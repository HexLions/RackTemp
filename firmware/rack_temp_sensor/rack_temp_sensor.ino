// Firmware per Adafruit QT Py ESP32-S2 + sensore STEMMA QT SHT31-D / SHT40
// Legge temperatura/umidità e le invia via HTTP POST al backend rack-temp-monitor.
//
// Librerie richieste (Arduino Library Manager):
//   - Adafruit SHT31 Library (per SHT31-D)  -- oppure Adafruit SHT4x Library (per SHT40)
//   - Adafruit BusIO
//
// Board: "Adafruit QT Py ESP32-S2" (installabile da Boards Manager -> esp32 by Espressif)

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include "Adafruit_SHT31.h"
#include "config.h"

Adafruit_SHT31 sht31 = Adafruit_SHT31();

const unsigned long SEND_INTERVAL_MS = SEND_INTERVAL_SEC * 1000UL;

// Identificativo stabile del chip, usato per la discovery (POST /api/discovery/announce)
// e incluso in ogni lettura così il server può ripulire la voce di discovery
// non appena il sensore inizia a mandare dati autenticati con l'API key vera.
String chipId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[17];
  snprintf(buf, sizeof(buf), "%016llX", mac);
  return String(buf);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connessione WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println(" connesso, IP: " + WiFi.localIP().toString());
}

// Annuncia il chip al server: se non esiste ancora un sensore configurato con
// questa API key, comparirà nella dashboard come "sensore rilevato in rete"
// con una notifica, per evitare di dover cercare l'IP a mano.
void announceDiscovery() {
  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/discovery/announce");
  http.addHeader("Content-Type", "application/json");
  String body = "{\"chipId\":\"" + chipId() + "\",\"firmware\":\"rack_temp_sensor\"}";
  int code = http.POST(body);
  Serial.printf("POST /api/discovery/announce -> %d\n", code);
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  // QT Py ESP32-S2: STEMMA QT è su Wire di default (SDA=41, SCL=40).
  Wire.begin();

  if (!sht31.begin(0x44)) {
    Serial.println("Sensore SHT31/SHT40 non trovato, controlla il cablaggio STEMMA QT.");
  }

  connectWiFi();
  announceDiscovery();
}

void sendReading(float temperature, float humidity) {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/ingest");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Api-Key", API_KEY);

  int rssi = WiFi.RSSI();
  String body = "{\"temperature\":" + String(temperature, 2) +
                ",\"humidity\":" + String(humidity, 2) +
                ",\"rssi\":" + String(rssi) +
                ",\"chipId\":\"" + chipId() + "\"}";

  int code = http.POST(body);
  Serial.printf("POST /api/ingest -> %d\n", code);
  http.end();
}

void loop() {
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
