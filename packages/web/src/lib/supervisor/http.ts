import { NextResponse } from "next/server";
import { SessionNotFoundError } from "@jleechanorg/ao-core";
import { getServices, type Services } from "../services";
import { authorizeSupervisorRequest } from "./auth";

export type SupervisorHandler = (services: Services) => Promise<NextResponse>;

export async function withSupervisorAuth(
  request: Request,
  handler: SupervisorHandler,
): Promise<NextResponse> {
  try {
    const services = await getServices();
    const authFailure = authorizeSupervisorRequest(request, services.config);
    if (authFailure) {
      return NextResponse.json({ error: authFailure.error }, { status: authFailure.status });
    }
    return handler(services);
  } catch (err) {
    const status = err instanceof SessionNotFoundError ? 404 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Supervisor request failed" },
      { status },
    );
  }
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  return (await request.json().catch(() => null)) as Record<string, unknown> | null;
}

export function supervisorError(err: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}
