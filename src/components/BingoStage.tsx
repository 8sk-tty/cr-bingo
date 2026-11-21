"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CONFIG,
  createGame,
  cryptoRng,
  drawEvent,
  type DrawEvent,
  type GameState,
  type Rank,
} from "@/lib/lottery";
import { buildEventPlan, type RevealPlan } from "@/lib/reveal";
import { buildStrips, type Strips } from "@/lib/strips";
import * as sfx from "@/lib/sound";
import ReelColumn, { type ReelHandle } from "./ReelColumn";

const STORAGE_KEY = "cr-bingo:v1";
const LETTERS = ["B", "I", "N", "G", "O"] as const;

// ランクが熱いほど各段階をゆっくり見せる
const PACE: Record<Rank, number> = {
  white: 1,
  blue: 1.1,
  green: 1.25,
  red: 1.45,
  gold: 1.6,
  rainbow: 1.8,
};
// 一の位の減速カーブ（大きいほど最後がねっとり遅い）
const POWER: Record<Rank, number> = {
  white: 3,
  blue: 3,
  green: 3.5,
  red: 4,
  gold: 4.5,
  rainbow: 5,
};

interface ReelView {
  id: string; // 抽選ごとに変えてリールを作り直す
  strips: Strips;
  lock: 0 | 1 | 2 | 3; // 0=回転中 1=列確定 2=十の位確定 3=確定
  rank: Rank;
  fake?: boolean; // 一度止まったように見せている状態
}
type Col = "letter" | "tens" | "ones";
type ReelHandles = Partial<Record<Col, ReelHandle | null>>;

interface Saved {
  history: GameState[]; // history[0] = 初期状態
  events: DrawEvent[]; // events[i] が history[i] → history[i+1] を作った
}

// 前の段階が止まるまでは中身を明かさないダミーの帯
const GENERIC = Array.from({ length: 10 }, (_, d) => ({ label: String(d), live: true }));
const symbolsFor = (r: ReelView, c: Col) =>
  c === "letter" || (c === "tens" && r.lock >= 1) || (c === "ones" && r.lock >= 2)
    ? r.strips[c].symbols
    : GENERIC;

interface Cutin {
  id: number;
  text: string;
  sub: string;
  tone: Rank | "jackpot";
}
const CUTIN_SUB: Partial<Record<Rank, string>> = {
  red: "期待度 UP",
  gold: "大チャンス",
  rainbow: "PREMIUM",
};
const CUTIN_LEVEL: Partial<Record<Rank, 1 | 2 | 3>> = { red: 1, gold: 2, rainbow: 3 };
let cutinSeq = 0;

let reelSeq = 0;
const makeReel = (n: number, remaining: number[], rank: Rank, lock: ReelView["lock"]): ReelView => ({
  id: `${Date.now().toString(36)}-${++reelSeq}`,
  strips: buildStrips(n, remaining),
  lock,
  rank,
});
const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function initialSaved(): Saved {
  return { history: [createGame(DEFAULT_CONFIG)], events: [] };
}

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!Array.isArray(s.history) || s.history.length === 0) return null;
    return s;
  } catch {
    return null;
  }
}

function persist(s: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 保存できなくても抽選は続ける
  }
}

