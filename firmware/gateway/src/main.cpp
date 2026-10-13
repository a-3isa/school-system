// School platform BLE gateway (ESP32).
//
// Listens for student straps (FSC-BP107D beacons) and every few seconds
// publishes what it heard to MQTT topic gw/<serial>/sightings:
//   {"firmware":"1.0.0","sightings":[{"mac":"DC:0D:30:AA:4A:11","rssi":-61,"at":1759212000000,"battery":82}]}
// The platform decides arrivals and lesson attendance from these reports.
// An empty report doubles as a heartbeat, so the dashboard knows the gateway is alive.

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <esp_task_wdt.h>
#include <map>
#include <mutex>
#include <vector>
#include <time.h>
#include <sightings.h>
#include "config.h"
#include "ca_cert.h"

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "dev"
#endif

static const uint32_t MAX_BUFFERED = 1500;  // sightings kept while offline
static const int LED_PIN = 2;

GatewayConfig cfg;
WiFiClientSecure tlsClient;
WiFiClient plainClient;
PubSubClient mqtt;

// Loudest reading per strap in the current window, and reports waiting to be sent.
// What is done with them (keeping the loudest, the battery, the prefix, the backlog cap)
// lives in lib/sightings so it can be tested on a computer.
sightings::Window window;
std::mutex windowLock;  // the BLE callback runs on the NimBLE task
sightings::Backlog backlog;

uint64_t nowMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (uint64_t)tv.tv_sec * 1000ULL + tv.tv_usec / 1000;
}

bool clockSet() { return time(nullptr) > 1700000000; }

// Eddystone-TLM carries the battery voltage (see sightings::batteryPercent).
int batteryFromTlm(NimBLEAdvertisedDevice* dev) {
  if (!dev->haveServiceData()) return -1;
  std::string data = dev->getServiceData(NimBLEUUID((uint16_t)0xFEAA));
  if (data.size() < 4 || (uint8_t)data[0] != 0x20) return -1;
  int mv = ((uint8_t)data[2] << 8) | (uint8_t)data[3];
  return sightings::batteryPercent(mv);
}

class ScanCallbacks : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* dev) override {
    std::string mac = dev->getAddress().toString();
    for (auto& c : mac) c = toupper(c);
    if (!sightings::macAllowed(mac, cfg.macPrefix.c_str())) return;
    int rssi = dev->getRSSI();
    if (rssi < cfg.minRssi) return;
    int battery = batteryFromTlm(dev);
    uint64_t at = clockSet() ? nowMs() : 0;
    std::lock_guard<std::mutex> guard(windowLock);
    sightings::hear(window, mac, rssi, at, battery);
  }
};

void startScan() {
  NimBLEDevice::init("");
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new ScanCallbacks(), true);  // true = report repeats
  scan->setActiveScan(false);  // passive: straps don't need to answer
  scan->setInterval(100);
  scan->setWindow(90);  // leave a little radio time for Wi-Fi
  scan->setDuplicateFilter(false);
  scan->start(0, nullptr, false);  // scan forever
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.wifiSsid.c_str(), cfg.wifiPass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
    esp_task_wdt_reset();
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Wi-Fi connected, IP %s\n", WiFi.localIP().toString().c_str());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  }
}

bool connectMqtt() {
  if (mqtt.connected()) return true;
  if (WiFi.status() != WL_CONNECTED) return false;
  // The gateway's secret goes in the MQTT login, so it only talks to a broker
  // whose certificate checks out against ca_cert.h. Plain MQTT is for
  // development builds only (build flag -DALLOW_PLAIN_MQTT).
#ifdef ALLOW_PLAIN_MQTT
  if (!cfg.mqttTls) {
    mqtt.setClient(plainClient);
  } else
#endif
  {
    tlsClient.setCACert(MQTT_CA_CERT);
    mqtt.setClient(tlsClient);
  }
  mqtt.setServer(cfg.mqttHost.c_str(), cfg.mqttPort);
  mqtt.setBufferSize(MQTT_MAX_PACKET_SIZE);
  String clientId = "gw-" + cfg.serial;
  bool ok = mqtt.connect(clientId.c_str(), cfg.serial.c_str(), cfg.secret.c_str());
  Serial.println(ok ? "MQTT connected" : "MQTT connection failed");
  return ok;
}

