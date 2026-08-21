// Firmware per ESP32-C3 Super Mini + sensore SHT31-D (I2C via jumper wire).
//
// Nessuna configurazione da compilare: lo stesso firmware va bene per tutti i sensori.
// Al primo avvio (o tenendo premuto BOOT all'accensione) il device apre un access point
// "RackTemp-XXXXXXXX" senza password. Connettiti e apri http://192.168.4.1 (o aspetta il
// popup automatico "accedi alla rete"): lì inserisci WiFi, indirizzo del server RackTemp e,
// se già la conosci, l'API key del sensore. Salva: il device si riavvia e prova a collegarsi.
// Se lasci l'API key vuota, il sensore si annuncia sulla rete e compare nella dashboard sotto
// "Sensori rilevati in rete" — vedi il README, sezione "Rilevamento sensori in rete".
//
// Librerie richieste (Arduino Library Manager):
//   - Adafruit SHT31 Library
//   - Adafruit BusIO
// (WiFi, WebServer, DNSServer, Preferences, HTTPClient, Wire sono già incluse nel core esp32)
//
// Board: "ESP32C3 Dev Module" (installabile da Boards Manager -> esp32 by Espressif).
// Sulla maggior parte dei cloni "ESP32-C3 Super Mini" serve anche il driver USB-seriale
// CH340 per vederla come porta COM/tty. Se il flash non parte, tieni premuto BOOT
// mentre colleghi il cavo USB.
//
// Cablaggio SHT31-D -> ESP32-C3 Super Mini (verifica la piedinatura stampata sulla tua
// scheda: i cloni non sono tutti identici; SDA/GPIO8 e SCL/GPIO9 sono i più comuni):
//   VIN -> 3V3      GND -> GND      SCL -> GPIO9      SDA -> GPIO8
#define I2C_SDA_PIN 8
#define I2C_SCL_PIN 9

// Pulsante BOOT, tenuto premuto all'accensione per rientrare nel setup WiFi. Su molti
// cloni "Super Mini" è sullo stesso GPIO9 usato sopra per SCL: lo leggiamo solo all'avvio,
// PRIMA di Wire.begin(), quindi non confligge — ma se sulla tua scheda BOOT è su un altro
// pin, cambia questo valore.
#define BOOT_BUTTON_PIN 9

#define SEND_INTERVAL_SEC 60

#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <Wire.h>
#include "Adafruit_SHT31.h"

Adafruit_SHT31 sht31 = Adafruit_SHT31();
Preferences prefs;
WebServer portalServer(80);
DNSServer dnsServer;

const unsigned long SEND_INTERVAL_MS = SEND_INTERVAL_SEC * 1000UL;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000UL;

String cfgSsid, cfgPassword, cfgServerUrl, cfgApiKey;

// Identificativo stabile del chip, usato per la discovery (POST /api/discovery/announce),
// per il nome dell'access point di setup, e incluso in ogni lettura così il server può
// ripulire la voce di discovery non appena arriva un dato autenticato con l'API key vera.
String chipId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[17];
  snprintf(buf, sizeof(buf), "%016llX", mac);
  return String(buf);
}

// ---------- configurazione salvata (NVS) ----------

bool loadConfig() {
  prefs.begin("racktemp", true);
  cfgSsid = prefs.getString("ssid", "");
  cfgPassword = prefs.getString("password", "");
  cfgServerUrl = prefs.getString("serverUrl", "");
  cfgApiKey = prefs.getString("apiKey", "");
  prefs.end();
  return cfgSsid.length() > 0 && cfgServerUrl.length() > 0;
}

void saveConfig() {
  prefs.begin("racktemp", false);
  prefs.putString("ssid", cfgSsid);
  prefs.putString("password", cfgPassword);
  prefs.putString("serverUrl", cfgServerUrl);
  prefs.putString("apiKey", cfgApiKey);
  prefs.end();
}

// ---------- portale di setup (access point + pagina web) ----------

String htmlEscape(const String &s) {
  String out = s;
  out.replace("&", "&amp;");
  out.replace("\"", "&quot;");
  out.replace("<", "&lt;");
  out.replace(">", "&gt;");
  return out;
}

