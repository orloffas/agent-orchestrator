import { describe, expect, it } from "vitest";
import type { OrchestratorConfig, SupervisorConfig } from "@jleechanorg/ao-core";
import { authorizeSupervisorRequest, listSupervisorProjects } from "../auth";

const supervisorDefaults: SupervisorConfig = {
  enabled: true,
  staleWorkerMinutes: 30,
  dashboardStaleGraceSeconds: 90,
  bearerTokenEnv: "TEST_SUPERVISOR_TOKEN",
  hermesGithubTokenEnv: "TEST_HERMES_GITHUB_TOKEN",
  hermesExpectedLogin: "nova-ome-hermes",
  aoExpectedLogin: "nova-ome",
};

function config(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    configPath: "/tmp/agent-orchestrator.yaml",
    readyThresholdMs: 300_000,
    defaults: { runtime: "tmux", agent: "codex", workspace: "worktree", notifiers: [] },
    projects: {
      app: {
        name: "App",
        repo: "acme/app",
        path: "/tmp/app",
        defaultBranch: "main",
        sessionPrefix: "app",
      },
      docs: {
        name: "Docs",
        repo: "acme/docs",
        path: "/tmp/docs",
        defaultBranch: "main",
        sessionPrefix: "docs",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
    ...overrides,
  };
}

describe("supervisor auth", () => {
  it("rejects when supervisor is disabled", () => {
    const request = new Request("http://localhost/api/supervisor/v1/health");
    expect(authorizeSupervisorRequest(request, config())).toEqual({
      status: 503,
      error: "AO supervisor API is disabled",
    });
  });

  it("requires a bearer token from the configured env var", () => {
    process.env.TEST_SUPERVISOR_TOKEN = "secret";
    const request = new Request("http://localhost/api/supervisor/v1/health", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(authorizeSupervisorRequest(request, config({ supervisor: supervisorDefaults }))).toEqual(
      { status: 401, error: "Unauthorized supervisor request" },
    );
    delete process.env.TEST_SUPERVISOR_TOKEN;
  });

  it("allows only configured projects when an allowlist is set", () => {
    const cfg = config({
      supervisor: { ...supervisorDefaults, allowedProjects: ["docs"] },
    });
    expect(listSupervisorProjects(cfg).map(([projectId]) => projectId)).toEqual(["docs"]);
  });
});
