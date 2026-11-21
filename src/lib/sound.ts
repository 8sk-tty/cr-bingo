// Web Audio で合成する効果音（音声ファイル不要）。試作用の仮の音。

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}
export const isMuted = () => muted;

function tone(
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  vol: number,
  delay = 0,
) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, delay = 0, lowpass = 1200) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

/** 高速回転中のチッ音 */
export const sfxTick = (pitch = 1) => tone("square", 1800 * pitch, 1400 * pitch, 0.03, 0.05);

/** 減速中の1コマ送り */
export const sfxStep = () => tone("triangle", 900, 700, 0.09, 0.25);

/** 列・十の位の停止 */
export const sfxLock = () => {
  tone("square", 220, 110, 0.12, 0.2);
  noise(0.08, 0.15, 0, 2000);
};

/** 最終確定の衝撃音 */
export const sfxImpact = () => {
  tone("sine", 160, 40, 0.5, 0.7);
  tone("square", 440, 220, 0.25, 0.15);
  noise(0.35, 0.4, 0, 3000);
};

/** 保留変化（段階ごとに音程が上がる） */
export const sfxHold = (level: number) =>
  tone("sine", 600 + level * 180, 1200 + level * 260, 0.18, 0.3);

/** カットイン・テロップ */
export const sfxWhoosh = () => {
  noise(0.3, 0.35, 0, 5000);
  tone("sawtooth", 200, 1200, 0.25, 0.08);
};

/** 大当たり確定告知の「キュイン」 */
export function sfxKyuin() {
  if (!ctx || !master) return;
  for (let k = 0; k < 2; k++) {
    const t = ctx.currentTime + k * 0.42;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
    g.gain.setValueAtTime(0.35, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    g.connect(master);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 28;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    for (const [type, mul] of [["square", 1], ["sine", 2]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(700 * mul, t);
      osc.frequency.exponentialRampToValueAtTime(2600 * mul, t + 0.18);
      lfoGain.connect(osc.frequency);
      const og = ctx.createGain();
      og.gain.value = type === "square" ? 0.25 : 0.5;
      osc.connect(og).connect(g);
      osc.start(t);
      osc.stop(t + 0.42);
    }
    lfo.start(t);
    lfo.stop(t + 0.42);
  }
}

/** 大当たりファンファーレ */
export function sfxFanfare() {
  const notes = [523, 659, 784, 1047, 784, 1047, 1319];
  notes.forEach((f, i) => tone("square", f, f, 0.22, 0.12, i * 0.11));
  tone("sawtooth", 262, 262, 1.2, 0.06, notes.length * 0.11);
  tone("square", 1047, 1047, 1.2, 0.08, notes.length * 0.11);
}
