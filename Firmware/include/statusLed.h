#pragma once
#include <Arduino.h>

enum statusLedCommand {
	LED_OFF,
	LED_ON_GREEN,
	LED_ON_RED,
	LED_BLINK_GREEN_SLOW,  // 1Hz
	LED_BLINK_GREEN_FAST,  // 5Hz
	LED_BLINK_RED_SLOW,	   // 1Hz
	LED_BLINK_RED_FAST	   // 5Hz
};

typedef struct {
	uint8_t pin;
	statusLedCommand command;
	bool currentState;
	unsigned long lastToggle;
} statusLed;