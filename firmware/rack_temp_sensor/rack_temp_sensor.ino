// Firmware for ESP32-C3 Super Mini + SHT31-D sensor (I2C via jumper wire).
//
// No configuration to compile in: the same firmware works for every sensor.
// On first boot the device opens an access point "RackTemp-XXXXXXXX" — the
// password is the same XXXXXXXX suffix (also printed over serial). To
// reopen it later on an already-configured device, power it on
// normally, then hold BOOT for 2 seconds AFTER it's already running (not
// while powering on — see the BOOT_BUTTON_PIN comment below for why). The
// portal closes on its own after 10 minutes of inactivity.
// Connect and open http://192.168.4.1 (or wait for the
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
#define FIRMWARE_VERSION "2026-08-27.2"

// OTA auto-update fetches and flashes a .bin over plain HTTP, checked against
// the SHA256 the server reports for it (HTTPUpdate.setSHA256sum, see
// checkFirmwareUpdate below) — that catches corruption and a swapped file,
// but arduino-esp32's HTTPUpdate has no signature/authenticity API (checked
// against core 3.3.11's actual HTTPUpdate.h: setMD5sum/setSHA256sum exist,
// nothing else). So anyone able to ARP- or DNS-spoof cfgServerUrl on the LAN
// can still serve their own .bin together with a matching hash and the check
// passes. Real authenticity needs ESP-IDF Secure Boot v2 or an app-level
// RSA/ECDSA signature checked with mbedtls against an embedded public key,
// which needs its own signing step in the release pipeline — out of scope
// here, left for a future phase. Off by default; set to 1 only if you've
// weighed that remaining tradeoff for your network. The version check itself
// (just a GET, no download) still runs and logs when an update is available either way.
#define OTA_AUTO_UPDATE 0

// BOOT button, held down AFTER boot (not at power-on — see setup()) to
// re-enter WiFi setup. On many "Super Mini" clones it's on the same GPIO9
// used above for SCL, and it's also the chip's own boot-strapping pin: on
// ESP32-C3 specifically, holding GPIO9 low at the moment of power-on/reset
// makes the ROM bootloader enter UART download mode instead of running this
// sketch, so it can only be read safely once the sketch is already up. If
// BOOT is on a different pin on your board, change this value.
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
// Set by the portal's HTTP handlers, read (and cleared) by runSetupPortal()'s
// loop to reset its inactivity timeout — a real request is genuine activity,
// unlike the constant DNS queries every captive-portal-detection probe sends.
bool portalActivitySeen = false;

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

// Same color tokens and "card" shape as the web app (frontend/src/styles.css),
// light by default with a prefers-color-scheme dark variant, so the setup
// portal doesn't look like a different, older product from the dashboard
// you land on right after saving.
#define PORTAL_STYLE \
  "<style>" \
  ":root{--bg:#eef0f2;--panel:#fff;--line:#dfe2e5;--paper:#20242a;--dim:#667085;" \
  "--accent:#4c9a2a;--accent-strong:#3d7d21;--accent-ink:#fff;--radius:14px;--radius-sm:10px;" \
  "--font-ui:'Segoe UI',-apple-system,BlinkMacSystemFont,system-ui,sans-serif}" \
  "@media (prefers-color-scheme:dark){:root{--bg:#1a1c20;--panel:#24262b;--line:#34373e;" \
  "--paper:#f0f1f3;--dim:#9aa0aa;--accent:#6dc24b;--accent-strong:#85d467;--accent-ink:#0d1a08}}" \
  "*{box-sizing:border-box}" \
  "body{font-family:var(--font-ui);background:var(--bg);color:var(--paper);margin:0;padding:24px 16px}" \
  ".card{max-width:400px;margin:0 auto;background:var(--panel);border:1px solid var(--line);" \
  "border-radius:var(--radius);padding:24px;box-shadow:0 1px 2px rgba(0,0,0,.08)}" \
  ".brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:1.05rem;margin-bottom:2px}" \
  "p.sub{color:var(--dim);font-size:.85rem;margin:0 0 4px}" \
  "label{display:block;margin:16px 0 4px;color:var(--dim);font-size:.85rem;font-weight:500}" \
  "input,select{width:100%;padding:10px;border-radius:var(--radius-sm);border:1px solid var(--line);" \
  "background:var(--bg);color:var(--paper);box-sizing:border-box;font-size:1rem;font-family:inherit}" \
  "input:focus,select:focus{outline:2px solid var(--accent);outline-offset:-1px}" \
  "button{margin-top:22px;width:100%;padding:12px;border:none;border-radius:var(--radius-sm);" \
  "background:var(--accent);color:var(--accent-ink);font-weight:650;font-size:1rem}" \
  "button:hover{background:var(--accent-strong)}" \
  "small{color:var(--dim);display:block;margin-top:14px;line-height:1.4;font-size:.8rem}" \
  "</style>"

