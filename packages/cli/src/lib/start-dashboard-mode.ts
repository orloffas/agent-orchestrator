import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type StartDashboardRequestedMode = "auto" | "development" | "production";
export type StartDashboardLaunchMode = "development" | "production";

export interface StartDashboardRuntimeContext {
  requestedMode: StartDashboardRequestedMode;
  launchMode: StartDashboardLaunchMode;
  isSourceCheckout: boolean;
  sourceRepoRoot: string | null;
}

export interface StartDashboardLaunchPlan extends StartDashboardRuntimeContext {
  command: string;
  args: string[];
}

const VALID_REQUESTED_MODES = new Set<StartDashboardRequestedMode>([
  "auto",
  "development",
  "production",
]);

export function inspectStartDashboardRuntime(
  webDir: string,
  env: NodeJS.ProcessEnv = process.env,
): StartDashboardRuntimeContext {
  const rawMode = env["AO_START_DASHBOARD_MODE"]?.trim() || "auto";
  if (!VALID_REQUESTED_MODES.has(rawMode as StartDashboardRequestedMode)) {
    throw new Error(
      `Invalid AO_START_DASHBOARD_MODE="${rawMode}". Expected one of: auto, development, production.`,
    );
  }

  const requestedMode = rawMode as StartDashboardRequestedMode;
  const isSourceCheckout = existsSync(resolve(webDir, "server"));
  const sourceRepoRoot = isSourceCheckout ? resolve(webDir, "..", "..") : null;

  if (requestedMode === "development" && !isSourceCheckout) {
    throw new Error(
      "AO_START_DASHBOARD_MODE=development requires a source checkout of @jleechanorg/ao-web.",
    );
  }

  const launchMode =
    requestedMode === "auto"
      ? (isSourceCheckout ? "development" : "production")
      : requestedMode;

  return {
    requestedMode,
    launchMode,
    isSourceCheckout,
    sourceRepoRoot,
  };
}

export function resolveStartDashboardLaunchPlan(
  webDir: string,
  env: NodeJS.ProcessEnv = process.env,
): StartDashboardLaunchPlan {
  const runtime = inspectStartDashboardRuntime(webDir, env);

  if (runtime.launchMode === "production") {
    assertProductionArtifacts(webDir);
    return {
      ...runtime,
      command: "node",
      args: [resolve(webDir, "dist-server", "start-all.js")],
    };
  }

  return {
    ...runtime,
    command: "pnpm",
    args: ["run", "dev"],
  };
}

function assertProductionArtifacts(webDir: string): void {
  const requiredPaths = [
    resolve(webDir, ".next", "BUILD_ID"),
    resolve(webDir, "dist-server", "start-all.js"),
    resolve(webDir, "dist-server", "terminal-websocket.js"),
    resolve(webDir, "dist-server", "direct-terminal-ws.js"),
  ];
  const missingPaths = requiredPaths.filter((path) => !existsSync(path));

  if (missingPaths.length === 0) {
    return;
  }

  const formattedPaths = missingPaths.map((path) => `  - ${path}`).join("\n");
  throw new Error(
    "AO_START_DASHBOARD_MODE=production requires built @jleechanorg/ao-web artifacts.\n" +
      `Missing paths:\n${formattedPaths}\n` +
      "If you are running from source, run: pnpm build",
  );
}
