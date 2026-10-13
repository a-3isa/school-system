// What the gateway does with what it hears, kept apart from the radio and the network so it can be
// tested on a computer (pio test -e native). No Arduino types in here: only the standard library.
#pragma once
#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace sightings {

struct Heard {
  int rssi;          // loudest in the current window
  uint64_t at;       // ms since epoch when it was loudest (0 = the clock wasn't set)
  int battery;       // percent, -1 if unknown
};

/** What was heard in the current window: one reading per strap. */
using Window = std::map<std::string, Heard>;
/** Readings waiting to be sent, oldest first. */
using Backlog = std::vector<std::pair<std::string, Heard>>;

/** Records a reading: the loudest one per strap is kept, and the last battery level it reported. */
inline void hear(Window& window, const std::string& mac, int rssi, uint64_t at, int battery) {
  auto it = window.find(mac);
  if (it == window.end()) {
    window[mac] = {rssi, at, battery};
    return;
  }
  if (rssi > it->second.rssi) {
    it->second.rssi = rssi;
    it->second.at = at;
  }
  if (battery >= 0) it->second.battery = battery;
}

/** Eddystone-TLM carries the battery voltage in millivolts; roughly 2.0 V to 3.0 V maps to 0 to 100 %. */
inline int batteryPercent(int millivolts) {
  if (millivolts <= 0) return -1;
  int percent = (millivolts - 2000) / 10;
  if (percent < 0) return 0;
  if (percent > 100) return 100;
  return percent;
}

/** Only straps whose address starts with the prefix are reported; an empty prefix allows all. */
inline bool macAllowed(const std::string& mac, const std::string& prefix) {
  return prefix.empty() || mac.rfind(prefix, 0) == 0;
}

/** Adds a window to the backlog. If more than `max` readings are waiting, the oldest are dropped. */
inline void addToBacklog(Backlog& backlog, const Window& taken, std::size_t max) {
  for (const auto& reading : taken) backlog.push_back(reading);
  if (backlog.size() > max) backlog.erase(backlog.begin(), backlog.begin() + static_cast<std::ptrdiff_t>(backlog.size() - max));
}

}  // namespace sightings
