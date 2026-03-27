#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <NeoPixelBus.h>
#include <NeoPixelBusLg.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_random.h>
#include <esp_sntp.h>
#include <time.h>
#include <vector>

#include "WiFiConfig.h"

// Array of server URLs for failover
String serverURLs[] = {
	//String("http://keastudios.co.nz/akl-ltm/") + BACKEND_VERSION + ".json",
	//String("http://dirksonline.net/akl-ltm/") + BACKEND_VERSION + ".json",
	String("https://ltm-api.hekinav.dev/hki-ltm/") + BACKEND_VERSION + ".json",
	//String("http://192.168.1.155:3001/hki-ltm/") + BACKEND_VERSION + ".json",
};
const int numServers = sizeof(serverURLs) / sizeof(serverURLs[0]);
int currentServerIndex = 0;

const char* ntpServers[] = { "0.fi.pool.ntp.org", "1.fi.pool.ntp.org", "2.fi.pool.ntp.org" };

const char* time_zone = "Europe/Helsinki";

bool direction_indicators = false;

time_t lastMapDrawTime = 0;	 // Tracks the last time the map was drawn
time_t nextFetchTime = 0;	 // Tracks when the next update should occur
int updateCounter = 0;

// Pins and pixel counts defined in the board file (./boards/)

// I am useing WS2811 timing =>   0:{0.3, 0.95} 1:{0.9, 0.35} Reset:300us
// XL-1615RGBC-WS2812B-S requires 0:{>0.3, >0.9} 1:{>0.9, >0.3} Reset:>200us
NeoPixelBusLg<NeoGrbFeature, NeoEsp32Rmt0Ws2811Method> hplNoa(HPL_NOA_PIXELS, HPL_NOA);
NeoPixelBusLg<NeoGrbFeature, NeoEsp32Rmt1Ws2811Method> hkiKts(HKI_KTS_PIXELS, HKI_KTS);

RgbColor black(0, 0, 0);
std::vector<RgbColor> colorTable;
int blockColorIds[512];	 // Array to hold block colors

// Data structure for scheduled LED updates
struct LedUpdate {
	std::vector<uint16_t> preBlocks;
	uint16_t postBlock;
	std::vector<int> colorIds;
	time_t timestamp;
};

enum charlieplexedLedState { GREEN, RED, OFF };

int8_t mode = 0;

// When updating these values, make sure to also update web server data

String modes[] = { String("lines"), String("delay"), String("comp"), String("train"), String("disruption"), String("test") };

uint8_t brightnessValues[5][2] = {
	{ 0, 0 }, { 80, 35 }, { 90, 35 }, { 120, 40 }, { 255, 80 },
};
uint8_t brightnessValuesWithoutDirection[5][2] = {
	{ 0, 0 }, { 35, 0 }, { 50, 0 }, { 80, 0 }, { 255, 0 },
};

std::vector<LedUpdate> ledUpdateSchedule;

TaskHandle_t statusLedTaskHandle;

static unsigned long lastUpdate = 0;
int16_t brightness = 0;
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
Button mapButton = { MAP_BUTTON, 0, false, HIGH };

