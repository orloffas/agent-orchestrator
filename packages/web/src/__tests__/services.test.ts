import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadConfig,
  mockRegister,
  mockCreateSessionManager,
  mockRegistry,
  tmuxPlugin,
  claudePlugin,
  codexPlugin,
  cursorPlugin,
  opencodePlugin,
  worktreePlugin,
  scmPlugin,
  trackerGithubPlugin,
  trackerLinearPlugin,
} = vi.hoisted(() => {
  const mockLoadConfig = vi.fn();
  const mockRegister = vi.fn();
  const mockCreateSessionManager = vi.fn();
  const mockRegistry = {
    register: mockRegister,
    get: vi.fn(),
    list: vi.fn(),
    loadBuiltins: vi.fn(),
    loadFromConfig: vi.fn(),
  };

  return {
    mockLoadConfig,
    mockRegister,
    mockCreateSessionManager,
    mockRegistry,
    tmuxPlugin: { manifest: { name: "tmux" } },
    claudePlugin: { manifest: { name: "claude-code" } },
    codexPlugin: { manifest: { name: "codex" } },
    cursorPlugin: { manifest: { name: "cursor" } },
    opencodePlugin: { manifest: { name: "opencode" } },
    worktreePlugin: { manifest: { name: "worktree" } },
    scmPlugin: { manifest: { name: "github" } },
    trackerGithubPlugin: { manifest: { name: "github" } },
    trackerLinearPlugin: { manifest: { name: "linear" } },
  };
});

vi.mock("@jleechanorg/ao-core", () => ({
  loadConfig: mockLoadConfig,
  createPluginRegistry: () => mockRegistry,
  createSessionManager: mockCreateSessionManager,
  createLifecycleManager: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    getStates: vi.fn(),
    check: vi.fn(),
  }),
  decompose: vi.fn(),
  getLeaves: vi.fn(),
  getSiblings: vi.fn(),
  formatPlanTree: vi.fn(),
  DEFAULT_DECOMPOSER_CONFIG: {},
  TERMINAL_STATUSES: new Set(["merged", "killed"]) as ReadonlySet<string>,
}));

vi.mock("@jleechanorg/ao-plugin-runtime-tmux", () => ({ default: tmuxPlugin }));
vi.mock("@jleechanorg/ao-plugin-agent-claude-code", () => ({ default: claudePlugin }));
vi.mock("@jleechanorg/ao-plugin-agent-codex", () => ({ default: codexPlugin }));
vi.mock("@jleechanorg/ao-plugin-agent-cursor", () => ({ default: cursorPlugin }));
vi.mock("@jleechanorg/ao-plugin-agent-opencode", () => ({ default: opencodePlugin }));
vi.mock("@jleechanorg/ao-plugin-workspace-worktree", () => ({ default: worktreePlugin }));
vi.mock("@jleechanorg/ao-plugin-scm-github", () => ({ default: scmPlugin }));
vi.mock("@jleechanorg/ao-plugin-tracker-github", () => ({ default: trackerGithubPlugin }));
vi.mock("@jleechanorg/ao-plugin-tracker-linear", () => ({ default: trackerLinearPlugin }));

type ServiceTestGlobals = typeof globalThis & {
  _aoServices?: unknown;
  _aoServicesInit?: unknown;
  _aoBacklogStarted?: unknown;
  _aoBacklogTimer?: ReturnType<typeof setInterval>;
  _aoBacklogPolling?: unknown;
};

function clearServiceGlobals(): void {
  const globals = globalThis as ServiceTestGlobals;
  if (globals._aoBacklogTimer) {
    clearInterval(globals._aoBacklogTimer);
  }
  delete globals._aoServices;
  delete globals._aoServicesInit;
  delete globals._aoBacklogStarted;
  delete globals._aoBacklogTimer;
  delete globals._aoBacklogPolling;
}

async function cleanupServicesModule(): Promise<void> {
  try {
    const { stopBacklogPollerForTests } = await import("../lib/services");
    stopBacklogPollerForTests();
  } catch {
    // If the test body already failed during module import, direct global cleanup is enough.
  } finally {
    clearServiceGlobals();
  }
}

