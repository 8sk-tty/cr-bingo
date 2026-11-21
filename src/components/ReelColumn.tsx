"use client";

// 縦スクロールするリール1本。位置 pos（実数のセル番号）を requestAnimationFrame で動かし、
// DOM を直接更新する（毎フレームの React 再描画を避ける）。
// pos が増えると記号は上から下へ流れ、帯の次の記号が上から入ってくる。
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Sym } from "@/lib/strips";

export interface ReelHandle {
  /** 一定速度で回し続ける（セル/秒） */
  spin(speed?: number): void;
  /** 今の速度から減速し、minCells 以上進んだ先の target で止める。power が大きいほど最後がねっとり遅い */
  stopAt(target: number, opts?: { minCells?: number; power?: number }): Promise<void>;
  /** 停止状態から次の target まで ms かけて送る（止まりかけ→1コマ進む用） */
  stepTo(target: number, ms: number): Promise<void>;
  /** 即座に target へ（スキップ用） */
  jump(target: number): void;
}

interface Props {
  symbols: Sym[];
  initial: number;
  className?: string;
  onCell?: (fast: boolean) => void;
  ref?: Ref<ReelHandle>;
}

const VISIBLE = 2; // 中央の上下に描くセル数
const DEFAULT_SPEED = 26;
const mod = (a: number, n: number) => ((a % n) + n) % n;

type Motion =
  | { kind: "idle" }
  | { kind: "spin"; speed: number; last: number }
  | {
      kind: "tween";
      from: number;
      to: number;
      start: number;
      ms: number;
      ease: (t: number) => number;
      bounce: boolean;
      resolve: () => void;
    }
  | { kind: "bounce"; base: number; start: number; resolve: () => void };

export default function ReelColumn({ symbols, initial, className, onCell, ref }: Props) {
  const pos = useRef(initial);
  const cells = useRef<(HTMLDivElement | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const motion = useRef<Motion>({ kind: "idle" });
  const raf = useRef(0);
  const lastCell = useRef(Math.round(initial));
  const speedNow = useRef(0);
  const symbolsRef = useRef(symbols);
  const onCellRef = useRef(onCell);

  useEffect(() => {
    symbolsRef.current = symbols;
    onCellRef.current = onCell;
  });

  const render = () => {
    const syms = symbolsRef.current;
    const p = pos.current;
    const base = Math.round(p);
    for (let k = 0; k <= VISIBLE * 2; k++) {
      const el = cells.current[k];
      if (!el) continue;
      const i = base + VISIBLE - k; // k=0 が一番上（次に来る記号）
      const sym = syms[mod(i, syms.length)];
      if (el.textContent !== (sym.label || " ")) el.textContent = sym.label || " ";
      el.dataset.live = String(sym.live);
      el.dataset.center = k === VISIBLE ? "1" : "0";
      el.style.transform = `translateY(${(p - i) * 100}%)`;
    }
    if (box.current) box.current.dataset.fast = speedNow.current > 12 ? "1" : "0";
    const cell = Math.round(p);
    if (cell !== lastCell.current) {
      lastCell.current = cell;
      onCellRef.current?.(speedNow.current > 12);
    }
  };

  const tick = (now: number) => {
    const m = motion.current;
    const prev = pos.current;
    if (m.kind === "spin") {
      const dt = Math.min(0.05, (now - m.last) / 1000);
      m.last = now;
      pos.current += m.speed * dt;
    } else if (m.kind === "tween") {
      const t = Math.min(1, (now - m.start) / m.ms);
      pos.current = m.from + (m.to - m.from) * m.ease(t);
      if (t >= 1) {
        pos.current = m.to;
        if (m.bounce) {
          motion.current = { kind: "bounce", base: m.to, start: now, resolve: m.resolve };
        } else {
          motion.current = { kind: "idle" };
          m.resolve();
        }
      }
    } else if (m.kind === "bounce") {
      // 止まった瞬間に少し行き過ぎて戻る
      const t = Math.min(1, (now - m.start) / 220);
      pos.current = m.base + 0.18 * Math.sin(Math.PI * t) * (1 - t);
      if (t >= 1) {
        pos.current = m.base;
        motion.current = { kind: "idle" };
        m.resolve();
      }
    }
    speedNow.current = Math.abs(pos.current - prev) * 60;
    render();
    if (motion.current.kind !== "idle") raf.current = requestAnimationFrame(tick);
    else {
      speedNow.current = 0;
      render();
    }
  };

  const start = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };

  const settlePending = () => {
    const m = motion.current;
    if (m.kind === "tween" || m.kind === "bounce") m.resolve();
  };

  // 前方で mod が target になる最小の位置（minCells 以上先）
  const forwardTarget = (target: number, minCells: number) => {
    const len = symbolsRef.current.length;
    const base = Math.ceil(pos.current + minCells);
    return base + mod(target - base, len);
  };

  useImperativeHandle(ref, () => ({
    spin(speed = DEFAULT_SPEED) {
      settlePending();
      motion.current = { kind: "spin", speed, last: performance.now() };
      start();
    },
    stopAt(target, { minCells = 6, power = 3 } = {}) {
      settlePending();
      const m = motion.current;
      const speed = m.kind === "spin" ? m.speed : DEFAULT_SPEED;
      const from = pos.current;
      const to = forwardTarget(target, minCells);
      // 初速が回転速度と一致するよう時間を決める（ease-out の初速 = power × 距離 / 時間）
      const ms = ((power * (to - from)) / speed) * 1000;
      return new Promise<void>((resolve) => {
        motion.current = {
          kind: "tween",
          from,
          to,
          start: performance.now(),
          ms,
          ease: (t) => 1 - Math.pow(1 - t, power),
          bounce: true,
          resolve,
        };
        start();
      });
    },
    stepTo(target, ms) {
      settlePending();
      const from = pos.current;
      const to = forwardTarget(target, 0.5);
      return new Promise<void>((resolve) => {
        motion.current = {
          kind: "tween",
          from,
          to,
          start: performance.now(),
          ms,
          ease: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
          bounce: true,
          resolve,
        };
        start();
      });
    },
    jump(target) {
      settlePending();
      cancelAnimationFrame(raf.current);
      motion.current = { kind: "idle" };
      // 帯の長さに依存しない位置（直後にダミー帯→本物の帯へ差し替わっても target を指す）
      pos.current = target;
      lastCell.current = Math.round(pos.current);
      speedNow.current = 0;
      render();
    },
  }));

  // 帯の差し替え（回転中でも止めずに描き直す）
  useEffect(() => {
    render();
  }, [symbols]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div ref={box} className={"rc " + (className ?? "")}>
      {Array.from({ length: VISIBLE * 2 + 1 }, (_, k) => (
        <div
          key={k}
          className="rc-cell"
          ref={(el) => {
            cells.current[k] = el;
          }}
        />
      ))}
    </div>
  );
}
