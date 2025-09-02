#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <NeoPixelBus.h>
#include <NeoPixelBusLg.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_sntp.h>
#include <time.h>
#include <vector>

#include "WiFiConfig.h"

// Array of server URLs for failover
String serverURLs[] = {
	String("http://keastudios.co.nz/akl-ltm/") + BACKEND_VERSION + ".json",
	String("http://dirksonline.net/akl-ltm/") + BACKEND_VERSION + ".json",
	// String("http://192.168.86.31:3000/akl-ltm/") + BACKEND_VERSION + ".json",
};
const int numServers = sizeof(serverURLs) / sizeof(serverURLs[0]);
int currentServerIndex = 0;

const char* ntpServers[] = { "nz.pool.ntp.org", "pool.msltime.measurement.govt.nz", "pool.ntp.org" };

const char* time_zone = "NZST-12NZDT,M9.5.0,M4.1.0/3";

time_t lastMapDrawTime = 0;	 // Tracks the last time the map was drawn
time_t nextFetchTime = 0;	 // Tracks when the next update should occur

// Pins and pixel counts defined in the board file (./boards/)

// I am useing WS2811 timing =>   0:{0.3, 0.95} 1:{0.9, 0.35} Reset:300us
// XL-1615RGBC-WS2812B-S requires 0:{>0.3, >0.9} 1:{>0.9, >0.3} Reset:>200us
NeoPixelBusLg<NeoGrbFeature, NeoEsp32Rmt0Ws2811Method> strandMNK(STRAND_MNK_PIXELS, STRAND_MNK);
NeoPixelBusLg<NeoGrbFeature, NeoEsp32Rmt1Ws2811Method> nalNIMT(NAL_NIMT_PIXELS, NAL_NIMT);

RgbColor black(0, 0, 0);
std::vector<RgbColor> colorTable;
int blockColorIds[512];	 // Array to hold block colors

// --- Data structure for scheduled LED updates ---
struct LedUpdate {
	uint16_t preBlock;
	uint16_t postBlock;
	int colorId;
	time_t timestamp;  // Timestamp for when the update should occur
};

std::vector<LedUpdate> ledUpdateSchedule;

enum statusLedCommand {
	LED_OFF,
	LED_ON_GREEN,
	LED_ON_RED,
	LED_BLINK_GREEN_SLOW,  // 1Hz
	LED_BLINK_GREEN_FAST,  // 5Hz
	LED_BLINK_RED_SLOW,	   // 1Hz
	LED_BLINK_RED_FAST	   // 5Hz
};

enum charlieplexedLedState { GREEN, RED, OFF };

typedef struct {
	uint8_t pin;
	statusLedCommand command;
	bool currentState;
	unsigned long lastToggle;
} statusLed;

TaskHandle_t statusLedTaskHandle;

static unsigned long lastUpdate = 0;
int16_t brightness = 60;
bool ledUpdatePending = false;

struct Button {
	uint8_t pin;
	volatile unsigned long lastChangeTime;
	volatile bool pendingCheck;
	bool lastState;
};

// Initialize button structures
Button brightnessDownButton = { BRIGHTNESS_DOWN_BUTTON, 0, false, HIGH };
Button brightnessUpButton = { BRIGHTNESS_UP_BUTTON, 0, false, HIGH };
Button powerButton = { POWER_BUTTON, 0, false, HIGH };

// --- (Existing ISR, button check, time, and LED functions) ---
// IRAM_ATTR ensures the ISR is placed in IRAM
void IRAM_ATTR buttonISR(void* arg) {
	Button* button = (Button*)arg;
	button->lastChangeTime = xTaskGetTickCountFromISR() * portTICK_PERIOD_MS;
	button->pendingCheck = true;
}

