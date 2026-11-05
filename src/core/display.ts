/** Physical layout of the display: identical panels tiled in a grid. */
export interface DisplayConfig {
  panelWidth: number;
  panelHeight: number;
  panelsX: number;
  panelsY: number;
}

export interface PanelPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  note?: string;
}

export const PANEL_PRESETS: PanelPreset[] = [
  { id: '7x7', name: '7 × 7 module', width: 7, height: 7 },
  { id: '14x7', name: '14 × 7 module', width: 14, height: 7 },
  { id: '28x7', name: '28 × 7 module', width: 28, height: 7, note: 'Common RS485 module size' },
  { id: '28x14', name: '28 × 14 panel', width: 28, height: 14, note: 'Two 28 × 7 modules stacked' },
  { id: '28x28', name: '28 × 28 panel', width: 28, height: 28 },
  { id: '56x14', name: '56 × 14 panel', width: 56, height: 14 },
  { id: '84x7', name: '84 × 7 destination sign', width: 84, height: 7 },
  { id: '112x16', name: '112 × 16 destination sign', width: 112, height: 16 },
];

export const DEFAULT_DISPLAY: DisplayConfig = { panelWidth: 28, panelHeight: 14, panelsX: 1, panelsY: 1 };

export function displaySize(d: DisplayConfig): { width: number; height: number } {
  return { width: d.panelWidth * d.panelsX, height: d.panelHeight * d.panelsY };
}

export const MAX_DISCS = 256 * 128;

export function clampDisplay(d: DisplayConfig): DisplayConfig {
  const c = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo));
  const out = {
    panelWidth: c(d.panelWidth, 1, 128),
    panelHeight: c(d.panelHeight, 1, 64),
    panelsX: c(d.panelsX, 1, 8),
    panelsY: c(d.panelsY, 1, 8),
  };
  return out;
}
