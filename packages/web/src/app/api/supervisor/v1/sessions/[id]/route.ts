import { NextResponse, type NextRequest } from "next/server";
import {
  enrichSessionPR,
  enrichSessionsMetadata,
  resolveProject,
  sessionToDashboard,
} from "@/lib/serialize";
import { getSCM } from "@/lib/services";
import { withSupervisorAuth } from "@/lib/supervisor/http";
import { validateIdentifier } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) return NextResponse.json({ error: idErr }, { status: 400 });

  return withSupervisorAuth(request, async ({ config, registry, sessionManager }) => {
    const session = await sessionManager.get(id);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const dashboard = sessionToDashboard(session);
    await enrichSessionsMetadata([session], [dashboard], config, registry).catch(() => undefined);
    if (session.pr) {
      const scm = getSCM(registry, resolveProject(session, config.projects));
      if (scm) await enrichSessionPR(dashboard, scm, session.pr).catch(() => undefined);
    }
    return NextResponse.json({ session: dashboard });
  });
}