void handlePortalRoot() {
  int n = WiFi.scanComplete();
  String options = "<option value=''>-- scegli dall'elenco o scrivi sotto --</option>";
  if (n > 0) {
    for (int i = 0; i < n; i++) {
      String ssid = htmlEscape(WiFi.SSID(i));
      options += "<option value='" + ssid + "'>" + ssid + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
    }
  }

  String page =
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>RackTemp - Setup sensore</title>"
    "<style>"
    "body{font-family:system-ui,sans-serif;background:#0a0d12;color:#e6eaf0;padding:24px;max-width:420px;margin:0 auto}"
    "h1{font-size:1.2rem;margin-bottom:4px}"
    "p.sub{color:#7c8797;font-size:.85rem;margin-top:0}"
    "label{display:block;margin:16px 0 4px;color:#9aa4b2;font-size:.85rem}"
    "input,select{width:100%;padding:9px;border-radius:6px;border:1px solid #2a3345;background:#05070a;color:#e6eaf0;box-sizing:border-box;font-size:1rem}"
    "button{margin-top:20px;width:100%;padding:12px;border:none;border-radius:6px;background:#4fb3a6;color:#06211d;font-weight:700;font-size:1rem}"
    "small{color:#7c8797;display:block;margin-top:14px;line-height:1.4}"
    "</style></head><body>"
    "<h1>&#127777; RackTemp</h1>"
    "<p class='sub'>Setup sensore &mdash; chip " + chipId().substring(8) + "</p>"
    "<form method='POST' action='/save'>"
    "<label>Rete WiFi</label>"
    "<select onchange=\"document.getElementById('ssid').value=this.value\">" + options + "</select>"
    "<input id='ssid' name='ssid' placeholder='Nome rete (SSID)' value='" + htmlEscape(cfgSsid) + "' required>"
    "<label>Password WiFi</label>"
    "<input type='password' name='password' placeholder='" + String(cfgPassword.length() > 0 ? "lascia vuoto per mantenere quella attuale" : "Password") + "'>"
    "<label>Indirizzo server RackTemp</label>"
    "<input name='serverUrl' placeholder='http://192.168.1.50:7431' value='" + htmlEscape(cfgServerUrl) + "' required>"
    "<label>API key sensore (opzionale)</label>"
    "<input name='apiKey' placeholder='lasciala vuota per farti notificare in dashboard' value='" + htmlEscape(cfgApiKey) + "'>"
    "<button type='submit'>Salva e riavvia</button>"
    "<small>Il sensore si riavvia e prova a collegarsi. Se sbagli qualcosa, tieni premuto BOOT "
    "all'accensione per rientrare in questa pagina.</small>"
    "</form></body></html>";

  portalServer.send(200, "text/html", page);
}

void handlePortalSave() {
  String newSsid = portalServer.arg("ssid");
  String newPassword = portalServer.arg("password");
  String newServerUrl = portalServer.arg("serverUrl");
  String newApiKey = portalServer.arg("apiKey");
  newSsid.trim();
  newServerUrl.trim();
  newApiKey.trim();

  if (newSsid.length() == 0 || newServerUrl.length() == 0) {
    portalServer.send(400, "text/plain", "SSID e indirizzo server sono obbligatori.");
    return;
  }

  cfgSsid = newSsid;
  if (newPassword.length() > 0) cfgPassword = newPassword; // vuoto = mantieni quella salvata
  cfgServerUrl = newServerUrl;
  cfgApiKey = newApiKey;
  saveConfig();

  portalServer.send(200, "text/html",
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    "<body style='font-family:system-ui,sans-serif;background:#0a0d12;color:#e6eaf0;padding:24px'>"
    "<h1>Salvato &#10003;</h1><p>Il sensore si riavvia e prova a collegarsi a \"" + htmlEscape(cfgSsid) + "\".</p>"
    "</body></html>");

  delay(800);
  ESP.restart();
}

