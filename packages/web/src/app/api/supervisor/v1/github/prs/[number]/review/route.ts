import { NextResponse, type NextRequest } from "next/server";
import { parseReviewInput, submitSupervisorReview } from "@/lib/supervisor/github";
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
      const input = parseReviewInput(await readJsonBody(request));
      const review = await submitSupervisorReview(config, prNumber, input);
      return NextResponse.json({ review });
    } catch (err) {
      return supervisorError(err, 400);
    }
  });
}
