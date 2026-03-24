#pragma once
#include "statusLed.h"
#include "ImprovWiFiLibrary.h"
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


const char index_html[] PROGMEM = R"=====(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LED Rail Map Device</title>
  <style>
    body {
      background: #222;
      color: #fff;
      font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
      margin: 0;
      padding: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: #222;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      padding: 32px 24px;
      max-width: 600px;
      width: 90%;
      text-align: center;
    }
    h1 {	
      color: #09f;
      font-family: inherit;
      margin-bottom: 16px;
    }
    h2 {
      color: #fff;
      font-family: inherit;
      font-weight: 400;
      margin-top: 0;
    }
    @media (max-width: 600px) {
      .container { padding: 18px 4px; }
      h1 { font-size: 1.6em; }
      h2 { font-size: 1.1em; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Led Rail Map Device Settings</h1>
    <h2>This is just an empty page for now, in the future settings will be added here...</h2>
  </div>
</body>
</html>

)=====";


void setUpWebserver(AsyncWebServer &server, void setValueCb(int8_t, int8_t, int8_t), int8_t *mode_ptr, int16_t *brightness_ptr, statusLed (*leds_ptr)[2], bool *direction_indicators_ptr) {
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
		AsyncWebParameter *brightness = request->hasParam("brightness") ? request->getParam("brightness") : new AsyncWebParameter("brightness", "-1");
		AsyncWebParameter *dir_ind = request->hasParam("dir_ind") ? request->getParam("dir_ind") : new AsyncWebParameter("dir_ind", "-1");
		
		setValueCb(mode->value().toInt(), brightness->value().toInt(), dir_ind->value().toInt());

		AsyncWebServerResponse *response = request->beginResponse(200, "application/json", "{\"success\":true}");
		
		response->addHeader(
			"Access-Control-Allow-Origin", "*"
		);

		request->send(response);
	});

	server.on("/get_data/", HTTP_ANY, [brightness_ptr, mode_ptr, leds_ptr, direction_indicators_ptr](AsyncWebServerRequest *request) {

		char jsonBuffer[128];

		snprintf(jsonBuffer, sizeof(jsonBuffer), "{\"brightness\":%i,\"mode\":%i,\"wifiLed\":%i,\"networkLed\":%i,\"directionIndicator\":%s}", *brightness_ptr, *mode_ptr, (*leds_ptr)[0].command, (*leds_ptr)[1].command, *direction_indicators_ptr ? "true" : "false");

		AsyncWebServerResponse *response = request->beginResponse(200, "application/json", jsonBuffer);
		response->addHeader(
			"Access-Control-Allow-Origin", "*"
		);
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

void WiFiImprovSetup(void setValueCb(int8_t, int8_t, int8_t), int8_t *mode_ptr, int16_t *brightness_ptr, statusLed (*leds_ptr)[2], bool *direction_indicators_ptr) {
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