// Fake smart band (ESP32), for testing the gateway on the desk.
//
// It does nothing but advertise. Like a real strap it sends an Eddystone-TLM frame (battery
// voltage) from a fixed address, and never connects to anything. The gateway hears it,
// matches the address prefix, and reports it to the platform as usual.
//
// Console (115200): help | show | mac <AA:BB:CC:DD:EE:FF> | battery <0-100> | on | off | save
// The BOOT button (GPIO 0) toggles on/off, to act out a student walking in and out of range.
// The LED (GPIO 2) is lit while the strap is on air.

#include <Arduino.h>
#include <Preferences.h>
#include <NimBLEDevice.h>

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "dev"
#endif

static const int LED_PIN = 2;
static const int BUTTON_PIN = 0;

// Must start with the gateway's prefix (default DC:0D:30). A BLE random static address needs
// the top two bits of its first byte set, which DC does.
static const char* DEFAULT_MAC = "DC:0D:30:00:00:01";

String macText = DEFAULT_MAC;
int batteryPercent = 85;
bool onAir = true;
uint32_t advCount = 0;
uint32_t lastTlm = 0;

bool parseMac(const String& text, uint8_t out[6]) {
  unsigned b[6];
  if (sscanf(text.c_str(), "%x:%x:%x:%x:%x:%x", &b[0], &b[1], &b[2], &b[3], &b[4], &b[5]) != 6) return false;
  for (int i = 0; i < 6; i++) {
    if (b[i] > 0xFF) return false;
    out[i] = (uint8_t)b[i];
  }
  return (out[0] & 0xC0) == 0xC0;  // static random address
}

// Same scale as the gateway (lib/sightings batteryPercent): 2000 mV = 0 %, 3000 mV = 100 %.
uint16_t millivolts() { return 2000 + batteryPercent * 10; }

void buildFrame() {
  uint16_t mv = millivolts();
  uint32_t uptime = millis() / 100;  // Eddystone counts 0.1 s steps
  std::string tlm(14, '\0');
  tlm[0] = 0x20;  // TLM frame
  tlm[1] = 0x00;  // version
  tlm[2] = mv >> 8;
  tlm[3] = mv & 0xFF;
  tlm[4] = 0x80;  // temperature not supported
  tlm[5] = 0x00;
  for (int i = 0; i < 4; i++) {
    tlm[6 + i] = (advCount >> (24 - 8 * i)) & 0xFF;
    tlm[10 + i] = (uptime >> (24 - 8 * i)) & 0xFF;
  }

  NimBLEAdvertisementData data;
  data.setFlags(0x06);  // general discoverable, no classic Bluetooth
  data.setCompleteServices16({NimBLEUUID((uint16_t)0xFEAA)});
  data.setServiceData(NimBLEUUID((uint16_t)0xFEAA), tlm);
  NimBLEDevice::getAdvertising()->setAdvertisementData(data);
}

bool applyMac() {
  uint8_t mac[6];
  if (!parseMac(macText, mac)) return false;
  uint8_t le[6];  // the stack wants the least significant byte first
  for (int i = 0; i < 6; i++) le[i] = mac[5 - i];
  NimBLEDevice::getAdvertising()->stop();
  int rc = ble_hs_id_set_rnd(le);
  if (rc != 0) {
    Serial.printf("Could not set the address (error %d)\n", rc);
    return false;
  }
  NimBLEDevice::setOwnAddrType(BLE_OWN_ADDR_RANDOM);
  return true;
}

void goOnAir() {
  buildFrame();
  NimBLEDevice::getAdvertising()->start();
  onAir = true;
  digitalWrite(LED_PIN, HIGH);
}

void goOffAir() {
  NimBLEDevice::getAdvertising()->stop();
  onAir = false;
  digitalWrite(LED_PIN, LOW);
}

void show() {
  Serial.printf("address  %s\nbattery  %d %% (%u mV)\nstate    %s\n", macText.c_str(), batteryPercent,
                millivolts(), onAir ? "on air" : "off air");
}

void handleConsole() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line == "help") {
    Serial.println("mac <AA:BB:CC:DD:EE:FF>   address to advertise (first byte C0-FF)");
    Serial.println("battery <0-100>   on   off   show   save");
  } else if (line == "show") {
    show();
  } else if (line == "on") {
    goOnAir();
    Serial.println("On air.");
  } else if (line == "off") {
    goOffAir();
    Serial.println("Off air.");
  } else if (line.startsWith("battery ")) {
    batteryPercent = constrain(line.substring(8).toInt(), 0, 100);
    if (onAir) buildFrame();
    Serial.printf("Battery %d %%\n", batteryPercent);
  } else if (line.startsWith("mac ")) {
    String text = line.substring(4);
    text.trim();
    text.toUpperCase();
    uint8_t mac[6];
    if (!parseMac(text, mac)) {
      Serial.println("Not a valid address. Use AA:BB:CC:DD:EE:FF with the first byte C0 to FF.");
      return;
    }
    macText = text;
    if (applyMac() && onAir) goOnAir();
    Serial.printf("Address %s\n", macText.c_str());
  } else if (line == "save") {
    Preferences p;
    p.begin("strap", false);
    p.putString("mac", macText);
    p.putInt("battery", batteryPercent);
    p.end();
    Serial.println("Saved.");
  } else if (line.length()) {
    Serial.println("Unknown command. Type help.");
  }
}

void handleButton() {
  static bool wasDown = false;
  static uint32_t changedAt = 0;
  bool down = digitalRead(BUTTON_PIN) == LOW;
  if (down == wasDown || millis() - changedAt < 50) return;  // debounce
  changedAt = millis();
  wasDown = down;
  if (!down) return;  // act on press, not release
  if (onAir) goOffAir(); else goOnAir();
  Serial.println(onAir ? "On air." : "Off air.");
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Preferences p;
  p.begin("strap", true);
  macText = p.getString("mac", DEFAULT_MAC);
  batteryPercent = p.getInt("battery", 85);
  p.end();

  Serial.printf("\nSchool platform fake strap %s\n", FIRMWARE_VERSION);
  NimBLEDevice::init("");
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementType(BLE_GAP_CONN_MODE_NON);  // beacon: not connectable
  adv->setMinInterval(0x00A0);                       // 100 ms
  adv->setMaxInterval(0x00A0);
  if (!applyMac()) {
    Serial.println("Saved address is not usable, using the default.");
    macText = DEFAULT_MAC;
    applyMac();
  }
  goOnAir();
  show();
  Serial.println("Type help for commands.");
}

void loop() {
  handleConsole();
  handleButton();
  if (onAir && millis() - lastTlm > 1000) {  // keep the uptime and counter in the frame moving
    lastTlm = millis();
    advCount += 10;
    NimBLEDevice::getAdvertising()->stop();
    buildFrame();
    NimBLEDevice::getAdvertising()->start();
  }
  delay(10);
}
