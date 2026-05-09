import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ACTIVITY_STATE,
  SESSION_STATUS,
  type OrchestratorConfig,
  type OpenCodeSessionManager,
  type PluginRegistry,
  type PRInfo,
  type ProjectConfig,
  type SCM,
  type Session,
} from "@jleechanorg/ao-core/types";
import { getAttentionLevel, type DashboardSession } from "../types";
import {
  enrichSessionPR,
  enrichSessionsMetadata,
  listDashboardOrchestrators,
  resolveProject,
  sessionToDashboard,
} from "../serialize";
import { listSupervisorProjects, resolveSupervisorConfig } from "./auth";
import { githubLoginStatus } from "./github";

const execFileAsync = promisify(execFile);

export type SupervisorStatus = "working" | "respond" | "review" | "pending" | "merge" | "done";

export interface SupervisorSession {
  session: DashboardSession;
  supervisorStatus: SupervisorStatus;
  reasons: string[];
}

function attentionToSupervisorStatus(
  attention: ReturnType<typeof getAttentionLevel>,
): SupervisorStatus {
  return attention;
}

function prKey(pr: PRInfo | null): string | null {
  return pr ? `${pr.owner}/${pr.repo}#${pr.number}` : null;
}

function getProjectSCM(registry: PluginRegistry, project: ProjectConfig | undefined): SCM | null {
  if (!project?.scm) return null;
  return registry.get<SCM>("scm", project.scm.plugin);
}

export function classifySession(
  session: DashboardSession,
  duplicatePrKeys: Set<string>,
  staleWorkerMs: number,
  nowMs: number,
): { supervisorStatus: SupervisorStatus; reasons: string[] } {
  let supervisorStatus = attentionToSupervisorStatus(getAttentionLevel(session));
  const reasons: string[] = [];

  if (session.status === SESSION_STATUS.NEEDS_INPUT || session.status === SESSION_STATUS.STUCK) {
    reasons.push("needs_operator");
  }
  if (
    session.activity === ACTIVITY_STATE.WAITING_INPUT ||
    session.activity === ACTIVITY_STATE.BLOCKED
  ) {
    reasons.push("needs_operator");
  }
  if (session.activity === ACTIVITY_STATE.EXITED && supervisorStatus !== "done") {
    reasons.push("needs_operator");
    supervisorStatus = "respond";
  }

  const lastActivityMs = Date.parse(session.lastActivityAt);
  if (
    supervisorStatus === "working" &&
    Number.isFinite(lastActivityMs) &&
    nowMs - lastActivityMs > staleWorkerMs
  ) {
    reasons.push("stale_worker");
    supervisorStatus = "respond";
  }

  if (session.pr?.state === "closed" && supervisorStatus !== "done") {
    reasons.push("stale_pr_binding");
    supervisorStatus = "review";
  }

  const key = session.pr ? `${session.pr.owner}/${session.pr.repo}#${session.pr.number}` : null;
  if (key && duplicatePrKeys.has(key)) {
    reasons.push("duplicate_pr_owner");
    if (supervisorStatus === "working" || supervisorStatus === "pending")
      supervisorStatus = "review";
  }

  if (session.pr?.ciStatus === "failing") {
    reasons.push("ci_failed");
    supervisorStatus = "review";
  }
  if (session.pr?.reviewDecision === "changes_requested") {
    reasons.push("changes_requested");
    supervisorStatus = "review";
  }
  if (session.pr?.mergeability.mergeable) {
    supervisorStatus = "merge";
  }

  return { supervisorStatus, reasons };
}

