import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import type { SessionManager } from "@jleechanorg/ao-core";
import { stringify as yamlStringify } from "yaml";

const {
  mockConfigRef,
  mockSpawn,
  mockEnsureLifecycleWorker,
  mockSessionManager,
  mockExec,
} = vi.hoisted(() => ({
  mockConfigRef: { current: null as Record<string, unknown> | null },
  mockSpawn: vi.fn(),
  mockEnsureLifecycleWorker: vi.fn(),
  mockSessionManager: {
    get: vi.fn(),
    spawnOrchestrator: vi.fn(),
  },
  mockExec: vi.fn(),
}));

vi.mock("../../src/lib/shell.js", () => ({
  exec: mockExec,
  execSilent: vi.fn(),
  git: vi.fn(),
  gh: vi.fn(),
  getTmuxSessions: vi.fn().mockResolvedValue([]),
  getTmuxActivity: vi.fn().mockResolvedValue(null),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: "",
  }),
}));

vi.mock("@jleechanorg/ao-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jleechanorg/ao-core")>();
  return {
    ...actual,
    findConfigFile: () => {
      const mockConfigPath = mockConfigRef.current?.["configPath"];
      return typeof mockConfigPath === "string" ? mockConfigPath : null;
    },
    loadConfig: () => mockConfigRef.current,
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async (): Promise<SessionManager> => mockSessionManager as SessionManager,
}));

vi.mock("../../src/lib/lifecycle-service.js", () => ({
  ensureLifecycleWorker: (...args: unknown[]) => mockEnsureLifecycleWorker(...args),
  stopLifecycleWorker: vi.fn(),
}));

vi.mock("../../src/lib/web-dir.js", () => ({
  findWebDir: vi.fn(),
  buildDashboardEnv: vi.fn().mockResolvedValue({}),
  waitForPortAndOpen: vi.fn().mockResolvedValue(undefined),
  isPortAvailable: vi.fn().mockResolvedValue(true),
  findFreePort: vi.fn().mockResolvedValue(3000),
  MAX_PORT_SCAN: 100,
}));

vi.mock("../../src/lib/dashboard-rebuild.js", () => ({
  cleanNextCache: vi.fn(),
}));

vi.mock("../../src/lib/preflight.js", () => ({
  preflight: {
    checkBuilt: vi.fn(),
  },
}));

vi.mock("../../src/lib/running-state.js", () => ({
  register: vi.fn(),
  unregister: vi.fn(),
  isAlreadyRunning: vi.fn().mockReturnValue(null),
  getRunning: vi.fn().mockReturnValue(null),
  waitForExit: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/lib/caller-context.js", () => ({
  isHumanCaller: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/lib/detect-env.js", () => ({
  detectEnvironment: vi.fn().mockResolvedValue({
    git: { isRepo: true, remoteUrl: null, ownerRepo: null, currentBranch: "main", defaultBranch: "main" },
    tools: { hasTmux: true, hasGh: false, ghAuthed: false },
    apiKeys: { hasLinear: false, hasSlack: false },
  }),
}));

vi.mock("../../src/lib/project-detection.js", () => ({
  detectProjectType: vi.fn().mockReturnValue(null),
  generateRulesFromTemplates: vi.fn().mockReturnValue(null),
  formatProjectTypeForDisplay: vi.fn().mockReturnValue(""),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
  };
});

import { registerStart } from "../../src/commands/start.js";

let tempRoot: string;
let program: Command;
let originalEnv: NodeJS.ProcessEnv;

function makeConfigPath(): string {
  return join(tempRoot, "agent-orchestrator.yaml");
}

function makeConfig(projectPath: string): Record<string, unknown> {
  const config = {
    configPath: makeConfigPath(),
    port: 3000,
    defaults: {
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
      notifiers: ["desktop"],
    },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
      },
    },
    notifiers: {},
    notificationRouting: {},
    reactions: {},
  };

  writeFileSync(makeConfigPath(), yamlStringify(config, { indent: 2 }));
  return config;
}

function createSourceWebDir(): string {
  const webDir = join(tempRoot, "packages", "web");
  mkdirSync(join(webDir, "server"), { recursive: true });
  mkdirSync(join(webDir, ".next"), { recursive: true });
  mkdirSync(join(webDir, "dist-server"), { recursive: true });
  writeFileSync(join(webDir, ".next", "BUILD_ID"), "build-id\n");
  writeFileSync(join(webDir, "dist-server", "start-all.js"), "console.log('start');\n");
  writeFileSync(join(webDir, "dist-server", "terminal-websocket.js"), "console.log('term');\n");
  writeFileSync(
    join(webDir, "dist-server", "direct-terminal-ws.js"),
    "console.log('direct');\n",
  );
  return webDir;
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "ao-start-dashboard-mode-int-"));
  originalEnv = { ...process.env };
  process.env["AO_CONFIG_PATH"] = makeConfigPath();

  program = new Command();
  program.exitOverride();
  registerStart(program);

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  const fakeChild = { on: vi.fn(), kill: vi.fn(), emit: vi.fn(), stdout: null, stderr: null };
  mockSpawn.mockReset();
  mockSpawn.mockReturnValue(fakeChild);
  mockEnsureLifecycleWorker.mockReset();
  mockEnsureLifecycleWorker.mockResolvedValue({
    running: true,
    started: true,
    pid: 12345,
    pidFile: "/tmp/lifecycle-worker.pid",
    logFile: "/tmp/lifecycle-worker.log",
  });
  mockSessionManager.get.mockReset();
  mockSessionManager.spawnOrchestrator.mockReset();
  mockExec.mockReset();
  mockExec.mockResolvedValue({ stdout: "", stderr: "" });
});

afterEach(() => {
  process.env = originalEnv;
  rmSync(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("ao start dashboard mode", () => {
  it("starts source checkouts in production mode when AO_START_DASHBOARD_MODE=production", async () => {
    process.env["AO_START_DASHBOARD_MODE"] = "production";

    const webDir = createSourceWebDir();
    const projectPath = join(tempRoot, "main-repo");
    mkdirSync(projectPath, { recursive: true });
    mockConfigRef.current = makeConfig(projectPath);

    const { findWebDir } = await import("../../src/lib/web-dir.js");
    vi.mocked(findWebDir).mockReturnValue(webDir);

    await program.parseAsync(["node", "test", "start", "--no-orchestrator"]);

    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      [resolve(webDir, "dist-server", "start-all.js")],
      expect.objectContaining({ cwd: webDir, env: expect.any(Object) }),
    );
  });

  it("rebuilds source artifacts instead of cleaning .next when production mode is requested with --rebuild", async () => {
    process.env["AO_START_DASHBOARD_MODE"] = "production";

    const webDir = createSourceWebDir();
    const projectPath = join(tempRoot, "main-repo");
    mkdirSync(projectPath, { recursive: true });
    mockConfigRef.current = makeConfig(projectPath);

    const { findWebDir } = await import("../../src/lib/web-dir.js");
    vi.mocked(findWebDir).mockReturnValue(webDir);

    await program.parseAsync(["node", "test", "start", "--no-orchestrator", "--rebuild"]);

    expect(mockExec).toHaveBeenCalledWith(
      "pnpm",
      ["build"],
      expect.objectContaining({ cwd: resolve(webDir, "..", "..") }),
    );
  });
});
