#pragma once
#include "ImprovWiFiLibrary.h"
#include "statusLed.h"
#include <ESPAsyncWebServer.h>
#include <Esp.h>
#include <Preferences.h>
#include <WiFi.h>

ImprovWiFi improvSerial(&Serial);
Preferences preferences;
AsyncWebServer server(80);

#define MAX_SSID_LEN 32
#define MAX_PASS_LEN 64
#define MAX_WIFI_NETWORKS 16

struct savedWiFiNetwork {
	char ssid[MAX_SSID_LEN];
	char password[MAX_PASS_LEN];
};

bool wifiConnected = false;
int wifiNetworkIndex = 0;  // Index of the current WiFi network

savedWiFiNetwork savedWiFi[MAX_WIFI_NETWORKS];	// Array to hold saved WiFi networks


// HTML compressed to save on flash space (~5kb)
const char index_html[] PROGMEM = R"=====(
<!doctypehtml><html lang=en><meta charset=UTF-8><meta content="width=device-width,initial-scale=1"name=viewport><title>Rail Map Control Panel</title><style>::selection{background-color:#09f;color:#fff}::-moz-selection{background-color:#09f;color:#fff}body{background:#222;color:#fff;font-family:-apple-system,system-ui,BlinkMacSystemFont,"Segoe UI",Roboto,Ubuntu,sans-serif;margin:0;padding:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center}.container{background:#333;border-radius:12px;box-shadow:0 2px 12px rgb(0 0 0 / .3);padding:32px 24px;max-width:600px;width:90%;display:flex;align-items:center;flex-direction:column}h1{color:#09f;font-family:inherit;margin-bottom:16px}button,summary{background-color:#09f;border-radius:12px;border:0;padding:.5em;font-size:1em;color:#fff;box-shadow:0 2px 6px rgb(0 153 255 / .6);font-family:inherit;margin-bottom:16px;height:min-content;margin-bottom:0}h2{color:#fff;font-family:inherit;font-weight:600;margin-top:0;display:flex}h3{color:#fff;font-family:inherit;font-weight:400;margin-top:0;display:flex}details{display:flex;justify-content:center;font-size:.6em;margin-left:1em;height:min-content;position:relative}details div{margin-left:1em;position:absolute;background:#222;border-radius:12px;box-shadow:0 2px 12px rgb(0 0 0 / .3);padding:8px 8px;width:max-content;display:flex;flex-direction:row;z-index:1000;gap:.5em;bottom:-8px}@media (max-width:600px){.container{padding:18px 4px}h1{font-size:1.6em}h2{font-size:1.1em}h3{font-size:.9em}details div{margin-top:1em;padding:8px 8px;width:min-content;height:max-content;flex-direction:column;top:2em;right:0}}.align-start{display:flex;flex-direction:column;width:100%;align-items:start}details>summary{list-style:none}</style><div class=container><h1>Rail Map Control Panel</h1><h2>Settings</h2><h3>Status: <span id=status>Loading...</span></h3><h3>Mode: <span id=mode>Loading...</span><details><summary>Change</summary><div><button onclick='setChanges("mode",0)'>Commuter lines</button> <button onclick='setChanges("mode",1)'>Delay</button> <button onclick='setChanges("mode",2)'>Composition</button> <button onclick='setChanges("mode",3)'>Train Type</button> <button onclick='setChanges("mode",4)'>Test</button></div></details></h3><h3>Tails: <span id=dir_ind>Loading...</span><details><summary>Change</summary><div><button onclick='setChanges("dir_ind",0)'>No</button> <button onclick='setChanges("dir_ind",1)'>Yes</button></div></details></h3><h3>Brightness: <span id=brightness>Loading...</span><details><summary>Change</summary><div id=brightnessC></div></details></h3><div><button onclick=getData() id=refresh>Refresh</button> <button onclick=saveChanges() id=save hidden>Save changes</button></div></div><script>const API_URL="http://192.168.1.195"
const statusSpan=document.querySelector("#status")
const modeSpan=document.querySelector("#mode")
const brightnessSpan=document.querySelector("#brightness")
const brightnessContainer=document.querySelector("#brightnessC")
const dirIndSpan=document.querySelector("#dir_ind")
const saveButton=document.querySelector("#save")
const refreshButton=document.querySelector("#refresh")
let changes={}
function setChanges(k,v){if(saveButton)saveButton.hidden=!1
changes={...changes,[k]:v}}
async function getData(){if(refreshButton)refreshButton.innerHTML="Loading..."
const response=await fetch(`${API_URL}/get_data/`)
const data=await response.json()
if(refreshButton)refreshButton.innerHTML="Refresh"
parseData(data)}
async function saveChanges(){if(saveButton)saveButton.innerHTML="Saving..."
const searchParams=Object.entries(changes)
if(searchParams.length)await fetch(`${API_URL}/set_data/${searchParams.length ? `${searchParams.reduce((p,[k,v])=>`${p}${p.length ? "&" : "?"}${k}=${v}`,"")}` : ""}`)
if(saveButton)saveButton.innerHTML="Save changes"
if(saveButton)saveButton.hidden=!0
if(refreshButton)refreshButton.innerHTML="Auto-reloading in 1 second"
setTimeout(()=>{getData()},1000)
changes={}}
function parseData(data){if(statusSpan)statusSpan.innerHTML=getStatus(data.wifiLed,data.networkLed)
if(brightnessSpan)brightnessSpan.innerHTML=getBrightness(data.brightness,data.directionIndicator)
if(dirIndSpan)dirIndSpan.innerHTML=data.directionIndicator?"Yes":"No"
if(modeSpan){const{name}=getMode(data.mode)
modeSpan.innerHTML=name}
if(data.networkLed!=1||data.wifiLed!=1){if(refreshButton)refreshButton.innerHTML="Auto-reloading in 5 seconds"
setTimeout(()=>{getData()},5000)}
if(brightnessContainer){brightnessContainer.innerHTML=""
for(let i=0;i<5;i++){brightnessContainer.innerHTML+=`<button onclick="setChanges('brightness',${i})">${getBrightness(i, data.directionIndicator).split("/")[0]}</button>`}}}
function getStatus(wifiLed=-1,networkLed=-1){switch(wifiLed){case 0:return"Boot failed"
case 1:switch(networkLed){case 0:return"Trying to connect to server"
case 1:return"Connected to server"
case 2:return"Failed to connect to server. Reconnecting..."
case 4:return"Switching map mode"
default:return"Unknown status: "+networkLed}
case 2:return"Failed to connect to WiFi"
case 4:return"Connecting to WiFi"
default:return"Unknown status: "+wifiLed}}
function getMode(mode=-1){switch(mode){case 0:return{name:"Commuter lines"}
case 1:return{name:"Delay"}
case 2:return{name:"Train composition (locomotive)"}
case 3:return{name:"Train Type"}
case 4:return{name:"Test"}
default:return{name:"Unknown mode: "+mode}}}
function getBrightness(brightness=-1,directionIndicators=!1){switch(brightness){case 0:return directionIndicators?"0/255":"0/255"
case 1:return directionIndicators?"80/255":"35/255"
case 2:return directionIndicators?"90/255":"50/255"
case 3:return directionIndicators?"120/255":"80/255"
case 4:return directionIndicators?"255/255":"255/255"
default:return"Unknown brightness: "+brightness}}
getData()</script>

)=====";

