import { NextResponse } from "next/server";
import { githubLoginStatus } from "@/lib/supervisor/github";
import { withSupervisorAuth } from "@/lib/supervisor/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withSupervisorAuth(request, async ({ config }) =>
    NextResponse.json({
      ao: await githubLoginStatus(config, "ao"),
      hermes: await githubLoginStatus(config, "hermes"),
    }),
  );
}
