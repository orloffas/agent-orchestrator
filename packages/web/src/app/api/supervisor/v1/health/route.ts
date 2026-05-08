import { NextResponse } from "next/server";
import { buildSupervisorHealth } from "@/lib/supervisor/snapshot";
import { withSupervisorAuth } from "@/lib/supervisor/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withSupervisorAuth(request, async (services) =>
    NextResponse.json(await buildSupervisorHealth(services)),
  );
}