async function sourceRef(): Promise<string | null> {
  if (process.env.AO_SOURCE_REF?.trim()) return process.env.AO_SOURCE_REF.trim();
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function listProjectOpenPRs(
  registry: PluginRegistry,
  projectId: string,
  config: OrchestratorConfig,
): Promise<Array<PRInfo & { projectId: string }>> {
  const project = config.projects[projectId];
  if (!project) return [];
  const scm = getProjectSCM(registry, project);
  if (!scm?.listOpenPRs) return [];
  try {
    const prs = await scm.listOpenPRs(project);
    return prs.map((pr) => ({ ...pr, projectId }));
  } catch {
    return [];
  }
}

async function dashboardSessionsForProject(
  sessions: Session[],
  config: OrchestratorConfig,
  registry: PluginRegistry,
): Promise<DashboardSession[]> {
  const dashboardSessions = sessions.map(sessionToDashboard);
  await enrichSessionsMetadata(sessions, dashboardSessions, config, registry).catch(
    () => undefined,
  );
  for (let index = 0; index < sessions.length; index++) {
    const core = sessions[index];
    const dashboard = dashboardSessions[index];
    if (!core?.pr || !dashboard) continue;
    const project = resolveProject(core, config.projects);
    const scm = getProjectSCM(registry, project);
    if (scm) await enrichSessionPR(dashboard, scm, core.pr).catch(() => undefined);
  }
  return dashboardSessions;
}

export async function buildSupervisorSnapshot(input: {
  config: OrchestratorConfig;
  registry: PluginRegistry;
  sessionManager: OpenCodeSessionManager;
}) {
  const { config, registry, sessionManager } = input;
  const supervisor = resolveSupervisorConfig(config);
  const nowMs = Date.now();
  const projectEntries = listSupervisorProjects(config);
  const projects = [];
  const ownedPrKeys = new Set<string>();
  const duplicatePrKeys = new Set<string>();
  const rawSessionsByProject = new Map<string, Session[]>();

  for (const [projectId] of projectEntries) {
    const sessions = await sessionManager.list(projectId);
    rawSessionsByProject.set(projectId, sessions);
    for (const session of sessions) {
      const key = prKey(session.pr);
      if (!key) continue;
      if (ownedPrKeys.has(key)) duplicatePrKeys.add(key);
      ownedPrKeys.add(key);
    }
  }

  for (const [projectId, project] of projectEntries) {
    const sessions = rawSessionsByProject.get(projectId) ?? [];
    const dashboardSessions = await dashboardSessionsForProject(sessions, config, registry);
    const openPRs = await listProjectOpenPRs(registry, projectId, config);
    const orphanPRs = openPRs.filter((pr) => !ownedPrKeys.has(prKey(pr) ?? ""));
    const supervisorSessions = dashboardSessions.map((session) => {
      const classified = classifySession(session, duplicatePrKeys, supervisor.staleWorkerMs, nowMs);
      return { session, ...classified };
    });

    projects.push({
      projectId,
      name: project.name,
      repo: project.repo,
      sessions: supervisorSessions,
      orchestrators: listDashboardOrchestrators(sessions, config.projects),
      orphanPRs,
    });
  }

  const allSessions = projects.flatMap((project) => project.sessions);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    supervisor: {
      enabled: supervisor.enabled,
      allowedProjects: supervisor.allowedProjects ?? null,
      staleWorkerMinutes: supervisor.staleWorkerMinutes,
    },
    stats: {
      projects: projects.length,
      sessions: allSessions.length,
      respond: allSessions.filter((item) => item.supervisorStatus === "respond").length,
      review: allSessions.filter((item) => item.supervisorStatus === "review").length,
      merge: allSessions.filter((item) => item.supervisorStatus === "merge").length,
      orphanPRs: projects.reduce((total, project) => total + project.orphanPRs.length, 0),
    },
    projects,
  };
}

export async function buildSupervisorHealth(input: {
  config: OrchestratorConfig;
  registry: PluginRegistry;
  sessionManager: OpenCodeSessionManager;
}) {
  const { config } = input;
  const supervisor = resolveSupervisorConfig(config);
  const [aoGitHub, hermesGitHub, ref] = await Promise.all([
    githubLoginStatus(config, "ao"),
    githubLoginStatus(config, "hermes"),
    sourceRef(),
  ]);
  return {
    ok: supervisor.enabled && Boolean(process.env[supervisor.bearerTokenEnv]?.trim()),
    generatedAt: new Date().toISOString(),
    sourceRef: ref,
    config: {
      projectCount: listSupervisorProjects(config).length,
      supervisorEnabled: supervisor.enabled,
      bearerConfigured: Boolean(process.env[supervisor.bearerTokenEnv]?.trim()),
      dashboardStaleGraceSeconds: supervisor.dashboardStaleGraceSeconds,
    },
    github: {
      ao: aoGitHub,
      hermes: hermesGitHub,
    },
  };
}