void checkButton(Button* button) {
	if (button->pendingCheck && (millis() - button->lastChangeTime) >= DEBOUNCE_DELAY) {
		bool currentState = digitalRead(button->pin);
		if (currentState != button->lastState) {
			button->lastState = currentState;
			if (currentState == LOW) {	// Assuming active-low configuration
				// Handle button press
				switch (button->pin) {
					case BRIGHTNESS_DOWN_BUTTON:
						Serial.print("Brightness Down pressed ");
						brightness -= 20;
						break;
					case BRIGHTNESS_UP_BUTTON:
						Serial.print("Brightness Up pressed ");
						brightness += 20;
						break;
					case POWER_BUTTON:
						Serial.print("Power button pressed ");
						brightness = (brightness == 0) ? 250 : 0;  // Toggle brightness
						break;
					default:
						Serial.printf("Unknown button pressed on pin %d\n", button->pin);
						return;	 // Exit if an unknown button is pressed
				}

				// Ensure brightness stays within bounds
				brightness = (brightness > 0) ? constrain(brightness, 20, 250) : 0;

				// Save brightness to preferences
				preferences.begin("brightness");
				if (preferences.getInt("brightness") != brightness) {
					preferences.putInt("brightness", brightness);
				}
				preferences.end();

				// Update the LEDs
				strandMNK.SetLuminance(brightness);
				nalNIMT.SetLuminance(brightness);

				Serial.printf("brightness now at: %i/255\n", brightness);
				ledUpdatePending = true;
			}
		}
		button->pendingCheck = false;
	}
}

const char* getLocalTime(time_t epoch) {
	struct tm timeinfo;
	static char buffer[64];
	struct timeval tv;

	// Convert epoch to local time
	if (!localtime_r(&epoch, &timeinfo)) {
		return "No time available";
	}
	gettimeofday(&tv, nullptr);
	int ms = tv.tv_usec / 1000;
	if (strftime(buffer, sizeof(buffer), "%H:%M:%S", &timeinfo)) {
		snprintf(buffer + strlen(buffer), sizeof(buffer) - strlen(buffer), ".%03d", ms);
		return buffer;
	}
	return "Format error";
}

void timeavailable(struct timeval* t) {
	Serial.println("NTP Synced");
}

void setCharlieplexedLED(uint8_t pin, charlieplexedLedState state) {
	switch (state) {
		case GREEN:
			pinMode(pin, OUTPUT);
			digitalWrite(pin, HIGH);
			break;

		case RED:
			pinMode(pin, OUTPUT);
			digitalWrite(pin, LOW);
			break;

		case OFF:
			// Set as input (High Resistance) to disable output driver
			pinMode(pin, INPUT);
			break;
	}
}

void statusLedManagerTask(void* pvParameters) {
	statusLed leds[] = { { WIFI_LED_PIN, LED_OFF, false, 0 }, { CONFIG_LED_PIN, LED_OFF, false, 0 } };
	const int numLeds = sizeof(leds) / sizeof(leds[0]);

	while (1) {
		// Check for notifications
		uint32_t notification;
		if (xTaskNotifyWait(0, ULONG_MAX, &notification, 0) == pdTRUE) {
			uint8_t pin = notification >> 24;
			statusLedCommand cmd = statusLedCommand((notification >> 16) & 0xFF);

			for (int i = 0; i < numLeds; i++) {
				if (leds[i].pin == pin) {
					leds[i].command = cmd;
					// Immediate response for non-blinking states
					if (cmd == LED_ON_GREEN || cmd == LED_ON_RED || cmd == LED_OFF) {
						setCharlieplexedLED(pin, (cmd == LED_ON_GREEN) ? GREEN : (cmd == LED_ON_RED) ? RED : OFF);
					}
					break;
				}
			}
		}

		// Handle blinking
		unsigned long now = millis();
		for (int i = 0; i < numLeds; i++) {
			if (leds[i].command >= LED_BLINK_GREEN_SLOW) {	// All blink commands
				// Extract blink parameters from command
				const bool isGreen = (leds[i].command == LED_BLINK_GREEN_SLOW || leds[i].command == LED_BLINK_GREEN_FAST);
				const bool isRed = (leds[i].command == LED_BLINK_RED_SLOW || leds[i].command == LED_BLINK_RED_FAST);
				const bool isSlow = (leds[i].command == LED_BLINK_GREEN_SLOW || leds[i].command == LED_BLINK_RED_SLOW);

				if (isGreen || isRed) {
					const int interval = isSlow ? 500 : 100;  // 1Hz or 5Hz
					const charlieplexedLedState color = isGreen ? GREEN : RED;

					if (now - leds[i].lastToggle >= interval) {
						leds[i].currentState = !leds[i].currentState;
						setCharlieplexedLED(leds[i].pin, leds[i].currentState ? color : OFF);
						leds[i].lastToggle = now;
					}
				}
			}
		}

		vTaskDelay(pdMS_TO_TICKS(25));
	}
}

