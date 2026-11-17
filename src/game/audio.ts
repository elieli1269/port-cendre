type AudioCtor = typeof AudioContext;

export class GameAudio {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beds: AudioNode[] = [];
  muted = false;

  unlock() {
    const w = window as Window & { webkitAudioContext?: AudioCtor };
    const AC = window.AudioContext || w.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      try {
        this.ctx = new AC({ latencyHint: "interactive" });
      } catch {
        this.ctx = new AC();
      }
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.master.gain.value = 0.85;
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.startBeds();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  resumeIfNeeded() {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(next: boolean) {
    this.muted = next;
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(next ? 0 : 0.85, this.ctx.currentTime, 0.03);
  }

  destroy() {
    for (const node of this.beds) {
      const stoppable = node as AudioScheduledSourceNode;
      if (typeof stoppable.stop === "function") {
        try {
          stoppable.stop();
        } catch {
          /* already stopped */
        }
      }
    }
    this.beds = [];
    void this.ctx?.close();
    this.ctx = null;
  }

  gun(id: string, distant = false) {
    const scale = distant ? 0.35 : 1;
    if (id === "rafale") this.burst(150 + Math.random() * 30, 0.07, "square", 0.16 * scale, 1700);
    else if (id === "brise") this.burst(80, 0.2, "sawtooth", 0.3 * scale, 780);
    else this.burst(190 + Math.random() * 24, 0.1, "triangle", 0.2 * scale, 2100);
  }

  hit() {
    this.blip(920, 0.045, 0.07);
  }

  down() {
    this.burst(64, 0.18, "sine", 0.16, 360);
  }

  hurt() {
    this.burst(48, 0.16, "sawtooth", 0.14, 280);
  }

  empty() {
    this.blip(160, 0.04, 0.05);
  }

  pickup() {
    this.blip(520, 0.07, 0.06);
    this.blip(760, 0.09, 0.05);
  }

  wave() {
    this.blip(311, 0.14, 0.06);
  }

  step() {
    this.burst(110 + Math.random() * 30, 0.035, "triangle", 0.028, 480);
  }

  reload() {
    this.blip(220, 0.05, 0.04);
  }

  private startBeds() {
    if (!this.ctx || !this.sfx || !this.noise || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hip = this.ctx.createBiquadFilter();
    hip.type = "highpass";
    hip.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
    src.connect(hip);
    hip.connect(g);
    g.connect(this.sfx);
    src.start();
    this.beds.push(src);

    const drone = this.ctx.createOscillator();
    drone.type = "sine";
    drone.frequency.value = 52;
    const fifth = this.ctx.createOscillator();
    fifth.type = "triangle";
    fifth.frequency.value = 78;
    const dg = this.ctx.createGain();
    dg.gain.setValueAtTime(0.0001, t);
    dg.gain.exponentialRampToValueAtTime(0.018, t + 1.2);
    drone.connect(dg);
    fifth.connect(dg);
    dg.connect(this.master);
    drone.start();
    fifth.start();
    this.beds.push(drone, fifth);
  }

  private blip(freq: number, dur: number, gain: number) {
    if (!this.ctx || !this.sfx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * (0.97 + Math.random() * 0.06);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  private burst(freq: number, dur: number, type: OscillatorType, gain: number, filterFreq: number) {
    if (!this.ctx || !this.sfx || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFreq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, filterFreq * 0.35), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    src.start(t);
    src.stop(t + dur + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(36, freq * 0.45), t + dur);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(gain * 0.55, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.75);
    osc.connect(og);
    og.connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur);
    osc.onended = () => {
      osc.disconnect();
      og.disconnect();
    };
  }
}
