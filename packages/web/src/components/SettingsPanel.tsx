"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardStats, DashboardOrchestratorLink } from "@/lib/types";

interface SettingsPanelProps {
  projectId?: string;
  projectName?: string;
  stats: DashboardStats;
  orchestrators: DashboardOrchestratorLink[];
}

interface ObservabilityData {
  generatedAt: string;
  overallStatus: string;
  projects: Record<
    string,
    {
      projectId: string;
      updatedAt: string;
      metrics: Record<string, { count: number }>;
      health: Record<string, { status: string }>;
      recentTraces: Array<{
        timestamp: string;
        metric: string;
        operation: string;
        outcome: string;
        reason?: string;
      }>;
      sessions: Record<string, { status: string }>;
    }
  >;
}

export function SettingsPanel({
  projectId,
  projectName,
  stats,
  orchestrators,
}: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"settings" | "logs">("settings");
  const [obsData, setObsData] = useState<ObservabilityData | null>(null);
  const [obsError, setObsError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchObservability = useCallback(async () => {
    try {
      const res = await fetch("/api/observability");
      if (res.ok) {
        const data = (await res.json()) as ObservabilityData;
        setObsData(data);
        setObsError(null);
      } else {
        setObsError(`HTTP ${res.status}`);
        setObsData(null);
      }
    } catch (err) {
      setObsError(err instanceof Error ? err.message : "Failed to fetch");
      setObsData(null);
    }
  }, []);

  useEffect(() => {
    if (open && tab === "logs") {
      fetchObservability();
    }
  }, [open, tab, fetchObservability]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const traces = obsData
    ? Object.entries(obsData.projects).flatMap(([pid, proj]) =>
        (proj.recentTraces ?? []).map((t) => ({
          ...t,
          projectId: pid,
        })),
      )
    : [];

  const sortedTraces = traces
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 50);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 left-4 z-50 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shadow-lg transition-all hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] hover:shadow-xl"
        aria-label="Toggle settings and logs"
        title="Settings & Logs"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-14 left-4 z-50 flex h-[420px] w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] shadow-2xl"
          style={{
            boxShadow:
              "0 0 0 1px rgba(48,54,61,0.3), 0 8px 32px rgba(0,0,0,0.6), 0 24px 80px rgba(0,0,0,0.4)",
          }}
        >
          <div className="flex shrink-0 items-center border-b border-[var(--color-border-subtle)]">
            <button
              type="button"
              onClick={() => setTab("settings")}
              className={`flex-1 px-4 py-2.5 text-[12px] font-semibold transition-colors ${
                tab === "settings"
                  ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => setTab("logs")}
              className={`flex-1 px-4 py-2.5 text-[12px] font-semibold transition-colors ${
                tab === "logs"
                  ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              Logs
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-2.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              aria-label="Close panel"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {tab === "settings" && (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
                    Status
                  </h3>
                  <div className="space-y-1.5">
                    <InfoRow label="Project" value={projectName ?? "All projects"} />
                    <InfoRow label="Active sessions" value={String(stats.totalSessions)} />
                    <InfoRow label="Working" value={String(stats.workingSessions)} />
                    <InfoRow label="Open PRs" value={String(stats.openPRs)} />
                    <InfoRow label="Needs review" value={String(stats.needsReview)} />
                    <InfoRow
                      label="Orchestrators"
                      value={String(orchestrators.length)}
                    />
                  </div>
                </section>

                {orchestrators.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
                      Orchestrators
                    </h3>
                    <div className="space-y-1">
                      {orchestrators.map((orchestrator) => (
                        <div
                          key={orchestrator.id}
                          className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] opacity-80" />
                            <span className="text-[12px] text-[var(--color-text-primary)]">
                              {orchestrator.projectName}
                            </span>
                          </div>
                          <a
                            href={`/sessions/${encodeURIComponent(orchestrator.id)}`}
                            className="text-[11px] text-[var(--color-accent)] hover:underline"
                          >
                            {orchestrator.id}
                          </a>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {obsData && (
                  <section>
                    <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
                      Health
                    </h3>
                    <div className="space-y-1.5">
                      <InfoRow label="Overall status" value={obsData.overallStatus} />
                      <InfoRow
                        label="Generated at"
                        value={new Date(obsData.generatedAt).toLocaleString()}
                      />
                      <InfoRow
                        label="Projects tracked"
                        value={String(Object.keys(obsData.projects).length)}
                      />
                    </div>
                  </section>
                )}
              </div>
            )}

            {tab === "logs" && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
                    Recent traces
                  </h3>
                  <button
                    type="button"
                    onClick={fetchObservability}
                    className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-secondary)]"
                  >
                    Refresh
                  </button>
                </div>

                {obsError && (
                  <div className="mb-3 rounded-md border border-[rgba(248,81,73,0.25)] bg-[rgba(248,81,73,0.05)] px-3 py-2 text-[11px] text-[var(--color-status-error)]">
                    Failed to load: {obsError}
                  </div>
                )}

                {!obsData && !obsError && (
                  <div className="py-8 text-center text-[12px] text-[var(--color-text-muted)]">
                    Loading…
                  </div>
                )}

                {sortedTraces.length === 0 && obsData && (
                  <div className="py-8 text-center text-[12px] text-[var(--color-text-muted)]">
                    No recent traces
                  </div>
                )}

                <div className="space-y-0.5">
                  {sortedTraces.map((trace, index) => (
                    <div
                      key={`${trace.timestamp}-${index}`}
                      className="flex items-start gap-3 rounded-md px-2.5 py-1.5 hover:bg-[var(--color-bg-subtle)]"
                    >
                      <span
                        className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          trace.outcome === "success"
                            ? "bg-[var(--color-status-ready)]"
                            : trace.outcome === "failure"
                              ? "bg-[var(--color-status-error)]"
                              : "bg-[var(--color-status-attention)]"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">
                            {trace.operation || trace.metric}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
                            {new Date(trace.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span
                            className={`text-[10px] ${
                              trace.outcome === "success"
                                ? "text-[var(--color-status-ready)]"
                                : trace.outcome === "failure"
                                  ? "text-[var(--color-status-error)]"
                                  : "text-[var(--color-text-muted)]"
                            }`}
                          >
                            {trace.outcome}
                          </span>
                          {trace.reason && (
                            <span className="truncate text-[10px] text-[var(--color-text-tertiary)]">
                              {trace.reason}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-[9px] tabular-nums text-[var(--color-text-tertiary)]">
                        {trace.projectId}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5">
      <span className="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      <span className="text-[11px] font-medium tabular-nums text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}
