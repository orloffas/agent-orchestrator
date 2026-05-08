import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OrchestratorConfig } from "@jleechanorg/ao-core";
import { resolveSupervisorConfig, resolveSupervisorProject } from "./auth";

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 30_000;
const GH_MAX_BUFFER = 10 * 1024 * 1024;
const MAX_REVIEW_BODY_LENGTH = 30_000;

export type ReviewAction = "approve" | "comment" | "request_changes";

export interface GitHubIssueInput {
  projectId?: string;
  repo?: string;
  title: string;
  description?: string;
  labels?: string[];
  sendToAo?: boolean;
}

export interface GitHubReviewInput {
  projectId?: string;
  repo?: string;
  action: ReviewAction;
  body?: string;
  requestId: string;
  reviewPacketHeadSha?: string;
}

export interface GitHubReviewPacketInput {
  projectId?: string;
  repo?: string;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .filter((label): label is string => typeof label === "string")
    .map((label) => label.trim())
    .filter((label) => /^[A-Za-z0-9_.:-]+$/.test(label))
    .slice(0, 20);
}

export function parseIssueInput(body: Record<string, unknown> | null): GitHubIssueInput {
  if (!body) throw new Error("Invalid JSON body");
  const title = safeString(body.title);
  if (!title) throw new Error("title is required");
  if (title.length > 200) throw new Error("title must be at most 200 characters");

  const description = typeof body.description === "string" ? body.description : "";
  if (description.length > 50_000) throw new Error("description must be at most 50000 characters");

  const labels = safeLabels(body.labels);
  const sendToAo = body.sendToAo === true || body.addToBacklog === true;
  if (!sendToAo && labels.includes("agent:backlog")) {
    throw new Error("agent:backlog requires sendToAo=true");
  }

  return {
    projectId: safeString(body.projectId),
    repo: safeString(body.repo),
    title,
    description,
    labels: sendToAo ? [...new Set([...labels, "agent:backlog"])] : labels,
    sendToAo,
  };
}

export function parseReviewInput(body: Record<string, unknown> | null): GitHubReviewInput {
  if (!body) throw new Error("Invalid JSON body");
  const action = safeString(body.action);
  if (action !== "approve" && action !== "comment" && action !== "request_changes") {
    throw new Error("action must be approve, comment, or request_changes");
  }

  const requestId = safeString(body.requestId);
  if (!requestId) throw new Error("requestId is required");

  const bodyText = typeof body.body === "string" ? body.body : "";
  if (bodyText.length > MAX_REVIEW_BODY_LENGTH) {
    throw new Error(`body must be at most ${MAX_REVIEW_BODY_LENGTH} characters`);
  }
  if ((action === "comment" || action === "request_changes") && !bodyText.trim()) {
    throw new Error("body is required for comment and request_changes");
  }

  return {
    projectId: safeString(body.projectId),
    repo: safeString(body.repo),
    action,
    body: bodyText,
    requestId,
    reviewPacketHeadSha: safeString(body.reviewPacketHeadSha),
  };
}

function reviewerEnv(config: OrchestratorConfig): NodeJS.ProcessEnv {
  const supervisor = resolveSupervisorConfig(config);
  const token = process.env[supervisor.hermesGithubTokenEnv]?.trim();
  if (!token) throw new Error(`${supervisor.hermesGithubTokenEnv} is not configured`);
  return { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token };
}

async function gh(args: string[], config: OrchestratorConfig): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    env: reviewerEnv(config),
    timeout: GH_TIMEOUT_MS,
    maxBuffer: GH_MAX_BUFFER,
  });
  return stdout.trim();
}

async function ghDefault(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    timeout: GH_TIMEOUT_MS,
    maxBuffer: GH_MAX_BUFFER,
  });
  return stdout.trim();
}

export async function githubLoginStatus(
  config: OrchestratorConfig,
  identity: "ao" | "hermes",
): Promise<{ expected: string; actual: string | null; ok: boolean; configured: boolean }> {
  const supervisor = resolveSupervisorConfig(config);
  const expected = identity === "ao" ? supervisor.aoExpectedLogin : supervisor.hermesExpectedLogin;
  try {
    const actual =
      identity === "ao"
        ? await ghDefault(["api", "user", "--jq", ".login"])
        : await gh(["api", "user", "--jq", ".login"], config);
    return { expected, actual, ok: actual === expected, configured: true };
  } catch {
    return { expected, actual: null, ok: false, configured: identity === "ao" };
  }
}