void setUpWebserver(AsyncWebServer &server, void setValueCb(int8_t, int8_t, int8_t), int8_t *mode_ptr, int16_t *brightness_ptr,
					statusLed (*leds_ptr)[2], bool *direction_indicators_ptr) {
	// return 404 to webpage icon
	server.on("/favicon.ico", [](AsyncWebServerRequest *request) {
		request->send(404);
	});	 // webpage icon

	// Serve Basic HTML Page
	server.on("/", HTTP_ANY, [](AsyncWebServerRequest *request) {
		AsyncWebServerResponse *response = request->beginResponse(200, "text/html", index_html);

		response->addHeader(
			"Cache-Control", "public,max-age=31536000");  // save this file to cache for 1 year (unless you refresh)
		request->send(response);
		Serial.println("Served Control Panel HTML Page");
	});

	server.on("/set_data", HTTP_ANY, [setValueCb](AsyncWebServerRequest *request) {
		AsyncWebParameter *mode = request->hasParam("mode") ? request->getParam("mode") : new AsyncWebParameter("mode", "-1");
		AsyncWebParameter *brightness =
			request->hasParam("brightness") ? request->getParam("brightness") : new AsyncWebParameter("brightness", "-1");
		AsyncWebParameter *dir_ind =
			request->hasParam("dir_ind") ? request->getParam("dir_ind") : new AsyncWebParameter("dir_ind", "-1");

		setValueCb(mode->value().toInt(), brightness->value().toInt(), dir_ind->value().toInt());

		AsyncWebServerResponse *response = request->beginResponse(200, "application/json", "{\"success\":true}");

		response->addHeader("Access-Control-Allow-Origin", "*");

		request->send(response);
	});

	server.on(
		"/get_data/", HTTP_ANY, [brightness_ptr, mode_ptr, leds_ptr, direction_indicators_ptr](AsyncWebServerRequest *request) {
			char jsonBuffer[128];

			snprintf(jsonBuffer,
					 sizeof(jsonBuffer),
					 "{\"brightness\":%i,\"mode\":%i,\"wifiLed\":%i,\"networkLed\":%i,\"directionIndicator\":%s}",
					 *brightness_ptr,
					 *mode_ptr,
					 (*leds_ptr)[0].command,
					 (*leds_ptr)[1].command,
					 *direction_indicators_ptr ? "true" : "false");

			AsyncWebServerResponse *response = request->beginResponse(200, "application/json", jsonBuffer);
			response->addHeader("Access-Control-Allow-Origin", "*");
			request->send(response);
			Serial.println("Served Data");
		});
}

