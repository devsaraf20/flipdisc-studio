// Flip-Disc Studio: play an exported animation on Arduino / ESP32.
//
// 1. In the studio: Output tab → "Export C array" → layout "Rows" → Download.
// 2. Put the downloaded file next to this sketch and rename it to flipdisc_frames.h
//    (or keep the name and change the #include below).
// 3. Replace setDisc() / showFrame() with calls to your panel driver.
//
// The exported header defines, for an array named `flipdisc_frames`:
//   FLIPDISC_FRAMES_WIDTH, _HEIGHT, _COUNT, _FRAME_BYTES, _BYTES_PER_ROW
//   flipdisc_frames[COUNT][FRAME_BYTES]   (bits)
//   flipdisc_frames_ms[COUNT]             (how long to hold each frame)

#include <Arduino.h>
#include "flipdisc_frames.h"

#ifndef pgm_read_byte
#define pgm_read_byte(addr) (*(const uint8_t *)(addr))
#endif
#ifndef pgm_read_word
#define pgm_read_word(addr) (*(const uint16_t *)(addr))
#endif

const int W = FLIPDISC_FRAMES_WIDTH;
const int H = FLIPDISC_FRAMES_HEIGHT;

bool discOn(int frame, int x, int y) {
  uint8_t b = pgm_read_byte(&flipdisc_frames[frame][y * FLIPDISC_FRAMES_BYTES_PER_ROW + x / 8]);
  return b & (0x80 >> (x % 8));
}

// ---- replace these with your hardware ----
void setDisc(int x, int y, bool on) {
  // e.g. myPanel.set(x, y, on);
}
void showFrame() {
  // e.g. myPanel.update();  (send the buffer over RS485, pulse the coils…)
}
// -------------------------------------------

void printFrame(int f) {
  // Handy while you have no panel: ASCII art in the Serial Monitor.
  for (int y = 0; y < H; y++) {
    for (int x = 0; x < W; x++) Serial.print(discOn(f, x, y) ? '#' : '.');
    Serial.println();
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  for (int f = 0; f < FLIPDISC_FRAMES_COUNT; f++) {
    for (int y = 0; y < H; y++)
      for (int x = 0; x < W; x++) setDisc(x, y, discOn(f, x, y));
    showFrame();
    printFrame(f);
    delay(pgm_read_word(&flipdisc_frames_ms[f]));
  }
}
