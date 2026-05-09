import chalk from "chalk";
import type { Command } from "commander";
import {
  doctorAgentWorkspaceRoots,
  listWorkspaceLeases,
  loadConfig,
  makeSessionBranch,
  readWorkspaceLease,
  releaseWorkspaceLease,
  resolveAgentWorkspaceRoots,
  type ProjectConfig,
  type Workspace,
} from "@jleechanorg/ao-core";
import { getPluginRegistry } from "../lib/create-session-manager.js";

interface ProjectSelection {
  projectId: string;
  project: ProjectConfig;
}

function requireProject(projectId: string): ProjectSelection {
  const config = loadConfig();
  const project = config.projects[projectId];
  if (!project) {
    throw new Error(`Unknown project: ${projectId}`);
  }
  return { projectId, project: { ...project, configPath: config.configPath } };
}

function workspaceRootsFor(projectId: string, project: ProjectConfig) {
  const config = loadConfig();
  return resolveAgentWorkspaceRoots({
    configPath: config.configPath,
    projectId,
    project,
    config: config.workspaceAllocator,
  });
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function registerAgentWorkspace(program: Command): void {
  const command = program
    .command("agent-workspace")
    .description("Allocate and inspect portable per-session agent workspaces");

  command
    .command("allocate")
    .requiredOption("--project <id>", "Project ID from agent-orchestrator.yaml")
    .requiredOption("--session-id <id>", "AO session ID")
    .requiredOption("--task-slug <slug>", "Task slug for the generated branch")
    .option("--repo <owner/repo>", "Override repo identity")
    .option("--default-branch <branch>", "Override default branch")
    .action(
      async (opts: {
        project: string;
        sessionId: string;
        taskSlug: string;
        repo?: string;
        defaultBranch?: string;
      }) => {
        try {
          const config = loadConfig();
          const project = config.projects[opts.project];
          if (!project) throw new Error(`Unknown project: ${opts.project}`);

          const registry = await getPluginRegistry(config);
          const workspaceName = project.workspace ?? config.defaults.workspace;
          const workspace = registry.get<Workspace>("workspace", workspaceName);
          if (!workspace) {
            throw new Error(`Workspace plugin '${workspaceName}' not found`);
          }

          const branch = makeSessionBranch(opts.project, opts.sessionId, opts.taskSlug);
          const info = await workspace.create({
            projectId: opts.project,
            project: {
              ...project,
              configPath: config.configPath,
              repo: opts.repo ?? project.repo,
              defaultBranch: opts.defaultBranch ?? project.defaultBranch,
            },
            sessionId: opts.sessionId,
            branch,
          });

          printJson({ ok: true, ...info, branch });
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        }
      },
    );

  command
    .command("status")
    .option("--project <id>", "Project ID from agent-orchestrator.yaml")
    .action((opts: { project?: string }) => {
      try {
        const config = loadConfig();
        const projects = opts.project
          ? [requireProject(opts.project)]
          : Object.entries(config.projects).map(([projectId, project]) => ({
              projectId,
              project: { ...project, configPath: config.configPath },
            }));
        printJson(
          projects.map(({ projectId, project }) => {
            const roots = resolveAgentWorkspaceRoots({
              configPath: config.configPath,
              projectId,
              project,
              config: config.workspaceAllocator,
            });
            return { projectId, roots, leases: listWorkspaceLeases(roots.stateRoot) };
          }),
        );
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  command
    .command("doctor")
    .requiredOption("--project <id>", "Project ID from agent-orchestrator.yaml")
    .action((opts: { project: string }) => {
      try {
        const { projectId, project } = requireProject(opts.project);
        printJson(doctorAgentWorkspaceRoots(workspaceRootsFor(projectId, project)));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  command
    .command("release")
    .requiredOption("--project <id>", "Project ID from agent-orchestrator.yaml")
    .requiredOption("--session-id <id>", "AO session ID")
    .option("--keep-workspace", "Only remove the lease file; leave the workspace on disk")
    .action(async (opts: { project: string; sessionId: string; keepWorkspace?: boolean }) => {
      try {
        const config = loadConfig();
        const { projectId, project } = requireProject(opts.project);
        const roots = workspaceRootsFor(projectId, project);
        const lease = readWorkspaceLease(roots.stateRoot, opts.sessionId);

        if (lease && !opts.keepWorkspace) {
          const registry = await getPluginRegistry(config);
          const workspaceName = project.workspace ?? config.defaults.workspace;
          const workspace = registry.get<Workspace>("workspace", workspaceName);
          if (workspace) {
            await workspace.destroy(lease.workspacePath, lease.repoPath);
          }
        }

        const released = releaseWorkspaceLease(roots.stateRoot, opts.sessionId);
        printJson({ ok: true, released, sessionId: opts.sessionId });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}
