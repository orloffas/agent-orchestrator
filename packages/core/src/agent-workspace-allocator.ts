import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { ProjectConfig, WorkspaceAllocatorConfig } from "./types.js";
import { getProjectBaseDir, getWorktreesDir } from "./paths.js";

const ROOT_LOCK_STALE_MS = 10 * 60 * 1000;

export interface AgentWorkspaceRoots {
  projectsRoot: string;
  worktreesRoot: string;
  stateRoot: string;
  artifactsRoot: string;
}

export interface ResolveAgentWorkspaceRootsInput {
  configPath?: string;
  projectId: string;
  project: ProjectConfig;
  config?: WorkspaceAllocatorConfig;
}

export interface WorkspaceLease {
  version: 1;
  leaseId: string;
  projectId: string;
  repo: string;
  repoSlug: string;
  sessionId: string;
  branch: string;
  workspacePath: string;
  repoPath?: string;
  artifactsPath: string;
  selectedGitStorage: string;
  readOnlyGitFallback: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDoctorResult {
  roots: AgentWorkspaceRoots;
  rootChecks: Array<{
    name: keyof AgentWorkspaceRoots;
    path: string;
    writable: boolean;
    error?: string;
  }>;
  lockDirWritable: boolean;
  leases: WorkspaceLease[];
}

function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function normalizePath(path: string): string {
  return resolve(expandHome(path));
}

function fromEnv(runtimeName: string, genericName: string): string | undefined {
  const runtimeValue = process.env[runtimeName]?.trim();
  if (runtimeValue) return runtimeValue;
  const genericValue = process.env[genericName]?.trim();
  if (genericValue) return genericValue;
  return undefined;
}

function portableBaseDir(input: ResolveAgentWorkspaceRootsInput): string {
  if (input.configPath) {
    return getProjectBaseDir(input.configPath, input.project.path);
  }
  return join(homedir(), ".agent-orchestrator", input.projectId || basename(input.project.path));
}

export function repoSlug(repo: string): string {
  return (
    repo
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repo"
  );
}

export function safePathSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "session"
  );
}

export function resolveAgentWorkspaceRoots(
  input: ResolveAgentWorkspaceRootsInput,
): AgentWorkspaceRoots {
  const baseDir = portableBaseDir(input);
  const config = input.config ?? {};
  const projectConfig = input.project.workspaceAllocator ?? {};
  const legacyWorktreeDir = input.project.worktreeDir;

  const fallbackWorktreesRoot = input.configPath
    ? getWorktreesDir(input.configPath, input.project.path)
    : join(baseDir, "worktrees");

  return {
    projectsRoot: normalizePath(
      fromEnv("AO_PROJECTS_ROOT", "SUPERNOVA_PROJECTS_ROOT") ??
        projectConfig.projectsRoot ??
        config.projectsRoot ??
        join(baseDir, "projects"),
    ),
    worktreesRoot: normalizePath(
      fromEnv("AO_WORKTREES_ROOT", "SUPERNOVA_WORKTREES_ROOT") ??
        projectConfig.worktreesRoot ??
        config.worktreesRoot ??
        legacyWorktreeDir ??
        fallbackWorktreesRoot,
    ),
    stateRoot: normalizePath(
      fromEnv("AO_STATE_ROOT", "SUPERNOVA_AGENT_STATE_ROOT") ??
        projectConfig.stateRoot ??
        config.stateRoot ??
        join(baseDir, "state"),
    ),
    artifactsRoot: normalizePath(
      fromEnv("AO_ARTIFACTS_ROOT", "SUPERNOVA_AGENT_ARTIFACTS_ROOT") ??
        projectConfig.artifactsRoot ??
        config.artifactsRoot ??
        join(baseDir, "artifacts"),
    ),
  };
}

export function branchSlug(input: string): string {
  return safePathSegment(
    input.replace(/^(codex|feat|fix|chore|docs|refactor|session|custom)\//, ""),
  );
}

export function makeSessionBranch(projectId: string, sessionId: string, slug: string): string {
  return `codex/${safePathSegment(projectId)}/${safePathSegment(sessionId)}-${branchSlug(slug)}`;
}

export function leasePath(stateRoot: string, sessionId: string): string {
  return join(stateRoot, "leases", `${safePathSegment(sessionId)}.json`);
}

export function lockPath(stateRoot: string, repo: string): string {
  return join(stateRoot, "locks", `${repoSlug(repo)}.lock`);
}

export function readWorkspaceLease(stateRoot: string, sessionId: string): WorkspaceLease | null {
  const path = leasePath(stateRoot, sessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as WorkspaceLease;
  } catch {
    return null;
  }
}

export function writeWorkspaceLease(stateRoot: string, lease: WorkspaceLease): void {
  const path = leasePath(stateRoot, lease.sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(lease, null, 2), "utf-8");
}

export function releaseWorkspaceLease(stateRoot: string, sessionId: string): boolean {
  const path = leasePath(stateRoot, sessionId);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

export function listWorkspaceLeases(stateRoot: string): WorkspaceLease[] {
  const leasesDir = join(stateRoot, "leases");
  if (!existsSync(leasesDir)) return [];
  return readdirSync(leasesDir)
    .filter((entry) => entry.endsWith(".json"))
    .flatMap((entry) => {
      try {
        return [JSON.parse(readFileSync(join(leasesDir, entry), "utf-8")) as WorkspaceLease];
      } catch {
        return [];
      }
    });
}

export async function withWorkspaceLock<T>(
  stateRoot: string,
  repo: string,
  fn: () => Promise<T>,
): Promise<T> {
  const path = lockPath(stateRoot, repo);
  mkdirSync(dirname(path), { recursive: true });
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(path);
      break;
    } catch (err) {
      if (Date.now() - startedAt > ROOT_LOCK_STALE_MS) {
        throw new Error(`Timed out acquiring workspace allocator lock: ${path}`, { cause: err });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      rmdirSync(path);
    } catch {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

function canWriteDirectory(path: string): { writable: boolean; error?: string } {
  const probe = join(path, `.ao-write-test-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(path, { recursive: true });
    writeFileSync(probe, "ok", "utf-8");
    rmSync(probe, { force: true });
    return { writable: true };
  } catch (err) {
    return { writable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function doctorAgentWorkspaceRoots(roots: AgentWorkspaceRoots): WorkspaceDoctorResult {
  const rootChecks: WorkspaceDoctorResult["rootChecks"] = (
    Object.entries(roots) as Array<[keyof AgentWorkspaceRoots, string]>
  ).map(([name, path]) => ({ name, path, ...canWriteDirectory(path) }));
  const lockDir = join(roots.stateRoot, "locks");
  return {
    roots,
    rootChecks,
    lockDirWritable: canWriteDirectory(lockDir).writable,
    leases: listWorkspaceLeases(roots.stateRoot),
  };
}
