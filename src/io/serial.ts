import type { Frame } from '../core/frame';
import type { DisplayProtocol, OptionValue } from './protocols';

// Minimal Web Serial typings (not yet in lib.dom for every TS version).
interface SerialPortLike {
  open(o: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

export function serialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Web Serial output. Writes one encoded frame at a time; if the port is still
 * busy when a new frame arrives, only the newest frame is kept (no backlog).
 */
export class SerialOutput {
  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private busy = false;
  private next: Uint8Array | null = null;
  connected = false;
  error = '';
  bytesSent = 0;
  framesSent = 0;
  dropped = 0;
  lastPacket: Uint8Array | null = null;
  portLabel = '';
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.lastEmit = performance.now();
    this.listeners.forEach((l) => l());
  }
  private lastEmit = 0;
  /** Counters change many times a second; tell the UI at most ~4×/s. */
  private emitSoon() {
    if (performance.now() - this.lastEmit > 250) this.emit();
  }

  async connect(baudRate: number): Promise<void> {
    this.error = '';
    if (!serialSupported()) {
      this.error = 'Web Serial is not available. Use Chrome or Edge on desktop, over https or localhost.';
      this.emit();
      return;
    }
    try {
      const port = (await (navigator as any).serial.requestPort()) as SerialPortLike;
      await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none' });
      this.port = port;
      this.writer = port.writable!.getWriter();
      this.connected = true;
      const info = port.getInfo?.() ?? {};
      this.portLabel = info.usbVendorId
        ? `USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`
        : 'Serial port';
    } catch (e) {
      this.error = (e as Error).message || String(e);
      this.connected = false;
    }
    this.emit();
  }

  async disconnect(): Promise<void> {
    try {
      this.writer?.releaseLock();
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.writer = null;
    this.port = null;
    this.connected = false;
    this.emit();
  }

  sendFrame(frame: Frame, protocol: DisplayProtocol, opts: Record<string, OptionValue>): void {
    const bytes = protocol.encode(frame, opts);
    this.lastPacket = bytes;
    if (!this.connected || !this.writer) return;
    if (this.busy) {
      if (this.next) this.dropped++;
      this.next = bytes;
      return;
    }
    void this.write(bytes);
  }

  private async write(bytes: Uint8Array) {
    this.busy = true;
    try {
      await this.writer!.write(bytes);
      this.bytesSent += bytes.length;
      this.framesSent++;
    } catch (e) {
      this.error = (e as Error).message || String(e);
      this.connected = false;
      this.busy = false;
      this.emit();
      return;
    }
    this.busy = false;
    this.emitSoon();
    if (this.next) {
      const n = this.next;
      this.next = null;
      void this.write(n);
    }
  }
}

export const serial = new SerialOutput();
