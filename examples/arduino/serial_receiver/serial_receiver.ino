// Flip-Disc Studio: receive live frames over USB serial ("Raw packed bits" protocol).
//
// In the studio: Output tab → Hardware via Web Serial → Protocol "Raw packed bits"
// → choose the same baud rate as below → Connect serial port… → pick this board.
//
// Packet: 'F' 'D' width height payload[ceil(w*h/8)] checksum
//   payload  = discs row by row, MSB first (bit 7 of byte 0 = top-left disc)
//   checksum = XOR of all payload bytes
//
// Works on Arduino Uno (small panels) and ESP32 (large panels).

#include <Arduino.h>

const long BAUD = 115200;
const int MAX_BYTES = 512;  // 4096 discs; lower this on an Uno if RAM is tight

uint8_t buf[MAX_BYTES];
int width = 0, height = 0, need = 0, got = 0;
uint8_t check = 0;
enum State { WAIT_F, WAIT_D, WAIT_W, WAIT_H, PAYLOAD, CHECKSUM } state = WAIT_F;

// ---- replace with your hardware ----
void setDisc(int x, int y, bool on) {}
void showFrame() {}
// ------------------------------------

bool disc(int x, int y) {
  int i = y * width + x;
  return buf[i >> 3] & (0x80 >> (i & 7));
}

void frameReady() {
  for (int y = 0; y < height; y++)
    for (int x = 0; x < width; x++) setDisc(x, y, disc(x, y));
  showFrame();
  digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));  // blink per frame
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(BAUD);
}

void loop() {
  while (Serial.available()) {
    uint8_t c = Serial.read();
    switch (state) {
      case WAIT_F: if (c == 'F') state = WAIT_D; break;
      case WAIT_D: state = (c == 'D') ? WAIT_W : WAIT_F; break;
      case WAIT_W: width = c; state = WAIT_H; break;
      case WAIT_H:
        height = c;
        need = (width * height + 7) / 8;
        got = 0;
        check = 0;
        state = (need > 0 && need <= MAX_BYTES) ? PAYLOAD : WAIT_F;
        break;
      case PAYLOAD:
        buf[got++] = c;
        check ^= c;
        if (got == need) state = CHECKSUM;
        break;
      case CHECKSUM:
        if (c == check) frameReady();  // otherwise: corrupted, drop it
        state = WAIT_F;
        break;
    }
  }
}
