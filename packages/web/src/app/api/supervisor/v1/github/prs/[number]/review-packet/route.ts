import { NextResponse, type NextRequest } from "next/server";
import { buildReviewPacket } from "@/lib/supervisor/github";
import { readJsonBody, supervisorError, withSupervisorAuth } from "@/lib/supervisor/http";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  const prNumber = Number(number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return NextResponse.json({ error: "number must be a positive integer" }, { status: 400 });
  }

  return withSupervisorAuth(request, async ({ config }) => {
    try {
      const body = await readJsonBody(request);
      const packet = await buildReviewPacket(config, prNumber, {
        projectId: typeof body?.projectId === "string" ? body.projectId : undefined,
        repo: typeof body?.repo === "string" ? body.repo : undefined,
      });
      return NextResponse.json({ packet });
    } catch (err) {
      return supervisorError(err, 400);
    }
  });
}
