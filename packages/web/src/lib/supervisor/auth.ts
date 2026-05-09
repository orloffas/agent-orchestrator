import { timingSafeEqual } from "node:crypto";
import type { OrchestratorConfig, ProjectConfig, SupervisorConfig } from "@jleechanorg/ao-core";

export interface SupervisorAuthFailure {
  status: 401 | 503;
  error: string;
}

export interface ResolvedSupervisorConfig extends SupervisorConfig {
  staleWorkerMs: number;
  dashboardStaleGraceMs: number;
}

const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  enabled: false,
  staleWorkerMinutes: 30,
  dashboardStaleGraceSeconds: 90,
  bearerTokenEnv: "SUPERNOVA_AO_SUPERVISOR_TOKEN",
  hermesGithubTokenEnv: "SUPERNOVA_HERMES_GITHUB_TOKEN",
  hermesExpectedLogin: "nova-hermes",
  aoExpectedLogin: "nova-ome",
};

export function resolveSupervisorConfig(config: OrchestratorConfig): ResolvedSupervisorConfig {
  const supervisor = { ...DEFAULT_SUPERVISOR_CONFIG, ...config.supervisor };
  return {
    ...supervisor,
    staleWorkerMs: supervisor.staleWorkerMinutes * 60_000,
    dashboardStaleGraceMs: supervisor.dashboardStaleGraceSeconds * 1000,
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authorizeSupervisorRequest(
  request: Request,
  config: OrchestratorConfig,
): SupervisorAuthFailure | null {
  const supervisor = resolveSupervisorConfig(config);
  if (!supervisor.enabled) {
    return { status: 503, error: "AO supervisor API is disabled" };
  }

  const expected = process.env[supervisor.bearerTokenEnv]?.trim();
  if (!expected) {
    return { status: 503, error: `${supervisor.bearerTokenEnv} is not configured` };
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token || !constantTimeEqual(token, expected)) {
    return { status: 401, error: "Unauthorized supervisor request" };
  }

  return null;
}

export function listSupervisorProjects(config: OrchestratorConfig): Array<[string, ProjectConfig]> {
  const supervisor = resolveSupervisorConfig(config);
  const allowed = supervisor.allowedProjects ? new Set(supervisor.allowedProjects) : null;
  return Object.entries(config.projects).filter(
    ([projectId]) => !allowed || allowed.has(projectId),
  );
}

export function resolveSupervisorProject(
  config: OrchestratorConfig,
  input: { projectId?: string; repo?: string },
): { projectId: string; project: ProjectConfig } {
  const projects = listSupervisorProjects(config);
  if (input.projectId) {
    const match = projects.find(([projectId]) => projectId === input.projectId);
    if (!match) throw new Error(`Project is not allowed for supervisor access: ${input.projectId}`);
    return { projectId: match[0], project: match[1] };
  }

  if (input.repo) {
    const match = projects.find(([, project]) => project.repo === input.repo);
    if (!match) throw new Error(`Repo is not configured for supervisor access: ${input.repo}`);
    return { projectId: match[0], project: match[1] };
  }

  throw new Error("projectId or repo is required");
}