void setStatusLedState(uint8_t pin, statusLedCommand command) {
	uint32_t notification = (pin << 24) | (command << 16);
	xTaskNotify(statusLedTaskHandle, notification, eSetValueWithOverwrite);
}

const char* getSystemInfo() {
	static char buffer[255];
	FlashMode_t mode = (FlashMode_t)ESP.getFlashChipMode();
	const char* flash_mode_str;

	// Convert flash mode to human-readable string
	switch (mode) {
		case FM_QIO: flash_mode_str = "Quad I/O (QIO)"; break;
		case FM_QOUT: flash_mode_str = "Quad Output (QOUT)"; break;
		case FM_DIO: flash_mode_str = "Dual I/O (DIO)"; break;
		case FM_DOUT: flash_mode_str = "Dual Output (DOUT)"; break;
		case FM_FAST_READ: flash_mode_str = "Fast Read"; break;
		case FM_SLOW_READ: flash_mode_str = "Slow Read"; break;
		case FM_UNKNOWN:
		default: flash_mode_str = "Unknown"; break;
	}

	snprintf(
		buffer,
		sizeof(buffer),
		"\n%s\n"
		"%s-Rev%d\n"
		"%d Core @ %dMHz\n"
		"%dMiB Flash @ %dMHz in %s Mode\n"
		"RAM Heap: %dkiB\n"
		"IDF SDK: %s\n",
		ARDUINO_BOARD,
		ESP.getChipModel(),
		ESP.getChipRevision(),
		ESP.getChipCores(),
		ESP.getCpuFreqMHz(),
		ESP.getFlashChipSize() / (1024 * 1024),
		ESP.getFlashChipSpeed() / (1000 * 1000),
		flash_mode_str,
		ESP.getHeapSize() / 1024,
		ESP.getSdkVersion());

	return buffer;
}

String downloadJSON() {
	HTTPClient http;
	String payload;

	for (int i = 0; i < numServers; i++) {
		int serverIndex = (currentServerIndex + i) % numServers;
		String url = serverURLs[serverIndex];
		http.setTimeout(10000);	 // Set timeout to 10 seconds per server
		http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
		http.begin(url);

		int httpCode = http.GET();
		if (httpCode == HTTP_CODE_OK) {
			payload = http.getString();
			http.end();
			currentServerIndex = serverIndex;  // Update to the successful server
			return payload;
		} else {
			Serial.printf("Fetch from %s returned: %i (%s)\n", url.c_str(), httpCode, http.errorToString(httpCode).c_str());
			http.end();
		}
	}
	return String();
}

void setBlockColor(uint16_t block, int colorId) {
	if (colorId < blockColorIds[block]) {
		return;	 // Do not update if the block if it is low priority
	}

	blockColorIds[block] = colorId;	 // Update the color ID for the block if it's higher

	// Set the color on the appropriate strand based on the block number
	if (block >= 100 && block < 100 + NAL_NIMT_PIXELS) {
		nalNIMT.SetPixelColor(block - 100, colorTable[blockColorIds[block]]);
	} else if (block >= 300 && block < 300 + STRAND_MNK_PIXELS) {
		strandMNK.SetPixelColor(block - 300, colorTable[blockColorIds[block]]);
	} else {
		Serial.printf("Block %d is out of range for both strands.\n", block);
	}
}

void drawMap(time_t epoch) {
	// Clear both strands
	nalNIMT.ClearTo(black);
	strandMNK.ClearTo(black);
	// Reset the blocks array
	for (int i = 0; i < 512; i++) {
		blockColorIds[i] = 0;  // Reset all blocks to black
	}

	// Draw the map based on the current LED update schedule
	for (const auto& update : ledUpdateSchedule) {
		if (epoch >= update.timestamp) {
			setBlockColor(update.postBlock, update.colorId);
		} else {
			setBlockColor(update.preBlock, update.colorId);
		}
	}

	// Show the updates on both strands
	strandMNK.Show();

	// Allow time for the strand to be sent out (Not needed but might reduce interference)
	vTaskDelay(pdMS_TO_TICKS(int(0.03 * STRAND_MNK_PIXELS) + 1));

	nalNIMT.Show();

	lastMapDrawTime = epoch;  // Update the last draw time
}

