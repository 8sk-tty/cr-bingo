"use client";

// 背景の動く演出（canvas）。テーマと熱さ（level）で描き方を変える。
// level: 0=通常 1=チャンス（赤以上の予告） 2=3個同時の告知 3=確変中
import { useEffect, useRef } from "react";

export type Theme = "gold" | "space";
export type StageLevel = 0 | 1 | 2 | 3;

interface Props {
  theme: Theme;
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
interface Star {
  x: number;
  y: number;
  z: number;
  pz: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export default function Backdrop({ theme, level }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  const themeRef = useRef(theme);

  useEffect(() => {
    levelRef.current = level;
    themeRef.current = theme;
  }, [level, theme]);

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
    const stars: Star[] = Array.from({ length: 500 }, () => {
      const z = rand(0.05, 1);
      return { x: rand(-1, 1), y: rand(-1, 1), z, pz: z };
    });
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

    const drawSpace = (t: number, dt: number, lv: number) => {
      const L = levelRef.current;
      ctx.fillStyle = "#01030a";
      ctx.fillRect(0, 0, w, h);
      // 星雲
      ctx.globalCompositeOperation = "lighter";
      const blobs: [number, number, string][] =
        L === 1
          ? [[0.3, 0.4, "255,40,60"], [0.75, 0.7, "180,20,40"]]
          : L === 3
            ? [[0.3, 0.4, "255,60,200"], [0.7, 0.65, "120,60,255"]]
            : [[0.3, 0.4, "40,90,255"], [0.72, 0.68, "130,50,255"]];
      for (const [i, [bx, by, col]] of blobs.entries()) {
        const x = (bx + 0.05 * Math.sin(t * 0.0002 + i)) * w;
        const y = (by + 0.05 * Math.cos(t * 0.00017 + i)) * h;
        const r = Math.max(w, h) * 0.45;
        const ng = ctx.createRadialGradient(x, y, 0, x, y, r);
        ng.addColorStop(0, `rgba(${col},${0.16 + lv * 0.05})`);
        ng.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = ng;
        ctx.fillRect(0, 0, w, h);
      }
      // ワープする星
      const cx = w * 0.36;
      const cy = h * 0.55;
      const speed = [0.12, 0.45, 2.2, 0.8][L] * (0.5 + smooth * 0.5);
      const fov = Math.min(w, h) * 0.6;
      for (const s of stars) {
        s.pz = s.z;
        s.z -= speed * dt;
        if (s.z <= 0.02) {
          s.x = rand(-1, 1);
          s.y = rand(-1, 1);
          s.z = 1;
          s.pz = 1;
        }
        const sx = cx + (s.x / s.z) * fov;
        const sy = cy + (s.y / s.z) * fov;
        const px = cx + (s.x / s.pz) * fov;
        const py = cy + (s.y / s.pz) * fov;
        const b = Math.min(1, (1 - s.z) * 1.4);
        const col = L === 1 ? `255,${120 + 100 * b},${120 + 100 * b}` : L === 3 ? `255,${170 + 80 * b},255` : `${190 + 65 * b},${220 + 35 * b},255`;
        ctx.strokeStyle = `rgba(${col},${b})`;
        ctx.lineWidth = Math.max(0.6, (1 - s.z) * 2.6);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      smooth += (levelRef.current - smooth) * Math.min(1, dt * 3);
      if (themeRef.current === "gold") drawGold(now, dt, smooth);
      else drawSpace(now, dt, smooth);
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
