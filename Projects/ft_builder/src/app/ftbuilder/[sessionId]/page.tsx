"use client";

import { use } from "react";
import FTBuilderPage from "../page";

export default function FTBuilderSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  return <FTBuilderPage sessionId={sessionId} />;
}