// Same brand mark as frontend/src/components/Logo.tsx and frontend/public/racktemp.svg.
#define PORTAL_LOGO \
  "<div class='brand'>" \
  "<svg width='26' height='26' viewBox='0 0 64 64' role='img' aria-label='RackTemp'>" \
  "<rect width='64' height='64' rx='14' fill='#0E1214'/>" \
  "<rect x='9' y='13' width='28' height='9' rx='3' fill='#2A3338'/>" \
  "<rect x='9' y='28' width='28' height='9' rx='3' fill='#2A3338'/>" \
  "<rect x='9' y='43' width='46' height='9' rx='3' fill='#2A3338'/>" \
  "<circle cx='31' cy='17.5' r='2' fill='#5A676D'/>" \
  "<circle cx='31' cy='32.5' r='2' fill='#F0B429'/>" \
  "<rect x='43' y='11' width='7' height='17' rx='3.5' fill='#2FD07A'/>" \
  "<circle cx='46.5' cy='31' r='7.5' fill='#2FD07A'/>" \
  "</svg>RackTemp</div>"

void handlePortalRoot() {
  portalActivitySeen = true;
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
    PORTAL_STYLE
    "</head><body><div class='card'>"
    PORTAL_LOGO
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
    "<input name='apiKey' placeholder='" +
      String(cfgApiKey.length() > 0 ? "******** (leave empty to keep the current one)"
                                     : "leave it empty to get notified in the dashboard") +
      "'>"
    "<button type='submit'>Save and restart</button>"
    "<small>The sensor restarts and tries to connect. If you got something wrong, power it on "
    "and hold BOOT for 2s once it's already running to come back to this page.</small>"
    "</form></div></body></html>";

  portalServer.send(200, "text/html", page);
}

void handlePortalSave() {
  portalActivitySeen = true;
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
  if (newApiKey.length() > 0) cfgApiKey = newApiKey; // empty = keep the saved one, same as the WiFi password
  saveConfig();

  portalServer.send(200, "text/html",
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    PORTAL_STYLE
    "</head><body><div class='card'>"
    PORTAL_LOGO
    "<p class='sub'>Saved &#10003;</p><p>The sensor is restarting and will try to connect to \"" + htmlEscape(cfgSsid) + "\".</p>"
    "</div></body></html>");

  delay(800);
  ESP.restart();
}

void runSetupPortal() {
  WiFi.mode(WIFI_AP_STA);
  int found = WiFi.scanNetworks();
  Serial.printf("WiFi networks found: %d\n", found);

  String apName = "RackTemp-" + chipId().substring(8);
  // Not a strong secret — it's derived from the chip's own ID, printed right
  // below on the same serial line anyone flashing/debugging the device
  // already has access to. But an open AP meant anyone in WiFi range could
  // join and reach the setup portal with zero barrier; this at least
  // requires physical/serial access to the device to read the password,
  // same bar as reopening the portal in the first place (hold BOOT).
  String apPassword = chipId().substring(8);
  WiFi.softAP(apName.c_str(), apPassword.c_str());
  IPAddress apIP = WiFi.softAPIP();

  dnsServer.start(53, "*", apIP);
  portalServer.on("/", HTTP_GET, handlePortalRoot);
  portalServer.on("/save", HTTP_POST, handlePortalSave);
  portalServer.onNotFound(handlePortalRoot);
  portalServer.begin();

  Serial.println("=== Setup mode ===");
  Serial.println("Connect to the WiFi network \"" + apName + "\", password: " + apPassword);
  Serial.println("then open http://" + apIP.toString() + " (or wait for the automatic popup).");

  unsigned long lastActivity = millis();
  const unsigned long PORTAL_TIMEOUT_MS = 10UL * 60 * 1000;
  while (millis() - lastActivity < PORTAL_TIMEOUT_MS) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    if (portalActivitySeen) {
      lastActivity = millis();
      portalActivitySeen = false;
    }
  }

  // Left open with no activity for too long, instead of indefinitely:
  // restarting re-enters setup() fresh, which reopens the portal again if
  // still unconfigured, or connects normally if a config was already saved
  // (e.g. this was a BOOT-reopened portal nobody finished editing).
  Serial.println("Setup portal timed out after 10 minutes of inactivity, restarting.");
  ESP.restart();
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
// Extracts a top-level "key":"value" string field from a small flat JSON
// payload — same hand-rolled approach already used elsewhere in this file
// (announceDiscovery, sendReading) rather than pulling in a JSON library
// for a couple of fields.
String jsonStringField(const String &payload, const char *key) {
  String needle = String("\"") + key + "\":\"";
  int start = payload.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = payload.indexOf('"', start);
  if (end <= start) return "";
  return payload.substring(start, end);
}

