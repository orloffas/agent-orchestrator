import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSessionBranch, resolveAgentWorkspaceRoots, type ProjectConfig } from "../index.js";

const ENV_KEYS = [
  "AO_PROJECTS_ROOT",
  "AO_WORKTREES_ROOT",
  "AO_STATE_ROOT",
  "AO_ARTIFACTS_ROOT",
  "SUPERNOVA_PROJECTS_ROOT",
  "SUPERNOVA_WORKTREES_ROOT",
  "SUPERNOVA_AGENT_STATE_ROOT",
  "SUPERNOVA_AGENT_ARTIFACTS_ROOT",
] as const;

let savedEnv: Record<string, string | undefined>;

function makeProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
  return {
    name: "Supernova",
    repo: "orloffas/supernova",
    path: "/repos/supernova",
    defaultBranch: "main",
    sessionPrefix: "sn",
    ...overrides,
  };
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("resolveAgentWorkspaceRoots", () => {
  it("prefers AO runtime-specific env over generic env and config", () => {
    process.env.AO_WORKTREES_ROOT = "/runtime/worktrees";
    process.env.SUPERNOVA_WORKTREES_ROOT = "/generic/worktrees";

    const roots = resolveAgentWorkspaceRoots({
      projectId: "supernova",
      project: makeProject({
        workspaceAllocator: { worktreesRoot: "/project/worktrees" },
      }),
      config: { worktreesRoot: "/global/worktrees" },
    });

    expect(roots.worktreesRoot).toBe("/runtime/worktrees");
  });

  it("uses generic Supernova env when runtime-specific env is absent", () => {
    process.env.SUPERNOVA_PROJECTS_ROOT = "/generic/projects";
    process.env.SUPERNOVA_WORKTREES_ROOT = "/generic/worktrees";
    process.env.SUPERNOVA_AGENT_STATE_ROOT = "/generic/state";
    process.env.SUPERNOVA_AGENT_ARTIFACTS_ROOT = "/generic/artifacts";

    const roots = resolveAgentWorkspaceRoots({
      projectId: "supernova",
      project: makeProject(),
      config: {
        projectsRoot: "/global/projects",
        worktreesRoot: "/global/worktrees",
        stateRoot: "/global/state",
        artifactsRoot: "/global/artifacts",
      },
    });

    expect(roots).toEqual({
      projectsRoot: "/generic/projects",
      worktreesRoot: "/generic/worktrees",
      stateRoot: "/generic/state",
      artifactsRoot: "/generic/artifacts",
    });
  });

  it("prefers project allocator config over legacy worktreeDir and global config", () => {
    const roots = resolveAgentWorkspaceRoots({
      projectId: "supernova",
      project: makeProject({
        worktreeDir: "/legacy/worktrees",
        workspaceAllocator: {
          projectsRoot: "/project/projects",
          worktreesRoot: "/project/worktrees",
          stateRoot: "/project/state",
          artifactsRoot: "/project/artifacts",
        },
      }),
      config: {
        projectsRoot: "/global/projects",
        worktreesRoot: "/global/worktrees",
        stateRoot: "/global/state",
        artifactsRoot: "/global/artifacts",
      },
    });

    expect(roots).toEqual({
      projectsRoot: "/project/projects",
      worktreesRoot: "/project/worktrees",
      stateRoot: "/project/state",
      artifactsRoot: "/project/artifacts",
    });
  });

  it("prefers top-level allocator config over legacy project worktreeDir", () => {
    const roots = resolveAgentWorkspaceRoots({
      projectId: "supernova",
      project: makeProject({
        worktreeDir: "/legacy/worktrees",
      }),
      config: {
        worktreesRoot: "/global/worktrees",
      },
    });

    expect(roots.worktreesRoot).toBe("/global/worktrees");
  });

  it("falls back to a portable user-state location without fixed container roots", () => {
    const roots = resolveAgentWorkspaceRoots({
      projectId: "supernova",
      project: makeProject(),
    });

    expect(roots.worktreesRoot).toBe(
      join(homedir(), ".agent-orchestrator", "supernova", "worktrees"),
    );
    for (const root of Object.values(roots)) {
      expect(root.startsWith("/home/ao/")).toBe(false);
      expect(root.startsWith("/workspace/")).toBe(false);
      expect(root.startsWith("/opt/data/")).toBe(false);
    }
  });
});

describe("makeSessionBranch", () => {
  it("creates one unique task branch per writer session", () => {
    const branches = ["sn-1", "sn-2", "sn-3"].map((sessionId) =>
      makeSessionBranch("supernova", sessionId, "Fix allocator lock"),
    );

    expect(new Set(branches).size).toBe(3);
    expect(branches).toEqual([
      "codex/supernova/sn-1-fix-allocator-lock",
      "codex/supernova/sn-2-fix-allocator-lock",
      "codex/supernova/sn-3-fix-allocator-lock",
    ]);
  });
});
