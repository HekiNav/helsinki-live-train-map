# Helsinki Live LED Train Map

A real-time PCB map of the Helsinki Region train network, powered by an ESP32-C3 microcontroller. Train movements are displayed using addressable RGB LEDs, with live data fetched over Wi-Fi.

---

## Table of Contents

- [Helsinki Live LED Train Map](#helsinki-live-led-train-map)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Hardware](#hardware)
  - [Design](#design)
  - [Software / Firmware](#software--firmware)
  - [Getting Started](#getting-started)
  - [Web Installer](#web-installer)
  - [Web Simulator](#web-simulator)
  - [Stand](#stand)
  - [Server](#server)
  - [Links](#links)
  - [Contributing](#contributing)
  - [License](#license)

---

![PCB Overview Render](Images/Helsinki-LED-Train-Map_Working.png)

## Features

- **Real-time Train Tracking:** Displays the approximate locations of trains on the HSL and VR commuter network.
- **Addressable LEDs:** ~290 WS2812B-compatible RGB LEDs (1.6x1.5mm) for a vibrant display.
- **Wi-Fi Connectivity:** ESP32-C3's built-in Wi-Fi fetches live train data.
- **Custom PCB:** Designed for JLCPCB manufacturing limits.
- **Open Source:** Hardware and firmware are open source.

---

## Hardware

- **Microcontroller:** Expressif ESP32-C3FH4 (RISC-V, 160 MHz, 4 MB Flash, QFN32)
- **Level shifter:** Texas Instruments SN74LVC4245APWR (3.3V to 5V)
- **LEDs:** ~290 x XingLight XL-1615RGBC-WS2812B (1.6mm x 1.5mm)
- **PCB:** 249mm x 71.5mm, JLCPCB-friendly
- **Antenna:** On-board PCB antenna ([TI CC2430DB design](https://www.ti.com/lit/ug/swru125/swru125.pdf))
- **Ports:** Two USB Type-C ports for redundancy

![ESP32-C3 PCB Render](Images/Helsinki-LED-Train-Map_ESP32_LVLS.png)


---

## Design


### Rail diagram design

Inspiration for the layout was taken from the VR rail map used on commuter trains (above the doors). 

**Each LED represents a double-track line**
- 8-tracked sections (4 LEDs wide):
   1. Helsinki-Pasila
- Quad-tracked sections (2 express commuter & intercity, 2 slower commuter):
   1. Pasila-Leppävaara-(Kauklahti [Under construction])
   2. Pasila-Kerava

- Exceptions to single-track lines: 
   1. Tavastila-Kotkan satama
   2. Siuntio-Hanko



### Technical design

- Designed in **KiCad V9.0** using [JLCPCB KiCad Library](https://github.com/CDFER/jlcpcb-kicad-library)
- **View Online:** [Interactive PCB Layout (Kicanvas)](https://kicanvas.org/?github=https%3A%2F%2Fgithub.com%2FHekiNav%2Fhelsinki-live-train-map%2Ftree%2Fmain%2FPCB)
- **Source Files:** `/PCB` directory
### Schematic
Led chains are located on other pages


![Schematic](Images/Schematic.png)


---

## Software / Firmware

The ESP32-C3 firmware is responsible for:

1. Connecting to Wi-Fi
2. Fetching live train data from the API
3. Processing data to determine train locations
4. Controlling WS2812B LED chains to display train positions
5. Handling button inputs and status LEDs
6. Hosting a web page for configuration

---

## Getting Started

1. **Flash the Firmware:**
   - Use the [Web Installer](#web-installer) (recommended, no drivers needed)
   - Or flash manually using PlatformIO (`Firmware/` directory)
2. **Connect to Wi-Fi:**
   - On first boot, use the web installer interface to configure Wi-Fi credentials. They are saved locally on the device.
3. **Power the Board:**
   - Use a 5V USB-C power supply capable of at least ~1A (~2A recommended for compatibility with higher brightness settings).
4. **Configure in the :**
   - Visit the IP address of your device (shown in Web Installer)
   - Configure options like tails, brightness and mode 
5. **Enjoy the Live Train Map!**

### Status LEDs

The top (🔌) power led is hardwired to the power rail

The middle and bottom status leds are controlled by the MCU

| LED | Light | Meaning |
|-----|-------|---------|
| top (🔌)    |🟩 green | The board is powered
| top (🔌)    |⬛ none  | The board is not powered
| top (🔌)    |🟥 red   | This shouldn't happen although it's techically possible if there's severe issues in the pcb
|||
| middle (ᯤ)  |🟩 green            | Connected to the API
| middle (ᯤ)  |🟩 green \(blinking\) | Mode change pending
| middle (ᯤ)  |⬛ none             | Connecting to the API
| middle (ᯤ)  |🟥 red              | Failed to connect to API
|||
| bottom (🌐)  |🟩 green \(blinking\) | Connecting to wifi
| bottom (🌐)  |🟩 green            | Connected to wifi
| bottom (🌐)  |⬛ none             | Failed to boot
| bottom (🌐)  |🟥 red              | Failed to connect to wifi

### Map Modes

There are 4(+1) map modes on the device. You can switch the mode by pressing the map (🗺️) button or by going to the control panel.

#### Lines (default)
- Shows commuter trains by line
- Only commuter trains
- Some colors are reused on lines that do not intersect

| Color                         | Line     | |
|-------------------------------|----------|-|
|$${\color{#f00}\Huge\text{■}}$$| Z        | |
|$${\color{#f80}\Huge\text{■}}$$| A        | |
|$${\color{#ff0}\Huge\text{■}}$$| E,O      | |
|$${\color{#0f0}\Huge\text{■}}$$| P,G      | |
|$${\color{#0ff}\Huge\text{■}}$$| M,I      | |
|$${\color{#00f}\Huge\text{■}}$$| K        | |
|$${\color{#80f}\Huge\text{■}}$$| Y,L,H    | |
|$${\color{#f0f}\Huge\text{■}}$$| U        | |
|$${\color{#f08}\Huge\text{■}}$$| D,T,R    | |
|$${\color{#fff}\Huge\text{■}}$$| V, Other | Look up on [juliadata.fi](https://juliadata.fi/map/view?mode=trains#8.86/60.3487/25.1733)|

\* V is used in transfer services

#### Delay
- Shows the delay state of trains
- Only commuter trains

| Color                         | Delay (min) | Description          |
|-------------------------------|-------------|----------------------|
|$${\color{#0ff}\Huge\text{■}}$$| < 0         | Ahead of schedule    |  
|$${\color{#0f0}\Huge\text{■}}$$| 0 - 2       | On time              |
|$${\color{#ff0}\Huge\text{■}}$$| 2 - 10      | Mild delay           |
|$${\color{#f00}\Huge\text{■}}$$| > 20        | Severe delay         |
|$${\color{#f0f}\Huge\text{■}}$$| -           | Unknown delay amount |


#### Composition
- Shows the locomotives/EMUs of trains
- ALL trains shown (incl. InterCity, freight)

| Color                         | Loco                                     | Description                                |
|-------------------------------|------------------------------------------|--------------------------------------------|
| EMUs                          |                                          |                                            |
|$${\color{#f00}\Huge\text{■}}$$| [Sm2](https://fi.wikipedia.org/wiki/Sm2) | Commuter, old                              |
|$${\color{#0f0}\Huge\text{■}}$$| [Sm3](https://fi.wikipedia.org/wiki/Sm3) | Pendolino (IC)                             |
|$${\color{#ff0}\Huge\text{■}}$$| [Sm4](https://fi.wikipedia.org/wiki/Sm4) | Commuter, longer distances                 |
|$${\color{#80f}\Huge\text{■}}$$| [Sm5](https://fi.wikipedia.org/wiki/Sm5) | Commuter, shorter distances                |
|$${\color{#f0f}\Huge\text{■}}$$| [Sm6](https://fi.wikipedia.org/wiki/Sm6) | Allegro (IC)                               |
|$${\color{#f80}\Huge\text{■}}$$| [Sm7](https://fi.wikipedia.org/wiki/Sm7) | Commuter, not in regular service yet       |
| Locos                         |                                          |                                            |
|$${\color{#0ff}\Huge\text{■}}$$| [Sr2](https://fi.wikipedia.org/wiki/Sr2) | IC locomotive                              |
|$${\color{#00f}\Huge\text{■}}$$| [Sr3](https://fi.wikipedia.org/wiki/Sr3) | Newer IC locomotive                        |
| Other                         |                                          |                                            |
|$${\color{#f08}\Huge\text{■}}$$| N/A                                      | No composition found (most likely freight) |
|$${\color{#fff}\Huge\text{■}}$$| Other                                    | Other locomotive with no color defined (Look up on [juliadata.fi](https://juliadata.fi/map/view?mode=trains#8.86/60.3487/25.1733)) |

#### Train types
- Shows the types of trains
- ALL trains shown (incl. InterCity, freight)

| Color                         | Code                  | Description                                |
|-------------------------------|-----------------------|--------------------------------------------|
|$${\color{#f00}\Huge\text{■}}$$| IC                    | Double-decker intercity trains             |
|$${\color{#f80}\Huge\text{■}}$$| VET                   | Locomotive train                           |
|$${\color{#f80}\Huge\text{■}}$$| MUS, MUV              | Heritage train                             |
|$${\color{#0f0}\Huge\text{■}}$$| S                     | Pendolino train                            |
|$${\color{#00f}\Huge\text{■}}$$| T                     | Freight train                              |
|$${\color{#80f}\Huge\text{■}}$$| HL                    | Commuter train                             |
|$${\color{#f0f}\Huge\text{■}}$$| HV                    | Commuter train transfer                    |
|$${\color{#f08}\Huge\text{■}}$$| PAR, PAI, VEV, W, SAA | Shunting                                   |
|$${\color{#fff}\Huge\text{■}}$$| Other                 | Other train type with no color defined (Look up on [juliadata.fi](https://juliadata.fi/map/view?mode=trains#8.86/60.3487/25.1733)) |


#### Test
- Shows the types of LEDs

| Color                         | Type         | Description                          | Technical logic                                                    |
|-------------------------------|--------------|--------------------------------------|--------------------------------------------------------------------|
|$${\color{#ff0}\Huge\text{■}}$$| Station      | All services stop                    | Train has arrived, but not departed                                |
|$${\color{#f00}\Huge\text{■}}$$| Stop         | Express services skip                | Same as station                                                    |
|$${\color{#0f0}\Huge\text{■}}$$| Between      | Single LED between stops/stations    | Train left previous, not arrived at next                           |
|$${\color{#0ff}\Huge\text{■}}$$| MultiBetween | Multiple LEDs between stops/stations | Same as between, but exact position is appoximated using timetable |

---

## Web Installer

Easily flash the latest firmware to your ESP32-C3 using your browser:

[Open the Helsinki LED Train Map Web Installer](https://hekinav.github.io/helsinki-live-train-map/led-rails.html)

- Works with Chrome, Edge, or any Web Serial-compatible browser
- Follow on-screen instructions to connect and flash your device

---

## Web Simulator

View the map without having the physical pcb:

[Open the Helsinki LED Train Map Web Simulator](https://hekinav.github.io/helsinki-live-train-map/sim.html)

- Use the map mode button to switch display modes, just like on the real thing
- Works with most modern browsers
- Fetches data from the API

---
## Stand and other 3D Models

A 3d-printable stand to hold up the board. Files are located in `/3D Models`

---

## Server

Processes train running data from [digitraffic](https://rata.digitraffic.fi/). Documentation for the train API is available at https://www.digitraffic.fi/rautatieliikenne. Most of it is only available in finnish.

### Main packages:
- express: API handling
- mqtt: Listening to MQTT train messages 
- node-sqlite & sqlite3: Database for cached train compositions and stats
- node-cron: Cron jobs for recaching data and cleaning the database

The api is tunneled to [ltm.hekinav.dev](https://ltm.hekinav.dev/).

### Running locally

Install npm packages

`npm install`

Start the api in dev mode (watches files) (uses port 3001 by default)

`npm run dev`

### Production

Compile TS to JS

`npm run build`

Start the server

`npm run start` or in PM2 `pm2 start ./ecosystem.config.cjs`

---

## Links

- [Web Installer](https://hekinav.github.io/helsinki-live-train-map//led-rails.html)
- [Web Simulator](https://hekinav.github.io/helsinki-live-train-map//sim.html)
- [Interactive PCB Viewer](https://kicanvas.org/?github=https%3A%2F%2Fgithub.com%2FHekiNav%2Fhelsinki-live-train-map%2Ftree%2Fmain%2FPCB)
- [JLCPCB KiCad Library](https://github.com/CDFER/jlcpcb-kicad-library)

---

## Contributing

Contributions are welcome! Open an issue or submit a pull request for improvements, bug fixes, or feature suggestions.

---

## Attributions

Thanks to [Chris (CDFER)](https://github.com/CDFER/) for the base and support of this project. Check out his store with multiple LED Rail Maps at [keastudios.co.nz](https://keastudios.co.nz/)

## License

This project is released under the MIT license.

© 2025 Chris Dirks & Unto Ahti
