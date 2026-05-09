import { describe, expect, it } from "vitest";
import type { DashboardSession } from "../../types";
import { classifySession } from "../snapshot";

function session(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "app-1",
    projectId: "app",
    status: "working",
    activity: "active",
    branch: "feat/app",
    issueId: null,
    issueUrl: null,
    issueLabel: null,
    issueTitle: null,
    summary: null,
    summaryIsFallback: false,
    userPrompt: null,
    requestedTask: null,
    hasPromptArtifact: false,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    pr: null,
    metadata: {},
    ...overrides,
  };
}

describe("classifySession", () => {
  it("maps approval or input prompts to respond", () => {
    const result = classifySession(
      session({ activity: "waiting_input" }),
      new Set(),
      30 * 60_000,
      Date.now(),
    );
    expect(result.supervisorStatus).toBe("respond");
    expect(result.reasons).toContain("needs_operator");
  });

  it("marks inactive active workers as stale_worker", () => {
    const now = Date.now();
    const result = classifySession(
      session({ lastActivityAt: new Date(now - 31 * 60_000).toISOString() }),
      new Set(),
      30 * 60_000,
      now,
    );
    expect(result.supervisorStatus).toBe("respond");
    expect(result.reasons).toContain("stale_worker");
  });

  it("maps approved green PRs to merge", () => {
    const result = classifySession(
      session({
        status: "approved",
        pr: {
          number: 7,
          url: "https://github.com/acme/app/pull/7",
          title: "Ready",
          owner: "acme",
          repo: "app",
          branch: "feat/app",
          baseBranch: "main",
          isDraft: false,
          state: "open",
          additions: 1,
          deletions: 0,
          ciStatus: "passing",
          ciChecks: [],
          reviewDecision: "approved",
          mergeability: {
            mergeable: true,
            ciPassing: true,
            approved: true,
            noConflicts: true,
            blockers: [],
          },
          unresolvedThreads: 0,
          unresolvedComments: [],
        },
      }),
      new Set(),
      30 * 60_000,
      Date.now(),
    );
    expect(result.supervisorStatus).toBe("merge");
  });

  it("flags duplicate PR ownership as review", () => {
    const result = classifySession(
      session({
        pr: {
          number: 7,
          url: "https://github.com/acme/app/pull/7",
          title: "Duplicate",
          owner: "acme",
          repo: "app",
          branch: "feat/app",
          baseBranch: "main",
          isDraft: false,
          state: "open",
          additions: 0,
          deletions: 0,
          ciStatus: "pending",
          ciChecks: [],
          reviewDecision: "pending",
          mergeability: {
            mergeable: false,
            ciPassing: false,
            approved: false,
            noConflicts: true,
            blockers: ["Review required"],
          },
          unresolvedThreads: 0,
          unresolvedComments: [],
        },
      }),
      new Set(["acme/app#7"]),
      30 * 60_000,
      Date.now(),
    );
    expect(result.supervisorStatus).toBe("review");
    expect(result.reasons).toContain("duplicate_pr_owner");
  });
});
