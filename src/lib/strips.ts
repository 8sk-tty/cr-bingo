// リールの帯（縦に並ぶ記号列）。列 → 十の位 → 一の位の各リールに対応する。
// 抽選済みの記号も帯には残し、暗く表示する（実機のリールのように欠けのない帯にするため）。
import { columnOf } from "./lottery";
import { tensOf } from "./reveal";

export interface Sym {
  label: string;
  live: boolean;
}
export interface Strip {
  symbols: Sym[];
  target: number;
}
export interface Strips {
  letter: Strip;
  tens: Strip;
  ones: Strip;
}

export const MIN_STRIP = 6;
const LETTERS = ["B", "I", "N", "G", "O"];

const range = (lo: number, hi: number) =>
  Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

function pad(symbols: Sym[]): Sym[] {
  const out = [...symbols];
  while (out.length < MIN_STRIP) out.push(...symbols);
  return out;
}

export function buildStrips(final: number, remaining: number[]): Strips {
  const live = new Set(remaining);
  live.add(final);
  const col = LETTERS.indexOf(columnOf(final));
  const inCol = range(col * 15 + 1, col * 15 + 15);

  const letter = LETTERS.map((L, c) => ({
    label: L,
    live: range(c * 15 + 1, c * 15 + 15).some((n) => live.has(n)),
  }));

  const tensValues = [...new Set(inCol.map(tensOf))];
  const tens = tensValues.map((t) => ({
    label: t === null ? "" : String(t),
    live: inCol.some((n) => tensOf(n) === t && live.has(n)),
  }));

  const ones = inCol
    .filter((n) => tensOf(n) === tensOf(final))
    .map((n) => ({ label: String(n % 10), live: live.has(n) }));

  const finalTens = tensOf(final);
  return {
    letter: { symbols: pad(letter), target: col },
    tens: {
      symbols: pad(tens),
      target: tensValues.indexOf(finalTens),
    },
    ones: {
      symbols: pad(ones),
      target: ones.findIndex((s) => s.label === String(final % 10)),
    },
  };
}