describe("services", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRegister.mockClear();
    mockRegistry.get.mockReset();
    mockCreateSessionManager.mockReset();
    mockLoadConfig.mockReset();
    mockLoadConfig.mockReturnValue({
      configPath: "/tmp/agent-orchestrator.yaml",
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
      projects: {},
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
    });
    mockCreateSessionManager.mockReturnValue({
      list: vi.fn().mockResolvedValue([]),
    });
    clearServiceGlobals();
  });

  afterEach(async () => {
    await cleanupServicesModule();
  });

  it("registers the OpenCode agent plugin with web services", async () => {
    const { getServices } = await import("../lib/services");

    await getServices();

    expect(mockRegister).toHaveBeenCalledWith(opencodePlugin);
  });

  it("registers the Codex agent plugin with web services", async () => {
    const { getServices } = await import("../lib/services");

    await getServices();

    expect(mockRegister).toHaveBeenCalledWith(codexPlugin);
  });

  it("caches initialized services across repeated calls", async () => {
    const { getServices } = await import("../lib/services");

    const first = await getServices();
    const second = await getServices();

    expect(first).toBe(second);
    expect(mockCreateSessionManager).toHaveBeenCalledTimes(1);
  });
});

describe("pollBacklog", () => {
  const mockUpdateIssue = vi.fn();
  const mockListIssues = vi.fn();
  const mockSpawn = vi.fn();
  const backlogIssue = {
    id: "123",
    title: "Test Issue",
    description: "Test description",
    url: "https://github.com/test/test/issues/123",
    state: "open",
    labels: ["agent:backlog"],
  };

  function configureBacklogRegistry(): void {
    mockRegistry.get.mockImplementation((slot: string) => {
      if (slot === "tracker") {
        return {
          name: "github",
          listIssues: mockListIssues,
          updateIssue: mockUpdateIssue,
        };
      }
      if (slot === "agent") {
        return { name: "claude-code" };
      }
      if (slot === "runtime") {
        return { name: "tmux" };
      }
      if (slot === "workspace") {
        return { name: "worktree" };
      }
      return null;
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    mockRegister.mockClear();
    mockRegistry.get.mockReset();
    mockCreateSessionManager.mockReset();
    mockLoadConfig.mockReset();
    mockUpdateIssue.mockClear();
    mockListIssues.mockClear();
    mockSpawn.mockClear();

    mockLoadConfig.mockReturnValue({
      configPath: "/tmp/agent-orchestrator.yaml",
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
      projects: {
        "test-project": {
          path: "/tmp/test-project",
          tracker: { plugin: "github" },
          backlog: { label: "agent:backlog", maxConcurrent: 5 },
        },
      },
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
    });

    mockCreateSessionManager.mockReturnValue({
      spawn: mockSpawn,
      list: vi.fn().mockResolvedValue([]),
    });

    clearServiceGlobals();
  });

  afterEach(async () => {
    await cleanupServicesModule();
  });

  it("starts the backlog poller when services initialize", async () => {
    mockListIssues.mockImplementation((query: { labels?: string[] }) =>
      Promise.resolve(query.labels?.includes("agent:backlog") ? [backlogIssue] : []),
    );
    configureBacklogRegistry();

    const { getServices } = await import("../lib/services");
    await getServices();

    await vi.waitUntil(
      () =>
        mockUpdateIssue.mock.calls.some(
          ([issueId, update]) =>
            issueId === "123" && update.removeLabels?.includes("agent:backlog"),
        ),
      { timeout: 1000 },
    );

    expect(mockSpawn).toHaveBeenCalledWith({ projectId: "test-project", issueId: "123" });
    expect(mockListIssues).toHaveBeenCalledWith(
      { state: "open", labels: ["agent:backlog"], limit: 10 },
      expect.objectContaining({ tracker: { plugin: "github" } }),
    );
  });

  it("removes agent:backlog label when claiming an issue", async () => {
    mockListIssues.mockImplementation((query: { labels?: string[] }) =>
      Promise.resolve(query.labels?.includes("agent:backlog") ? [backlogIssue] : []),
    );
    configureBacklogRegistry();

    const { pollBacklog } = await import("../lib/services");
    await pollBacklog();

    expect(mockUpdateIssue).toHaveBeenCalledWith(
      "123",
      {
        labels: ["agent:in-progress"],
        removeLabels: ["agent:backlog"],
        comment: "Claimed by agent orchestrator — session spawned.",
      },
      expect.objectContaining({ tracker: { plugin: "github" } }),
    );
  });
});
