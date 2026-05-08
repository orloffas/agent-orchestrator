import {
  enrichSessionPR,
  enrichSessionsMetadata,
  resolveProject,
  sessionToDashboard,
} from "../serialize";
import type { Services } from "../services";
import type { PluginRegistry, ProjectConfig, SCM } from "@jleechanorg/ao-core/types";
import {
  buildReviewPacket,
  createSupervisorIssue,
  githubLoginStatus,
  parseIssueInput,
  parseReviewInput,
  submitSupervisorReview,
} from "./github";
import { buildSupervisorHealth, buildSupervisorSnapshot } from "./snapshot";

function getProjectSCM(registry: PluginRegistry, project: ProjectConfig | undefined): SCM | null {
  if (!project?.scm) return null;
  return registry.get<SCM>("scm", project.scm.plugin);
}

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

type ToolHandler = (args: Record<string, unknown>, services: Services) => Promise<unknown>;

const tools: Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}> = [
  {
    name: "health",
    description: "Read AO supervisor health, source ref, freshness and GitHub identity status.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, services) => buildSupervisorHealth(services),
  },
  {
    name: "snapshot",
    description: "Read the unified AO supervisor snapshot across allowed projects.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, services) => buildSupervisorSnapshot(services),
  },
  {
    name: "session",
    description: "Read sanitized detail for one AO session without raw terminal output.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: async (args, { config, registry, sessionManager }) => {
      const id = String(args.id ?? "");
      const session = await sessionManager.get(id);
      if (!session) throw new Error("Session not found");
      const dashboard = sessionToDashboard(session);
      await enrichSessionsMetadata([session], [dashboard], config, registry).catch(() => undefined);
      if (session.pr) {
        const scm = getProjectSCM(registry, resolveProject(session, config.projects));
        if (scm) await enrichSessionPR(dashboard, scm, session.pr).catch(() => undefined);
      }
      return { session: dashboard };
    },
  },
  {
    name: "send",
    description: "Relay an explicit user/Hermes message into an AO session.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, message: { type: "string" } },
      required: ["id", "message"],
    },
    handler: async (args, { sessionManager }) => {
      await sessionManager.send(String(args.id ?? ""), String(args.message ?? ""));
      return { success: true };
    },
  },
  {
    name: "github_viewer",
    description: "Read AO and Hermes GitHub viewer identity status.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, { config }) => ({
      ao: await githubLoginStatus(config, "ao"),
      hermes: await githubLoginStatus(config, "hermes"),
    }),
  },
  {
    name: "github_issue",
    description: "Create a GitHub issue as the Hermes reviewer identity.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        sendToAo: { type: "boolean" },
      },
      required: ["title"],
    },
    handler: async (args, { config }) => createSupervisorIssue(config, parseIssueInput(args)),
  },
  {
    name: "review_packet",
    description: "Read a PR review packet as the Hermes reviewer identity.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        repo: { type: "string" },
        number: { type: "number" },
      },
      required: ["number"],
    },
    handler: async (args, { config }) => {
      const number = Number(args.number);
      if (!Number.isInteger(number) || number <= 0)
        throw new Error("number must be a positive integer");
      return buildReviewPacket(config, number, {
        projectId: typeof args.projectId === "string" ? args.projectId : undefined,
        repo: typeof args.repo === "string" ? args.repo : undefined,
      });
    },
  },
  {
    name: "pr_review",
    description: "Submit an explicit PR review action as the Hermes reviewer identity.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        repo: { type: "string" },
        number: { type: "number" },
        action: { type: "string", enum: ["approve", "comment", "request_changes"] },
        body: { type: "string" },
        requestId: { type: "string" },
        reviewPacketHeadSha: { type: "string" },
      },
      required: ["number", "action", "requestId"],
    },
    handler: async (args, { config }) => {
      const number = Number(args.number);
      if (!Number.isInteger(number) || number <= 0)
        throw new Error("number must be a positive integer");
      return submitSupervisorReview(config, number, parseReviewInput(args));
    },
  },
];

function result(id: JsonRpcRequest["id"], value: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}

function error(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolResult(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

export async function handleSupervisorMcp(
  request: JsonRpcRequest,
  services: Services,
): Promise<JsonRpcResponse | null> {
  if (request.method === "notifications/initialized") return null;
  if (request.method === "initialize") {
    return result(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "ao-supervisor", version: "0.1.0" },
    });
  }
  if (request.method === "ping") return result(request.id, {});
  if (request.method === "tools/list") {
    return result(request.id, {
      tools: tools.map(({ handler: _handler, ...tool }) => tool),
    });
  }
  if (request.method === "tools/call") {
    const name = String(request.params?.name ?? "");
    const args =
      request.params?.arguments && typeof request.params.arguments === "object"
        ? (request.params.arguments as Record<string, unknown>)
        : {};
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) return error(request.id, -32602, `Unknown tool: ${name}`);
    try {
      return result(request.id, toolResult(await tool.handler(args, services)));
    } catch (err) {
      return error(request.id, -32000, err instanceof Error ? err.message : String(err));
    }
  }
  return error(request.id, -32601, `Method not found: ${request.method ?? ""}`);
}