void parseLEDMap(const String& downloadedJson) {
	JsonDocument doc;
	DeserializationError error = deserializeJson(doc, downloadedJson);

	if (error) {
		Serial.printf("JSON parse error: %s\n", error.c_str());
		return;
	}

	String version = doc["version"] | "";
	time_t baseTimestamp = doc["timestamp"] | 0;
	int updateOffset = doc["update"] | 0;
	JsonObject colors = doc["colors"];
	JsonArray updates = doc["updates"];

	if (baseTimestamp + updateOffset > nextFetchTime) {
		nextFetchTime = baseTimestamp + updateOffset;
	} else {
		Serial.println("Fetched the same data twice");
		return;	 // No need to update if the data is the same
	}

	if (String(BACKEND_VERSION) != version) {
		Serial.printf("Backend version mismatch: expected %s, got %s\n", BACKEND_VERSION, version.c_str());
	}

	// Serial.printf("%ld Base timestamp: %ld, Update offset: %d, Next fetch time: %ld\n",
	// 			  time(nullptr),
	// 			  baseTimestamp,
	// 			  updateOffset,
	// 			  nextFetchTime);

	// Populate colorTable from the JSON colors object
	colorTable.clear();
	for (JsonPair kv : colors) {
		JsonArray rgb = kv.value().as<JsonArray>();
		colorTable.push_back(RgbColor(rgb[0] | 0, rgb[1] | 0, rgb[2] | 0));
	}

	ledUpdateSchedule.clear();
	for (JsonObject update : updates) {
		JsonArray blocks = update["b"];
		int colorId = update["c"];
		int offset = update["t"];

		// Schedule color update
		LedUpdate ledUpdate;
		ledUpdate.preBlock = blocks[0];
		ledUpdate.postBlock = blocks[1];
		if (offset > 0) {
			ledUpdate.timestamp = baseTimestamp + offset;
		} else {
			ledUpdate.timestamp = 0;
		}
		ledUpdate.colorId = colorId;
		ledUpdateSchedule.push_back(ledUpdate);
	}

	ledUpdatePending = true;  // Mark that an update is pending
}

void onCdcRxEvent(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data) {
	improvSerial.handleSerial();
}

