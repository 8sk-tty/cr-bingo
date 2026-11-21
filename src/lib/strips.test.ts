import { describe, expect, test } from "bun:test";
import { buildStrips, MIN_STRIP } from "./strips";

const all = Array.from({ length: 75 }, (_, i) => i + 1);

describe("buildStrips", () => {
  test("目標記号のインデックスが正しく、帯は最低長以上", () => {
    for (const n of all) {
      const s = buildStrips(n, all);
      expect(s.letter.symbols[s.letter.target].label).toBe("BINGO"[Math.floor((n - 1) / 15)]);
      expect(s.tens.symbols[s.tens.target].label).toBe(n < 10 ? "" : String(Math.floor(n / 10)));
      expect(s.ones.symbols[s.ones.target].label).toBe(String(n % 10));
      for (const strip of [s.letter, s.tens, s.ones]) {
        expect(strip.symbols.length).toBeGreaterThanOrEqual(MIN_STRIP);
      }
    }
  });

  test("一の位の帯は同じ列・十の位の番号だけ（G列の40番台は46〜49）", () => {
    const s = buildStrips(47, all);
    expect(new Set(s.ones.symbols.map((x) => x.label))).toEqual(new Set(["6", "7", "8", "9"]));
  });

  test("抽選済みの番号・番号のない列は live=false（暗く表示）", () => {
    const remaining = all.filter((n) => n !== 48 && (n < 1 || n > 15));
    const s = buildStrips(47, remaining);
    expect(s.ones.symbols.find((x) => x.label === "8")?.live).toBe(false);
    expect(s.ones.symbols.find((x) => x.label === "7")?.live).toBe(true);
    expect(s.letter.symbols.find((x) => x.label === "B")?.live).toBe(false);
  });
});