// Moves the current window into the backlog (dropping the oldest if full).
void closeWindow() {
  sightings::Window taken;
  {
    std::lock_guard<std::mutex> guard(windowLock);
    taken.swap(window);
  }
  sightings::addToBacklog(backlog, taken, MAX_BUFFERED);
}

// Sends the backlog in chunks; keeps whatever couldn't be sent.
void publishBacklog() {
  if (!connectMqtt()) return;
  String topic = "gw/" + cfg.serial + "/sightings";
  const size_t CHUNK = 150;
  do {
    JsonDocument doc;
    doc["firmware"] = FIRMWARE_VERSION;
    JsonArray arr = doc["sightings"].to<JsonArray>();
    size_t n = std::min(CHUNK, backlog.size());
    for (size_t i = 0; i < n; i++) {
      JsonObject o = arr.add<JsonObject>();
      o["mac"] = backlog[i].first.c_str();
      o["rssi"] = backlog[i].second.rssi;
      if (backlog[i].second.at) o["at"] = backlog[i].second.at;
      if (backlog[i].second.battery >= 0) o["battery"] = backlog[i].second.battery;
    }
    String body;
    serializeJson(doc, body);
    if (!mqtt.publish(topic.c_str(), body.c_str())) {
      Serial.println("Publish failed, keeping reports for later");
      return;
    }
    backlog.erase(backlog.begin(), backlog.begin() + n);
  } while (!backlog.empty());
  digitalWrite(LED_PIN, !digitalRead(LED_PIN));
}

// Serial console: "help", "show", "set <key> <value>", "save", "reboot".
void handleConsole() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line == "help") {
    Serial.println("set ssid|pass|serial|secret|mqttHost|mqttPort|mqttTls|prefix|minRssi|reportMs <value>");
    Serial.println("show   save   reboot");
  } else if (line == "show") {
    cfg.print(Serial);
  } else if (line == "save") {
    cfg.save();
    Serial.println("Saved. Type reboot to apply.");
  } else if (line == "reboot") {
    ESP.restart();
  } else if (line.startsWith("set ")) {
    int sp = line.indexOf(' ', 4);
    String key = line.substring(4, sp);
    String val = sp > 0 ? line.substring(sp + 1) : "";
    if (key == "ssid") cfg.wifiSsid = val;
    else if (key == "pass") cfg.wifiPass = val;
    else if (key == "serial") cfg.serial = val;
    else if (key == "secret") cfg.secret = val;
    else if (key == "mqttHost") cfg.mqttHost = val;
    else if (key == "mqttPort") cfg.mqttPort = val.toInt();
    else if (key == "mqttTls") cfg.mqttTls = val == "on" || val == "1";
    else if (key == "prefix") { val.toUpperCase(); cfg.macPrefix = val; }
    else if (key == "minRssi") cfg.minRssi = val.toInt();
    else if (key == "reportMs") cfg.reportMs = max(1000L, val.toInt());
    else { Serial.println("Unknown setting. Type help."); return; }
    Serial.println("OK (not saved yet)");
  } else if (line.length()) {
    Serial.println("Unknown command. Type help.");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  esp_task_wdt_init(30, true);
  esp_task_wdt_add(nullptr);
  cfg.load();
  Serial.printf("\nSchool platform gateway %s\n", FIRMWARE_VERSION);
  if (!cfg.complete()) {
    Serial.println("Not configured yet. Type help.");
  } else {
    connectWifi();
  }
  startScan();
}

uint32_t lastReport = 0;

void loop() {
  esp_task_wdt_reset();
  handleConsole();
  if (!cfg.complete()) { delay(50); return; }
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  mqtt.loop();
  if (millis() - lastReport >= cfg.reportMs) {
    lastReport = millis();
    closeWindow();
    if (backlog.empty()) {
      // Heartbeat: an empty report.
      if (connectMqtt()) mqtt.publish(("gw/" + cfg.serial + "/sightings").c_str(), "{\"firmware\":\"" FIRMWARE_VERSION "\",\"sightings\":[]}");
    } else {
      publishBacklog();
    }
  }
  delay(20);
}