// --- (Existing ISR, button check, time, and LED functions) ---
// IRAM_ATTR ensures the ISR is placed in IRAM
void IRAM_ATTR buttonISR(void* arg) {
	Button* button = (Button*)arg;
	button->lastChangeTime = xTaskGetTickCountFromISR() * portTICK_PERIOD_MS;
	button->pendingCheck = true;
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
int ledCalibration() {
	vTaskDelay(pdMS_TO_TICKS(1000));
	hplNoa.SetLuminance(40);
	hkiKts.SetLuminance(40);
	int i = 0;
	while (i < HPL_NOA_PIXELS + HKI_KTS_PIXELS) {
		if (i < HPL_NOA_PIXELS) {
			hplNoa.SetPixelColor(i, RgbColor(128, 0, 255));
			hplNoa.Show();
		} else {
			hkiKts.SetPixelColor(i - HPL_NOA_PIXELS, RgbColor(128, 0, 255));
			hkiKts.Show();
		}
		i++;
		vTaskDelay(pdMS_TO_TICKS(5));
	}
	hplNoa.SetLuminance(255);
	hkiKts.SetLuminance(255);
	return 1;
}

statusLed leds[] = { { WIFI_LED_PIN, (statusLedCommand)LED_OFF, false, 0 },
					 { CONFIG_LED_PIN, (statusLedCommand)LED_OFF, false, 0 } };

void statusLedManagerTask(void* pvParameters) {
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
						setCharlieplexedLED(pin,
											(cmd == (statusLedCommand)LED_ON_GREEN) ? GREEN
											: (statusLedCommand)(cmd == LED_ON_RED) ? RED
																					: OFF);
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
						brightness -= 1;
						break;
					case BRIGHTNESS_UP_BUTTON:
						Serial.print("Brightness Up pressed ");
						brightness += 1;
						break;
					case POWER_BUTTON:
						Serial.print("Power button pressed ");
						brightness = (brightness == 0) ? 3 : 0;	 // Toggle brightness
						break;
					case MAP_BUTTON:
						Serial.print("Map button pressed ");
						mode = (mode + 1) % (sizeof(modes) / sizeof(modes[0]) - 1);	 // -1 accounts for test mode
						ledUpdatePending = true;
						nextFetchTime = 0;
						setStatusLedState(CONFIG_LED_PIN, (statusLedCommand)LED_BLINK_GREEN_FAST);
						break;
					default:
						Serial.printf("Unknown button pressed on pin %d\n", button->pin);
						return;	 // Exit if an unknown button is pressed
				}

				// Ensure brightness stays within bounds
				brightness =
					(brightness > 0) ? constrain(brightness, 0, (sizeof(brightnessValues) / sizeof(brightnessValues[0])) - 1) : 0;

				// Save brightness to preferences
				preferences.begin("brightness");
				if (preferences.getInt("brightness") != brightness) {
					preferences.putInt("brightness", brightness);
				}
				preferences.end();

				// Update the LEDs
				if (button->pin == MAP_BUTTON) {
					Serial.printf("mode is now : %s\n", modes[mode]);
				} else {
					Serial.printf(
						"brightness now at: %i/%i\n", brightness, (sizeof(brightnessValues) / sizeof(brightnessValues[0])) - 1);
				}
				ledUpdatePending = true;
			}
		}
		button->pendingCheck = false;
	}
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
		String url = serverURLs[serverIndex] + "?mode=" + modes[mode];
		Serial.println(url);
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

void setBlockColor(uint16_t block, int colorId, bool secondary = false) {
	if (colorId < blockColorIds[block]) {
		return;	 // Do not update if the block if it is low priority
	}

	blockColorIds[block] = colorId;	 // Update the color ID for the block if it's higher

	// Set the color on the appropriate strand based on the block number
	if (block >= 100 && block < 100 + HKI_KTS_PIXELS) {
		hkiKts.SetPixelColor(
			block - 100,
			colorTable[blockColorIds[block]].Dim(
				(direction_indicators ? brightnessValues : brightnessValuesWithoutDirection)[brightness][secondary ? 1 : 0]));
	} else if (block >= 300 && block < 300 + HPL_NOA_PIXELS) {
		hplNoa.SetPixelColor(
			block - 300,
			colorTable[blockColorIds[block]].Dim(
				(direction_indicators ? brightnessValues : brightnessValuesWithoutDirection)[brightness][secondary ? 1 : 0]));
	} else {
		Serial.printf("Block %d is out of range for both strands.\n", block);
	}
}

