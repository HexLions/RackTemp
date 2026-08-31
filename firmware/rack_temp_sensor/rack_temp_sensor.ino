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
// automatic "sign in to network" popup): there you enter the WiFi and the RackTemp server's
// IP address (and port, only if it's not the default 7431) — the server (as of this firmware
// version) is always HTTPS, so there's no scheme to type. If you already know it, also enter
// the sensor's API key. Save: the device restarts and tries to connect. If you leave the API
// key empty, the sensor announces itself on the network and shows up in the dashboard under
// "Sensors discovered on the network" — see the README, section "Discovering sensors on the
// network".
//
// Also paste the server's certificate fingerprint (shown in the dashboard under Settings >
// Network) into the setup portal's fingerprint field: without it the connection is encrypted
// but not authenticated, so nothing stops an active on-path attacker from presenting their own
// certificate; with it, the sensor refuses to send data unless the live certificate matches
// byte-for-byte. Regenerating the server's certificate (or moving a sensor to a different
// server) means updating this field and re-saving on every sensor that talks to it.
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
#define FIRMWARE_VERSION "2026-08-31.2"

// OTA auto-update fetches and flashes a .bin over HTTPS, checked against
// the MD5 the server reports for it (HTTPUpdate.setMD5sum, see
// checkFirmwareUpdate below - the only hash arduino-esp32's HTTPUpdate class
// actually exposes, confirmed by reading the real installed HTTPUpdate.h;
// setSHA256sum doesn't exist on it despite an earlier version of this file
// claiming otherwise) — that catches corruption and a swapped file,
// but arduino-esp32's HTTPUpdate has no signature/authenticity API. So
// anyone able to ARP- or DNS-spoof cfgServerHost on the LAN
// can still serve their own .bin together with a matching hash and the check
// passes even over HTTPS. Real authenticity needs ESP-IDF Secure Boot v2 or an app-level
// RSA/ECDSA signature checked with mbedtls against an embedded public key,
// which needs its own signing step in the release pipeline — out of scope
// here, left for a future phase. Off by default; set to 1 only if you've
// weighed that remaining tradeoff for your network. The version check itself
// (just a GET, no download) still runs and logs when an update is available either way.
#define OTA_AUTO_UPDATE 1

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
#include <WiFiClientSecure.h>
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
// Single reused instance instead of a fresh local one per call (as this
// briefly was): NetworkClientSecure's constructor allocates a full mbedtls
// SSL context on the heap unconditionally - declaring one fresh in
// announceDiscovery()/checkFirmwareUpdate()/sendReading() meant doing that
// heap alloc+free on every single call (every 60s from sendReading alone),
// which on the ESP32-C3's limited RAM fragments the heap over time and can
// hang the device - confirmed on real hardware, not theoretical. Safe to
// share one instance across all call sites: loop() is single-threaded, no
// two of these ever run concurrently, and HTTPClient::end() (called after
// every use, see beginRequest()) always calls stop() on an externally
// supplied client (confirmed against arduino-esp32's own HTTPClient.cpp),
// so each call starts from a clean disconnected state.
WiFiClientSecure secureClient;
// Set by the portal's HTTP handlers, read (and cleared) by runSetupPortal()'s
// loop to reset its inactivity timeout — a real request is genuine activity,
// unlike the constant DNS queries every captive-portal-detection probe sends.
bool portalActivitySeen = false;

const unsigned long SEND_INTERVAL_MS = SEND_INTERVAL_SEC * 1000UL;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000UL;

String cfgSsid, cfgPassword, cfgServerHost, cfgApiKey, cfgCertFingerprint;

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
  // Same NVS key as before ("serverUrl") - only what's expected in it
  // changed across firmware versions: a sensor set up with an older
  // firmware may still have a full "http://..."/"https://..." URL saved
  // there (or, from the brief scheme-auto-detect version in between, a
  // bare host with no prefix at all) - stripping any prefix here means
  // cfgServerHost ends up as bare host[:port] regardless of which
  // previous version last wrote it, with nothing else to migrate since
  // the server is HTTPS-only now, there's no scheme left to guess.
  String stored = prefs.getString("serverUrl", "");
  if (stored.startsWith("https://")) {
    stored = stored.substring(8);
  } else if (stored.startsWith("http://")) {
    stored = stored.substring(7);
  }
  int slash = stored.indexOf('/');
  if (slash >= 0) stored = stored.substring(0, slash);
  cfgServerHost = stored;
  cfgApiKey = prefs.getString("apiKey", "");
  cfgCertFingerprint = prefs.getString("certFp", "");
  prefs.end();
  return cfgSsid.length() > 0 && cfgServerHost.length() > 0;
}

