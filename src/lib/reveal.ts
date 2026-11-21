// 段階的開示（列 → 十の位 → 一の位）の演出プラン。結果は抽選時に確定済みで、
// ここでは「どう見せるか」だけを決める。リールは未抽選の番号だけを通る。
import { columnOf, type DrawEvent, type Letter, type Rank, type Rng } from "./lottery";

export const RANK_ORDER: Rank[] = ["white", "blue", "green", "red", "gold", "rainbow"];

export type Tens = number | null; // null = 1桁（十の位が空白）
export type Hesitation = "none" | "hesitate" | "respin";

export interface RevealPlan {
  final: number;
  letter: Letter;
  letterCandidates: Letter[];
  tens: Tens;
  tensCandidates: Tens[];
  onesCandidates: number[];
  slowSteps: number[]; // 一の位の減速で表示する番号列（最後が確定番号）
  hesitation: Hesitation; // 止まりかけて1コマ進む / 一度止まって再始動
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
const HESITATE_RATE: Record<Rank, number> = {
  white: 0.05,
  blue: 0.15,
  green: 0.25,
  red: 0.4,
  gold: 0.5,
  rainbow: 0.6,
};

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

  let hesitation: Hesitation = "none";
  if (slowSteps.length >= 2 && rng() < HESITATE_RATE[rank]) {
    hesitation = rng() < 0.5 ? "hesitate" : "respin";
  }

  return {
    final,
    letter,
    letterCandidates: uniq(pool.map(columnOf)),
    tens,
    tensCandidates: uniq(inColumn.map(tensOf)),
    onesCandidates,
    slowSteps,
    hesitation,
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