void drawMap(time_t epoch) {
	// Clear both strands
	hkiKts.ClearTo(black);
	hplNoa.ClearTo(black);
	// Reset the blocks array
	for (int i = 0; i < 512; i++) {
		blockColorIds[i] = 0;  // Reset all blocks to black
	}

	// Draw the map based on the current LED update schedule
	if (lastMapDrawTime != 0) {
		updateCounter++;
		for (const auto& update : ledUpdateSchedule) {
			const int l = update.colorIds.size();
			if (l > 1) {
				const int i = updateCounter % l;
				setBlockColor(update.postBlock, update.colorIds[i]);

				for (auto i = 0; i < update.preBlocks.size(); i++) {
					if (update.preBlocks.size() > i && update.colorIds.size() > i && update.preBlocks[i]) {
						setBlockColor(update.preBlocks[i], update.colorIds[i], true);
					}
				}

				ledUpdatePending = true;

			} else {

				if (update.colorIds.size() > 0)
					setBlockColor(update.postBlock, update.colorIds[0]);
				for (auto i = 0; i < update.preBlocks.size(); i++) {
					if (update.preBlocks.size() > i && update.colorIds.size() > i && update.preBlocks[i]) {
						setBlockColor(update.preBlocks[i], update.colorIds[i], true);
					}
				}
			}
		}
	}

	// Show the updates on both strands
	hplNoa.Show();

	// Allow time for the strand to be sent out (Not needed but might reduce interference)
	vTaskDelay(pdMS_TO_TICKS(int(0.03 * HPL_NOA_PIXELS) + 1));

	hkiKts.Show();

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

	nextFetchTime = baseTimestamp + updateOffset;

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
		JsonArray preBlocks = update["p"];
		JsonArray colorIds = update["c"];
		int offset = update["t"];
		uint16_t postBlock = update["b"];

		// Schedule color update
		LedUpdate ledUpdate;
		if (direction_indicators)
			for (JsonVariant value : preBlocks) {
				ledUpdate.preBlocks.push_back(value.as<uint16_t>());
			}
		ledUpdate.postBlock = postBlock;
		if (offset > 0) {
			ledUpdate.timestamp = baseTimestamp + offset;
		} else {
			ledUpdate.timestamp = 0;
		}
		for (const int colorId : colorIds) {
			ledUpdate.colorIds.push_back(colorId);
		}

		ledUpdateSchedule.push_back(ledUpdate);
	}

	ledUpdatePending = true;  // Mark that an update is pending
}

void onCdcRxEvent(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data) {
	improvSerial.handleSerial();
}

void updateValues(int8_t new_mode = -1, int8_t new_brightness = -1, int8_t new_dir_ind = -1) {
	if (new_mode >= 0) {
		Serial.printf("Set mode: %i\n", new_mode);
		Serial.println(new_mode % (sizeof(modes) / sizeof(modes[0])));
		mode = (new_mode % (sizeof(modes) / sizeof(modes[0])));
		ledUpdatePending = true;
		nextFetchTime = 0;
		setStatusLedState(CONFIG_LED_PIN, (statusLedCommand)LED_BLINK_GREEN_FAST);
	}
	if (new_brightness >= 0) {
		brightness =
			(brightness > 0) ? constrain(new_brightness, 0, (sizeof(brightnessValues) / sizeof(brightnessValues[0])) - 1) : 0;

		preferences.begin("brightness");
		if (preferences.getInt("brightness") != brightness) {
			preferences.putInt("brightness", brightness);
			Serial.printf("Setting brightness: %i\n", new_brightness);
			ledUpdatePending = 0;
		} else {
			Serial.printf("Ignoring brightness command (no change) : %i\n", new_brightness);
		}
		preferences.end();
	}
	if (new_dir_ind >= 0) {
		direction_indicators = new_dir_ind == 1 ? true : false;

		preferences.begin("dir_ind");
		if (preferences.getInt("dir_ind") != direction_indicators) {
			preferences.putInt("dir_ind", direction_indicators);
			Serial.printf("Setting direction indicators: %i\n", new_dir_ind);
			ledUpdatePending = 0;
		} else {
			Serial.printf("Ignoring direction indicators command (no change) : %i\n", new_dir_ind);
		}
		preferences.end();
	}
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

	hplNoa.Begin();
	hplNoa.ClearTo(black);
	hkiKts.Begin();
	hkiKts.ClearTo(black);

	digitalWrite(LVL_Shifter_EN, LOW);	//Enable LVL Shifter
	digitalWrite(LED_5V_EN, HIGH);		//Enable 5V Power

	hkiKts.Show();
	hplNoa.Show();

	// Set initial brightness
	preferences.begin("brightness");
	brightness = preferences.getInt("brightness", brightness);
	preferences.end();
	preferences.begin("dir_ind");
	direction_indicators = preferences.getInt("dir_ind", direction_indicators);
	preferences.end();

	hplNoa.SetLuminance(255);
	hkiKts.SetLuminance(255);

// Factory test mode
#if defined(FACTORY_TEST)
	preferences.begin("factory_test");
	if (preferences.getBool("passed", false) == false) {  // Check if factory test mode has been passed
		preferences.putBool("passed", true);			  // Set factory test mode as passed
		preferences.end();

		while (true) {
			Serial.println("Factory test mode enabled");

			hplNoa.ClearTo(RgbColor(255, 0, 0));
			hkiKts.ClearTo(RgbColor(255, 0, 0));
			hplNoa.Show();
			hkiKts.Show();
			vTaskDelay(pdMS_TO_TICKS(1000));

			hplNoa.ClearTo(RgbColor(0, 255, 0));
			hkiKts.ClearTo(RgbColor(0, 255, 0));
			hplNoa.Show();
			hkiKts.Show();
			vTaskDelay(pdMS_TO_TICKS(1000));

			hplNoa.ClearTo(RgbColor(0, 0, 255));
			hkiKts.ClearTo(RgbColor(0, 0, 255));
			hplNoa.Show();
			hkiKts.Show();
			vTaskDelay(pdMS_TO_TICKS(1000));
		}
	}
	preferences.end();
#endif

	// Button initialization
	pinMode(brightnessDownButton.pin, INPUT_PULLUP);
	pinMode(brightnessUpButton.pin, INPUT_PULLUP);
	pinMode(powerButton.pin, INPUT_PULLUP);
	pinMode(mapButton.pin, INPUT_PULLUP);

	// Attach interrupts with debouncing
	attachInterruptArg(digitalPinToInterrupt(BRIGHTNESS_DOWN_BUTTON), buttonISR, &brightnessDownButton, CHANGE);
	attachInterruptArg(digitalPinToInterrupt(BRIGHTNESS_UP_BUTTON), buttonISR, &brightnessUpButton, CHANGE);
	attachInterruptArg(digitalPinToInterrupt(POWER_BUTTON), buttonISR, &powerButton, CHANGE);
	attachInterruptArg(digitalPinToInterrupt(MAP_BUTTON), buttonISR, &mapButton, CHANGE);

	Serial.println(getSystemInfo());

	// --- Time Setup ---
	sntp_set_time_sync_notification_cb(timeavailable);
	sntp_set_sync_interval(1000 * 60 * 15);	 // Set sync interval to 15 minutes
	sntp_set_sync_mode(SNTP_SYNC_MODE_IMMED);
	configTzTime(time_zone, ntpServers[0], ntpServers[1], ntpServers[2]);

	// --- WiFi Setup ---
	setStatusLedState(WIFI_LED_PIN, (statusLedCommand)LED_BLINK_GREEN_FAST);
	WiFi.mode(WIFI_STA);
	WiFi.setTxPower(WIFI_POWER_15dBm);	// Set WiFi power to avoid brownouts
	WiFi.disconnect();

	WiFiImprovSetup(updateValues, &mode, &brightness, &leds, &direction_indicators);

	Serial.println(getSystemInfo());
	ledCalibration();  // <-- breaks the brightness control for some reason
}

