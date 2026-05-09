# Portable Agent Workspaces

AO writer sessions must run in allocator-managed workspaces, not in the seed
checkout. The seed checkout is a source reference for the default branch and is
treated as read-only for worker edits.

## Roots

The allocator uses logical roots instead of hardcoded container paths:

- `projectsRoot` for seed checkouts or writable local mirrors.
- `worktreesRoot` for per-session writer workspaces.
- `stateRoot` for locks, leases, session metadata and bare mirrors.
- `artifactsRoot` for logs, generated output and evidence.

Resolution order is:

1. AO runtime env:
   - `AO_PROJECTS_ROOT`
   - `AO_WORKTREES_ROOT`
   - `AO_STATE_ROOT`
   - `AO_ARTIFACTS_ROOT`
2. Generic Supernova env:
   - `SUPERNOVA_PROJECTS_ROOT`
   - `SUPERNOVA_WORKTREES_ROOT`
   - `SUPERNOVA_AGENT_STATE_ROOT`
   - `SUPERNOVA_AGENT_ARTIFACTS_ROOT`
3. Project `workspaceAllocator` config.
4. Top-level `workspaceAllocator` config.
5. Existing `worktreeDir` compatibility setting.
6. Portable AO user-state fallback.

Absolute paths such as `/home/ao`, `/workspace` or `/opt/data` may appear in a
deployment's environment, but they are not AO policy.

## Command Surface

```bash
ao agent-workspace allocate \
  --project supernova \
  --session-id sn-1 \
  --task-slug fix-workspace-lock

ao agent-workspace status
ao agent-workspace doctor --project supernova
ao agent-workspace release --project supernova --session-id sn-1
```

Allocation creates:

- a unique workspace under `worktreesRoot/<projectId>/<sessionId>`;
- a unique branch like `codex/<project>/<sessionId>-<slug>`;
- a lease under `stateRoot/leases/<sessionId>.json`;
- an artifacts directory under `artifactsRoot/<sessionId>`.

## Read-Only Git Handling

Before mutating Git storage, the worktree plugin probes whether the seed
checkout's `.git` metadata is writable.

If the seed `.git` is read-only:

- AO does not retry raw `git switch` or raw `git worktree add` in that checkout;
- AO fails closed if the seed checkout is dirty or unreadable;
- AO uses a writable bare mirror under `stateRoot/git/<repoSlug>.git`;
- the session workspace is created from that writable mirror;
- the lease records `readOnlyGitFallback: true`.

If a workspace path already exists without a matching allocator lease, allocation
fails closed. Dirty or unknown workspaces are not removed automatically; cleanup
must be an explicit operator action.
