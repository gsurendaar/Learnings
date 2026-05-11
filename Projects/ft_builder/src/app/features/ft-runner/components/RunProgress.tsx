"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { Card, Steps, Space, Typography, Tag, Modal, Button, Tooltip } from "antd";
import {
  CloudDownloadOutlined,
  BuildOutlined,
  RocketOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  ToolOutlined,
  SyncOutlined,
  CodeOutlined,
  EyeOutlined,
  LeftOutlined,
  RightOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";
import { SSEEvent } from "@/types/ft";

const { Text } = Typography;

interface RunProgressProps {
  events: SSEEvent[];
  lastEvent: SSEEvent | null;
  sseStatus: string;
  runId: string | null;
  error?: string | null;
  /** When true, hides the log output and error sections (for embedding in other panels that have their own logs) */
  compact?: boolean;
}

interface PipelineStep {
  key: string;
  title: string;
  icon: React.ReactNode;
}

const BASE_STEPS: PipelineStep[] = [
  { key: "clone",        title: "Clone",        icon: <CloudDownloadOutlined /> },
  { key: "install",      title: "Install",      icon: <ThunderboltOutlined /> },
  { key: "build",        title: "Build",        icon: <BuildOutlined /> },
  { key: "start-server", title: "Start Server", icon: <RocketOutlined /> },
  { key: "run-tests",    title: "Run Tests",    icon: <ExperimentOutlined /> },
];

const GENERATE_STEP: PipelineStep = {
  key: "generate", title: "Generate", icon: <CodeOutlined />,
};

const FIX_STEPS: PipelineStep[] = [
  { key: "fix-analyze", title: "Analyze", icon: <SearchOutlined /> },
  { key: "fix-apply", title: "Apply Fix", icon: <ToolOutlined /> },
  { key: "fix-rerun", title: "Re-run", icon: <SyncOutlined /> },
];

const FINAL_STEP: PipelineStep = {
  key: "collect-results",
  title: "Results",
  icon: <CheckCircleOutlined />,
};

export default function RunProgress({ events, lastEvent, sseStatus, runId, error, compact }: RunProgressProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  // Elapsed time tracking for active steps
  const [, setTick] = useState(0);
  const stepStartTimes = useRef(new Map<string, number>());
  const isRunning = !events.some((e) => e.type === "run:complete" || e.type === "run:error");

  // Screenshot lightbox state
  const [lightboxFile, setLightboxFile] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Extract results + screenshots from the run:results event
  const { completedResults, screenshotsByFile } = useMemo(() => {
    const resultsEvent = events.find((e) => e.type === "run:results") as any;
    const testResults: Array<{ file: string; status: string }> = resultsEvent?.results ?? [];
    const allScreenshots: string[] = resultsEvent?.screenshots ?? [];

    const grouped = new Map<string, string[]>();
    for (const s of allScreenshots) {
      const parts = s.replace(/\\/g, "/").split("/");
      const specIdx = parts.findIndex((p: string) => p.endsWith(".cy.ts") || p.endsWith(".cy.js"));
      const key = specIdx >= 0 ? parts[specIdx] : (parts[parts.length - 2] ?? "misc");
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(s);
    }
    return { completedResults: testResults, screenshotsByFile: grouped };
  }, [events]);

  const lightboxScreenshots = lightboxFile ? (screenshotsByFile.get(lightboxFile) ?? []) : [];

  // Update step start times from events
  useEffect(() => {
    for (const event of events) {
      if (event.type === "step:start" && event.step) {
        stepStartTimes.current.set(event.step, event.timestamp);
      }
      if ((event.type === "step:complete" || event.type === "step:error") && event.step) {
        stepStartTimes.current.delete(event.step);
      }
    }
  }, [events]);

  // Tick every second to update elapsed times for active steps
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Detect if fix events are present
  const hasFixEvents = useMemo(
    () => events.some((e) =>
      e.type === "fix:start" || e.type === "fix:analyzing" ||
      e.type === "fix:applied" || e.type === "fix:complete" ||
      e.type === "fix:error" || e.type === "fix:manual-required" ||
      e.type === "supervisor:analyzing" || e.type === "supervisor:requesting-fix"
    ),
    [events]
  );

  // Detect if generation events are present
  const hasGenerationEvents = useMemo(
    () => events.some((e) =>
      e.type === "generator:progress" || e.type === "gen:complete" ||
      e.type === "generator:fixing" || e.type === "generator:fixed" ||
      (e.type === "step:start" && e.step === "generate")
    ),
    [events]
  );

  // Build pipeline steps dynamically
  const PIPELINE_STEPS = useMemo(() => {
    // FT Builder (compact) skips Clone — repo is already cloned during workspace setup
    const steps = compact
      ? BASE_STEPS.filter((s) => s.key !== "clone")
      : [...BASE_STEPS];

    // Insert "Generate" step after "Start Server" if generation events detected
    if (hasGenerationEvents) {
      const serverIdx = steps.findIndex((s) => s.key === "start-server");
      if (serverIdx >= 0) steps.splice(serverIdx + 1, 0, GENERATE_STEP);
      else steps.unshift(GENERATE_STEP);
    }

    if (hasFixEvents) {
      steps.push(...FIX_STEPS);
    }

    steps.push(FINAL_STEP);
    return steps;
  }, [hasFixEvents, hasGenerationEvents, compact]);

  // Determine step statuses from events
  const stepStatuses = new Map<string, "wait" | "process" | "finish" | "error">();
  const stepDurations = new Map<string, number>();
  const stepMessages = new Map<string, string>();

  let inFixPhase = false;

  for (const event of events) {
    if (event.type === "step:start" && event.step) {
      // During fix phase, "run-tests" restarts mean the re-run step, not the original
      if (inFixPhase && event.step === "run-tests") {
        stepStatuses.set("fix-rerun", "process");
        stepMessages.set("fix-rerun", "Re-running tests...");
      } else {
        stepStatuses.set(event.step, "process");
      }
    }
    if (event.type === "step:complete" && event.step) {
      if (inFixPhase && event.step === "run-tests") {
        stepStatuses.set("fix-rerun", "finish");
        if (event.duration) stepDurations.set("fix-rerun", event.duration);
      } else {
        stepStatuses.set(event.step, "finish");
        if (event.duration) stepDurations.set(event.step, event.duration);
      }
    }
    if (event.type === "step:error" && event.step) {
      if (inFixPhase && event.step === "run-tests") {
        stepStatuses.set("fix-rerun", "error");
      } else {
        stepStatuses.set(event.step, "error");
      }
    }

    // Map fix events to fix step statuses
    if (event.type === "fix:start") {
      inFixPhase = true;
      stepStatuses.set("fix-analyze", "process");
      stepMessages.set("fix-analyze", event.message || "Analyzing failures...");
    }
    if (event.type === "fix:analyzing") {
      stepStatuses.set("fix-analyze", "process");
      stepMessages.set("fix-analyze", event.message || "AI analyzing...");
    }
    if (event.type === "fix:applied") {
      stepStatuses.set("fix-analyze", "finish");
      stepStatuses.set("fix-apply", "finish");
      stepStatuses.set("fix-rerun", "process");
      stepMessages.set("fix-apply", event.message || "Fix applied");
      stepMessages.set("fix-rerun", "Re-running tests...");
    }
    if (event.type === "fix:complete") {
      stepStatuses.set("fix-analyze", "finish");
      stepStatuses.set("fix-apply", "finish");
      stepStatuses.set("fix-rerun", "finish");
      stepMessages.set("fix-rerun", event.message || "Re-run complete");
    }
    if (event.type === "fix:error") {
      const currentFixStep = !stepStatuses.has("fix-apply") ? "fix-analyze" :
                             !stepStatuses.has("fix-rerun") ? "fix-apply" : "fix-rerun";
      stepStatuses.set(currentFixStep, "error");
      stepMessages.set(currentFixStep, event.message || "Fix failed");
    }
    if (event.type === "fix:user-confirm") {
      stepStatuses.set("fix-analyze", "process");
      stepMessages.set("fix-analyze", "Waiting for your confirmation...");
    }
    if (event.type === "fix:manual-required") {
      if (!stepStatuses.has("fix-analyze") || stepStatuses.get("fix-analyze") === "process") {
        stepStatuses.set("fix-analyze", "finish");
      }
      stepMessages.set("fix-analyze", event.message || "Manual fix required");
    }

    // Map supervisor events to fix step statuses
    if (event.type === "supervisor:analyzing") {
      stepStatuses.set("fix-analyze", "process");
      stepMessages.set("fix-analyze", event.message || "Supervisor analyzing failures...");
    }
    if (event.type === "supervisor:requesting-fix") {
      stepStatuses.set("fix-analyze", "process");
      stepMessages.set("fix-analyze", event.message || `Requesting fix for: ${event.file || "test"}`);
    }
    if (event.type === "supervisor:summary") {
      stepMessages.set("run-tests", event.message || `Passed: ${event.passed || 0} | Failed: ${event.failed || 0}`);
    }

    // Map generator events
    if (event.type === "generator:progress") {
      stepStatuses.set("generate", "process");
      stepMessages.set("generate", event.message || "Generating tests...");
    }
    if (event.type === "generator:fixing") {
      stepStatuses.set("fix-analyze", "finish");
      stepStatuses.set("fix-apply", "process");
      stepMessages.set("fix-apply", event.message || `Fixing: ${event.file || "test"}`);
    }
    if (event.type === "generator:fixed") {
      stepStatuses.set("fix-apply", "finish");
      stepMessages.set("fix-apply", event.message || "Fix generated");
    }
    if (event.type === "gen:complete") {
      stepStatuses.set("generate", "finish");
    }

    // Map agent events
    if (event.type === "agent:start") {
      stepStatuses.set("run-tests", "process");
      stepMessages.set("run-tests", event.message || `Agent: ${event.file || "running"}`);
    }
    if (event.type === "agent:test-running") {
      stepMessages.set("run-tests", event.message || "Cypress running...");
    }
    if (event.type === "agent:compliance") {
      stepMessages.set("run-tests", event.message || `Compliance: ${event.complianceScore || 0}%`);
    }
    if (event.type === "agent:fixing") {
      stepStatuses.set("fix-analyze", "process");
      stepMessages.set("fix-analyze", event.message || "Agent fixing...");
    }
    if (event.type === "agent:retry") {
      stepMessages.set("run-tests", event.message || `Retry #${event.retryCount || 0}`);
    }
    if (event.type === "agent:summary") {
      stepMessages.set("run-tests", event.message || `P: ${event.passed || 0} F: ${event.failed || 0}`);
    }
  }

  const isComplete = events.some((e) => e.type === "run:complete");
  const isError = !!error || events.some((e) => e.type === "run:error");
  const errorMsg = error || events.find((e) => e.type === "run:error")?.error;

  // If there's an error, mark the last in-progress step as error
  if (isError) {
    for (const step of PIPELINE_STEPS) {
      if (stepStatuses.get(step.key) === "process") {
        stepStatuses.set(step.key, "error");
      }
    }
  }

  // Calculate current step index
  let currentStep = 0;
  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    const status = stepStatuses.get(PIPELINE_STEPS[i].key);
    if (status === "process" || status === "error") currentStep = i;
    if (status === "finish") currentStep = i + 1;
  }

  // Get log messages — show more for generation/fix flows
  const maxLogs = isError ? 20 : hasFixEvents || hasGenerationEvents ? 15 : 10;
  const logs = events
    .filter((e) =>
      (e.type === "log" && e.message) ||
      (e.type === "generator:progress" && e.message) ||
      (e.type === "supervisor:summary" && e.message) ||
      (e.type === "supervisor:failure" && e.message) ||
      (e.type === "agent:start" && e.message) ||
      (e.type === "agent:done" && e.message)
    )
    .slice(-maxLogs)
    .map((e) => e.message!);

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isError ? (isDark ? "#991b1b" : "#fecaca") : isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  if (!runId) return null;

  // Determine overall status tag
  let statusTag = { color: "processing" as string, text: "Running" };
  if (isComplete && !isError) {
    statusTag = { color: "success", text: "Completed" };
  } else if (isError) {
    statusTag = { color: "error", text: "Failed" };
  } else if (hasGenerationEvents && stepStatuses.get("generate") === "process") {
    statusTag = { color: "cyan", text: "Generating" };
  } else if (hasFixEvents) {
    const fixAnalyzeStatus = stepStatuses.get("fix-analyze");
    const fixApplyStatus = stepStatuses.get("fix-apply");
    const fixRerunStatus = stepStatuses.get("fix-rerun");
    if (fixRerunStatus === "process") {
      statusTag = { color: "warning", text: "Re-running (Fix)" };
    } else if (fixApplyStatus === "process" || fixApplyStatus === "finish") {
      statusTag = { color: "warning", text: "Applying Fix" };
    } else if (fixAnalyzeStatus === "process") {
      statusTag = { color: "warning", text: "Auto-Fixing" };
    }
  }

  return (
    <Card
      title={
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Space>
            {isComplete && !isError ? (
              <CheckCircleOutlined style={{ color: "#059669" }} />
            ) : isError ? (
              <CloseCircleOutlined style={{ color: "#dc2626" }} />
            ) : hasFixEvents ? (
              <ThunderboltOutlined style={{ color: "#d97706" }} />
            ) : hasGenerationEvents && stepStatuses.get("generate") === "process" ? (
              <CodeOutlined style={{ color: "#06b6d4" }} />
            ) : (
              <LoadingOutlined style={{ color: "#2563eb" }} />
            )}
            <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
              Run Progress
            </Text>
            <Tag color={statusTag.color} style={{ borderRadius: 4 }}>
              {statusTag.text}
            </Tag>
          </Space>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {runId}
          </Text>
        </Space>
      }
      style={cardStyle}
      styles={{ body: { padding: "16px 20px" } }}
    >
      <Steps
        current={currentStep}
        status={isError ? "error" : undefined}
        size="small"
        items={PIPELINE_STEPS.map((step) => {
          const status = stepStatuses.get(step.key);
          const duration = stepDurations.get(step.key);
          const msg = stepMessages.get(step.key);

          // Determine description: show elapsed time for active steps, duration for completed
          let description: string | undefined;
          if (status === "process" && stepStartTimes.current.has(step.key)) {
            const elapsed = (Date.now() - stepStartTimes.current.get(step.key)!) / 1000;
            description = `${elapsed.toFixed(0)}s...`;
          } else if (duration) {
            description = `${(duration / 1000).toFixed(1)}s`;
          } else if (msg && status !== "process") {
            description = msg.length > 40 ? msg.slice(0, 40) + "..." : msg;
          }

          // For process status, show the message as a subtitle
          let title = step.title;
          if (status === "process" && msg) {
            title = `${step.title}`;
          }

          return {
            title,
            icon: status === "process" ? <LoadingOutlined /> : step.icon,
            status: status || "wait",
            description,
          };
        })}
        style={{ marginBottom: 16 }}
      />

      {/* Error message (hidden in compact mode) */}
      {!compact && isError && errorMsg && (
        <div
          style={{
            marginBottom: 12,
            padding: "12px 16px",
            background: isDark ? "#450a0a" : "#fef2f2",
            border: `1px solid ${isDark ? "#991b1b" : "#fca5a5"}`,
            borderRadius: 8,
          }}
        >
          <Text strong style={{ color: "#dc2626", fontSize: 13, display: "block", marginBottom: 4 }}>
            Error
          </Text>
          <Text
            style={{
              color: isDark ? "#fca5a5" : "#991b1b",
              fontSize: 12,
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {errorMsg}
          </Text>
        </div>
      )}

      {/* Log output (hidden in compact mode) */}
      {!compact && logs.length > 0 && (
        <div
          style={{
            padding: "10px 14px",
            background: "#0d1117",
            borderRadius: 6,
            maxHeight: isError ? 250 : hasFixEvents || hasGenerationEvents ? 200 : 150,
            overflowY: "auto",
            fontFamily: "'Menlo', 'Monaco', 'Consolas', monospace",
            fontSize: 11,
            border: "1px solid #30363d",
          }}
        >
          {logs.map((log, i) => (
            <div
              key={i}
              style={{
                color: log.includes("[server:err]") || log.includes("[fix:error]")
                  ? "#f87171"
                  : log.includes("[fix]") || log.includes("[fixer]")
                  ? "#fbbf24"
                  : log.includes("[router]")
                  ? "#60a5fa"
                  : log.includes("[Supervisor]") || log.includes("supervisor")
                  ? "#c084fc"
                  : log.includes("[Generator]") || log.includes("generator")
                  ? "#22d3ee"
                  : "#e5e7eb",
                lineHeight: 1.6,
              }}
            >
              {log}
            </div>
          ))}
        </div>
      )}

      {/* Per-file results with screenshot eye icons — shown after run completes */}
      {!compact && isComplete && completedResults.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {completedResults.map((result, i) => {
            const shortName = result.file.split("/").pop() ?? result.file;
            const fileKey = completedResults
              .find((r) => r.file === result.file)
              ?.file.split("/").pop() ?? shortName;
            // Match screenshot group by spec filename
            const specKey = Array.from(screenshotsByFile.keys()).find((k) =>
              result.file.includes(k) || k.includes(fileKey)
            );
            const hasShots = !!specKey;
            const passed = result.status === "passed";

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  borderBottom: i < completedResults.length - 1
                    ? `1px solid ${isDark ? "#1f2937" : "#f3f4f6"}`
                    : undefined,
                }}
              >
                <CheckOutlined
                  style={{
                    fontSize: 11,
                    color: passed ? "#10b981" : "#f87171",
                    transform: passed ? undefined : "rotate(45deg)",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: isDark ? "#d1d5db" : "#374151",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {shortName}
                </span>
                {hasShots && (
                  <Tooltip title="View screenshots">
                    <Button
                      type="text"
                      size="small"
                      icon={<EyeOutlined />}
                      style={{ color: isDark ? "#60a5fa" : "#2563eb", padding: "0 4px" }}
                      onClick={() => {
                        setLightboxFile(specKey!);
                        setLightboxIndex(0);
                      }}
                    />
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Screenshot lightbox modal */}
      <Modal
        open={!!lightboxFile}
        onCancel={() => setLightboxFile(null)}
        footer={null}
        centered
        width={900}
        styles={{ body: { padding: 0, background: "#0d1117" } }}
        style={{ top: 20 }}
      >
        {lightboxFile && lightboxScreenshots.length > 0 && (
          <div style={{ background: "#0d1117", borderRadius: 8, overflow: "hidden" }}>
            {/* Header */}
            <div
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid #30363d",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ color: "#e5e7eb", fontSize: 12, fontFamily: "monospace" }}>
                {lightboxFile}
              </span>
              <span style={{ color: "#6b7280", fontSize: 11 }}>
                {lightboxIndex + 1} / {lightboxScreenshots.length}
              </span>
            </div>

            {/* Image area */}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 480,
                padding: "16px 60px",
              }}
            >
              {/* Prev arrow */}
              <Button
                type="text"
                icon={<LeftOutlined />}
                disabled={lightboxIndex === 0}
                onClick={() => setLightboxIndex((i) => i - 1)}
                style={{
                  position: "absolute",
                  left: 8,
                  color: lightboxIndex === 0 ? "#374151" : "#e5e7eb",
                  fontSize: 18,
                  height: 48,
                  width: 48,
                }}
              />

              {/* Screenshot */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/ft-runner/artifacts?runId=${encodeURIComponent(runId ?? "")}&filePath=${encodeURIComponent(lightboxScreenshots[lightboxIndex])}`}
                alt={lightboxScreenshots[lightboxIndex].split("/").pop()}
                style={{
                  maxWidth: "100%",
                  maxHeight: 520,
                  objectFit: "contain",
                  borderRadius: 4,
                  display: "block",
                }}
              />

              {/* Next arrow */}
              <Button
                type="text"
                icon={<RightOutlined />}
                disabled={lightboxIndex === lightboxScreenshots.length - 1}
                onClick={() => setLightboxIndex((i) => i + 1)}
                style={{
                  position: "absolute",
                  right: 8,
                  color: lightboxIndex === lightboxScreenshots.length - 1 ? "#374151" : "#e5e7eb",
                  fontSize: 18,
                  height: 48,
                  width: 48,
                }}
              />
            </div>

            {/* Filename strip */}
            <div
              style={{
                padding: "8px 16px",
                borderTop: "1px solid #30363d",
                color: "#6b7280",
                fontSize: 11,
                fontFamily: "monospace",
                textAlign: "center",
              }}
            >
              {lightboxScreenshots[lightboxIndex].split("/").pop()}
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