void loop() {
	handleWiFiImprov();			   // Handle WiFi credentials setup via WebSerial
	time_t epoch = time(nullptr);  // Get current time

	if (WiFi.status() == WL_CONNECTED) {
		setStatusLedState(WIFI_LED_PIN, (statusLedCommand)LED_ON_GREEN);

		// --- Fetch new data periodically ---
		if (epoch > nextFetchTime) {

			String downloadedJson = downloadJSON();
			if (downloadedJson.length() > 0) {
				setStatusLedState(CONFIG_LED_PIN, (statusLedCommand)LED_ON_GREEN);
				parseLEDMap(downloadedJson);  // This populates/updates the schedule
			} else {
				Serial.println("All servers failed to provide data.");
				setStatusLedState(CONFIG_LED_PIN, (statusLedCommand)LED_ON_RED);
			}

			nextFetchTime = max(nextFetchTime, epoch + 10);	 // Ensure we don't fetch too frequently

			Serial.printf("%s MCU:%2.0f°C  WiFi:%idBm\n", getLocalTime(epoch), temperatureRead(), WiFi.RSSI());
			Serial.flush();
		}

		// --- Handle button presses ---
		checkButton(&brightnessDownButton);
		checkButton(&brightnessUpButton);
		checkButton(&powerButton);
		checkButton(&mapButton);

		// --- Push updates to the LED strips only if changes were made ---
		if (ledUpdatePending || lastMapDrawTime < epoch) {
			drawMap(epoch);	 // Draw the map with the current updates
			ledUpdatePending = false;
		}

	} else {
		setStatusLedState(WIFI_LED_PIN, (statusLedCommand)LED_ON_RED);
	}
	vTaskDelay(pdMS_TO_TICKS(10));	// Delay to yield to other tasks
}