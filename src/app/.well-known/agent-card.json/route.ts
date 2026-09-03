import { NextRequest, NextResponse } from "next/server";
import {
  loadAgentCard,
  resolveA2AOrigin,
  resolveA2ARequestOrigin,
} from "@/lib/a2a/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const card = await loadAgentCard(
    resolveA2AOrigin(request),
    resolveA2ARequestOrigin(request),
  );
  return NextResponse.json(card, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
