// Gateway settings, kept in flash (NVS) and changed over the USB serial console.
#pragma once
#include <Arduino.h>
#include <Preferences.h>

struct GatewayConfig {
  String wifiSsid;
  String wifiPass;
  String serial;        // e.g. NV-GW-0001, registered in the owner console
  String secret;        // shown once when the gateway is registered
  String mqttHost;      // e.g. mqtt.example.com
  uint16_t mqttPort = 8883;
  bool mqttTls = true;
  String macPrefix = "DC:0D:30";  // only report straps whose address starts with this ("" = all)
  int minRssi = -95;              // ignore anything quieter
  uint32_t reportMs = 5000;       // how often to send what was heard

  void load() {
    Preferences p;
    p.begin("gw", true);
    wifiSsid = p.getString("ssid", "");
    wifiPass = p.getString("pass", "");
    serial = p.getString("serial", "");
    secret = p.getString("secret", "");
    mqttHost = p.getString("mqttHost", "");
    mqttPort = p.getUShort("mqttPort", 8883);
    mqttTls = p.getBool("mqttTls", true);
    macPrefix = p.getString("prefix", "DC:0D:30");
    minRssi = p.getInt("minRssi", -95);
    reportMs = p.getUInt("reportMs", 5000);
    p.end();
  }

  void save() const {
    Preferences p;
    p.begin("gw", false);
    p.putString("ssid", wifiSsid);
    p.putString("pass", wifiPass);
    p.putString("serial", serial);
    p.putString("secret", secret);
    p.putString("mqttHost", mqttHost);
    p.putUShort("mqttPort", mqttPort);
    p.putBool("mqttTls", mqttTls);
    p.putString("prefix", macPrefix);
    p.putInt("minRssi", minRssi);
    p.putUInt("reportMs", reportMs);
    p.end();
  }

  bool complete() const {
    return wifiSsid.length() && serial.length() && secret.length() && mqttHost.length();
  }

  void print(Stream& out) const {
    out.printf("wifi      %s\n", wifiSsid.c_str());
    out.printf("serial    %s\n", serial.c_str());
    out.printf("secret    %s\n", secret.length() ? "(set)" : "(not set)");
    out.printf("mqtt      %s:%u tls=%s\n", mqttHost.c_str(), mqttPort, mqttTls ? "on" : "off");
    out.printf("prefix    %s\n", macPrefix.c_str());
    out.printf("minRssi   %d\n", minRssi);
    out.printf("reportMs  %lu\n", (unsigned long)reportMs);
  }
};
