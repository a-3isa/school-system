# Fake strap (ESP32)

Stands in for a real FSC-BP107D smart band, so the gateway can be tested on a desk.
It only advertises; it never connects to the gateway or anything else. The gateway hears it,
matches the address prefix and reports it to the platform exactly as it would a real band.

It sends an Eddystone-TLM frame (battery voltage) from a fixed Bluetooth address, about every 100 ms.

## Flash it (Arduino IDE)

1. **Boards Manager:** install *esp32 by Espressif Systems* **2.0.17** (the gateway builds against this version).
2. **Library Manager:** install *NimBLE-Arduino* by h2zero, version **1.4.3**. Version 2.x has a different API and will not compile.
3. Open `fake-strap/fake-strap.ino`. The folder name must stay `fake-strap`.
4. Board: *ESP32 Dev Module*. Pick the port, then Upload.
5. Open Serial Monitor at **115200** baud, line ending *Newline*.

## Use it

| Console command | What it does |
|---|---|
| `show` | Prints address, battery and state |
| `mac DC:0D:30:AA:4A:11` | Address to advertise. First byte must be `C0` to `FF` |
| `battery 60` | Battery percent (0 to 100) sent in the TLM frame |
| `off` / `on` | Stop or start advertising: the student leaves or arrives |
| `save` | Keep address and battery across power cycles |

The **BOOT** button toggles on/off. The blue LED is lit while the strap is on air.

The default address is `DC:0D:30:00:00:01`, which matches the gateway's default `prefix`
(`DC:0D:30`). If you use another address, either keep the same first three bytes or set the
gateway's prefix to match (`set prefix <value>`, or `set prefix` with nothing after it to accept everything, then `save`).

For several students, flash more boards with different addresses, or change the address with `mac` between tests.
Register each address to a student in the dashboard like a real band. The demo school already
gives `DC:0D:30:00:00:00`, `…:01`, `…:02` and so on to its students.

The whole setup (broker, API, gateway, this strap) is in `firmware/gateway/README.md`, "Desk test with two ESP32s".

## What it does not test

Range, RSSI in real rooms and battery life of the real FSC-BP107D. Test with a real band before promising anything to a school.
