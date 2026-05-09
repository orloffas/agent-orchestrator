import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(
    (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "", "");
      return {};
    },
  ),
  config: {
    projects: {
      app: { repo: "acme/app" },
      local: { path: "/tmp/local-only" },
    },
  },
}));

vi.mock("node:child_process", () => ({
  default: { execFile: mocks.execFile },
  execFile: mocks.execFile,
}));

vi.mock("@/lib/services", () => ({
  getServices: vi.fn(async () => ({
    config: mocks.config,
  })),
}));

import { POST } from "@/app/api/setup-labels/route";

beforeEach(() => {
  mocks.execFile.mockClear();
});

describe("POST /api/setup-labels", () => {
  it("creates every label used by the issue lifecycle", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    const labels = mocks.execFile.mock.calls.map(([, args]) => (args as string[])[2]);

    expect(labels).toEqual([
      "agent:backlog",
      "agent:in-progress",
      "agent:blocked",
      "agent:done",
      "agent:decompose-pending",
      "agent:decompose-approved",
      "merged-unverified",
      "verified",
      "verification-failed",
    ]);

    expect(mocks.execFile.mock.calls[1]?.[0]).toBe("gh");
    expect(mocks.execFile.mock.calls[1]?.[1]).toEqual([
      "label",
      "create",
      "agent:in-progress",
      "--repo",
      "acme/app",
      "--color",
      "7C3AED",
      "--description",
      "Agent is working on this",
      "--force",
    ]);
    expect(mocks.execFile.mock.calls[1]?.[2]).toEqual({ timeout: 10_000 });
  });
});
