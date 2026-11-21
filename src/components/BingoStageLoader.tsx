"use client";

import dynamic from "next/dynamic";

const BingoStage = dynamic(() => import("./BingoStage"), { ssr: false });

export default function BingoStageLoader() {
  return <BingoStage />;
}
