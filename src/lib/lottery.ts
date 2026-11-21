// 抽選コア。番号は常に一様乱数で選び、演出ランクは「何個引くか」だけに影響する。

export type Rank = "white" | "blue" | "green" | "red" | "gold" | "rainbow";
export type Letter = "B" | "I" | "N" | "G" | "O";
export type Rng = () => number; // [0, 1)

export interface RankEntry {
  rank: Rank;
  weight: number; // 出現率
  trust: number; // 大当たり率
}

export interface Config {
  max: number;
  jackpotCount: number;
  rushLength: number;
  rushBonus: number;
  ranks: RankEntry[];
}

export const DEFAULT_CONFIG: Config = {
  max: 75,
  jackpotCount: 3,
  rushLength: 5,
  rushBonus: 0.1,
  ranks: [
    { rank: "white", weight: 0.6, trust: 0 },
    { rank: "blue", weight: 0.2, trust: 0.03 },
    { rank: "green", weight: 0.1, trust: 0.15 },
    { rank: "red", weight: 0.07, trust: 0.5 },
    { rank: "gold", weight: 0.025, trust: 0.9 },
    { rank: "rainbow", weight: 0.005, trust: 1 },
  ],
};

export interface DrawEvent {
  rank: Rank;
  jackpot: boolean;
  inRush: boolean;
  numbers: number[];
}

export interface GameState {
  remaining: number[];
  drawn: number[];
  rushLeft: number;
}

export function createGame(config: Config): GameState {
  return {
    remaining: Array.from({ length: config.max }, (_, i) => i + 1),
    drawn: [],
    rushLeft: 0,
  };
}

const LETTERS: Letter[] = ["B", "I", "N", "G", "O"];

export function columnOf(n: number): Letter {
  return LETTERS[Math.min(4, Math.floor((n - 1) / 15))];
}

function pickRank(ranks: RankEntry[], rng: Rng): RankEntry {
  const total = ranks.reduce((s, r) => s + r.weight, 0);
  let x = rng() * total;
  for (const r of ranks) {
    x -= r.weight;
    if (x < 0) return r;
  }
  return ranks[ranks.length - 1];
}

export function drawEvent(
  state: GameState,
  config: Config,
  rng: Rng,
): { state: GameState; event: DrawEvent } {
  if (state.remaining.length === 0) throw new Error("no numbers left");

  const inRush = state.rushLeft > 0;
  const entry = pickRank(config.ranks, rng);
  const trust = Math.min(1, entry.trust + (inRush ? config.rushBonus : 0));
  const jackpot = rng() < trust;
  const count = jackpot
    ? Math.min(config.jackpotCount, state.remaining.length)
    : 1;

  const remaining = [...state.remaining];
  const numbers: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * remaining.length);
    numbers.push(remaining.splice(idx, 1)[0]);
  }

  const rushLeft = jackpot
    ? config.rushLength
    : Math.max(0, state.rushLeft - 1);

  return {
    state: { remaining, drawn: [...state.drawn, ...numbers], rushLeft },
    event: { rank: entry.rank, jackpot, inRush, numbers },
  };
}

export function cryptoRng(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

// テスト用の再現可能な乱数（mulberry32）
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
