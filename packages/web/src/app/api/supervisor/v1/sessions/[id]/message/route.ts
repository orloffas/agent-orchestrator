import { NextResponse, type NextRequest } from "next/server";
import { withSupervisorAuth, readJsonBody } from "@/lib/supervisor/http";
import { stripControlChars, validateIdentifier, validateString } from "@/lib/validation";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 10_000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) return NextResponse.json({ error: idErr }, { status: 400 });

  return withSupervisorAuth(request, async ({ sessionManager }) => {
    const body = await readJsonBody(request);
    const messageErr = validateString(body?.message, "message", MAX_MESSAGE_LENGTH);
    if (messageErr) return NextResponse.json({ error: messageErr }, { status: 400 });
    const message = stripControlChars(String(body?.message));
    if (!message.trim()) {
      return NextResponse.json(
        { error: "message must not be empty after sanitization" },
        { status: 400 },
      );
    }
    await sessionManager.send(id, message);
    return NextResponse.json({ success: true });
  });
}