export async function verifyHermesReviewer(config: OrchestratorConfig): Promise<string> {
  const status = await githubLoginStatus(config, "hermes");
  if (!status.actual) throw new Error("Failed to resolve Hermes GitHub token owner");
  if (!status.ok) {
    throw new Error(`Hermes GitHub token owner is ${status.actual}; expected ${status.expected}`);
  }
  return status.actual;
}

export async function createSupervisorIssue(config: OrchestratorConfig, input: GitHubIssueInput) {
  await verifyHermesReviewer(config);
  const { projectId, project } = resolveSupervisorProject(config, input);
  const args = [
    "issue",
    "create",
    "--repo",
    project.repo,
    "--title",
    input.title,
    "--body",
    input.description ?? "",
  ];
  if (input.labels && input.labels.length > 0) args.push("--label", input.labels.join(","));

  const url = await gh(args, config);
  const number = Number(url.match(/\/issues\/(\d+)$/)?.[1] ?? 0);
  return { projectId, repo: project.repo, number, url, labels: input.labels ?? [] };
}

function parseRepo(repo: string): { owner: string; name: string } {
  const match = repo.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error(`Invalid repo: ${repo}`);
  return { owner: match[1]!, name: match[2]! };
}

async function reviewThreads(config: OrchestratorConfig, repo: string, number: number) {
  const { owner, name } = parseRepo(repo);
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved path line comments(first:10){nodes{author{login} body url createdAt}}}}}}}`;
  const raw = await gh(
    [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${number}`,
    ],
    config,
  );
  const parsed = JSON.parse(raw) as {
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            nodes?: Array<{
              isResolved?: boolean;
              path?: string;
              line?: number | null;
              comments?: {
                nodes?: Array<{
                  author?: { login?: string };
                  body?: string;
                  url?: string;
                  createdAt?: string;
                }>;
              };
            }>;
          };
        };
      };
    };
  };
  return parsed.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
}

export async function buildReviewPacket(
  config: OrchestratorConfig,
  number: number,
  input: GitHubReviewPacketInput,
) {
  await verifyHermesReviewer(config);
  const { projectId, project } = resolveSupervisorProject(config, input);
  const raw = await gh(
    [
      "pr",
      "view",
      String(number),
      "--repo",
      project.repo,
      "--json",
      "number,title,url,author,headRefName,headRefOid,baseRefName,isDraft,state,mergeable,reviewDecision,statusCheckRollup,latestReviews,updatedAt,createdAt",
    ],
    config,
  );
  const pr = JSON.parse(raw) as Record<string, unknown>;
  const filesRaw = await gh(
    ["pr", "diff", String(number), "--repo", project.repo, "--name-only"],
    config,
  ).catch(() => "");
  const threads = await reviewThreads(config, project.repo, number).catch(() => []);
  const unresolvedThreads = threads.filter((thread) => !thread.isResolved);

  return {
    projectId,
    repo: project.repo,
    pr,
    changedFiles: filesRaw.split("\n").filter(Boolean),
    unresolvedThreads,
    generatedAt: new Date().toISOString(),
  };
}

export async function submitSupervisorReview(
  config: OrchestratorConfig,
  number: number,
  input: GitHubReviewInput,
) {
  const reviewer = await verifyHermesReviewer(config);
  const { projectId, project } = resolveSupervisorProject(config, input);
  const raw = await gh(
    ["pr", "view", String(number), "--repo", project.repo, "--json", "author,headRefOid,url"],
    config,
  );
  const data = JSON.parse(raw) as {
    author?: { login?: string };
    headRefOid?: string;
    url?: string;
  };
  const author = data.author?.login ?? "";
  if (input.action === "approve" && author === reviewer) {
    throw new Error("Hermes reviewer cannot approve a PR authored by the same account");
  }
  if (input.action !== "comment" && input.reviewPacketHeadSha !== data.headRefOid) {
    throw new Error("reviewPacketHeadSha is required and must match the current PR head");
  }

  const audit = `\n\nHermes supervisor request: ${input.requestId}`;
  const body = `${input.body?.trim() || `Reviewed via Hermes supervisor proxy.`}${audit}`;
  const args = ["pr", "review", String(number), "--repo", project.repo, "--body", body];
  if (input.action === "approve") args.push("--approve");
  if (input.action === "comment") args.push("--comment");
  if (input.action === "request_changes") args.push("--request-changes");
  await gh(args, config);
  return { projectId, repo: project.repo, number, action: input.action, reviewer, prUrl: data.url };
}
