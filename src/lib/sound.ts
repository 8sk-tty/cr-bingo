// Web Audio で合成する効果音（音声ファイル不要）。
// 全体をリバーブとコンプレッサーに通して、厚みと音圧を出す。

let ctx: AudioContext | null = null;
let master: GainNode | null = null; // 最終音量（ミュート用）
let dry: GainNode | null = null; // 各音の出力先
let wet: GainNode | null = null; // リバーブ送り
let muted = false;
const VOLUME = 0.9;

function impulse(c: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 6;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.connect(master).connect(ctx.destination);

    dry = ctx.createGain();
    dry.connect(comp);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 1.8, 2.5);
    wet = ctx.createGain();
    wet.gain.value = 0.35;
    dry.connect(wet).connect(verb).connect(comp);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : VOLUME;
}
export const isMuted = () => muted;

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  dur: number;
  vol: number;
  delay?: number;
  attack?: number;
  detune?: number;
  curve?: "exp" | "lin";
}

function tone({ type = "sine", f0, f1 = f0, dur, vol, delay = 0, attack = 0.005, detune = 0, curve = "exp" }: ToneOpts) {
  if (!ctx || !dry) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(f0, t);
  if (curve === "exp") osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  else osc.frequency.linearRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(dry);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** 3本ずらした音で厚みを出す */
function fat(opts: ToneOpts, spread = 12) {
  tone({ ...opts, vol: opts.vol * 0.5, detune: -spread });
  tone({ ...opts, vol: opts.vol * 0.5, detune: spread });
  tone({ ...opts, vol: opts.vol * 0.6 });
}

interface NoiseOpts {
  delay?: number;
  from?: number;
  to?: number;
  type?: BiquadFilterType;
  q?: number;
}

function noise(dur: number, vol: number, opts: NoiseOpts = {}) {
  const { delay = 0, from = 1200, type = "lowpass", q = 0.7 } = opts;
  const to = opts.to ?? from;
  if (!ctx || !dry) return;
  const t = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(dry);
  src.start(t);
}

/** 高速回転中のチッ音 */
export const sfxTick = () => tone({ type: "square", f0: 2200, f1: 1600, dur: 0.025, vol: 0.06 });

/** 減速中の1コマ送り */
export const sfxStep = () => {
  tone({ type: "triangle", f0: 1100, f1: 800, dur: 0.1, vol: 0.35 });
  tone({ type: "square", f0: 2200, f1: 1600, dur: 0.04, vol: 0.08 });
};

/** 列・十の位の停止（ガシャン） */
export const sfxLock = () => {
  tone({ type: "square", f0: 260, f1: 90, dur: 0.16, vol: 0.35 });
  tone({ type: "sine", f0: 120, f1: 50, dur: 0.25, vol: 0.6 });
  noise(0.12, 0.35, { from: 4000, to: 800 });
};

/** 最終確定の衝撃音（ドーン） */
export const sfxImpact = () => {
  tone({ type: "sine", f0: 180, f1: 32, dur: 0.9, vol: 1 });
  tone({ type: "triangle", f0: 90, f1: 30, dur: 1.1, vol: 0.6 });
  fat({ type: "sawtooth", f0: 440, f1: 110, dur: 0.35, vol: 0.25 }, 25);
  noise(0.6, 0.7, { from: 6000, to: 200 });
  noise(0.05, 0.5, { from: 9000, type: "highpass" });
};

/** 保留変化（段階ごとに音程が上がる＋キラッ） */
export const sfxHold = (level: number) => {
  const base = 700 + level * 220;
  tone({ type: "sine", f0: base, f1: base * 2, dur: 0.22, vol: 0.4 });
  tone({ type: "square", f0: base * 2, f1: base * 4, dur: 0.12, vol: 0.08, delay: 0.04 });
  tone({ type: "sine", f0: base * 3, dur: 0.35, vol: 0.12, delay: 0.08 });
};

/** カットイン（シュバッ → ガキーン → ジャーン） */
export const sfxCutin = (level: 1 | 2 | 3 = 1) => {
  // 風切り
  noise(0.35, 0.8, { from: 300, to: 8000, type: "bandpass", q: 1.5 });
  // 金属音（倍音をずらして鐘っぽく）
  for (const [mul, v] of [[1, 0.5], [2.76, 0.3], [5.4, 0.18], [8.93, 0.1]] as const) {
    tone({ type: "sine", f0: 620 * mul, dur: 0.9, vol: v, delay: 0.18 });
  }
  tone({ type: "sine", f0: 140, f1: 40, dur: 0.6, vol: 0.9, delay: 0.18 });
  noise(0.25, 0.6, { delay: 0.18, from: 8000, to: 1000 });
  // 和音のスタブ（熱いほど音を重ねる）
  const chord = level === 1 ? [392, 494, 587] : level === 2 ? [440, 554, 659, 880] : [523, 659, 784, 1047, 1319];
  for (const f of chord) fat({ type: "sawtooth", f0: f, dur: 0.7 + level * 0.2, vol: 0.13, delay: 0.2, attack: 0.01 }, 15);
};

/** 大当たり確定告知の「キュイン」×3（音程を上げながら） */
export function sfxKyuin() {
  if (!ctx || !dry) return;
  for (let k = 0; k < 3; k++) {
    const t = ctx.currentTime + k * 0.36;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.setValueAtTime(0.5, t + 0.26);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (k === 2 ? 0.9 : 0.34));
    g.connect(dry);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 32;
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    const top = 2600 * Math.pow(1.12, k);
    for (const [type, mul, v, det] of [
      ["square", 1, 0.2, -8],
      ["square", 1, 0.2, 8],
      ["sine", 2, 0.45, 0],
      ["sawtooth", 0.5, 0.12, 0],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.detune.value = det;
      osc.frequency.setValueAtTime(600 * mul, t);
      osc.frequency.exponentialRampToValueAtTime(top * mul, t + 0.16);
      lfoGain.connect(osc.frequency);
      const og = ctx.createGain();
      og.gain.value = v;
      osc.connect(og).connect(g);
      osc.start(t);
      osc.stop(t + 1);
    }
    lfo.start(t);
    lfo.stop(t + 1);
  }
  // 最後にキラキラ
  for (let i = 0; i < 10; i++) {
    tone({ type: "sine", f0: 2000 + Math.random() * 3000, dur: 0.25, vol: 0.12, delay: 1.0 + i * 0.05 });
  }
}

/** 大当たりファンファーレ（ブラス風の和音） */
export function sfxFanfare() {
  const seq: [number[], number, number][] = [
    [[523, 659, 784], 0, 0.14],
    [[523, 659, 784], 0.15, 0.14],
    [[523, 659, 784], 0.3, 0.14],
    [[587, 740, 880], 0.45, 0.3],
    [[659, 831, 988], 0.8, 0.3],
    [[784, 988, 1175, 1568], 1.15, 1.4],
  ];
  for (const [notes, at, dur] of seq) {
    for (const f of notes) fat({ type: "sawtooth", f0: f, dur, vol: 0.12, delay: at, attack: 0.02 }, 18);
    tone({ type: "sine", f0: notes[0] / 2, dur, vol: 0.4, delay: at });
  }
  noise(1.2, 0.3, { delay: 1.15, from: 10000, to: 3000, type: "highpass" });
  tone({ type: "sine", f0: 120, f1: 40, dur: 0.8, vol: 0.8, delay: 1.15 });
}

/** 再始動などの短い風切り音 */
export const sfxWhoosh = () => {
  noise(0.3, 0.6, { from: 400, to: 6000, type: "bandpass", q: 1.2 });
  tone({ type: "sawtooth", f0: 200, f1: 1400, dur: 0.25, vol: 0.1 });
};
