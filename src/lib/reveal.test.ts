import { describe, expect, test } from "bun:test";
import { columnOf, seededRng } from "./lottery";
import { buildRevealPlan, tensOf } from "./reveal";

const all = Array.from({ length: 75 }, (_, i) => i + 1);

describe("buildRevealPlan", () => {
  test("一の位の減速列は最終番号で終わり、同じ列・十の位の未抽選番号だけを通る", () => {
    const rng = seededRng(1);
    for (let trial = 0; trial < 500; trial++) {
      const remaining = all.filter(() => rng() < 0.6);
      if (remaining.length === 0) continue;
      const final = remaining[Math.floor(rng() * remaining.length)];
      const plan = buildRevealPlan(final, "red", remaining, rng);
      expect(plan.letter).toBe(columnOf(final));
      expect(plan.tens).toBe(tensOf(final));
      expect(plan.slowSteps.at(-1)).toBe(final);
      for (const n of plan.slowSteps) {
        expect(remaining).toContain(n);
        expect(columnOf(n)).toBe(plan.letter);
        expect(tensOf(n)).toBe(plan.tens);
      }
      expect(plan.onesCandidates).toContain(final);
    }
  });

  test("1桁は十の位が空白（null）", () => {
    const plan = buildRevealPlan(7, "white", all, seededRng(2));
    expect(plan.tens).toBeNull();
    expect(plan.tensCandidates).toContain(null);
  });

  test("リール候補は未抽選の番号がある列・十の位だけ", () => {
    const remaining = [3, 48, 52, 70];
    const plan = buildRevealPlan(52, "blue", remaining, seededRng(3));
    expect(plan.letterCandidates.sort()).toEqual(["B", "G", "O"]);
    expect(plan.tensCandidates.sort()).toEqual([4, 5]);
    expect(plan.onesCandidates).toEqual([52]);
  });

  test("熱いランクほど減速が長い（平均）", () => {
    const rng = seededRng(4);
    const avg = (rank: "white" | "rainbow") => {
      let s = 0;
      for (let i = 0; i < 300; i++)
        s += buildRevealPlan(55, rank, all, rng).slowSteps.length;
      return s / 300;
    };
    expect(avg("rainbow")).toBeGreaterThan(avg("white"));
  });
});

describe("buildHoldSteps", () => {
  test("白から始まりランクで終わる昇順", async () => {
    const { buildHoldSteps, RANK_ORDER } = await import("./reveal");
    const rng = seededRng(5);
    for (const rank of RANK_ORDER) {
      for (let i = 0; i < 50; i++) {
        const s = buildHoldSteps(rank, rng);
        expect(s[0]).toBe("white");
        expect(s.at(-1)).toBe(rank);
        const idx = s.map((r) => RANK_ORDER.indexOf(r));
        expect(idx.every((v, j) => j === 0 || v > idx[j - 1])).toBe(true);
      }
    }
  });
});

describe("滑り（スベリ）", () => {
  test("一の位の滑りは0〜3コマ、列・十の位は0〜1コマ", () => {
    const rng = seededRng(9);
    for (const rank of ["white", "blue", "green", "red", "gold", "rainbow"] as const) {
      for (let i = 0; i < 200; i++) {
        const p = buildRevealPlan(55, rank, all, rng);
        expect(p.slips.ones).toBeGreaterThanOrEqual(0);
        expect(p.slips.ones).toBeLessThanOrEqual(3);
        expect([0, 1]).toContain(p.slips.tens);
        expect([0, 1]).toContain(p.slips.letter);
      }
    }
  });

  test("通常でも半分以上は一の位が滑り、熱いほど滑りが多い", () => {
    const rng = seededRng(10);
    const stats = (rank: "white" | "red") => {
      let slipped = 0;
      let total = 0;
      for (let i = 0; i < 2000; i++) {
        const s = buildRevealPlan(55, rank, all, rng).slips.ones;
        if (s > 0) slipped++;
        total += s;
      }
      return { rate: slipped / 2000, avg: total / 2000 };
    };
    const w = stats("white");
    const r = stats("red");
    expect(w.rate).toBeGreaterThan(0.5);
    expect(r.avg).toBeGreaterThan(w.avg);
  });
});
