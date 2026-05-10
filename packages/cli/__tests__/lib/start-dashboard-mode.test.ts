import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { resolveStartDashboardLaunchPlan } from "../../src/lib/start-dashboard-mode.js";

function createSourceWebDir(root: string): string {
  const webDir = join(root, "packages", "web");
  mkdirSync(join(webDir, "server"), { recursive: true });
  return webDir;
}

function writeProductionArtifacts(webDir: string): void {
  mkdirSync(join(webDir, ".next"), { recursive: true });
  writeFileSync(join(webDir, ".next", "BUILD_ID"), "build-id\n");
  mkdirSync(join(webDir, "dist-server"), { recursive: true });
  writeFileSync(join(webDir, "dist-server", "start-all.js"), "console.log('start');\n");
  writeFileSync(join(webDir, "dist-server", "terminal-websocket.js"), "console.log('term');\n");
  writeFileSync(
    join(webDir, "dist-server", "direct-terminal-ws.js"),
    "console.log('direct');\n",
  );
}

describe("resolveStartDashboardLaunchPlan", () => {
  it("defaults source checkouts to development mode in auto", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "ao-start-dashboard-mode-"));
    try {
      const webDir = createSourceWebDir(tempRoot);

      const plan = resolveStartDashboardLaunchPlan(webDir, {});

      expect(plan.requestedMode).toBe("auto");
      expect(plan.launchMode).toBe("development");
      expect(plan.isSourceCheckout).toBe(true);
      expect(plan.command).toBe("pnpm");
      expect(plan.args).toEqual(["run", "dev"]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("allows production mode from a source checkout when build artifacts exist", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "ao-start-dashboard-mode-"));
    try {
      const webDir = createSourceWebDir(tempRoot);
      writeProductionArtifacts(webDir);

      const plan = resolveStartDashboardLaunchPlan(webDir, {
        AO_START_DASHBOARD_MODE: "production",
      });

      expect(plan.requestedMode).toBe("production");
      expect(plan.launchMode).toBe("production");
      expect(plan.command).toBe("node");
      expect(plan.args).toEqual([resolve(webDir, "dist-server", "start-all.js")]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails clearly when production mode is requested without built artifacts", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "ao-start-dashboard-mode-"));
    try {
      const webDir = createSourceWebDir(tempRoot);

      expect(() =>
        resolveStartDashboardLaunchPlan(webDir, {
          AO_START_DASHBOARD_MODE: "production",
        }),
      ).toThrow(/requires built @jleechanorg\/ao-web artifacts/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid mode values", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "ao-start-dashboard-mode-"));
    try {
      const webDir = createSourceWebDir(tempRoot);

      expect(() =>
        resolveStartDashboardLaunchPlan(webDir, {
          AO_START_DASHBOARD_MODE: "invalid",
        }),
      ).toThrow(/Invalid AO_START_DASHBOARD_MODE/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