void setup() {
	xTaskCreate(statusLedManagerTask, "Status LED Manager", 1024, NULL, 1, &statusLedTaskHandle);

	// Hardware Serial
	Serial0.begin(115200);

	// USB Serial
	Serial.begin();
	Serial.setDebugOutput(true);
	Serial.onEvent(ARDUINO_HW_CDC_RX_EVENT, onCdcRxEvent);

	pinMode(LVL_Shifter_EN, OUTPUT);
	digitalWrite(LVL_Shifter_EN, HIGH);	 //Disable LVL Shifter
	pinMode(LED_5V_EN, OUTPUT);
	digitalWrite(LED_5V_EN, LOW);  //Disable 5V Power

	strandMNK.Begin();
	strandMNK.ClearTo(black);
	nalNIMT.Begin();
	nalNIMT.ClearTo(black);

	digitalWrite(LVL_Shifter_EN, LOW);	//Enable LVL Shifter
	digitalWrite(LED_5V_EN, HIGH);		//Enable 5V Power

	nalNIMT.Show();
	strandMNK.Show();

	// Set initial brightness
	preferences.begin("brightness");
	brightness = preferences.getInt("brightness", brightness);
	preferences.end();
	strandMNK.SetLuminance(brightness);
	nalNIMT.SetLuminance(brightness);

// Factory test mode
#if defined(FACTORY_TEST)
	preferences.begin("factory_test");
	if (preferences.getBool("passed", false) == false) {  // Check if factory test mode has been passed
		preferences.putBool("passed", true);			  // Set factory test mode as passed
		preferences.end();

		while (true) {
			Serial.println("Factory test mode enabled");

			strandMNK.ClearTo(RgbColor(255, 0, 0));
			nalNIMT.ClearTo(RgbColor(255, 0, 0));
			strandMNK.Show();
			nalNIMT.Show();
			vTaskDelay(pdMS_TO_TICKS(1000));

			strandMNK.ClearTo(RgbColor(0, 255, 0));
			nalNIMT.ClearTo(RgbColor(0, 255, 0));
			strandMNK.Show();
			nalNIMT.Show();
			vTaskDelay(pdMS_TO_TICKS(1000));

			strandMNK.ClearTo(RgbColor(0, 0, 255));
			nalNIMT.ClearTo(RgbColor(0, 0, 255));
			strandMNK.Show();
			nalNIMT.Show();
			vTaskDelay(pdMS_TO_TICKS(1000));
		}
	}
	preferences.end();
#endif

	// Button initialization
	pinMode(brightnessDownButton.pin, INPUT_PULLUP);
	pinMode(brightnessUpButton.pin, INPUT_PULLUP);
	pinMode(powerButton.pin, INPUT_PULLUP);

	// Attach interrupts with debouncing
	attachInterruptArg(digitalPinToInterrupt(BRIGHTNESS_DOWN_BUTTON), buttonISR, &brightnessDownButton, CHANGE);
	attachInterruptArg(digitalPinToInterrupt(BRIGHTNESS_UP_BUTTON), buttonISR, &brightnessUpButton, CHANGE);
	attachInterruptArg(digitalPinToInterrupt(POWER_BUTTON), buttonISR, &powerButton, CHANGE);

	Serial.println(getSystemInfo());

	// --- Time Setup ---
	sntp_set_time_sync_notification_cb(timeavailable);
	sntp_set_sync_interval(1000 * 60 * 15);	 // Set sync interval to 15 minutes
	sntp_set_sync_mode(SNTP_SYNC_MODE_IMMED);
	configTzTime(time_zone, ntpServers[0], ntpServers[1], ntpServers[2]);

	// --- WiFi Setup ---
	setStatusLedState(WIFI_LED_PIN, LED_BLINK_GREEN_FAST);
	WiFi.mode(WIFI_STA);
	WiFi.setTxPower(WIFI_POWER_15dBm);	// Set WiFi power to avoid brownouts
	WiFi.disconnect();

	WiFiImprovSetup();

	Serial.println(getSystemInfo());
}

void loop() {
	handleWiFiImprov();			   // Handle WiFi credentials setup via WebSerial
	time_t epoch = time(nullptr);  // Get current time

	if (WiFi.status() == WL_CONNECTED) {
		setStatusLedState(WIFI_LED_PIN, LED_ON_GREEN);

		// --- Fetch new data periodically ---
		if (epoch > nextFetchTime) {

			String downloadedJson = downloadJSON();
			if (downloadedJson.length() > 0) {
				setStatusLedState(CONFIG_LED_PIN, LED_ON_GREEN);
				parseLEDMap(downloadedJson);  // This populates/updates the schedule
			} else {
				Serial.println("All servers failed to provide data.");
				setStatusLedState(CONFIG_LED_PIN, LED_ON_RED);
			}

			nextFetchTime = max(nextFetchTime, epoch + 6);	// Ensure we don't fetch too frequently

			Serial.printf("%s MCU:%2.0f°C  WiFi:%idBm\n", getLocalTime(epoch), temperatureRead(), WiFi.RSSI());
			Serial.flush();
		}

		// --- Handle button presses ---
		checkButton(&brightnessDownButton);
		checkButton(&brightnessUpButton);
		checkButton(&powerButton);

		// --- Push updates to the LED strips only if changes were made ---
		if (ledUpdatePending || lastMapDrawTime < epoch) {
			drawMap(epoch);	 // Draw the map with the current updates
			ledUpdatePending = false;
		}

	} else {
		setStatusLedState(WIFI_LED_PIN, LED_ON_RED);
	}
	vTaskDelay(pdMS_TO_TICKS(10));	// Delay to yield to other tasks
}