void runSetupPortal() {
  WiFi.mode(WIFI_AP_STA);
  int found = WiFi.scanNetworks();
  Serial.printf("Reti WiFi trovate: %d\n", found);

  String apName = "RackTemp-" + chipId().substring(8);
  WiFi.softAP(apName.c_str());
  IPAddress apIP = WiFi.softAPIP();

  dnsServer.start(53, "*", apIP);
  portalServer.on("/", HTTP_GET, handlePortalRoot);
  portalServer.on("/save", HTTP_POST, handlePortalSave);
  portalServer.onNotFound(handlePortalRoot);
  portalServer.begin();

  Serial.println("=== Modalita' setup ===");
  Serial.println("Connettiti alla rete WiFi \"" + apName + "\" (nessuna password)");
  Serial.println("poi apri http://" + apIP.toString() + " (o aspetta il popup automatico).");

  while (true) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
  }
}

// ---------- funzionamento normale ----------

// Prova a connettersi per un tempo limitato invece di bloccare all'infinito: se la rete
// è giù, meglio riprovare al prossimo ciclo che restare impiccati qui.
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  WiFi.mode(WIFI_STA);
  WiFi.begin(cfgSsid.c_str(), cfgPassword.c_str());
  Serial.print("Connessione WiFi");

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(" non riuscita, riprovo al prossimo ciclo.");
    return false;
  }

  Serial.println(" connesso, IP: " + WiFi.localIP().toString());
  return true;
}

// Annuncia il chip al server finché non hai una API key: compare nella dashboard
// come "sensore rilevato in rete" (notifica al primo avvistamento). Se nel
// frattempo un admin ha collegato questo chip a un sensore — creandone uno nuovo
// dal banner o linkandolo a uno esistente — il server risponde con la sua API
// key: la salviamo da soli, senza dover riaprire il portale di setup a mano.
void announceDiscovery() {
  if (cfgApiKey.length() > 0) return;

  HTTPClient http;
  http.begin(cfgServerUrl + "/api/discovery/announce");
  http.addHeader("Content-Type", "application/json");
  String body = "{\"chipId\":\"" + chipId() + "\",\"firmware\":\"rack_temp_sensor\"}";
  int code = http.POST(body);
  Serial.printf("POST /api/discovery/announce -> %d\n", code);

  if (code == 200) {
    String payload = http.getString();
    int start = payload.indexOf("\"apiKey\":\"");
    if (start >= 0) {
      start += 10;
      int end = payload.indexOf('"', start);
      if (end > start) {
        cfgApiKey = payload.substring(start, end);
        saveConfig();
        Serial.println("API key ricevuta dal server, salvata. Da ora invio i dati.");
      }
    }
  }

  http.end();
}

void sendReading(float temperature, float humidity) {
  if (cfgApiKey.length() == 0) {
    Serial.println("Nessuna API key configurata: in attesa di essere collegato dalla dashboard.");
    return;
  }

  if (!connectWiFi()) {
    Serial.println("Salto invio: WiFi non disponibile.");
    return;
  }

  HTTPClient http;
  http.begin(cfgServerUrl + "/api/ingest");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Api-Key", cfgApiKey);

  int rssi = WiFi.RSSI();
  String body = "{\"temperature\":" + String(temperature, 2) +
                ",\"humidity\":" + String(humidity, 2) +
                ",\"rssi\":" + String(rssi) +
                ",\"chipId\":\"" + chipId() + "\"}";

  int code = http.POST(body);
  Serial.printf("POST /api/ingest -> %d\n", code);
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  bool forceSetup = (digitalRead(BOOT_BUTTON_PIN) == LOW);

  bool haveConfig = loadConfig();

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  if (!sht31.begin(0x44)) {
    Serial.println("Sensore SHT31 non trovato, controlla il cablaggio I2C (SDA/SCL/3V3/GND).");
  }

  if (!haveConfig || forceSetup) {
    runSetupPortal(); // non ritorna: resta qui finché non salvi, poi riavvia il device
  }

  connectWiFi();
}

void loop() {
  if (cfgApiKey.length() == 0 && connectWiFi()) {
    announceDiscovery();
  }

  float temperature = sht31.readTemperature();
  float humidity = sht31.readHumidity();

  if (!isnan(temperature) && !isnan(humidity)) {
    Serial.printf("Temp: %.2f C  Hum: %.2f %%\n", temperature, humidity);
    sendReading(temperature, humidity);
  } else {
    Serial.println("Lettura sensore fallita.");
  }

  delay(SEND_INTERVAL_MS);
}
