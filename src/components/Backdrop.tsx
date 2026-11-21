"use client";

// 背景の動く演出（canvas、黒金テーマ）。熱さ（level）で描き方を変える。
// level: 0=通常 1=チャンス（赤以上の予告） 2=3個同時の告知 3=確変中
import { useEffect, useRef } from "react";

export type StageLevel = 0 | 1 | 2 | 3;

interface Props {
  level: StageLevel;
}

interface Ember {
  x: number;
  y: number;
  vy: number;
  r: number;
  phase: number;
  hue: number;
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export default function Backdrop({ level }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const embers: Ember[] = Array.from({ length: 160 }, () => ({
      x: rand(0, 1),
      y: rand(0, 1),
      vy: rand(0.02, 0.08),
      r: rand(0.6, 2.6),
      phase: rand(0, Math.PI * 2),
      hue: rand(20, 48),
    }));
    let bolt = 0; // 雷光の残り時間
    let boltPath: [number, number][] = [];
    let smooth = 0; // level を滑らかに追従
    let last = performance.now();
    let raf = 0;

    const drawGold = (t: number, dt: number, lv: number) => {
      const L = levelRef.current;
      // 地の色: 黒〜焦げ茶、熱いほど赤み・金色が強まる
      const g = ctx.createRadialGradient(w * 0.36, h * 0.55, 0, w * 0.36, h * 0.55, Math.max(w, h) * 0.8);
      const core = L === 3 ? "#3a0608" : L === 2 ? "#3d2a05" : L === 1 ? "#2a0606" : "#1a0f06";
      g.addColorStop(0, core);
      g.addColorStop(0.6, "#070302");
      g.addColorStop(1, "#020100");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // 光の柱
      const pillars = 6;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < pillars; i++) {
        const x = ((i + 0.5) / pillars + 0.04 * Math.sin(t * 0.0003 + i * 1.7)) * w;
        const pw = w * (0.03 + 0.02 * Math.sin(t * 0.001 + i));
        const a = 0.04 + lv * 0.07 + 0.02 * Math.sin(t * 0.002 + i * 2);
        const pg = ctx.createLinearGradient(x - pw, 0, x + pw, 0);
        const col = L === 1 || L === 3 ? "255,70,40" : "255,200,90";
        pg.addColorStop(0, `rgba(${col},0)`);
        pg.addColorStop(0.5, `rgba(${col},${a})`);
        pg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = pg;
        ctx.fillRect(x - pw, 0, pw * 2, h);
      }

      // 火の粉・金粒
      const speed = 1 + lv * 0.9;
      for (const e of embers) {
        e.y -= e.vy * speed * dt;
        e.x += Math.sin(t * 0.001 + e.phase) * 0.0004 * speed;
        if (e.y < -0.02) {
          e.y = 1.02;
          e.x = rand(0, 1);
        }
        const flick = 0.55 + 0.45 * Math.sin(t * 0.01 + e.phase * 3);
        const hue = L === 1 || L === 3 ? e.hue - 18 : e.hue;
        const r = e.r * (1 + lv * 0.25);
        ctx.fillStyle = `hsla(${hue},100%,${60 + flick * 20}%,${0.35 + flick * 0.5})`;
        ctx.beginPath();
        ctx.arc(e.x * w, e.y * h, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsla(${hue},100%,60%,${0.06 * flick})`;
        ctx.beginPath();
        ctx.arc(e.x * w, e.y * h, r * 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 雷光（3個同時の告知中）
      if (L === 2 && bolt <= 0 && Math.random() < dt * 1.6) {
        bolt = 0.18;
        let x = rand(0.1, 0.9) * w;
        boltPath = [[x, 0]];
        for (let y = 0; y < h; y += h / 14) {
          x += rand(-0.05, 0.05) * w;
          boltPath.push([x, y]);
        }
      }
      if (bolt > 0) {
        bolt -= dt;
        ctx.fillStyle = `rgba(255,240,200,${bolt * 1.2})`;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = `rgba(255,250,220,${Math.min(1, bolt * 8)})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = "#ffd76a";
        ctx.shadowBlur = 30;
        ctx.beginPath();
        boltPath.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      smooth += (levelRef.current - smooth) * Math.min(1, dt * 3);
      drawGold(now, dt, smooth);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvas} className="backdrop" aria-hidden />;
}