// localStorage から復元するため、ブラウザでのみ描画する（BingoStageLoader 経由）
export default function BingoStage() {
  const [saved, setSaved] = useState<Saved>(() => loadSaved() ?? initialSaved());
  const [playing, setPlaying] = useState(false);
  const [reels, setReels] = useState<ReelView[]>(() => {
    const last = saved.events.at(-1);
    const rem = saved.history[saved.history.length - 1].remaining;
    return last ? last.numbers.map((n) => makeReel(n, rem, last.rank, 3)) : [];
  });
  const [hold, setHold] = useState<{ rank: Rank; level: number } | null>(null);
  const [cutin, setCutin] = useState<Cutin | null>(null);
  const [shake, setShake] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [muted, setMutedState] = useState(false);

  const savedRef = useRef(saved);
  const playingRef = useRef(false);
  const skipRef = useRef(false);
  const waiters = useRef(new Set<() => void>());
  const handles = useRef<ReelHandles[]>([]);
  const reelsRef = useRef<ReelView[]>(reels);
  const lastTick = useRef(0);

  const setReelsBoth = (next: ReelView[]) => {
    reelsRef.current = next;
    setReels(next);
  };

  const commit = (s: Saved) => {
    savedRef.current = s;
    setSaved(s);
    persist(s);
  };

  // ---- 演出用ユーティリティ ----
  const wait = (ms: number) =>
    skipRef.current
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(id);
            waiters.current.delete(done);
            resolve();
          };
          const id = setTimeout(done, ms);
          waiters.current.add(done);
        });

  const play = (f: () => void) => {
    if (!skipRef.current) f();
  };

  const updateReel = (i: number, patch: Partial<ReelView>) =>
    setReelsBoth(reelsRef.current.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const bigFlash = () => setFlash((f) => f + 1);
  const shakeStage = () => setShake((x) => x + 1);

  // カットイン（スキップ中は出さない）
  const showCutin = async (text: string, sub: string, tone: Cutin["tone"], level: 1 | 2 | 3, ms = 1500) => {
    if (skipRef.current) return;
    setCutin({ id: ++cutinSeq, text, sub, tone });
    sfx.sfxCutin(level);
    bigFlash();
    shakeStage();
    await wait(ms);
    setCutin(null);
  };

  const onCell = (fast: boolean) => {
    if (skipRef.current) return;
    if (fast) {
      const now = performance.now();
      if (now - lastTick.current > 45) {
        lastTick.current = now;
        sfx.sfxTick();
      }
    } else sfx.sfxStep();
  };

  // スキップ中は即座に止める
  const col = (i: number, c: Col) => {
    const h = handles.current[i]?.[c];
    const target = reelsRef.current[i].strips[c].target;
    return {
      target,
      len: reelsRef.current[i].strips[c].symbols.length,
      spin: () => {
        if (!skipRef.current) h?.spin();
      },
      stop: (opts?: { minCells?: number; power?: number }, t = target) =>
        skipRef.current || !h ? (h?.jump(t), Promise.resolve()) : h.stopAt(t, opts),
      step: (ms: number) =>
        skipRef.current || !h ? (h?.jump(target), Promise.resolve()) : h.stepTo(target, ms),
      jump: () => h?.jump(target),
    };
  };

  const runReel = async (i: number, plan: RevealPlan, rank: Rank, telopText: string | null) => {
    const pace = PACE[rank];
    const L = col(i, "letter");
    const T = col(i, "tens");
    const O = col(i, "ones");
    L.spin();
    T.spin();
    O.spin();
    await wait(500 * pace);
    // 1. 列
    await L.stop({ minCells: Math.round(5 * pace) });
    updateReel(i, { lock: 1 });
    play(sfx.sfxLock);
    await wait(250 * pace);
    // 2. 十の位
    await T.stop({ minCells: Math.round(5 * pace) });
    updateReel(i, { lock: 2 });
    play(sfx.sfxLock);
    // カットイン
    if (telopText) {
      await wait(200);
      await showCutin(telopText, CUTIN_SUB[rank] ?? "", rank, CUTIN_LEVEL[rank] ?? 1);
    }
    await wait(300 * pace);
    // 3. 一の位（減速 → 止まりかけ / 再始動）
    const slow = { minCells: 3 + plan.slowSteps.length, power: POWER[rank] };
    const before = (O.target - 1 + O.len) % O.len;
    if (plan.hesitation === "hesitate") {
      await O.stop(slow, before);
      await wait(900 * pace);
      await O.step(650);
    } else if (plan.hesitation === "respin") {
      await O.stop(slow, before);
      updateReel(i, { fake: true });
      play(sfx.sfxLock);
      await wait(1000 * pace);
      updateReel(i, { fake: false });
      play(sfx.sfxWhoosh);
      O.spin();
      await wait(400);
      await O.stop({ minCells: 8, power: POWER[rank] });
    } else {
      await O.stop(slow);
    }
    O.jump();
    updateReel(i, { lock: 3, fake: false });
  };

  const runEvent = async (event: DrawEvent, remainingBefore: number[]) => {
    const plan = buildEventPlan(event, remainingBefore, cryptoRng);
    const rank = event.rank;
    skipRef.current = false;
    playingRef.current = true;
    setPlaying(true);
    setReelsBoth([makeReel(event.numbers[0], remainingBefore, rank, 0)]);

    // 保留変化
    for (let k = 0; k < plan.holdSteps.length; k++) {
      setHold({ rank: plan.holdSteps[k], level: k });
      play(() => sfx.sfxHold(k));
      await wait(320);
    }

    if (plan.announce === "pre") {
      await wait(200);
      play(sfx.sfxKyuin);
      await showCutin("3個同時!!", "JACKPOT 確定", "jackpot", 3, 1700);
      setReelsBoth(event.numbers.map((n) => makeReel(n, remainingBefore, rank, 0)));
      await nextFrame();
      await Promise.all(
        plan.reels.map((p, i) => runReel(i, p, rank, i === 0 ? plan.telop : null)),
      );
    } else {
      await nextFrame();
      await runReel(0, plan.reels[0], rank, plan.telop);
      if (plan.announce === "post") {
        play(sfx.sfxImpact);
        bigFlash();
        await wait(900);
        play(sfx.sfxKyuin);
        await showCutin("まだだ!!", "3個同時 確定", "jackpot", 3, 1700);
        setReelsBoth([
          reelsRef.current[0],
          ...event.numbers.slice(1).map((n) => makeReel(n, remainingBefore, rank, 0)),
        ]);
        await nextFrame();
        await Promise.all(
          plan.reels.slice(1).map((p, i) => runReel(i + 1, p, rank, null)),
        );
      }
    }

    // 確定（スキップ時もここは必ず鳴らす）
    reelsRef.current.forEach((_, i) => (["letter", "tens", "ones"] as Col[]).forEach((c) => col(i, c).jump()));
    setReelsBoth(reelsRef.current.map((r) => ({ ...r, lock: 3, fake: false })));
    skipRef.current = false;
    sfx.sfxImpact();
    bigFlash();
    shakeStage();
    if (event.jackpot) {
      sfx.sfxFanfare();
      setBanner("JACKPOT ×" + event.numbers.length);
      setTimeout(() => setBanner(null), 2200);
    }
    setHold(null);
    playingRef.current = false;
    setPlaying(false);
  };

  // ---- 操作 ----
  const skip = () => {
    skipRef.current = true;
    waiters.current.forEach((f) => f());
    waiters.current.clear();
    reelsRef.current.forEach((_, i) =>
      (["letter", "tens", "ones"] as Col[]).forEach((c) => col(i, c).jump()),
    );
  };

  const onAction = useCallback(() => {
    sfx.unlockAudio();
    if (playingRef.current) return skip();
    const s = savedRef.current;
    const current = s.history[s.history.length - 1];
    if (current.remaining.length === 0) return;
    const { state, event } = drawEvent(current, DEFAULT_CONFIG, cryptoRng);
    commit({ history: [...s.history, state], events: [...s.events, event] });
    void runEvent(event, current.remaining);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUndo = useCallback(() => {
    const s = savedRef.current;
    if (playingRef.current || s.events.length === 0) return;
    if (!window.confirm("直前の抽選を取り消しますか？")) return;
    const next = { history: s.history.slice(0, -1), events: s.events.slice(0, -1) };
    commit(next);
    const last = next.events.at(-1);
    const rem = next.history[next.history.length - 1].remaining;
    setReelsBoth(last ? last.numbers.map((n) => makeReel(n, rem, last.rank, 3)) : []);
  }, []);

  const onReset = useCallback(() => {
    if (playingRef.current) return;
    if (!window.confirm("新しいゲームを始めますか？（抽選履歴は消えます）")) return;
    commit(initialSaved());
    setReelsBoth([]);
  }, []);

  const onMute = useCallback(() => {
    sfx.unlockAudio();
    const m = !sfx.isMuted();
    sfx.setMuted(m);
    setMutedState(m);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if ([" ", "enter", "pagedown", "arrowright"].includes(k)) {
        e.preventDefault();
        onAction();
      } else if (k === "z") onUndo();
      else if (k === "r") onReset();
      else if (k === "m") onMute();
      else if (k === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAction, onUndo, onReset, onMute]);

  // ---- 表示 ----
  // 演出中は結果をネタバレしないよう、1つ前の状態を表示する
  const { history, events } = saved;
  const shown = playing ? history[history.length - 2] : history[history.length - 1];
  const lastEvent = playing ? null : events.at(-1);
  const drawnSet = new Set(shown.drawn);
  const latestSet = new Set(lastEvent?.numbers ?? []);
  const finished = shown.remaining.length === 0;

  return (
    <main
      className={
        "stage" +
        (shown.rushLeft > 0 ? " rush" : "") +
        // 同じアニメーションを再生し直すため、2つのクラスを交互に付け替える
        (shake > 0 ? (shake % 2 ? " shake-a" : " shake-b") : "")
      }
      onClick={onAction}
    >
      <header className="topbar">
        <span className="logo">CR BINGO NEON</span>
        <span className="stat">
          抽選 <b>{shown.drawn.length}</b> / {DEFAULT_CONFIG.max}
        </span>
        <span className="stat">
          残り <b>{shown.remaining.length}</b>
        </span>
        {shown.rushLeft > 0 && (
          <span className="rush-badge">NEON RUSH 残り{shown.rushLeft}回</span>
        )}
        <button
          className="mute"
          onClick={(e) => {
            e.stopPropagation();
            onMute();
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </header>

      <section className="center">
        <div className="hold-slot">
          {hold && (
            <div key={hold.level} className={`hold rank-${hold.rank}`} />
          )}
        </div>
        <div className={`reels n${Math.max(1, reels.length)}`}>
          {reels.length === 0 ? (
            <div className="idle-hint">SPACE / クリックで抽選</div>
          ) : (
            reels.map((r, i) => {
              const setH = (c: Col) => (h: ReelHandle | null) => {
                (handles.current[i] ??= {})[c] = h;
              };
              const reelCol = (c: Col, cls: string, lit: boolean) => (
                <ReelColumn
                  ref={setH(c)}
                  symbols={symbolsFor(r, c)}
                  initial={r.lock === 3 ? r.strips[c].target : r.strips[c].target + 2}
                  className={cls + (lit ? " lit" : "")}
                  onCell={onCell}
                />
              );
              return (
                <div
                  key={r.id}
                  className={`reel lock${r.lock} rank-${r.rank}${r.fake ? " fake" : ""}`}
                >
                  {reelCol("letter", "letter", r.lock >= 1)}
                  <div className="reel-window">
                    {reelCol("tens", "digit", r.lock >= 2)}
                    {reelCol("ones", "digit", r.lock >= 3 || !!r.fake)}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {finished && !playing && <div className="complete">全番号 抽選済み</div>}
        <div className="keys">
          SPACE 抽選/スキップ ・ Z 取消 ・ R リセット ・ M 音 ・ F 全画面
        </div>
      </section>

      <aside className="board">
        {LETTERS.map((L, c) => (
          <div key={L} className="col">
            <div className="col-head">{L}</div>
            {Array.from({ length: 15 }, (_, r) => {
              const n = c * 15 + r + 1;
              return (
                <div
                  key={n}
                  className={
                    "cell" +
                    (drawnSet.has(n) ? " on" : "") +
                    (latestSet.has(n) ? " latest" : "")
                  }
                >
                  {n}
                </div>
              );
            })}
          </div>
        ))}
      </aside>

      {cutin && (
        <div className={`cutin tone-${cutin.tone}`} key={"cutin" + cutin.id}>
          <div className="cutin-rays" />
          <div className="cutin-band b1" />
          <div className="cutin-band b2" />
          <div className="cutin-lines" />
          <div className="cutin-text" data-text={cutin.text}>
            {cutin.text}
          </div>
          {cutin.sub && <div className="cutin-sub">{cutin.sub}</div>}
        </div>
      )}
      {banner && (
        <div className="banner" key={"banner" + banner}>
          {banner}
        </div>
      )}
      {flash > 0 && <div className="flash" key={"flash" + flash} />}
    </main>
  );
}
