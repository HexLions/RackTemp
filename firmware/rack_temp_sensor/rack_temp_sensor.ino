// Firmware per ESP32-C3 Super Mini + sensore SHT31-D (I2C via jumper wire).
// Legge temperatura/umidità e le invia via HTTP POST al backend rack-temp-monitor.
//
// Librerie richieste (Arduino Library Manager):
//   - Adafruit SHT31 Library
//   - Adafruit BusIO
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

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include "Adafruit_SHT31.h"
#include "config.h"

Adafruit_SHT31 sht31 = Adafruit_SHT31();

const unsigned long SEND_INTERVAL_MS = SEND_INTERVAL_SEC * 1000UL;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000UL;

bool announced = false;

// Identificativo stabile del chip, usato per la discovery (POST /api/discovery/announce)
// e incluso in ogni lettura così il server può ripulire la voce di discovery
// non appena il sensore inizia a mandare dati autenticati con l'API key vera.
String chipId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[17];
  snprintf(buf, sizeof(buf), "%016llX", mac);
  return String(buf);
}

// Prova a connettersi per un tempo limitato invece di bloccare all'infinito:
// se la rete è giù, meglio riprovare al prossimo ciclo che restare impiccati
// qui e non leggere/inviare più nulla finché non torna.
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
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

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (!sht31.begin(0x44)) {
    Serial.println("Sensore SHT31 non trovato, controlla il cablaggio I2C (SDA/SCL/3V3/GND).");
  }

  connectWiFi();
}

void sendReading(float temperature, float humidity) {
  if (!connectWiFi()) {
    Serial.println("Salto invio: WiFi non disponibile.");
    return;
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
  if (!announced && connectWiFi()) {
    announceDiscovery();
    announced = true;
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
