/**
 * Synthesised flip-disc clicks. Each click is a few milliseconds of filtered
 * noise with a fast decay — close to the "tick" a disc makes as it lands
 * against its stop. Many discs flipping at once become a rattle.
 */
export class ClickSynth {
  private ctx: AudioContext | null = null;
  private buffers: AudioBuffer[] = [];
  private master: GainNode | null = null;
  volume = 0.5;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    // A handful of slightly different clicks so a rattle doesn't sound robotic.
    for (let k = 0; k < 6; k++) {
      const len = Math.floor(this.ctx.sampleRate * 0.012);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      const decay = 0.0009 + Math.random() * 0.0007;
      const ring = 2200 + Math.random() * 2600;
      for (let i = 0; i < len; i++) {
        const t = i / this.ctx.sampleRate;
        const env = Math.exp(-t / decay);
        d[i] = env * ((Math.random() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * ring * t) * 0.4);
      }
      this.buffers.push(buf);
    }
    return this.ctx;
  }

  /** Call from a user gesture (browsers block audio until then). */
  unlock(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  /**
   * Schedule clicks. `delays` are ms from now when each disc lands.
   * Voices are capped and gain is scaled so 2000 flips don't clip.
   */
  play(delays: number[]): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || ctx.state !== 'running' || !delays.length) return;
    const MAX = 40;
    const n = delays.length;
    const pick = n <= MAX ? delays : sample(delays, MAX);
    const loudness = Math.min(1.6, 0.35 + Math.sqrt(n) * 0.05);
    const per = (loudness / Math.sqrt(pick.length)) * this.volume;
    this.master.gain.value = 1;
    const now = ctx.currentTime;
    for (const d of pick) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers[(Math.random() * this.buffers.length) | 0];
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const g = ctx.createGain();
      g.gain.value = per * (0.7 + Math.random() * 0.6);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2500 + Math.random() * 2500;
      bp.Q.value = 0.9;
      src.connect(bp).connect(g).connect(this.master);
      src.start(now + Math.max(0, d) / 1000);
    }
  }
}

function sample<T>(arr: T[], k: number): T[] {
  const out: T[] = [];
  const step = arr.length / k;
  for (let i = 0; i < k; i++) out.push(arr[Math.floor(i * step + Math.random() * step)]);
  return out;
}
