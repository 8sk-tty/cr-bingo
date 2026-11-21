"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CONFIG,
  columnOf,
  createGame,
  cryptoRng,
  drawEvent,
  type DrawEvent,
  type GameState,
  type Rank,
} from "@/lib/lottery";
import { buildEventPlan, tensOf, type RevealPlan, type Tens } from "@/lib/reveal";
import * as sfx from "@/lib/sound";

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

interface ReelView {
  letter: string;
  tens: string;
  ones: string;
  lock: 0 | 1 | 2 | 3; // 0=回転中 1=列確定 2=十の位確定 3=確定
  rank: Rank;
  fake?: boolean; // 一度止まったように見せている状態
}

interface Saved {
  history: GameState[]; // history[0] = 初期状態
  events: DrawEvent[]; // events[i] が history[i] → history[i+1] を作った
}

const fmtTens = (t: Tens) => (t === null ? "" : String(t));
const spinningReel = (rank: Rank = "white"): ReelView => ({
  letter: "?",
  tens: "",
  ones: "",
  lock: 0,
  rank,
});
const lockedReel = (n: number, rank: Rank): ReelView => ({
  letter: columnOf(n),
  tens: fmtTens(tensOf(n)),
  ones: String(n % 10),
  lock: 3,
  rank,
});
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

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
    return last ? last.numbers.map((n) => lockedReel(n, last.rank)) : [];
  });
  const [hold, setHold] = useState<{ rank: Rank; level: number } | null>(null);
  const [telop, setTelop] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [muted, setMutedState] = useState(false);

  const savedRef = useRef(saved);
  const playingRef = useRef(false);
  const skipRef = useRef(false);
  const waiters = useRef(new Set<() => void>());

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
    setReels((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const spin = async (ms: number, frame: () => void, pitch = 1) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !skipRef.current) {
      frame();
      play(() => sfx.sfxTick(pitch));
      await wait(60);
    }
  };

  const bigFlash = () => setFlash((f) => f + 1);

  const runReel = async (
    i: number,
    plan: RevealPlan,
    rank: Rank,
    telopText: string | null,
  ) => {
    const pace = PACE[rank];
    // 1. 列
    await spin(500 * pace, () => updateReel(i, { letter: pick(plan.letterCandidates) }));
    updateReel(i, { letter: plan.letter, lock: 1 });
    play(sfx.sfxLock);
    await wait(250 * pace);
    // 2. 十の位
    await spin(
      500 * pace,
      () => updateReel(i, { tens: fmtTens(pick(plan.tensCandidates)) }),
      1.1,
    );
    updateReel(i, { tens: fmtTens(plan.tens), lock: 2 });
    play(sfx.sfxLock);
    // カットイン
    if (telopText) {
      await wait(200);
      setTelop(telopText);
      play(sfx.sfxWhoosh);
      await wait(1100);
      setTelop(null);
    }
    // 3. 一の位（高速 → 減速）
    await spin(
      400 * pace,
      () => updateReel(i, { ones: String(pick(plan.onesCandidates) % 10) }),
      1.2,
    );
    const steps = plan.slowSteps;
    for (let k = 0; k < steps.length; k++) {
      const isLast = k === steps.length - 1;
      if (isLast && plan.hesitation === "hesitate") {
        await wait(900 * pace);
      }
      if (isLast && plan.hesitation === "respin") {
        updateReel(i, { fake: true });
        play(sfx.sfxLock);
        await wait(1000 * pace);
        updateReel(i, { fake: false });
        play(sfx.sfxWhoosh);
        await wait(250);
      }
      updateReel(i, { ones: String(steps[k] % 10) });
      play(sfx.sfxStep);
      if (!isLast) {
        const t = (k + 1) / steps.length;
        await wait((120 + 380 * t * t) * pace);
      }
    }
    updateReel(i, { ones: String(plan.final % 10), lock: 3, fake: false });
  };

  const runEvent = async (event: DrawEvent, remainingBefore: number[]) => {
    const plan = buildEventPlan(event, remainingBefore, cryptoRng);
    const rank = event.rank;
    skipRef.current = false;
    playingRef.current = true;
    setPlaying(true);
    setReels([spinningReel(rank)]);

    // 保留変化
    for (let k = 0; k < plan.holdSteps.length; k++) {
      setHold({ rank: plan.holdSteps[k], level: k });
      play(() => sfx.sfxHold(k));
      await wait(320);
    }

    if (plan.announce === "pre") {
      await wait(200);
      play(sfx.sfxKyuin);
      bigFlash();
      setBanner("3個同時!!");
      await wait(1000);
      setBanner(null);
      setReels(plan.reels.map(() => spinningReel(rank)));
      await Promise.all(
        plan.reels.map((p, i) => runReel(i, p, rank, i === 0 ? plan.telop : null)),
      );
    } else {
      await runReel(0, plan.reels[0], rank, plan.telop);
      if (plan.announce === "post") {
        play(sfx.sfxImpact);
        bigFlash();
        await wait(900);
        play(sfx.sfxKyuin);
        bigFlash();
        setBanner("まだだ!! 3個同時!!");
        await wait(1100);
        setBanner(null);
        setReels((rs) => [rs[0], ...plan.reels.slice(1).map(() => spinningReel(rank))]);
        await Promise.all(
          plan.reels.slice(1).map((p, i) => runReel(i + 1, p, rank, null)),
        );
      }
    }

    // 確定（スキップ時もここは必ず鳴らす）
    setReels(event.numbers.map((n) => lockedReel(n, rank)));
    skipRef.current = false;
    sfx.sfxImpact();
    bigFlash();
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
    setReels(last ? last.numbers.map((n) => lockedReel(n, last.rank)) : []);
  }, []);

  const onReset = useCallback(() => {
    if (playingRef.current) return;
    if (!window.confirm("新しいゲームを始めますか？（抽選履歴は消えます）")) return;
    commit(initialSaved());
    setReels([]);
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
    <main className={"stage" + (shown.rushLeft > 0 ? " rush" : "")} onClick={onAction}>
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
            <div className="idle-hint">
              {finished ? "全番号 抽選済み" : "SPACE / クリックで抽選"}
            </div>
          ) : (
            reels.map((r, i) => (
              <div
                key={i}
                className={`reel lock${r.lock} rank-${r.rank}${r.fake ? " fake" : ""}`}
              >
                <span className="letter">{r.letter}</span>
                <span className="num">
                  {!(r.lock >= 2 && r.tens === "") && (
                    <span
                      className={
                        "digit" + (r.lock >= 2 ? " locked" : r.lock === 1 ? " spin" : " wait")
                      }
                    >
                      {r.lock === 0 ? "-" : r.tens || " "}
                    </span>
                  )}
                  <span
                    className={
                      "digit" + (r.lock >= 3 ? " locked" : r.lock === 2 ? " spin" : " wait")
                    }
                  >
                    {r.lock < 2 ? "-" : r.ones}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
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

      {telop && (
        <div className="telop" key={telop}>
          <span>{telop}</span>
        </div>
      )}
      {banner && (
        <div className="banner" key={banner}>
          {banner}
        </div>
      )}
      {flash > 0 && <div className="flash" key={flash} />}
    </main>
  );
}
