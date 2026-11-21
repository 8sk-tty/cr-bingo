import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  columnOf,
  createGame,
  drawEvent,
  seededRng,
  type Config,
} from "./lottery";

const alwaysJackpot: Config = {
  ...DEFAULT_CONFIG,
  ranks: [{ rank: "rainbow", weight: 1, trust: 1 }],
};
const neverJackpot: Config = {
  ...DEFAULT_CONFIG,
  rushBonus: 0,
  ranks: [{ rank: "white", weight: 1, trust: 0 }],
};

describe("drawEvent", () => {
  test("全番号を重複なく引き切れる", () => {
    const rng = seededRng(1);
    let state = createGame(DEFAULT_CONFIG);
    const seen: number[] = [];
    while (state.remaining.length > 0) {
      const r = drawEvent(state, DEFAULT_CONFIG, rng);
      seen.push(...r.event.numbers);
      state = r.state;
    }
    expect(seen.length).toBe(75);
    expect(new Set(seen).size).toBe(75);
    expect(seen.every((n) => n >= 1 && n <= 75)).toBe(true);
    expect(state.drawn).toEqual(seen);
  });

  test("大当たりは3個同時、残り3未満なら残り全部", () => {
    const rng = seededRng(2);
    let state = createGame(alwaysJackpot);
    const counts: number[] = [];
    while (state.remaining.length > 0) {
      const r = drawEvent(state, alwaysJackpot, rng);
      expect(r.event.jackpot).toBe(true);
      counts.push(r.event.numbers.length);
      state = r.state;
    }
    expect(counts.slice(0, -1).every((c) => c === 3)).toBe(true);
    expect(counts.at(-1)).toBe(75 % 3 === 0 ? 3 : 75 % 3);
  });

  test("外れは1個", () => {
    const r = drawEvent(createGame(neverJackpot), neverJackpot, seededRng(3));
    expect(r.event.jackpot).toBe(false);
    expect(r.event.numbers.length).toBe(1);
  });

  test("残り0で呼ぶとエラー", () => {
    const state = { ...createGame(DEFAULT_CONFIG), remaining: [] };
    expect(() => drawEvent(state, DEFAULT_CONFIG, seededRng(4))).toThrow();
  });

  test("確変: 大当たりで残り回数セット、外れで減る、連チャンで戻る", () => {
    const rng = seededRng(5);
    let state = drawEvent(createGame(alwaysJackpot), alwaysJackpot, rng).state;
    expect(state.rushLeft).toBe(5);
    state = drawEvent(state, neverJackpot, rng).state;
    expect(state.rushLeft).toBe(4);
    state = drawEvent(state, alwaysJackpot, rng).state;
    expect(state.rushLeft).toBe(5);
  });

  test("確変中は信頼度に上乗せされる（上限100%）", () => {
    const cfg: Config = {
      ...DEFAULT_CONFIG,
      rushBonus: 1,
      ranks: [{ rank: "white", weight: 1, trust: 0 }],
    };
    const state = { ...createGame(cfg), rushLeft: 2 };
    const r = drawEvent(state, cfg, seededRng(6));
    expect(r.event.jackpot).toBe(true);
    expect(r.event.inRush).toBe(true);
  });

  test("ランク出現率が設定どおり（許容±1.5pt）", () => {
    const rng = seededRng(7);
    const tally: Record<string, number> = {};
    const N = 40000;
    for (let i = 0; i < N; i++) {
      const r = drawEvent(createGame(DEFAULT_CONFIG), DEFAULT_CONFIG, rng);
      tally[r.event.rank] = (tally[r.event.rank] ?? 0) + 1;
    }
    for (const { rank, weight } of DEFAULT_CONFIG.ranks) {
      expect(Math.abs((tally[rank] ?? 0) / N - weight)).toBeLessThan(0.015);
    }
  });

  test("番号の選ばれ方に偏りがない（ランクに依存しない）", () => {
    const rng = seededRng(8);
    const hits = new Array(76).fill(0);
    const N = 75000;
    for (let i = 0; i < N; i++) {
      const r = drawEvent(createGame(DEFAULT_CONFIG), DEFAULT_CONFIG, rng);
      hits[r.event.numbers[0]]++;
    }
    const expected = N / 75;
    const chi = hits
      .slice(1)
      .reduce((s, h) => s + (h - expected) ** 2 / expected, 0);
    // 自由度74、有意水準0.1%の臨界値 ≒ 117
    expect(chi).toBeLessThan(117);
  });
});

describe("columnOf", () => {
  test("B/I/N/G/O の境界", () => {
    expect(columnOf(1)).toBe("B");
    expect(columnOf(15)).toBe("B");
    expect(columnOf(16)).toBe("I");
    expect(columnOf(45)).toBe("N");
    expect(columnOf(46)).toBe("G");
    expect(columnOf(75)).toBe("O");
  });
});
