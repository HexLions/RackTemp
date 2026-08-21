// Firmware for ESP32-C3 Super Mini + SHT31-D sensor (I2C via jumper wire).
//
// No configuration to compile in: the same firmware works for every sensor.
// On first boot (or by holding BOOT while powering on) the device opens an access point
// "RackTemp-XXXXXXXX" with no password. Connect and open http://192.168.4.1 (or wait for the
// automatic "sign in to network" popup): there you enter the WiFi, the RackTemp server address and,
// if you already know it, the sensor's API key. Save: the device restarts and tries to connect.
// If you leave the API key empty, the sensor announces itself on the network and shows up in the dashboard under
// "Sensors discovered on the network" — see the README, section "Discovering sensors on the network".
//
// Required libraries (Arduino Library Manager):
//   - Adafruit SHT31 Library
//   - Adafruit BusIO
// (WiFi, WebServer, DNSServer, Preferences, HTTPClient, Wire are already included in the esp32 core)
//
// Board: "ESP32C3 Dev Module" (installable from Boards Manager -> esp32 by Espressif).
// On most "ESP32-C3 Super Mini" clones you'll also need the CH340 USB-serial driver
// to see it as a COM/tty port. If the flash doesn't start, hold BOOT
// while plugging in the USB cable.
//
// Wiring SHT31-D -> ESP32-C3 Super Mini (check the pinout printed on your
// board: clones aren't all identical; SDA/GPIO8 and SCL/GPIO9 are the most common):
//   VIN -> 3V3      GND -> GND      SCL -> GPIO9      SDA -> GPIO8
#define I2C_SDA_PIN 8
#define I2C_SCL_PIN 9

// Updated on every firmware change — printed over serial at boot,
// so you can quickly tell if the device is running the latest flashed version.
// Also used for OTA auto-update: if the server offers a different one, the
// device downloads it and flashes itself (see checkFirmwareUpdate below).
#define FIRMWARE_VERSION "2026-08-22.1"

// BOOT button, held down at power-on to re-enter WiFi setup. On many
// "Super Mini" clones it's on the same GPIO9 used above for SCL: we only read it at startup,
// BEFORE Wire.begin(), so it doesn't conflict — but if BOOT is on a different
// pin on your board, change this value.
#define BOOT_BUTTON_PIN 9

#define SEND_INTERVAL_SEC 60

#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
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

// Stable chip identifier, used for discovery (POST /api/discovery/announce),
// for the setup access point's name, and included in every reading so the server can
// clear the discovery entry as soon as data arrives authenticated with the real API key.
String chipId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[17];
  snprintf(buf, sizeof(buf), "%016llX", mac);
  return String(buf);
}

// ---------- saved configuration (NVS) ----------

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

// ---------- setup portal (access point + web page) ----------

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
  String options = "<option value=''>-- choose from the list or type below --</option>";
  if (n > 0) {
    for (int i = 0; i < n; i++) {
      String ssid = htmlEscape(WiFi.SSID(i));
      options += "<option value='" + ssid + "'>" + ssid + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
    }
  }

  String page =
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>RackTemp - Sensor setup</title>"
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
    "<p class='sub'>Sensor setup &mdash; chip " + chipId().substring(8) + "</p>"
    "<form method='POST' action='/save'>"
    "<label>WiFi network</label>"
    "<select onchange=\"document.getElementById('ssid').value=this.value\">" + options + "</select>"
    "<input id='ssid' name='ssid' placeholder='Network name (SSID)' value='" + htmlEscape(cfgSsid) + "' required>"
    "<label>WiFi password</label>"
    "<input type='password' name='password' placeholder='" + String(cfgPassword.length() > 0 ? "leave empty to keep the current one" : "Password") + "'>"
    "<label>RackTemp server address</label>"
    "<input name='serverUrl' placeholder='http://192.168.1.50:7431' value='" + htmlEscape(cfgServerUrl) + "' required>"
    "<label>Sensor API key (optional)</label>"
    "<input name='apiKey' placeholder='leave it empty to get notified in the dashboard' value='" + htmlEscape(cfgApiKey) + "'>"
    "<button type='submit'>Save and restart</button>"
    "<small>The sensor restarts and tries to connect. If you got something wrong, hold BOOT "
    "at power-on to come back to this page.</small>"
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
    portalServer.send(400, "text/plain", "SSID and server address are required.");
    return;
  }

  cfgSsid = newSsid;
  if (newPassword.length() > 0) cfgPassword = newPassword; // empty = keep the saved one
  cfgServerUrl = newServerUrl;
  cfgApiKey = newApiKey;
  saveConfig();

  portalServer.send(200, "text/html",
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    "<body style='font-family:system-ui,sans-serif;background:#0a0d12;color:#e6eaf0;padding:24px'>"
    "<h1>Saved &#10003;</h1><p>The sensor is restarting and will try to connect to \"" + htmlEscape(cfgSsid) + "\".</p>"
    "</body></html>");

  delay(800);
  ESP.restart();
}