void saveConfig() {
  prefs.begin("racktemp", false);
  prefs.putString("ssid", cfgSsid);
  prefs.putString("password", cfgPassword);
  prefs.putString("serverUrl", cfgServerHost);
  prefs.putString("apiKey", cfgApiKey);
  prefs.putString("certFp", cfgCertFingerprint);
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
    "<label>RackTemp server IP address (HTTPS, no http:// or https:// prefix)</label>"
    "<input name='serverUrl' placeholder='192.168.1.50 (add :port only if not 7431)' value='" + htmlEscape(cfgServerHost) + "' required>"
    "<label>Sensor API key (optional)</label>"
    "<input name='apiKey' placeholder='" +
      String(cfgApiKey.length() > 0 ? "******** (leave empty to keep the current one)"
                                     : "leave it empty to get notified in the dashboard") +
      "'>"
    "<label>Server certificate fingerprint (recommended, optional)</label>"
    "<input name='certFp' placeholder='" +
      String(cfgCertFingerprint.length() > 0 ? "leave empty to keep the current one" : "SHA256, from the dashboard: Settings > Network") +
      "'>" +
      (cfgCertFingerprint.length() > 0
        ? "<label style='display:flex;align-items:center;gap:8px;margin-top:10px'>"
          "<input type='checkbox' name='clearFp' value='1' style='width:auto;margin:0'>"
          "Clear the saved fingerprint instead (check this if you're pointing at a different/rebuilt "
          "server - keeping the old one here would refuse to connect to the new one)"
          "</label>"
        : "") +
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
  String newServerHost = portalServer.arg("serverUrl");
  String newApiKey = portalServer.arg("apiKey");
  String newCertFingerprint = portalServer.arg("certFp");
  // Only present in the submitted form when the checkbox was actually
  // ticked (standard unchecked-checkbox-omits-the-field HTML behavior) -
  // lets "clear it" be a distinct, deliberate choice from "leave it
  // blank", which otherwise means "keep the current one" for every field
  // on this form, fingerprint included until now. Reconfiguring the same
  // sensor for a different (or rebuilt) server while keeping its old
  // fingerprint is exactly the case that used to silently refuse to
  // connect - fail-closed and correctly logged, but with no way back into
  // the portal to fix it other than realizing the fingerprint field was
  // the problem.
  bool clearFingerprint = portalServer.hasArg("clearFp");
  newSsid.trim();
  newServerHost.trim();
  newApiKey.trim();
  newCertFingerprint.trim();

  // The field only asks for a bare IP, but someone might still paste a
  // full URL out of habit (e.g. copied from a browser address bar) -
  // stripping it here rather than rejecting it is friendlier and correct
  // either way, since the server only ever speaks HTTPS regardless of
  // what was typed. A trailing "/..." would also break the host:port
  // parsing in beginRequest() later, so drop that too.
  if (newServerHost.startsWith("https://")) {
    newServerHost = newServerHost.substring(8);
  } else if (newServerHost.startsWith("http://")) {
    newServerHost = newServerHost.substring(7);
  }
  int savedSlash = newServerHost.indexOf('/');
  if (savedSlash >= 0) newServerHost = newServerHost.substring(0, savedSlash);

  if (newSsid.length() == 0 || newServerHost.length() == 0) {
    portalServer.send(400, "text/plain", "SSID and server address are required.");
    return;
  }

  cfgSsid = newSsid;
  if (newPassword.length() > 0) cfgPassword = newPassword; // empty = keep the saved one
  cfgServerHost = newServerHost;
  if (newApiKey.length() > 0) cfgApiKey = newApiKey; // empty = keep the saved one, same as the WiFi password
  // A typed fingerprint always wins; otherwise the checkbox explicitly
  // clears it (connects unpinned until re-pinned - see connectSecure()'s
  // comment); with neither, keep the existing one, same as every other
  // field on this form.
  if (newCertFingerprint.length() > 0) {
    cfgCertFingerprint = newCertFingerprint;
  } else if (clearFingerprint) {
    cfgCertFingerprint = "";
  }
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

// Splits a "host[:port]" server address (no scheme - see cfgServerHost) into
// its parts. WiFiClientSecure::connect() needs a bare host + port, unlike
// HTTPClient::begin(String) which parses a whole URL itself — this is only
// needed for the HTTPS path, where we have to open and verify the
// connection by hand before handing it to HTTPClient.
bool parseServerHost(const String &hostPort, String &host, uint16_t &port) {
  port = 7431; // this app's own default (see PORT in backend/src/index.ts)
  int colon = hostPort.indexOf(':');
  if (colon >= 0) {
    host = hostPort.substring(0, colon);
    port = (uint16_t)hostPort.substring(colon + 1).toInt();
  } else {
    host = hostPort;
  }
  return host.length() > 0;
}

// https:// + cfgServerHost + path, spelled out once instead of at every call site.
String buildUrl(const String &host, uint16_t port, const String &path) {
  return "https://" + host + ":" + String(port) + path;
}

// Plain #define int constants, not an enum class: arduino-esp32 (Arduino
// IDE) auto-generates function prototypes via a ctags-based prescan and
// inserts them right after the #include block, before any type defined
// later in the file - a custom enum/struct return type used by a
// function defined below that insertion point breaks with "does not
// name a type" (confirmed: this exact error, on this exact function,
// reported from a real compile). int sidesteps it entirely since it is
// always a known type, no matter where the auto-prototype lands.
#define CONNECT_OK 0
#define CONNECT_FAILED 1
#define CONNECT_FINGERPRINT_MISMATCH 2

// Opens and verifies the shared secureClient connection - shared between
// beginRequest() below and the OTA .bin download further down, both of
// which need the same connect-then-optionally-verify-fingerprint sequence
// before handing the client off (to HTTPClient or httpUpdate respectively).
int connectSecure(const String &host, uint16_t port) {
  // Default handshake timeout is 120 seconds (arduino-esp32's own
  // NetworkClientSecure constructor sets sslclient->handshake_timeout =
  // 120000 - confirmed by reading it directly) - loop() blocks for the
  // whole duration of connect() below, so a handshake that never
  // completes (a flaky AP or a server mid-restart is enough) would
  // otherwise stall the device for up to two minutes on every single
  // send, not just fail fast. 15s is generous for a real handshake
  // against this server's self-signed cert on an ESP32-C3, nowhere near
  // 120s.
  secureClient.setHandshakeTimeout(15000);
  // setInsecure() skips CA-chain validation — required just to let the TLS
  // handshake complete at all against the server's self-signed certificate
  // (arduino-esp32 refuses to negotiate with neither a CA nor this flag set,
  // confirmed by reading its ssl_client.cpp directly). verify() right after
  // is what actually provides the security guarantee: it recomputes the
  // live peer certificate's SHA256 fingerprint and compares it byte-for-byte
  // against cfgCertFingerprint, so the request only proceeds if it's
  // talking to the exact certificate configured in the setup portal — not
  // "any certificate for this host" the way normal CA validation would
  // accept. Without a fingerprint configured, the link is still encrypted
  // (defeats passive packet capture) but not authenticated against an
  // active MITM — same tradeoff called out in the setup portal's field.
  secureClient.setInsecure();
  if (!secureClient.connect(host.c_str(), port)) {
    secureClient.stop(); // defensive: this instance is reused across calls, never leave a half-open handshake behind
    return CONNECT_FAILED;
  }
  if (cfgCertFingerprint.length() > 0 && !secureClient.verify(cfgCertFingerprint.c_str(), nullptr)) {
    secureClient.stop();
    return CONNECT_FINGERPRINT_MISMATCH;
  }
  return CONNECT_OK;
}

// Prepares `http` for a request to cfgServerHost + path over HTTPS, via the
// shared global `secureClient` - which has to outlive this function since
// HTTPClient::begin(Client&, url) just borrows a reference to whatever it's
// handed, it doesn't take ownership.
// Returns false (nothing sent, caller should give up on this request) if
// the address can't be parsed, the TLS connection can't be opened, or the
// configured fingerprint doesn't match the live certificate - a mismatch
// always fails closed here, logged as a possible MITM, never treated as
// something to retry differently.
bool beginRequest(HTTPClient &http, const String &path) {
  String host;
  uint16_t port;
  if (!parseServerHost(cfgServerHost, host, port)) {
    Serial.println("Could not parse the configured RackTemp server address: " + cfgServerHost);
    return false;
  }

  int outcome = connectSecure(host, port);
  if (outcome == CONNECT_FINGERPRINT_MISMATCH) {
    Serial.println("Server certificate fingerprint does not match the configured one - refusing to send data (possible MITM).");
    return false;
  }
  if (outcome != CONNECT_OK) {
    Serial.println("HTTPS connection to the RackTemp server failed.");
    return false;
  }

  return http.begin(secureClient, buildUrl(host, port, path));
}

// Announces the chip to the server until you have an API key: it shows up in the dashboard
// as a "sensor discovered on the network" (notification on first sighting). If in the
// meantime an admin has linked this chip to a sensor — by creating a new one
// from the banner or linking it to an existing one — the server responds with its API
// key: we save it on our own, with no need to reopen the setup portal by hand.
void announceDiscovery() {
  if (cfgApiKey.length() > 0) return;

  HTTPClient http;
  if (!beginRequest(http, "/api/discovery/announce")) return;
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
  String latestVersion, latestMd5;
  if (!beginRequest(http, "/api/firmware/latest")) return;
  int code = http.GET();

  if (code == 200) {
    String payload = http.getString();
    latestVersion = jsonStringField(payload, "version");
    latestMd5 = jsonStringField(payload, "md5");
  }
  http.end();

  if (latestVersion.length() == 0 || latestVersion == FIRMWARE_VERSION) return;

#if OTA_AUTO_UPDATE
  // No verified hash from the server: refuse to flash rather than trust an
  // unverified download (an old server predating this field, or a striped/
  // malformed response, both look the same from here — fail closed either way).
  // 32 hex chars = MD5 - arduino-esp32's HTTPUpdate class only exposes
  // setMD5sum(), never setSHA256sum() (confirmed by reading the real
  // installed HTTPUpdate.h directly - a real compile error proved a
  // previous version of this file wrong about that).
  if (latestMd5.length() != 32) {
    Serial.println("New firmware available: " + latestVersion + " but server did not report an MD5 - not flashing.");
    return;
  }
  Serial.println("New firmware available: " + latestVersion + " (current: " FIRMWARE_VERSION "). Updating...");

  String host;
  uint16_t port;
  if (!parseServerHost(cfgServerHost, host, port)) {
    Serial.println("Could not parse the configured RackTemp server address, aborting OTA.");
    return;
  }

  httpUpdate.rebootOnUpdate(true);
  httpUpdate.setMD5sum(latestMd5);

  // httpUpdate opens and manages its own connection internally, so unlike
  // beginRequest() above there's no point between connect and download
  // where we could call verify() against the live peer certificate — only
  // setInsecure() is applied here (required for the handshake to complete
  // at all, same as beginRequest()/connectSecure()). The downloaded file
  // is still content-authenticated by the MD5 check just above; this
  // only adds encryption in transit against passive packet capture, not
  // fingerprint pinning against an active MITM.
  secureClient.setHandshakeTimeout(15000); // see connectSecure() - 120s default is too long to block loop() on
  secureClient.setInsecure();
  t_httpUpdate_return ret = httpUpdate.update(secureClient, buildUrl(host, port, "/api/firmware/latest.bin"));
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
  if (!beginRequest(http, "/api/ingest")) return;
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