void onImprovWiFiErrorCb(ImprovTypes::Error err) {
	Serial.printf("Improv WiFi Error: %d\n", err);
	server.end();
}

// Save WiFi credentials to Preferences (NVS Flash Partition)
void exportWiFi() {
	preferences.begin("wifi");
	preferences.putBytes("wifi", savedWiFi, sizeof(savedWiFi));
	preferences.end();
}

// Read WiFi credentials from Preferences (NVS Flash Partition)
void importWiFi() {
	preferences.begin("wifi", true);
	preferences.getBytes("wifi", savedWiFi, sizeof(savedWiFi));
	preferences.end();
}

void onImprovWiFiConnectedCb(const char *ssid, const char *password) {
	// Move the networks all down one position
	for (int i = MAX_WIFI_NETWORKS - 1; i > 0; i--) {
		strncpy(savedWiFi[i].ssid, savedWiFi[i - 1].ssid, MAX_SSID_LEN);
		strncpy(savedWiFi[i].password, savedWiFi[i - 1].password, MAX_PASS_LEN);
	}

	// Save the new network at the top
	strncpy(savedWiFi[0].ssid, ssid, MAX_SSID_LEN);
	strncpy(savedWiFi[0].password, password, MAX_PASS_LEN);

	// Save the updated WiFi networks to Preferences
	exportWiFi();

	// Restart the web server
	server.end();
	server.begin();
}

bool attemptConnectToSavedWiFi(int index) {
	Serial.printf("Attempting to connect to saved network %i: %s\n", index, savedWiFi[index].ssid);
	if (improvSerial.tryConnectToWifi(savedWiFi[index].ssid, savedWiFi[index].password, 500, 5)) {
		Serial.println("WiFi connected successfully!");
		server.begin();	 // Start the web server
		return true;
	} else {
		Serial.printf("Failed to connect to %s.\n", savedWiFi[index].ssid);
		return false;
	}
}

void WiFiImprovSetup(void setValueCb(int8_t, int8_t, int8_t), int8_t *mode_ptr, int16_t *brightness_ptr, statusLed (*leds_ptr)[2],
					 bool *direction_indicators_ptr) {
	importWiFi();
	improvSerial.setDeviceInfo(
		ImprovTypes::ChipFamily::CF_ESP32_C3, FIRMWARE, FIRMWARE_VERSION, ARDUINO_BOARD, "http://{LOCAL_IPV4}/");
	improvSerial.onImprovError(onImprovWiFiErrorCb);
	improvSerial.onImprovConnected(onImprovWiFiConnectedCb);
	setUpWebserver(server, setValueCb, mode_ptr, brightness_ptr, leds_ptr, direction_indicators_ptr);

	while (wifiNetworkIndex < MAX_WIFI_NETWORKS) {
		if (strlen(savedWiFi[wifiNetworkIndex].ssid) > 0) {
			wifiConnected = attemptConnectToSavedWiFi(wifiNetworkIndex);
			if (wifiConnected)
				break;	// Exit loop if connected
		}
		wifiNetworkIndex++;
	}

	if (!wifiConnected) {
		Serial.println("Failed to connect to any saved WiFi networks");
	}
}

void handleWiFiImprov() {
	improvSerial.handleSerial();  // Handle Improv communication regardless of WiFi state

	if (WiFi.status() != WL_CONNECTED) {

		if (wifiNetworkIndex >= MAX_WIFI_NETWORKS) {
			wifiNetworkIndex = 0;
		}

		while (strlen(savedWiFi[wifiNetworkIndex].ssid) == 0 && wifiNetworkIndex < MAX_WIFI_NETWORKS) {
			wifiNetworkIndex++;	 // Skip empty SSIDs
		}

		if (wifiNetworkIndex >= MAX_WIFI_NETWORKS) {
			return;	 // No saved WiFi networks available
		}

		wifiConnected = attemptConnectToSavedWiFi(wifiNetworkIndex);
	}
}