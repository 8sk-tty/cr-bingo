import type { Metadata } from "next";
import { Dela_Gothic_One, Orbitron } from "next/font/google";
import "./globals.css";

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["700", "900"],
});

const dela = Dela_Gothic_One({
  variable: "--font-dela",
  weight: "400",
  preload: false,
});

export const metadata: Metadata = {
  title: "CR BINGO NEON",
  description: "パチンコ風演出のビンゴ抽選アプリ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${orbitron.variable} ${dela.variable}`}>
      <body>{children}</body>
    </html>
  );
}
