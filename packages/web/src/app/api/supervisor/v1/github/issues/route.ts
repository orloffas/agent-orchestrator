import { NextResponse } from "next/server";
import { createSupervisorIssue, parseIssueInput } from "@/lib/supervisor/github";
import { readJsonBody, supervisorError, withSupervisorAuth } from "@/lib/supervisor/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withSupervisorAuth(request, async ({ config }) => {
    try {
      const input = parseIssueInput(await readJsonBody(request));
      const issue = await createSupervisorIssue(config, input);
      return NextResponse.json({ issue }, { status: 201 });
    } catch (err) {
      return supervisorError(err, 400);
    }
  });
}