void checkFirmwareUpdate() {
  HTTPClient http;
  http.begin(cfgServerUrl + "/api/firmware/latest");
  int code = http.GET();
  String latestVersion, latestSha256;

  if (code == 200) {
    String payload = http.getString();
    latestVersion = jsonStringField(payload, "version");
    latestSha256 = jsonStringField(payload, "sha256");
  }
  http.end();

  if (latestVersion.length() == 0 || latestVersion == FIRMWARE_VERSION) return;

#if OTA_AUTO_UPDATE
  // No verified hash from the server: refuse to flash rather than trust an
  // unverified download (an old server predating FASE 4.2, or a striped/
  // malformed response, both look the same from here — fail closed either way).
  if (latestSha256.length() != 64) {
    Serial.println("New firmware available: " + latestVersion + " but server did not report a SHA256 - not flashing.");
    return;
  }
  Serial.println("New firmware available: " + latestVersion + " (current: " FIRMWARE_VERSION "). Updating...");
  WiFiClient client;
  httpUpdate.rebootOnUpdate(true);
  httpUpdate.setSHA256sum(latestSha256);
  t_httpUpdate_return ret = httpUpdate.update(client, cfgServerUrl + "/api/firmware/latest.bin");
  if (ret != HTTP_UPDATE_OK) {
    Serial.printf("OTA failed: %s\n", httpUpdate.getLastErrorString().c_str());
  }
  // If ret == HTTP_UPDATE_OK the device restarts on its own (rebootOnUpdate).
#else
  Serial.println("New firmware available: " + latestVersion + " (current: " FIRMWARE_VERSION
                  ") - OTA_AUTO_UPDATE is off, not flashing. Reflash manually to update.");
#endif
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

  // The dashboard has no direct connection to the sensor to push a remote
  // reboot to, so it rides along in the response to whatever we send next:
  // {"ok":true,"reboot":true} if an admin requested one via Settings.
  if (code == 201 || code == 200) {
    String response = http.getString();
    if (response.indexOf("\"reboot\":true") >= 0) {
      Serial.println("Reboot requested from the dashboard, restarting...");
      http.end();
      delay(300);
      ESP.restart();
    }
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("=== RackTemp ESP32-C3/SHT31-D - firmware " FIRMWARE_VERSION " ===");

  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);

  bool haveConfig = loadConfig();

  // BOOT_BUTTON_PIN (GPIO9) is also the ESP32-C3's own boot-strapping pin
  // AND the I2C SCL line used below: holding it low DURING power-on/reset
  // makes the ROM bootloader enter UART download mode instead of running
  // this sketch at all, so it can only be checked here, after the sketch
  // is already running — press and hold BOOT for a couple of seconds
  // AFTER powering the device on, not while. This has to happen BEFORE
  // Wire.begin(): once the I2C peripheral takes over the pin, digitalRead()
  // reflects the I2C bus instead of the button and this check stops working.
  bool forceSetup = false;
  if (haveConfig) {
    Serial.println("Hold BOOT now for 2s to reopen the setup portal...");
    unsigned long waitStart = millis();
    while (millis() - waitStart < 2000) {
      if (digitalRead(BOOT_BUTTON_PIN) == LOW) {
        forceSetup = true;
        break;
      }
      delay(50);
    }
  }

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
