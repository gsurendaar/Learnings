"use client";

import React, { useState, useEffect } from "react";
import { useSessionState } from "@/hooks/useSessionState";
import {
  Card,
  Row,
  Col,
  Button,
  Space,
  Typography,
  Tag,
  Tooltip,
  Progress,
  Checkbox,
  Empty,
  Table,
  Statistic,
  Divider,
  Spin,
  Image as AntImage,
  Collapse,
} from "antd";
import {
  PlayCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
  CameraOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";
import { useInitialization } from "@/components/InitializationContext";
import { useUser } from "@/components/UserContext";
import { useSSE } from "@/hooks/useSSE";
import RunProgress from "@/app/features/ft-runner/components/RunProgress";
import type { ComplianceResult, AgentFileStatus, SSEEvent } from "@/types/ft";

const { Text } = Typography;

// Parse priority from filename: p0-... → P0, p1-... → P1
function parsePriority(filePath: string): string | null {
  const fileName = filePath.split("/").pop() || "";
  if (fileName.startsWith("p0-")) return "P0";
  if (fileName.startsWith("p1-")) return "P1";
  if (fileName.startsWith("p2-")) return "P2";
  return null;
}

type PanelView = "selection" | "running" | "results";

// Helper: find matching key in agent status map by filename (handles different path formats)
function findMatchingKey(map: Map<string, AgentFileStatus>, file: string): string | undefined {
  if (map.has(file)) return file;
  const fileName = file.split("/").pop() || file;
  for (const key of map.keys()) {
    if (key.endsWith(fileName) || key.split("/").pop() === fileName) {
      return key;
    }
  }
  return undefined;
}

function ScreenshotCard({ ssPath, fileName, isDark }: { ssPath: string; fileName: string; isDark: boolean }) {
  const [imgSrc, setImgSrc] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    fetch(`/api/ft-runner/browse-repo?path=${encodeURIComponent(ssPath)}&content=true`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.dataUrl) {
          setImgSrc(data.dataUrl);
        } else {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
  }, [ssPath]);

  if (!imgSrc && !failed) return null;
  if (failed) return (
    <div style={{
      border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
      borderRadius: 6, width: 220, height: 140, display: "flex",
      alignItems: "center", justifyContent: "center",
      background: isDark ? "#1f2937" : "#f3f4f6", color: isDark ? "#9ca3af" : "#6b7280",
      fontSize: 11, textAlign: "center", padding: 8,
    }}>
      {fileName.replace(/\.png$/, "")}
      <br />(cleaned up)
    </div>
  );

  return (
    <div style={{
      border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
      borderRadius: 6,
      overflow: "hidden",
      background: isDark ? "#1f2937" : "#f9fafb",
    }}>
      <AntImage
        src={imgSrc}
        alt={fileName}
        width={220}
        height={140}
        style={{ objectFit: "cover" }}
      />
      <div style={{ padding: "2px 6px" }}>
        <Text type="secondary" style={{ fontSize: 9, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
          {fileName}
        </Text>
      </div>
    </div>
  );
}

interface RunFTPanelProps {
  sessionId?: string;
  generatedFiles?: Array<{ path: string; name: string; status: string }>;
  complianceResults?: ComplianceResult[];
  onRunComplete?: () => void;
  onRunIdChange?: (runId: string) => void;
  autoRun?: boolean;
  isGenerating?: boolean;
  generationProgress?: number;
}

export default function RunFTPanel({
  sessionId,
  generatedFiles = [],
  complianceResults = [],
  onRunComplete,
  onRunIdChange,
  autoRun = false,
  isGenerating = false,
  generationProgress = 0,
}: RunFTPanelProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const { credentials } = useInitialization();
  const { userInfo } = useUser();
  const userId = userInfo?.userid || userInfo?.name || "";

  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [agentMessages, setAgentMessages] = useState<Array<{ agent: string; message: string; timestamp: number }>>([]);

  // FT Builder only shows generated files — no repo test loading

  // Selection state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Run state
  const [panelView, setPanelView] = useSessionState<PanelView>("runPanelView", "selection", sessionId);
  const [runId, setRunId] = useSessionState<string | null>("runId", null, sessionId);
  const [runError, setRunError] = useState<string | null>(null);
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<Map<string, AgentFileStatus>>(new Map());
  const [supervisorSummary, setSupervisorSummary] = useState<{
    total: number; running: number; passed: number; failed: number;
  }>({ total: 0, running: 0, passed: 0, failed: 0 });
  const [pipelineStep, setPipelineStep] = useState<string>("");
  const [runStartTime, setRunStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Restore run state from server when returning to a session with a stored runId
  useEffect(() => {
    if (!runId || agentStatuses.size > 0) return;

    const restoreState = async () => {
      try {
        const statusRes = await fetch(`/api/ft-runner/status?runId=${encodeURIComponent(runId)}`);
        const data = await statusRes.json();
        if (!data.success) return;

        if (data.isActive) {
          // Run is still active — fetch agent logs to find which specs are being tested
          setPanelView("running");
          setRunStartTime(Date.now() - (data.elapsed || 0));
          try {
            const traceRes = await fetch(`/api/ft-runner/traces?runId=${encodeURIComponent(runId)}`);
            const traceData = await traceRes.json();
            if (traceData.success && traceData.traces) {
              const specFiles = new Set<string>();
              for (const t of traceData.traces) {
                if (t.target_file) specFiles.add(t.target_file.split("/").pop() || t.target_file);
              }
              if (specFiles.size > 0) {
                const statuses = new Map<string, AgentFileStatus>();
                for (const file of specFiles) {
                  statuses.set(file, { file, status: "running", currentAction: "Reconnected — waiting for updates", retryCount: 0, complianceScore: null });
                }
                setAgentStatuses(statuses);
                setSupervisorSummary({ total: specFiles.size, passed: 0, failed: 0, running: specFiles.size });
              }
            }
          } catch { /* ignore */ }
        } else {
          // Run completed — fetch final results
          setPanelView("results");
          const results = data.testResults || [];
          const statuses = new Map<string, AgentFileStatus>();
          for (const r of results) {
            const fileName = r.file?.split("/").pop() || r.file;
            statuses.set(fileName, {
              file: fileName,
              status: r.status === "passed" ? "passed" : "failed",
              currentAction: r.status === "passed" ? "Passed" : (r.error_message?.split("\n")[0]?.slice(0, 80) || "Failed"),
              retryCount: (r.attempt_number || 1) - 1,
              complianceScore: null,
              failureReason: r.status === "failed" ? r.error_message?.split("\n")[0]?.slice(0, 150) : undefined,
            });
          }
          setAgentStatuses(statuses);
          const passed = results.filter((r: any) => r.status === "passed").length;
          const failed = results.filter((r: any) => r.status === "failed").length;
          setSupervisorSummary({ total: statuses.size, passed, failed, running: 0 });
        }
      } catch { /* ignore */ }
    };

    restoreState();
  }, [runId]);

  // Timer — ticks every second while running
  useEffect(() => {
    if (panelView !== "running" || !runStartTime) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - runStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [panelView, runStartTime]);

  // SSE — must be before any effects that use lastEvent
  const sseUrl = runId ? `/api/ft-runner/stream?runId=${runId}` : null;
  const { events: sseEvents, lastEvent, status: sseStatus } = useSSE(sseUrl);

  useEffect(() => {
    if (panelView !== "running") return;
    if (!userId) return;

    const initialDelay = panelView === "running" ? 30000 : 0;

    const pollScreenshots = async () => {
      try {
        const res = await fetch(`/api/ft-runner/browse-repo?path=${encodeURIComponent(`${userId}/${credentials?.repoName || "sparkxnodeweb"}/cypress/screenshots`)}`);
        const data = await res.json();
        if (data.success && data.type === "directory") {
          const pngs: string[] = [];
          const collectPngs = async (browsePath: string) => {
            const r = await fetch(`/api/ft-runner/browse-repo?path=${encodeURIComponent(browsePath)}`);
            const d = await r.json();
            if (!d.success) return;
            for (const entry of d.entries || []) {
              if (entry.isDirectory) {
                await collectPngs(entry.path);
              } else if (entry.name.endsWith(".png")) {
                pngs.push(entry.path);
              }
            }
          };
          await collectPngs(`${userId}/${credentials?.repoName || "sparkxnodeweb"}/cypress/screenshots`);
          setScreenshots(pngs.sort((a, b) => {
            const nameA = a.split("/").pop() || a;
            const nameB = b.split("/").pop() || b;
            return nameA.localeCompare(nameB);
          }));
        }
      } catch { /* ignore */ }
    };

    const delayTimer = setTimeout(() => {
      pollScreenshots();
    }, initialDelay);
    const interval = setInterval(pollScreenshots, 10000);
    return () => { clearTimeout(delayTimer); clearInterval(interval); };
  }, [panelView, userId]);

  // Fallback: poll status every 5s to catch up when SSE misses events
  useEffect(() => {
    if (!runId || panelView !== "running") return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/ft-runner/status?runId=${runId}`);
        const data = await res.json();
        if (data.status) {
          const step = data.currentStep || data.status;
          if (step && step !== "queued") {
            setPipelineStep(step);
          }
          if (data.status === "completed" || data.status === "failed") {
            setPanelView("results");
            clearInterval(poll);
          }
        }
      } catch { /* ignore */ }
    }, 10000);
    return () => clearInterval(poll);
  }, [runId, panelView]); // eslint-disable-line react-hooks/exhaustive-deps

  const runnableFiles = generatedFiles.filter((f) => f.status === "success" || f.status === "warning");

  // Build compliance lookup
  const complianceLookup = new Map<string, number>();
  for (const cr of complianceResults) {
    const fileName = cr.testPath.split("/").pop() || cr.testPath;
    complianceLookup.set(fileName, cr.score);
    complianceLookup.set(cr.testPath, cr.score);
  }

  // Auto-select generated files and reset selection when generatedFiles change
  useEffect(() => {
    if (runnableFiles.length > 0) {
      setSelectedFiles(new Set(runnableFiles.map((f) => f.path)));
    }
  }, [generatedFiles.length, runnableFiles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-run when autoRun is true and generated files are ready
  const autoRunTriggered = React.useRef(false);
  useEffect(() => {
    if (autoRun && generatedFiles.length > 0 && !autoRunTriggered.current && panelView === "selection") {
      const runnable = generatedFiles.filter((f) => f.status === "success" || f.status === "warning");
      if (runnable.length > 0) {
        autoRunTriggered.current = true;
        const filePaths = runnable.map((f) => f.path);
        setSelectedFiles(new Set(filePaths));
        setTimeout(() => handleRun(filePaths), 300);
      }
    }
  }, [autoRun, generatedFiles.length, panelView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track which events we've processed to avoid duplicates
  const processedEventCount = React.useRef(0);
  // Track per-worker spec queues: workerId → [spec1, spec2, ...]
  const workerQueues = React.useRef<Map<number, string[]>>(new Map());

  // Process SSE events from LangGraph pipeline
  // Use sseEvents array instead of lastEvent to avoid missing events that arrive in rapid succession
  useEffect(() => {
    if (sseEvents.length <= processedEventCount.current) return;

    const newEvents = sseEvents.slice(processedEventCount.current);
    processedEventCount.current = sseEvents.length;

    for (const event of newEvents) {

    // SSE connected — fetch current status to catch up on missed events
    if (event.type === "connected") {
      setPipelineStep("Pipeline starting...");

      // Poll status endpoint to get current step info
      if (runId) {
        fetch(`/api/ft-runner/status?runId=${runId}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.status && data.status !== "queued") {
              const stepLabel = data.status === "completed" ? "Complete" : data.currentStep || data.status;
              setPipelineStep(stepLabel);
            }
          })
          .catch(() => { /* ignore */ });
      }
    }

    // Capture log messages
    if (event.type === "log" && event.message) {
      setLogMessages((prev) => [...prev.slice(-50), event.message!]);

      const msg = event.message;
      if (msg.includes("[Supervisor]") || msg.includes("[Generator]") || msg.includes("[Compliance]")) {
        const agent = msg.includes("[Supervisor]") ? "Supervisor" : msg.includes("[Compliance]") ? "Compliance" : "Generator";
        const cleanMsg = msg.replace(/^\[Supervisor\]\s*/, "").replace(/^\[Generator\]\s*/, "").replace(/^\[Generator Agent\]\s*/, "").replace(/^\[Compliance\]\s*/, "");
        setAgentMessages((prev) => [...prev.slice(-30), { agent, message: cleanMsg, timestamp: event.timestamp }]);
      }
    }

    // Pipeline step tracking (clone, install, server, cypress)
    if (event.type === "step:start" && event.step) {
      const stepLabels: Record<string, string> = {
        clone: "Cloning repository...",
        install: "Installing dependencies...",
        build: "Building application...",
        "start-server": "Starting dev server...",
        server: "Starting dev server...",
        warmup: "Warming up server...",
        "run-tests": "Running Cypress tests...",
        cypress: "Running Cypress tests...",
        generate: "Generating tests...",
        "collect-results": "Collecting results...",
        "auto-fix": "Auto-fixing failures...",
      };
      const label = stepLabels[event.step] || event.step;
      setPipelineStep(label);

      const isTestPhase = event.step === "cypress" || event.step === "run-tests";
      if (!isTestPhase) {
        // Global pipeline step (clone/install/build/server) — show as waiting, not running
        setAgentStatuses((prev) => {
          const next = new Map(prev);
          for (const [key, status] of next) {
            if (status.status === "queued") {
              next.set(key, { ...status, currentAction: `Waiting — ${label}` });
            }
          }
          return next;
        });
      }
    }

    if (event.type === "step:complete" && event.step) {
      setPipelineStep("");
    }

    // Worker started — mark first spec as "running", rest as queued in worker
    // Preserve already-passed/failed statuses from previous runs (fix retries re-run all specs)
    if ((event as any).type === "worker:start") {
      const we = event as any;
      const workerSpecs: string[] = we.specs || [];
      const wId = we.workerId as number;
      workerQueues.current.set(wId, [...workerSpecs]);
      let firstPending = true;
      setAgentStatuses((prev) => {
        const next = new Map(prev);
        workerSpecs.forEach((spec, i) => {
          const matchKey = findMatchingKey(next, spec);
          if (matchKey) {
            const current = next.get(matchKey)!;
            // Don't reset already-completed specs
            if (current.status === "passed" || current.status === "failed") return;
            if (firstPending) {
              firstPending = false;
              next.set(matchKey, { ...current, status: "running", currentAction: `Running test... (Worker ${wId + 1})` });
            } else {
              next.set(matchKey, { ...current, status: "queued", currentAction: `Waiting — Worker ${wId + 1} queue` });
            }
          }
        });
        return next;
      });
    }

    // Worker completed
    if ((event as any).type === "worker:complete") {
      const we = event as any;
      setAgentMessages((prev) => [...prev.slice(-30), {
        agent: "Supervisor",
        message: `Worker ${we.workerId + 1} finished — ${we.passed} passed, ${we.failed} failed`,
        timestamp: event.timestamp,
      }]);
    }

    // Helper: after a spec finishes, promote the next queued spec in the same worker.
    // Uses filename-only matching to handle different path formats between backend events and frontend state.
    const getFileName = (p: string) => p.split("/").pop() || p;
    const promoteNextInWorker = (statusMap: Map<string, AgentFileStatus>, finishedFile: string) => {
      const finishedName = getFileName(finishedFile);
      for (const [wId, specs] of workerQueues.current) {
        const idx = specs.findIndex((s) => getFileName(s) === finishedName);
        if (idx >= 0 && idx + 1 < specs.length) {
          const nextSpec = specs[idx + 1];
          const nextKey = findMatchingKey(statusMap, nextSpec);
          if (nextKey) {
            const ns = statusMap.get(nextKey)!;
            if (ns.status === "queued") {
              statusMap.set(nextKey, { ...ns, status: "running", currentAction: `Running test... (Worker ${wId + 1})` });
            }
          }
          break;
        }
      }
    };

    // Per-file test results
    if (event.type === "test:pass" && event.file) {
      setAgentStatuses((prev) => {
        const next = new Map(prev);
        const matchKey = findMatchingKey(next, event.file!);
        if (matchKey) {
          const current = next.get(matchKey)!;
          next.set(matchKey, { ...current, status: "passed", currentAction: "Test passed" });
          promoteNextInWorker(next, matchKey);
        }
        return next;
      });
    }

    if (event.type === "test:fail" && event.file) {
      setAgentStatuses((prev) => {
        const next = new Map(prev);
        const matchKey = findMatchingKey(next, event.file!);
        if (matchKey) {
          const current = next.get(matchKey)!;
          next.set(matchKey, {
            ...current,
            status: "running", // Still running — may get fixed
            currentAction: "Test failed — awaiting fix...",
            error: event.error,
          });
          promoteNextInWorker(next, matchKey);
        }
        return next;
      });
    }

    // Supervisor events
    if (event.type === "supervisor:analyzing") {
      setPipelineStep("Supervisor analyzing failures...");
      if (event.message) {
        const cleanMsg = event.message.replace(/^\[Supervisor\]\s*/, "");
        setAgentMessages((prev) => [...prev.slice(-30), { agent: "Supervisor", message: cleanMsg, timestamp: event.timestamp }]);
      }
    }

    if (event.type === "supervisor:requesting-fix") {
      if (event.message) {
        const cleanMsg = event.message.replace(/^\[Supervisor\]\s*/, "");
        setAgentMessages((prev) => [...prev.slice(-30), { agent: "Supervisor", message: cleanMsg, timestamp: event.timestamp }]);
      }
      if (event.file) {
        setAgentStatuses((prev) => {
          const next = new Map(prev);
          const matchKey = findMatchingKey(next, event.file!);
          if (matchKey) {
            const current = next.get(matchKey)!;
            next.set(matchKey, { ...current, currentAction: "Supervisor requesting fix..." });
          }
          return next;
        });
      }
    }

    if (event.type === "generator:fixing") {
      if (event.message) {
        const cleanMsg = event.message.replace(/^\[Generator Agent\]\s*/, "").replace(/^\[Generator\]\s*/, "");
        setAgentMessages((prev) => [...prev.slice(-30), { agent: "Generator", message: cleanMsg, timestamp: event.timestamp }]);
      }
      if (event.file) {
        setAgentStatuses((prev) => {
          const next = new Map(prev);
          const matchKey = findMatchingKey(next, event.file!);
          if (matchKey) {
            const current = next.get(matchKey)!;
            next.set(matchKey, { ...current, currentAction: "Generator fixing code..." });
          }
          return next;
        });
      }
    }

    if (event.type === "generator:fixed") {
      if (event.message) {
        const cleanMsg = event.message.replace(/^\[Generator Agent\]\s*/, "").replace(/^\[Generator\]\s*/, "");
        setAgentMessages((prev) => [...prev.slice(-30), { agent: "Generator", message: cleanMsg, timestamp: event.timestamp }]);
      }
      if (event.file) {
        setAgentStatuses((prev) => {
          const next = new Map(prev);
          const matchKey = findMatchingKey(next, event.file!);
          if (matchKey) {
            const current = next.get(matchKey)!;
            next.set(matchKey, {
              ...current,
              currentAction: "Fix applied — rerunning...",
              retryCount: current.retryCount + 1,
            });
          }
          return next;
        });
      }
    }

    if (event.type === "generator:progress" && event.message) {
      const cleanMsg = event.message.replace(/^\[Generator Agent\]\s*/, "").replace(/^\[Generator\]\s*/, "");
      setAgentMessages((prev) => [...prev.slice(-30), { agent: "Generator", message: cleanMsg, timestamp: event.timestamp }]);
    }

    // Compliance agent events
    if ((event as any).type === "agent:compliance") {
      const ce = event as any;
      const scoreMsg = ce.message || `${ce.file}: ${ce.complianceScore}%`;
      setAgentMessages((prev) => [...prev.slice(-30), { agent: "Compliance", message: scoreMsg, timestamp: event.timestamp }]);
      if (ce.file) {
        setAgentStatuses((prev) => {
          const next = new Map(prev);
          const matchKey = findMatchingKey(next, ce.file);
          if (matchKey) {
            const current = next.get(matchKey)!;
            next.set(matchKey, { ...current, currentAction: `Compliance: ${ce.complianceScore}%` });
          }
          return next;
        });
      }
    }

    // Supervisor skipped a spec due to repeated errors
    if ((event as any).type === "supervisor:skip-spec" && (event as any).file) {
      const se = event as any;
      setAgentStatuses((prev) => {
        const next = new Map(prev);
        const matchKey = findMatchingKey(next, se.file);
        if (matchKey) {
          const current = next.get(matchKey)!;
          next.set(matchKey, { ...current, status: "failed", currentAction: "Skipped — repeated error", failureReason: se.reason });
        }
        return next;
      });
      setAgentMessages((prev) => [...prev.slice(-30), { agent: "Supervisor", message: `SKIP ${se.file.split("/").pop()} — ${se.reason}`, timestamp: event.timestamp }]);
    }

    // Final failure reason emitted from cleanupNode
    if ((event as any).type === "test:fail-reason" && (event as any).file) {
      const fe = event as any;
      setAgentStatuses((prev) => {
        const next = new Map(prev);
        const matchKey = findMatchingKey(next, fe.file);
        if (matchKey) {
          const current = next.get(matchKey)!;
          if (!current.failureReason) {
            next.set(matchKey, { ...current, failureReason: fe.reason });
          }
        }
        return next;
      });
    }

    // Supervisor summary with pass/fail counts
    if (event.type === "supervisor:summary" || event.type === "test:summary") {
      setSupervisorSummary((prev) => ({
        ...prev,
        total: event.total || prev.total,
        passed: event.passed || 0,
        failed: event.failed || 0,
        running: (event.total || prev.total) - (event.passed || 0) - (event.failed || 0),
      }));
      if (event.message) {
        const cleanMsg = event.message.replace(/^\[Supervisor\]\s*/, "");
        setAgentMessages((prev) => [...prev.slice(-30), { agent: "Supervisor", message: cleanMsg, timestamp: event.timestamp }]);
      }
    }

    if (event.type === "supervisor:failure" && event.message) {
      const cleanMsg = event.message.replace(/^\[Supervisor\]\s*/, "");
      setAgentMessages((prev) => [...prev.slice(-30), { agent: "Supervisor", message: cleanMsg, timestamp: event.timestamp }]);
    }

    // Run results — update final statuses from actual test results
    if (event.type === "run:results") {
      const resultData = event as any;
      // Capture screenshots from the event (sent BEFORE cleanup deletes files)
      if (resultData.screenshots && Array.isArray(resultData.screenshots)) {
        const userId = userInfo?.userid || userInfo?.name || "";
        const repo = credentials?.repoName || "sparkxnodeweb";
        const fullPaths = resultData.screenshots
          .filter((s: string) => s.endsWith(".png"))
          .map((s: string) => `${userId}/${repo}/${s}`);
        if (fullPaths.length > 0) {
          setScreenshots(fullPaths.sort((a: string, b: string) => {
            const nameA = a.split("/").pop() || a;
            const nameB = b.split("/").pop() || b;
            return nameA.localeCompare(nameB);
          }));
        }
      }
      setAgentStatuses((prev) => {
        const next = new Map(prev);
        if (resultData.results && Array.isArray(resultData.results)) {
          for (const r of resultData.results) {
            const matchKey = findMatchingKey(next, r.file);
            if (matchKey) {
              const current = next.get(matchKey)!;
              next.set(matchKey, {
                ...current,
                status: r.status === "passed" ? "passed" : "failed",
                currentAction: r.status === "passed" ? "Passed" : (r.error?.split("\n")[0]?.slice(0, 80) || "Failed"),
                error: r.error,
                failureReason: r.status === "failed" && !current.failureReason
                  ? (r.error?.split("\n")[0]?.slice(0, 150) || "Test failed")
                  : current.failureReason,
              });
            }
          }
        }
        const passed = Array.from(next.values()).filter((s) => s.status === "passed").length;
        const failed = Array.from(next.values()).filter((s) => s.status === "failed").length;
        const running = Array.from(next.values()).filter((s) => s.status === "running" || s.status === "queued").length;
        setSupervisorSummary({ total: next.size, passed, failed, running });
        return next;
      });
      onRunComplete?.();
    }

    if (event.type === "run:complete" && panelView === "running") {
      setAgentStatuses((prev) => {
        const next = new Map(prev);
        for (const [key, status] of next) {
          if (status.status === "running" || status.status === "queued") {
            next.set(key, { ...status, status: "failed", currentAction: "Run completed — check logs" });
          }
        }
        const passed = Array.from(next.values()).filter((s) => s.status === "passed").length;
        const failed = Array.from(next.values()).filter((s) => s.status === "failed").length;
        setSupervisorSummary({ total: next.size, passed, failed, running: 0 });
        return next;
      });
      setPanelView("results");
    }

    if (event.type === "run:error") {
      setRunError(event.error || "Run failed");
      setPipelineStep(event.error || "Run failed");
      setAgentStatuses((prev) => {
        const next = new Map(prev);
        for (const [key, status] of next) {
          if (status.status === "running" || status.status === "queued") {
            next.set(key, { ...status, status: "failed", currentAction: event.error || "Run failed" });
          }
        }
        const passed = Array.from(next.values()).filter((s) => s.status === "passed").length;
        const failed = Array.from(next.values()).filter((s) => s.status === "failed").length;
        setSupervisorSummary({ total: next.size, passed, failed, running: 0 });
        return next;
      });
      setPanelView("results");
    }

    // Capture step errors
    if (event.type === "step:error") {
      const errMsg = `Step "${event.step}" failed: ${event.error || "unknown error"}`;
      setLogMessages((prev) => [...prev.slice(-50), errMsg]);
      setRunError(errMsg);
    }
    } // end for loop over newEvents
  }, [sseEvents.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handlers
  const toggleFile = (filePath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const selectAll = () => setSelectedFiles(new Set(runnableFiles.map((f) => f.path)));
  const deselectAll = () => setSelectedFiles(new Set());

  const handleRun = async (overrideFiles?: string[]) => {
    const testFiles = overrideFiles || Array.from(selectedFiles);
    if (testFiles.length === 0) return;

    // Initialize agent statuses
    const initial = new Map<string, AgentFileStatus>();
    for (const file of testFiles) {
      initial.set(file, {
        file,
        status: "queued",
        currentAction: "Queued",
        retryCount: 0,
        complianceScore: null,
      });
    }
    setAgentStatuses(initial);
    setSupervisorSummary({ total: testFiles.length, running: 0, passed: 0, failed: 0 });
    setRunStartTime(Date.now());
    setElapsedSeconds(0);
    setScreenshots([]);
    setPanelView("running");

    try {
      await fetch("/api/ft-runner/browse-repo?path=" + encodeURIComponent(`${userId}/${credentials?.repoName || "sparkxnodeweb"}/cypress/screenshots`), { method: "DELETE" });
    } catch { /* best effort */ }

    try {
      const response = await fetch("/api/ft-runner/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentMode: true,
          testFiles,
          workerCount: Math.min(testFiles.length, 4),
          browser: "electron",
          runMode: "headless",
          llmApiKey: credentials?.llmApiKey || undefined,
          llmBaseUrl: credentials?.baseUrl || undefined,
          llmModel: credentials?.modelId || undefined,
          githubToken: credentials?.githubToken || undefined,
          userId: userInfo?.userid || userInfo?.name || undefined,
          owner: credentials?.repoOwner || undefined,
          repo: credentials?.repoName || undefined,
          branch: credentials?.repoBranch || undefined,
        }),
      });

      const data = await response.json();
      if (data.success && data.runId) {
        setRunId(data.runId);
        onRunIdChange?.(data.runId);
        setRunError(null);
      } else {
        setRunError(data.message || data.error || "Failed to start test run");
        setPanelView("results");
      }
    } catch (err: any) {
      setRunError(err?.message || "Failed to connect to server");
      setPanelView("results");
    }
  };

  const handleReset = () => {
    setPanelView("selection");
    setRunId(null);
    setRunError(null);
    setLogMessages([]);
    setAgentMessages([]);
    setPipelineStep("");
    setScreenshots([]);
    setAgentStatuses(new Map());
    setSupervisorSummary({ total: 0, running: 0, passed: 0, failed: 0 });
    processedEventCount.current = 0;
  };

  const handleCancel = async () => {
    if (!runId) return;
    try {
      await fetch("/api/ft-runner/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
    } catch { /* best effort */ }
    // UI will update via SSE run:error + run:complete events
  };

  const cardStyle = {
    borderRadius: 10,
    border: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
    background: isDark ? "#1e293b" : "#ffffff",
    boxShadow: isDark ? "none" : "0 1px 3px rgba(0,0,0,0.06)",
  };

  // Status icon renderer
  const renderStatusIcon = (status: string) => {
    switch (status) {
      case "passed": return <CheckCircleOutlined style={{ color: "#059669", fontSize: 16 }} />;
      case "failed": return <CloseCircleOutlined style={{ color: "#dc2626", fontSize: 16 }} />;
      case "running": return <LoadingOutlined style={{ color: "#2563eb", fontSize: 16 }} spin />;
      case "queued": return <ClockCircleOutlined style={{ color: "#9ca3af", fontSize: 16 }} />;
      default: return <ClockCircleOutlined style={{ color: "#9ca3af", fontSize: 16 }} />;
    }
  };

  // ═══════════════════════════════════════════
  // GENERATING VIEW — show progress while CreateFT generates tests
  // ═══════════════════════════════════════════
  if (panelView === "selection" && isGenerating) {
    const stepLabel = generationProgress < 30 ? "Scanning source files" : generationProgress < 50 ? "Analyzing components" : generationProgress < 70 ? "Writing Cypress tests" : generationProgress < 90 ? "Running compliance checks" : "Finalizing";
    return (
      <div style={{ padding: "8px 16px 16px" }}>
        <div style={{
          background: isDark ? "#0f172a" : "#f8fafc",
          borderRadius: 12,
          border: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
          padding: "32px 24px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <SyncOutlined spin style={{ fontSize: 18, color: isDark ? "#a78bfa" : "#7c3aed" }} />
            <div style={{ flex: 1 }}>
              <Text strong style={{ fontSize: 14, color: isDark ? "#f1f5f9" : "#0f172a", display: "block" }}>
                Generating Tests
              </Text>
              <Text style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b" }}>
                {stepLabel} — tests will auto-run when ready
              </Text>
            </div>
            <Tag style={{ borderRadius: 4, fontSize: 11, fontWeight: 600, background: isDark ? "#1e293b" : "#f1f5f9", border: "none", color: isDark ? "#a78bfa" : "#7c3aed" }}>
              {generationProgress}%
            </Tag>
          </div>
          <Progress
            percent={generationProgress}
            status="active"
            strokeColor={isDark ? "#7c3aed" : "#7c3aed"}
            trailColor={isDark ? "#1e293b" : "#e2e8f0"}
            size="small"
            showInfo={false}
          />
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // SELECTION VIEW
  // ═══════════════════════════════════════════
  if (panelView === "selection") {
    return (
      <div style={{ padding: "8px 16px 16px" }}>
        <Row gutter={[20, 20]}>
          {/* Left: File Selection */}
          <Col xs={24} lg={14}>
            <Card
              title={
                <Space>
                  <FileTextOutlined style={{ color: isDark ? "#34d399" : "#059669" }} />
                  <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
                    Test Files
                  </Text>
                  <Tag color="purple" style={{ borderRadius: 4 }}>
                    {runnableFiles.length} files
                  </Tag>
                </Space>
              }
              style={cardStyle}
              styles={{ body: { padding: "12px 16px" } }}
            >
              {runnableFiles.length === 0 ? (
                <Empty
                  description="No tests generated yet. Use Create FT to generate tests first."
                  style={{ padding: 40 }}
                />
              ) : (
                <>
                  <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
                    <Space>
                      <Button size="small" onClick={selectAll}>Select All</Button>
                      <Button size="small" onClick={deselectAll}>Deselect All</Button>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {selectedFiles.size} selected
                    </Text>
                  </Space>

                  <div
                    style={{
                      maxHeight: 400,
                      overflowY: "auto",
                      border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                      borderRadius: 8,
                      background: isDark ? "#1f2937" : "#ffffff",
                    }}
                  >
                    {runnableFiles.map((file) => {
                      const priority = parsePriority(file.path);
                      const fileName = file.path.split("/").pop() || file.path;
                      const score = complianceLookup.get(fileName) ?? complianceLookup.get(file.path);

                      return (
                        <div
                          key={file.path}
                          onClick={() => toggleFile(file.path)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 12px",
                            borderBottom: `1px solid ${isDark ? "#374151" : "#f3f4f6"}`,
                            cursor: "pointer",
                            background: selectedFiles.has(file.path)
                              ? isDark ? "#1e3a5f20" : "#eff6ff"
                              : "transparent",
                          }}
                        >
                          <Space>
                            <Checkbox checked={selectedFiles.has(file.path)} />
                            {priority && (
                              <Tag
                                color={priority === "P0" ? "red" : priority === "P1" ? "orange" : "blue"}
                                style={{ borderRadius: 4, fontWeight: 600, minWidth: 32, textAlign: "center" }}
                              >
                                {priority}
                              </Tag>
                            )}
                            <Tooltip title={file.path}>
                              <Text
                                style={{
                                  fontSize: 13,
                                  fontFamily: "monospace",
                                  color: isDark ? "#e5e7eb" : "#374151",
                                }}
                              >
                                {fileName}
                              </Text>
                            </Tooltip>
                          </Space>
                          <Space>
                            {score !== undefined && (
                              <Tag
                                color={score >= 90 ? "green" : score >= 70 ? "orange" : "red"}
                                style={{ borderRadius: 4, fontSize: 11 }}
                              >
                                {score}%
                              </Tag>
                            )}
                            {file.status === "warning" && (
                              <Tag color="orange" style={{ borderRadius: 4, fontSize: 11 }}>
                                Exists
                              </Tag>
                            )}
                          </Space>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      padding: "8px 12px",
                      marginTop: 12,
                      background: isDark ? "#1f293780" : "#f3f4f6",
                      borderRadius: 6,
                    }}
                  >
                    <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>
                      Base Path:{" "}
                      <Text code style={{ fontSize: 11 }}>repos/sparkxnodeweb/</Text>
                    </Text>
                  </div>
                </>
              )}
            </Card>
          </Col>

          {/* Right: Run Button */}
          <Col xs={24} lg={10}>
            <Card
              style={{ ...cardStyle, height: "auto" }}
              styles={{ body: { padding: "20px" } }}
            >
              <Button
                type="primary"
                size="large"
                icon={<PlayCircleOutlined />}
                onClick={() => handleRun()}
                disabled={selectedFiles.size === 0}
                block
                style={{
                  height: 52,
                  borderRadius: 8,
                  background: selectedFiles.size === 0
                    ? undefined
                    : "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                  border: "none",
                  fontWeight: 600,
                  fontSize: 16,
                }}
              >
                Run {selectedFiles.size} Test{selectedFiles.size !== 1 ? "s" : ""} (Parallel Agents)
              </Button>

              <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 12, textAlign: "center" }}>
                Each file runs as an independent agent with auto-fix (up to 5 retries).
                Tests execute in Chrome (headless) in parallel.
              </Text>
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // RUNNING / RESULTS VIEW
  // ═══════════════════════════════════════════
  const isRunning = panelView === "running";
  const agentList = Array.from(agentStatuses.values());
  const completedCount = supervisorSummary.passed + supervisorSummary.failed;

  return (
    <div style={{ padding: "8px 16px 16px" }}>
      {/* Pipeline Steps — reuse RunProgress from FT Runner */}
      <div style={{ marginBottom: 16 }}>
        <RunProgress
          events={sseEvents as SSEEvent[]}
          lastEvent={lastEvent as SSEEvent | null}
          sseStatus={sseStatus}
          runId={runId}
          error={runError}
          compact
        />
        {panelView === "running" && (
          <div style={{ marginTop: 8, textAlign: "right" }}>
            <Button
              danger
              icon={<StopOutlined />}
              onClick={handleCancel}
              style={{ borderRadius: 8 }}
            >
              Stop Run & Kill Server
            </Button>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {runError && (
        <Card
          style={{
            ...cardStyle,
            marginBottom: 16,
            border: `1px solid ${isDark ? "#991b1b" : "#fca5a5"}`,
            background: isDark ? "#450a0a" : "#fef2f2",
          }}
          styles={{ body: { padding: "12px 16px" } }}
        >
          <Space>
            <CloseCircleOutlined style={{ color: "#dc2626", fontSize: 16 }} />
            <Text strong style={{ color: "#dc2626", fontSize: 13 }}>Error</Text>
          </Space>
          <pre
            style={{
              margin: "8px 0 0",
              padding: 10,
              background: isDark ? "#1a1a2e" : "#fff5f5",
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 150,
              overflowY: "auto",
              color: isDark ? "#fca5a5" : "#991b1b",
              fontFamily: "monospace",
            }}
          >
            {runError}
          </pre>
        </Card>
      )}

      {/* Agent Activity — Supervisor & Generator decisions */}
      {agentMessages.length > 0 && (
        <Card
          title={
            <Space>
              <ThunderboltOutlined style={{ color: isDark ? "#c084fc" : "#7c3aed" }} />
              <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937", fontSize: 13 }}>
                Agent Activity ({agentMessages.length})
              </Text>
            </Space>
          }
          style={{ ...cardStyle, marginBottom: 16, border: `1px solid ${isDark ? "#4c1d95" : "#ddd6fe"}` }}
          styles={{ body: { padding: "8px 12px", maxHeight: 250, overflowY: "auto" } }}
          size="small"
        >
          {agentMessages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                padding: "4px 0",
                borderBottom: i < agentMessages.length - 1 ? `1px solid ${isDark ? "#374151" : "#f3f4f6"}` : "none",
                fontSize: 12,
              }}
            >
              <Tag
                color={msg.agent === "Supervisor" ? "purple" : msg.agent === "Compliance" ? "green" : "cyan"}
                style={{ borderRadius: 4, fontSize: 10, flexShrink: 0, margin: 0 }}
              >
                {msg.agent}
              </Tag>
              <Text style={{
                color: msg.message.includes("Error:") || msg.message.includes("didn't work") || msg.message.includes("FAIL")
                  ? isDark ? "#f87171" : "#dc2626"
                  : msg.message.includes("Fix applied") || msg.message.includes("Added:") || msg.message.includes("PASS")
                  ? isDark ? "#34d399" : "#059669"
                  : isDark ? "#e5e7eb" : "#374151",
                fontSize: 12,
                lineHeight: 1.5,
              }}>
                {msg.message}
              </Text>
            </div>
          ))}
        </Card>
      )}

      {/* Live Log Output */}
      {logMessages.length > 0 && (
        <Card
          title={
            <Space>
              <FileTextOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
              <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937", fontSize: 13 }}>
                Logs ({logMessages.length})
              </Text>
            </Space>
          }
          style={{ ...cardStyle, marginBottom: 16 }}
          styles={{ body: { padding: "8px 12px" } }}
          size="small"
        >
          <div
            style={{
              maxHeight: 180,
              overflowY: "auto",
              fontFamily: "monospace",
              fontSize: 11,
            }}
          >
            {logMessages.slice(-20).map((log, i) => (
              <div
                key={i}
                style={{
                  color: log.includes("[server:err]") || log.includes("error") || log.includes("Error")
                    ? isDark ? "#f87171" : "#dc2626"
                    : log.includes("[fix]") || log.includes("[Supervisor]")
                    ? isDark ? "#fbbf24" : "#d97706"
                    : log.includes("[Generator")
                    ? isDark ? "#22d3ee" : "#0891b2"
                    : isDark ? "#9ca3af" : "#6b7280",
                  lineHeight: 1.6,
                }}
              >
                {log}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Agent Status Table */}
      <Card style={cardStyle} styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={agentList}
          rowKey="file"
          size="small"
          pagination={false}
          scroll={{ y: 400 }}
          columns={[
            {
              title: "File",
              dataIndex: "file",
              key: "file",
              render: (file: string) => {
                const fileName = file.split("/").pop() || file;
                return (
                  <Tooltip title={file}>
                    <Space>
                      <FileTextOutlined style={{ color: isDark ? "#a78bfa" : "#7c3aed" }} />
                      <Text code style={{ fontSize: 12, color: isDark ? "#e5e7eb" : "#374151" }}>
                        {fileName}
                      </Text>
                    </Space>
                  </Tooltip>
                );
              },
            },
            {
              title: "Priority",
              dataIndex: "file",
              key: "priority",
              width: 70,
              render: (file: string) => {
                const p = parsePriority(file);
                return p ? (
                  <Tag
                    color={p === "P0" ? "red" : p === "P1" ? "orange" : "blue"}
                    style={{ borderRadius: 4, fontWeight: 600 }}
                  >
                    {p}
                  </Tag>
                ) : null;
              },
            },
            {
              title: "Status",
              dataIndex: "status",
              key: "status",
              width: 90,
              render: (status: string) => (
                <Space size={4}>
                  {renderStatusIcon(status)}
                  <Text style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: status === "passed" ? "#059669"
                         : status === "failed" ? "#dc2626"
                         : status === "running" ? "#2563eb"
                         : "#9ca3af",
                  }}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Text>
                </Space>
              ),
            },
            {
              title: "Retries",
              dataIndex: "retryCount",
              key: "retryCount",
              width: 70,
              render: (count: number) => (
                count > 0 ? (
                  <Tag style={{ borderRadius: 4, fontSize: 11 }}>
                    {count} {count === 1 ? "retry" : "retries"}
                  </Tag>
                ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
              ),
            },
            {
              title: "Compliance",
              dataIndex: "complianceScore",
              key: "compliance",
              width: 110,
              render: (score: number | null) => (
                score !== null ? (
                  <Tag
                    icon={<SafetyCertificateOutlined />}
                    color={score >= 90 ? "green" : score >= 70 ? "orange" : "red"}
                    style={{ borderRadius: 4, fontSize: 11, fontWeight: 600 }}
                  >
                    {score}%
                  </Tag>
                ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
              ),
            },
            {
              title: "Current Action",
              dataIndex: "currentAction",
              key: "currentAction",
              render: (action: string, record: AgentFileStatus) => (
                <Text
                  style={{
                    fontSize: 12,
                    color: record.status === "running"
                      ? isDark ? "#60a5fa" : "#2563eb"
                      : isDark ? "#9ca3af" : "#6b7280",
                    fontStyle: record.status === "running" ? "italic" : "normal",
                  }}
                >
                  {action || "—"}
                </Text>
              ),
            },
            {
              title: "Failure Reason",
              dataIndex: "failureReason",
              key: "failureReason",
              width: 250,
              render: (reason: string | undefined, record: AgentFileStatus) => (
                reason ? (
                  <Tooltip title={reason}>
                    <Text
                      style={{
                        fontSize: 11,
                        color: isDark ? "#f87171" : "#dc2626",
                        maxWidth: 230,
                        display: "inline-block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {reason.length > 60 ? reason.slice(0, 57) + "..." : reason}
                    </Text>
                  </Tooltip>
                ) : (
                  record.status === "failed"
                    ? <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
                    : null
                )
              ),
            },
          ]}
        />
      </Card>

      {/* Screenshots from Cypress — grouped by spec file */}
      {screenshots.length > 0 && (() => {
        const grouped = new Map<string, string[]>();
        for (const ssPath of screenshots) {
          const parts = ssPath.split("/");
          const pngIndex = parts.findIndex((p) => p.endsWith(".png"));
          const specName = pngIndex > 0 ? parts[pngIndex - 1] : "Other";
          if (!grouped.has(specName)) grouped.set(specName, []);
          grouped.get(specName)!.push(ssPath);
        }

        const collapseItems = Array.from(grouped.entries()).map(([specName, paths]) => ({
          key: specName,
          label: (
            <Space>
              <CameraOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
              <Text strong style={{ fontSize: 12, color: isDark ? "#e5e7eb" : "#374151" }}>
                {specName}
              </Text>
              <Tag style={{ fontSize: 10, borderRadius: 4 }}>{paths.length}</Tag>
              {panelView === "running" && <Tag color="processing" style={{ fontSize: 10 }}>Live</Tag>}
            </Space>
          ),
          children: (
            <AntImage.PreviewGroup>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {paths.map((ssPath, i) => {
                  const fileName = ssPath.split("/").pop() || ssPath;
                  return (
                    <ScreenshotCard
                      key={i}
                      ssPath={ssPath}
                      fileName={fileName}
                      isDark={isDark}
                    />
                  );
                })}
              </div>
            </AntImage.PreviewGroup>
          ),
        }));

        return (
          <Collapse
            ghost
            style={{ marginTop: 16 }}
            defaultActiveKey={panelView === "results" ? collapseItems.map((i) => i.key) : []}
            items={[{
              key: "screenshots",
              label: (
                <Space>
                  <CameraOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
                  <Text strong style={{ fontSize: 13, color: isDark ? "#e5e7eb" : "#374151" }}>
                    Screenshots ({screenshots.length})
                  </Text>
                  {panelView === "running" && <Tag color="processing" style={{ fontSize: 10 }}>Live</Tag>}
                </Space>
              ),
              children: (
                <Collapse
                  ghost
                  defaultActiveKey={panelView === "results" ? collapseItems.map((i) => i.key) : [collapseItems[0]?.key]}
                  items={collapseItems}
                />
              ),
            }]}
          />
        );
      })()}

      {/* Action Buttons (visible after completion) */}
      {panelView === "results" && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between" }}>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={handleReset} size="large" style={{ borderRadius: 8 }}>
              New Run
            </Button>
            <Button
              icon={<StopOutlined />}
              onClick={async () => {
                try {
                  const res = await fetch("/api/ft-runner/cleanup", { method: "POST" });
                  const data = await res.json();
                  console.log("[Cleanup]", data);
                } catch { /* ignore */ }
              }}
              style={{ borderRadius: 8 }}
            >
              Cleanup Servers
            </Button>
          </Space>
          <Space>
            {supervisorSummary.failed > 0 && (
              <Button type="primary" danger icon={<ReloadOutlined />} size="large" style={{ borderRadius: 8 }}>
                Rerun Failed ({supervisorSummary.failed})
              </Button>
            )}
            <Row gutter={16}>
              <Col>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>Passed</Text>}
                  value={supervisorSummary.passed}
                  valueStyle={{ fontSize: 20, color: "#059669" }}
                  prefix={<CheckCircleOutlined />}
                />
              </Col>
              <Col>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>Failed</Text>}
                  value={supervisorSummary.failed}
                  valueStyle={{ fontSize: 20, color: "#dc2626" }}
                  prefix={<CloseCircleOutlined />}
                />
              </Col>
            </Row>
          </Space>
        </div>
      )}
    </div>
  );
}