void runSetupPortal() {
  WiFi.mode(WIFI_AP_STA);
  int found = WiFi.scanNetworks();
  Serial.printf("WiFi networks found: %d\n", found);

  String apName = "RackTemp-" + chipId().substring(8);
  WiFi.softAP(apName.c_str());
  IPAddress apIP = WiFi.softAPIP();

  dnsServer.start(53, "*", apIP);
  portalServer.on("/", HTTP_GET, handlePortalRoot);
  portalServer.on("/save", HTTP_POST, handlePortalSave);
  portalServer.onNotFound(handlePortalRoot);
  portalServer.begin();

  Serial.println("=== Setup mode ===");
  Serial.println("Connect to the WiFi network \"" + apName + "\" (no password)");
  Serial.println("then open http://" + apIP.toString() + " (or wait for the automatic popup).");

  while (true) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
  }
}

// ---------- normal operation ----------

// Tries to connect for a limited time instead of blocking forever: if the network
// is down, it's better to retry next cycle than get stuck here.
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  WiFi.mode(WIFI_STA);
  WiFi.begin(cfgSsid.c_str(), cfgPassword.c_str());
  Serial.print("Connecting to WiFi");

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(" failed, will retry next cycle.");
    return false;
  }

  Serial.println(" connected, IP: " + WiFi.localIP().toString());
  return true;
}

// Announces the chip to the server until you have an API key: it shows up in the dashboard
// as a "sensor discovered on the network" (notification on first sighting). If in the
// meantime an admin has linked this chip to a sensor — by creating a new one
// from the banner or linking it to an existing one — the server responds with its API
// key: we save it on our own, with no need to reopen the setup portal by hand.
void announceDiscovery() {
  if (cfgApiKey.length() > 0) return;

  HTTPClient http;
  http.begin(cfgServerUrl + "/api/discovery/announce");
  http.addHeader("Content-Type", "application/json");
  String body = "{\"chipId\":\"" + chipId() + "\",\"firmware\":\"rack_temp_sensor@" FIRMWARE_VERSION "\"}";
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
        Serial.println("API key received from the server, saved. Sending data from now on.");
      }
    }
  }

  http.end();
}

// Compares the version with the one offered by the server: if different, downloads the
// new .bin and reflashes itself (HTTPUpdate only writes the OTA app
// partition — the NVS where WiFi/server/API key are saved is not touched,
// so the configuration survives the update intact).
void checkFirmwareUpdate() {
  HTTPClient http;
  http.begin(cfgServerUrl + "/api/firmware/latest");
  int code = http.GET();
  String latestVersion;

  if (code == 200) {
    String payload = http.getString();
    int start = payload.indexOf("\"version\":\"");
    if (start >= 0) {
      start += 11;
      int end = payload.indexOf('"', start);
      if (end > start) latestVersion = payload.substring(start, end);
    }
  }
  http.end();

  if (latestVersion.length() == 0 || latestVersion == FIRMWARE_VERSION) return;

  Serial.println("New firmware available: " + latestVersion + " (current: " FIRMWARE_VERSION "). Updating...");
  WiFiClient client;
  httpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return ret = httpUpdate.update(client, cfgServerUrl + "/api/firmware/latest.bin");
  if (ret != HTTP_UPDATE_OK) {
    Serial.printf("OTA failed: %s\n", httpUpdate.getLastErrorString().c_str());
  }
  // If ret == HTTP_UPDATE_OK the device restarts on its own (rebootOnUpdate).
}

void sendReading(float temperature, float humidity) {
  if (cfgApiKey.length() == 0) {
    Serial.println("No API key configured: waiting to be linked from the dashboard.");
    return;
  }

  if (!connectWiFi()) {
    Serial.println("Skipping send: WiFi not available.");
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
                ",\"chipId\":\"" + chipId() + "\"" +
                ",\"firmwareVersion\":\"" FIRMWARE_VERSION "\"}";

  int code = http.POST(body);
  Serial.printf("POST /api/ingest -> %d\n", code);
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("=== RackTemp ESP32-C3/SHT31-D - firmware " FIRMWARE_VERSION " ===");

  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  bool forceSetup = (digitalRead(BOOT_BUTTON_PIN) == LOW);

  bool haveConfig = loadConfig();

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  if (!sht31.begin(0x44)) {
    Serial.println("SHT31 sensor not found, check the I2C wiring (SDA/SCL/3V3/GND).");
  }

  if (!haveConfig || forceSetup) {
    runSetupPortal(); // doesn't return: stays here until you save, then restarts the device
  }

  connectWiFi();
}

unsigned long lastOtaCheck = 0;
const unsigned long OTA_CHECK_INTERVAL_MS = 24UL * 3600 * 1000;

void loop() {
  if (cfgApiKey.length() == 0 && connectWiFi()) {
    announceDiscovery();
  }

  if (cfgApiKey.length() > 0 && connectWiFi() &&
      (lastOtaCheck == 0 || millis() - lastOtaCheck > OTA_CHECK_INTERVAL_MS)) {
    checkFirmwareUpdate();
    lastOtaCheck = millis();
  }

  float temperature = sht31.readTemperature();
  float humidity = sht31.readHumidity();

  if (!isnan(temperature) && !isnan(humidity)) {
    Serial.printf("Temp: %.2f C  Hum: %.2f %%\n", temperature, humidity);
    sendReading(temperature, humidity);
  } else {
    Serial.println("Sensor reading failed.");
  }

  delay(SEND_INTERVAL_MS);
}
