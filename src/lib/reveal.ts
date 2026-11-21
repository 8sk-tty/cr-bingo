// 段階的開示（列 → 十の位 → 一の位）の演出プラン。結果は抽選時に確定済みで、
// ここでは「どう見せるか」だけを決める。リールは未抽選の番号だけを通る。
import { columnOf, type DrawEvent, type Letter, type Rank, type Rng } from "./lottery";

export const RANK_ORDER: Rank[] = ["white", "blue", "green", "red", "gold", "rainbow"];

export type Tens = number | null; // null = 1桁（十の位が空白）
/** 止まりかけたリールがさらに何コマ滑るか */
export interface Slips {
  letter: number;
  tens: number;
  ones: number;
}

export interface RevealPlan {
  final: number;
  letter: Letter;
  letterCandidates: Letter[];
  tens: Tens;
  tensCandidates: Tens[];
  onesCandidates: number[];
  slowSteps: number[]; // 一の位の減速で表示する番号列（最後が確定番号）
  slips: Slips;
  respin: boolean; // 一の位が一度止まってから再始動する
}

export interface EventPlan {
  holdSteps: Rank[]; // 保留変化（白 → … → ランク）
  telop: string | null;
  announce: "none" | "pre" | "post"; // 大当たり告知: 開示前 / 1個目確定後
  reels: RevealPlan[];
}

export function tensOf(n: number): Tens {
  return n < 10 ? null : Math.floor(n / 10);
}

const SLOW_RANGE: Record<Rank, [number, number]> = {
  white: [2, 3],
  blue: [3, 4],
  green: [4, 5],
  red: [5, 7],
  gold: [6, 8],
  rainbow: [7, 10],
};
// 一の位の滑りコマ数の出やすさ [0, 1, 2, 3]
const ONES_SLIP: Record<Rank, number[]> = {
  white: [0.45, 0.35, 0.2, 0],
  blue: [0.35, 0.4, 0.25, 0],
  green: [0.25, 0.35, 0.3, 0.1],
  red: [0.1, 0.3, 0.4, 0.2],
  gold: [0.1, 0.25, 0.4, 0.25],
  rainbow: [0.05, 0.25, 0.4, 0.3],
};
const TENS_SLIP: Record<Rank, number> = {
  white: 0.2, blue: 0.25, green: 0.3, red: 0.4, gold: 0.45, rainbow: 0.5,
};
const RESPIN_RATE: Record<Rank, number> = {
  white: 0, blue: 0.03, green: 0.08, red: 0.2, gold: 0.25, rainbow: 0.3,
};

function pickIndex(weights: number[], rng: Rng) {
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const randInt = (rng: Rng, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));

export function buildRevealPlan(
  final: number,
  rank: Rank,
  remaining: number[],
  rng: Rng,
): RevealPlan {
  const pool = remaining.includes(final) ? remaining : [...remaining, final];
  const letter = columnOf(final);
  const tens = tensOf(final);
  const inColumn = pool.filter((n) => columnOf(n) === letter);
  const onesCandidates = inColumn
    .filter((n) => tensOf(n) === tens)
    .sort((a, b) => a - b);

  const [lo, hi] = SLOW_RANGE[rank];
  const k = randInt(rng, lo, hi);
  const slowSteps: number[] = [];
  if (onesCandidates.length === 1) {
    slowSteps.push(final);
  } else {
    const idx = onesCandidates.indexOf(final);
    const len = onesCandidates.length;
    for (let i = k - 1; i >= 0; i--) {
      slowSteps.push(onesCandidates[(((idx - i) % len) + len) % len]);
    }
  }

  const slips: Slips = {
    letter: rng() < 0.15 ? 1 : 0,
    tens: rng() < TENS_SLIP[rank] ? 1 : 0,
    ones: pickIndex(ONES_SLIP[rank], rng),
  };
  const respin = rng() < RESPIN_RATE[rank];

  return {
    final,
    letter,
    letterCandidates: uniq(pool.map(columnOf)),
    tens,
    tensCandidates: uniq(inColumn.map(tensOf)),
    onesCandidates,
    slowSteps,
    slips,
    respin,
  };
}

export function buildHoldSteps(rank: Rank, rng: Rng): Rank[] {
  const target = RANK_ORDER.indexOf(rank);
  const steps: Rank[] = ["white"];
  for (let i = 1; i < target; i++) if (rng() < 0.4) steps.push(RANK_ORDER[i]);
  if (target > 0) steps.push(rank);
  return steps;
}

const TELOP: Partial<Record<Rank, string>> = {
  red: "CHANCE",
  gold: "激熱",
  rainbow: "確定!?",
};

export function buildEventPlan(
  event: DrawEvent,
  remainingBefore: number[],
  rng: Rng,
): EventPlan {
  return {
    holdSteps: buildHoldSteps(event.rank, rng),
    telop: TELOP[event.rank] ?? null,
    announce: event.jackpot ? (rng() < 0.5 ? "pre" : "post") : "none",
    reels: event.numbers.map((n) =>
      buildRevealPlan(n, event.rank, remainingBefore, rng),
    ),
  };
}
