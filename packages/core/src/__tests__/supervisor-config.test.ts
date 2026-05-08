import { describe, expect, it } from "vitest";
import { validateConfig } from "../config";

describe("supervisor config", () => {
  it("accepts supervisor API and identity settings", () => {
    const config = validateConfig({
      supervisor: {
        enabled: true,
        allowedProjects: ["app"],
        staleWorkerMinutes: 45,
        dashboardStaleGraceSeconds: 120,
        bearerTokenEnv: "AO_SUPERVISOR_TOKEN",
        hermesGithubTokenEnv: "HERMES_GITHUB_TOKEN",
        hermesExpectedLogin: "nova-hermes",
        aoExpectedLogin: "nova-ome",
      },
      projects: {
        app: {
          name: "App",
          repo: "acme/app",
          path: "/workspace/app",
        },
      },
    });

    expect(config.supervisor).toEqual({
      enabled: true,
      allowedProjects: ["app"],
      staleWorkerMinutes: 45,
      dashboardStaleGraceSeconds: 120,
      bearerTokenEnv: "AO_SUPERVISOR_TOKEN",
      hermesGithubTokenEnv: "HERMES_GITHUB_TOKEN",
      hermesExpectedLogin: "nova-hermes",
      aoExpectedLogin: "nova-ome",
    });
  });
});
