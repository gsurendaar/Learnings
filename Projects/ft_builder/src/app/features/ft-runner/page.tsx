"use client";

import React, { useState, useCallback } from "react";
import { Row, Col, Space, Collapse, Tag, Typography, App, Modal, Button, Alert, Radio, Input } from "antd";
import {
  GithubOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  ToolOutlined,
  HistoryOutlined,
  WarningOutlined,
  LoadingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { TreeDataNode } from "antd";
import { useInitialization } from "@/components/InitializationContext";
import { useUser } from "@/components/UserContext";
import { useSSE } from "@/hooks/useSSE";
import RepoSelector from "./components/RepoSelector";
import FolderPickerModal from "./components/FolderPickerModal";
import TestTreeSelector from "./components/TestTreeSelector";
import RunConfigPanel from "./components/RunConfigPanel";
import RunProgress from "./components/RunProgress";
import RunResults from "./components/RunResults";
import RunHistory from "./components/RunHistory";
import FixEditor from "./components/FixEditor";
import { useTheme } from "@/components/ThemeProvider";

const { Text } = Typography;

interface TestResultItem {
  file: string;
  testName: string;
  status: "passed" | "failed" | "pending" | "skipped";
  duration: number;
  error?: string;
  attempts?: number;
  retryAttempts?: Array<{
    attempt: number;
    status: "passed" | "failed" | "pending" | "skipped";
    error?: string;
    duration: number;
  }>;
}

export default function FTRunnerPage() {
  const { credentials } = useInitialization();
  const { userInfo } = useUser();
  const { currentTheme } = useTheme();
  const { message } = App.useApp();
  const isDark = currentTheme === "dark";

  // Credentials from unified context (set via root-level gate)
  const githubToken = credentials?.githubToken || "";
  const llmKey = credentials?.llmApiKey || "";

  // Accordion state
  const [activeKey, setActiveKey] = useState<string | string[]>("repo");

  // Repo + Branch state — pre-fill from app context if available
  const [owner, setOwner] = useState(credentials?.repoOwner || "");
  const [repo, setRepo] = useState(credentials?.repoName || "");
  const [branch, setBranch] = useState(credentials?.repoBranch || "");

  // Tree state
  const [treeData, setTreeData] = useState<TreeDataNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [totalTests, setTotalTests] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [basePath, setBasePath] = useState("");

  // Config state
  const [browser, setBrowser] = useState("electron");
  const [retries, setRetries] = useState(1);
  const [runMode, setRunMode] = useState<"headless" | "headed">("headless");
  const [workerCount, setWorkerCount] = useState(1);
  const [fixMode, setFixMode] = useState<"execute-only" | "auto-fix" | "manual-fix">("execute-only");
  const [maxFixAttempts, setMaxFixAttempts] = useState(10);
  const [maxComplianceFixes, setMaxComplianceFixes] = useState(2);

  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Source mode: remote (GitHub) or local (filesystem folder)
  const [sourceMode, setSourceMode] = useState<"remote" | "local">("remote");
  const [localPath, setLocalPath] = useState("");
  const [localBranch, setLocalBranch] = useState("");
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [localBranchLoading, setLocalBranchLoading] = useState(false);
  const [workspaceWarning, setWorkspaceWarning] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  // Reset worker count to 1 when switching to fix modes
  React.useEffect(() => {
    if (fixMode !== "execute-only") {
      setWorkerCount(1);
    }
  }, [fixMode]);

  // Fix editor state
  const [showFixEditor, setShowFixEditor] = useState(false);
  const [fixEditorData, setFixEditorData] = useState<{
    filePath: string;
    content: string;
    error: string;
    diagnostic: string;
    workDir: string;
    spec: string;
  } | null>(null);

  // User confirmation state (for LLM classification override)
  const [confirmationData, setConfirmationData] = useState<{
    message: string;
    spec: string;
    error: string;
    runId: string;
  } | null>(null);

  // Manual fix info (saved from SSE event, used by "Fix" button in RunResults)
  const [manualFixInfo, setManualFixInfo] = useState<{
    workDir: string;
    spec: string;
    error: string;
    diagnostic: string;
  } | null>(null);

  // Screenshots from run results
  const [resultScreenshots, setResultScreenshots] = useState<string[]>([]);

  // Helper to open the fix editor
  const openFixEditor = (workDir: string, spec: string, errorMsg: string, diagnostic: string) => {
    fetch(`/api/ft-runner/file?workDir=${encodeURIComponent(workDir)}&filePath=${encodeURIComponent(spec)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setFixEditorData({
            filePath: spec,
            content: data.content,
            error: errorMsg,
            diagnostic,
            workDir,
            spec,
          });
          setShowFixEditor(true);
          setIsRunning(false);
          setActiveKey("fix");
        } else {
          console.error("[ft-runner] Failed to load file:", data.message);
          message.error(`Failed to load file: ${data.message}`);
        }
      })
      .catch((err) => {
        console.error("[ft-runner] Failed to fetch file:", err);
        message.error("Failed to load test file for editor");
      });
  };

  // Track the workDir from the last run (for manual fix)
  const [lastWorkDir, setLastWorkDir] = useState("");

  // Run state
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const [runTotal, setRunTotal] = useState(0);

  // Results state
  const [showResults, setShowResults] = useState(false);
  const [resultConclusion, setResultConclusion] = useState<"success" | "failure" | null>(null);
  const [resultTotal, setResultTotal] = useState(0);
  const [resultPassed, setResultPassed] = useState(0);
  const [resultFailed, setResultFailed] = useState(0);
  const [resultDuration, setResultDuration] = useState(0);
  const [testResults, setTestResults] = useState<TestResultItem[]>([]);

  const handleTokenSaved = (_token: string) => {
    // Token is now managed by InitializationContext - no-op for backward compat
  };

  // SSE connection
  const sseUrl = runId ? `/api/ft-runner/stream?runId=${runId}` : null;
  const { events, status: sseStatus, lastEvent } = useSSE(sseUrl);

  const specsExecuted = events.filter((e: any) =>
    e.type === "spec" && (e.status === "passed" || e.status === "failed" || e.status === "skipped")
  ).length;

  // Process SSE events
  React.useEffect(() => {
    if (!lastEvent) return;

    const event = lastEvent;

    switch (event.type) {
      case "step:start": {
        setCurrentStep(event.step || "");
        // 5 steps, 20% each: clone(0-20), install(20-40), start-server(40-60), run-tests(60-80), collect-results(80-100)
        const stepStartProgress: Record<string, number> = {
          clone: 0,
          install: 20,
          "start-server": 40,
          "run-tests": 60,
          "collect-results": 80,
        };
        if (event.step && event.step in stepStartProgress) {
          setRunProgress(stepStartProgress[event.step]);
        }
        break;
      }

      case "step:complete": {
        const stepCompleteProgress: Record<string, number> = {
          clone: 20,
          install: 40,
          "start-server": 60,
          "run-tests": 80,
          "collect-results": 100,
        };
        if (event.step && stepCompleteProgress[event.step]) {
          setRunProgress(stepCompleteProgress[event.step]);
        }
        break;
      }

      case "fix:start":
        setCurrentStep(event.message || "Running auto-fix...");
        setRunProgress(82);
        break;

      case "fix:analyzing":
        setCurrentStep(event.message || "AI analyzing failure...");
        setRunProgress(85);
        break;

      case "fix:applied":
        setCurrentStep(event.message || "Fix applied, re-running...");
        setRunProgress(88);
        break;

      case "fix:complete":
        setCurrentStep(event.message || "Fix complete, checking results...");
        setRunProgress(92);
        break;

      case "fix:error":
        setCurrentStep(event.message || "Fix error");
        break;

      case "fix:user-confirm": {
        const confirmEvt = event as any;
        setConfirmationData({
          message: confirmEvt.message || "LLM classified this as an app-logic issue.",
          spec: confirmEvt.spec || "",
          error: confirmEvt.error || "",
          runId: confirmEvt.runId || runId || "",
        });
        setCurrentStep("Waiting for your confirmation...");
        break;
      }

      case "fix:manual-required": {
        const evt = event as any;
        const evtWorkDir = evt.workDir || "";
        const evtFailedSpecs = evt.failedSpecs || [];
        const evtFailedDetails = evt.failedDetails || [];

        console.log("[ft-runner] fix:manual-required received", { evtWorkDir, evtFailedSpecs, evtFailedDetails });

        // Store the data for the editor — will open via button or automatically
        const firstSpec = evtFailedSpecs[0] || "";
        const firstDetail = evtFailedDetails[0] || {};
        const errorMsg = firstDetail.error || event.message || "Test failed";

        // Save workDir and spec info for the "Fix" button in RunResults
        setManualFixInfo({ workDir: evtWorkDir, spec: firstSpec, error: errorMsg, diagnostic: event.message || "" });
        if (evtWorkDir) setLastWorkDir(evtWorkDir);

        if (evtWorkDir && firstSpec) {
          openFixEditor(evtWorkDir, firstSpec, errorMsg, event.message || "Manual fix required");
        }
        break;
      }

      case "run:results": {
        const resEvt = event as any;
        console.log("[ft-runner] run:results received, workDir:", resEvt.workDir, "fixMode:", fixMode);
        setShowResults(true);
        setIsRunning(false);
        setRunProgress(100);
        setResultConclusion(event.conclusion === "success" ? "success" : "failure");
        setResultTotal(event.total || 0);
        setResultPassed(event.passed || 0);
        setResultFailed(event.failed || 0);
        setResultDuration(event.duration || 0);
        if (resEvt.results) {
          setTestResults(resEvt.results);
        }
        // Capture screenshots
        if (resEvt.screenshots) {
          setResultScreenshots(resEvt.screenshots);
        }
        // Capture workDir for manual fix editor
        if (resEvt.workDir) {
          setLastWorkDir(resEvt.workDir);
        }
        break;
      }

      case "run:complete":
        setIsRunning(false);
        setRunProgress(100);
        // If we haven't received results yet, fetch them
        if (!showResults && runId) {
          fetchResults(runId);
        }
        setTimeout(() => setHistoryRefreshKey((k) => k + 1), 800);
        break;

      case "run:error":
        setIsRunning(false);
        setCurrentStep("");
        setRunError(event.error || "Run failed");
        setTimeout(() => setHistoryRefreshKey((k) => k + 1), 800);
        break;
    }
  }, [lastEvent]);

  // Fetch the cypress/e2e tree — remote (GitHub API) or local (filesystem scan).
  // localPathOverride: pass path directly to avoid stale closure on fresh folder selection.
  // autoAdvance: when true (default), switches accordion to Tests on success.
  //              set false to preload files in background without moving the user.
  const fetchTree = useCallback(
    async (treeOwner: string, treeRepo: string, treeBranch: string, localPathOverride?: string, autoAdvance = true) => {
      setTreeLoading(true);
      setSelectedKeys([]);
      setTreeData([]);
      setShowResults(false);

      try {
        if (sourceMode === "local") {
          const effectivePath = localPathOverride || localPath;
          if (!effectivePath) { setTreeLoading(false); return; }
          const res = await fetch("/api/ft-runner/local-tree", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ localPath: effectivePath }),
          });
          const data = await res.json();
          if (data.success) {
            setTreeData(data.tree);
            setTotalTests(data.totalTests);
            setBasePath(data.basePath);
            if (autoAdvance) setActiveKey("tests");
          } else {
            message.error(data.message || "Failed to scan local folder");
          }
        } else {
          if (!treeOwner || !treeRepo || !treeBranch) { setTreeLoading(false); return; }
          const res = await fetch("/api/ft-runner/tree", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner: treeOwner, repo: treeRepo, branch: treeBranch, githubToken }),
          });
          const data = await res.json();
          if (data.success) {
            setTreeData(data.tree);
            setTotalTests(data.totalTests);
            setBasePath(data.basePath);
            if (autoAdvance) setActiveKey("tests");
          } else {
            message.error(data.message || "Failed to load test tree");
          }
        }
      } catch (err: any) {
        message.error(err?.message || "Failed to load test tree");
      } finally {
        setTreeLoading(false);
      }
    },
    [githubToken, sourceMode, localPath]
  );

  // Fetch git branches from a local repo path.
  // If not a git repo, auto-scans tests directly (no branch selection needed).
  const fetchLocalBranches = useCallback(async (path: string) => {
    setLocalBranchLoading(true);
    setLocalBranches([]);
    setLocalBranch("");
    try {
      const res = await fetch(`/api/ft-runner/local-branches?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.success) {
        setLocalBranches(data.branches);
        setLocalBranch(data.currentBranch);
        // Preload test files for the current branch in the background.
        // autoAdvance=false keeps the accordion on Source so the user can
        // review/change the branch; files will be ready when they navigate over.
        fetchTree("", "", "", path, false);
      } else {
        console.warn("[ft-runner] Branch detection:", data.message);
        // Not a git repo — skip branch selection and scan tests directly
        fetchTree("", "", "", path);
      }
    } catch (err: any) {
      console.error("[ft-runner] fetchLocalBranches error:", err);
      fetchTree("", "", "", path);
    } finally {
      setLocalBranchLoading(false);
    }
  }, [fetchTree]);

  // Switch local branch then re-scan
  const handleLocalBranchChange = async (selectedBranch: string) => {
    setLocalBranchLoading(true);
    try {
      const res = await fetch("/api/ft-runner/local-branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: localPath, branch: selectedBranch }),
      });
      const data = await res.json();
      if (data.success) {
        setLocalBranch(selectedBranch);
        if (data.warning) setWorkspaceWarning(data.warning);
        fetchTree("", "", "");
      } else {
        message.error(data.message || "Branch checkout failed");
      }
    } catch (err: any) {
      message.error(err?.message || "Branch checkout failed");
    } finally {
      setLocalBranchLoading(false);
    }
  };

  const handleRepoSelected = (newOwner: string, newRepo: string) => {
    setOwner(newOwner);
    setRepo(newRepo);
  };

  const handleBranchSelected = useCallback(
    (selectedBranch: string) => {
      setBranch(selectedBranch);
    },
    []
  );

  // Remote: fetch tree when owner + repo + branch are all set
  React.useEffect(() => {
    if (sourceMode === "remote" && owner && repo && branch) {
      fetchTree(owner, repo, branch);
    }
  }, [owner, repo, branch, sourceMode, fetchTree]);

  // Clear tree and local branch state when switching source mode
  React.useEffect(() => {
    setTreeData([]);
    setSelectedKeys([]);
    setTotalTests(0);
    setLocalBranches([]);
    setLocalBranch("");
  }, [sourceMode]);

  // Start a test run
  const handleRun = async (filesToRun?: string[]) => {
    const selectedFiles = Array.isArray(filesToRun)
      ? filesToRun
      : (selectedKeys.filter(
          (key) =>
            typeof key === "string" &&
            (key.endsWith(".cy.ts") || key.endsWith(".cy.js"))
        ) as string[]);

    if (selectedFiles.length === 0) {
      message.warning("Select at least one test file");
      return;
    }

    if (sourceMode === "local" && !localPath) {
      message.warning("Enter a local project folder path before running");
      return;
    }

    setRunId(null);
    setIsRunning(true);
    setRunProgress(0);
    setCurrentStep("Preparing...");
    setShowResults(false);
    setTestResults([]);
    setShowFixEditor(false);
    setFixEditorData(null);
    setResultScreenshots([]);
    setRunError(null);
    setWorkspaceWarning(null);
    setActiveKey("progress");
    setRunTotal(selectedFiles.length);

    // Pre-run cleanup: clear stale servers, screenshots and old artifacts for this user.
    // Fire-and-forget — a cleanup failure must never block the test run.
    const runUserId = userInfo?.userid || userInfo?.name;
    if (runUserId) {
      fetch("/api/ft-runner/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: runUserId }),
      }).catch(() => { /* non-fatal */ });
    }

    try {
      let workDir: string | undefined;

      if (sourceMode === "remote") {
        // Set up per-user workspace before starting the run
        const userId = userInfo?.userid || userInfo?.name;
        setCurrentStep("Setting up workspace...");
        const ensureRes = await fetch("/api/ft-runner/ensure-repo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            githubToken,
            userName: userInfo?.name,
            owner,
            repo,
            branch,
            source: "FTRunner",
          }),
        });
        const ensureData = await ensureRes.json();
        if (!ensureData.success) {
          setIsRunning(false);
          setCurrentStep("");
          message.error(ensureData.error || "Failed to set up workspace");
          return;
        }
        if (ensureData.warning) {
          setWorkspaceWarning(ensureData.warning);
        }
        workDir = ensureData.repoPath;
      } else {
        // Local mode — use the provided path directly, no cloning
        workDir = localPath;
      }

      setCurrentStep("Starting test run...");
      console.log("[ft-runner] Triggering run:", { sourceMode, fixMode, llmKeyPresent: !!llmKey });

      const res = await fetch("/api/ft-runner/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: sourceMode === "remote" ? owner : "local",
          repo: sourceMode === "remote" ? repo : (localPath.split("/").pop() || "local"),
          branch: sourceMode === "remote" ? branch : (localBranch || "local"),
          testFiles: selectedFiles,
          specPattern: selectedFiles.map((f) => `${basePath}${f}`).join(","),
          browser,
          retries,
          runMode,
          workerCount,
          githubToken,
          triggeredBy: userInfo?.userid || userInfo?.name || "ui-user",
          skipSetup: true,
          existingWorkDir: workDir,
          fixMode,
          maxFixAttempts: fixMode === "auto-fix" ? maxFixAttempts : undefined,
          maxComplianceFixes: fixMode === "auto-fix" ? maxComplianceFixes : undefined,
          keepServerAlive: false,
          llmApiKey: llmKey,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setRunId(data.runId);
        message.success("Test run started");
      } else {
        setIsRunning(false);
        message.error(data.message || "Failed to start run");
      }
    } catch (err: any) {
      setIsRunning(false);
      message.error(err?.message || "Failed to start run");
    }
  };

  const handleStop = async () => {
    if (runId) {
      try {
        await fetch("/api/ft-runner/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId }),
        });
      } catch { /* best effort */ }
    }
    setIsRunning(false);
    setCurrentStep("");
    setRunProgress(0);
    setTimeout(() => setHistoryRefreshKey((k) => k + 1), 1500);
    message.info("Run stopped and server killed");
  };

  const handleConfirmation = async (decision: "test" | "app-logic" | "skip") => {
    if (!confirmationData) return;
    try {
      await fetch("/api/ft-runner/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: confirmationData.runId, decision }),
      });
      message.info(
        decision === "test"
          ? "Overriding to test issue — re-analyzing..."
          : decision === "app-logic"
          ? "Confirmed as app issue — skipping auto-fix"
          : "Skipping auto-fix"
      );
    } catch {
      message.error("Failed to send confirmation");
    }
    setConfirmationData(null);
  };

  const fetchResults = async (id: string) => {
    try {
      const res = await fetch(`/api/ft-runner/results?runId=${id}`);
      const data = await res.json();
      if (data.success) {
        setShowResults(true);
        setResultConclusion(data.conclusion);
        setResultTotal(data.summary.total);
        setResultPassed(data.summary.passed);
        setResultFailed(data.summary.failed);
        setResultDuration(data.summary.duration);
        setTestResults(data.results);
        setResultScreenshots(data.screenshots || []);
      }
    } catch {
      // Results may not be available yet
    }
  };

  const handleRerunAll = () => {
    handleRun();
  };

  const handleRerunFailed = () => {
    const failedFiles = testResults
      .filter((r) => r.status === "failed")
      .map((r) => r.file);

    if (failedFiles.length > 0) {
      setSelectedKeys(failedFiles);
      handleRun(failedFiles);
    }
  };

  const selectedCount = selectedKeys.filter(
    (key) =>
      typeof key === "string" &&
      (key.endsWith(".cy.ts") || key.endsWith(".cy.js"))
  ).length;

  const panelStyle: React.CSSProperties = {
    marginBottom: 12,
    borderRadius: 10,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#ffffff",
    overflow: "hidden",
  };

  const accordionItems = [
    {
      key: "repo",
      label: (
        <Space>
          {sourceMode === "remote" ? <GithubOutlined /> : <FolderOpenOutlined />}
          <Text strong>Source</Text>
          {sourceMode === "remote" && owner && repo && (
            <Tag color="blue" style={{ borderRadius: 4 }}>
              {owner}/{repo}{branch ? ` @ ${branch}` : ""}
            </Tag>
          )}
          {sourceMode === "local" && localPath && (
            <Tag color="purple" style={{ borderRadius: 4 }}>
              {localPath.split("/").pop()}{localBranch ? ` @ ${localBranch}` : ""}
            </Tag>
          )}
        </Space>
      ),
      children: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {/* Source mode toggle */}
          <Radio.Group
            value={sourceMode}
            onChange={(e) => {
              setSourceMode(e.target.value);
              setOwner(""); setRepo(""); setBranch("");
              setLocalPath("");
            }}
            disabled={isRunning}
            buttonStyle="solid"
            size="middle"
          >
            <Radio.Button value="remote">
              <Space size={4}><CloudServerOutlined /> Remote (GitHub)</Space>
            </Radio.Button>
            <Radio.Button value="local">
              <Space size={4}><FolderOpenOutlined /> Local Folder</Space>
            </Radio.Button>
          </Radio.Group>

          {sourceMode === "remote" && (
            <RepoSelector
              onRepoSelected={handleRepoSelected}
              onBranchSelected={handleBranchSelected}
              selectedOwner={owner}
              selectedRepo={repo}
              selectedBranch={branch}
              githubToken={githubToken}
              onTokenSaved={handleTokenSaved}
              disabled={isRunning}
              userId={userInfo?.userid || userInfo?.name}
            />
          )}

          {sourceMode === "local" && (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Text style={{ fontSize: 12, color: isDark ? "#9ca3af" : "#6b7280" }}>
                Select or paste the absolute path to your local project folder (must have <Text code style={{ fontSize: 11 }}>cypress/e2e/</Text> inside)
              </Text>
              <Space.Compact style={{ width: "100%" }}>
                <Button
                  size="large"
                  icon={<FolderOpenOutlined />}
                  onClick={() => setFolderPickerOpen(true)}
                  disabled={isRunning}
                  style={{ flexShrink: 0 }}
                >
                  Browse
                </Button>
                <Input
                  size="large"
                  placeholder="/Users/you/projects/my-app"
                  value={localPath}
                  onChange={(e) => {
                    setLocalPath(e.target.value);
                    setLocalBranches([]);
                    setLocalBranch("");
                  }}
                  onBlur={(e) => {
                    if (e.target.value) fetchLocalBranches(e.target.value);
                  }}
                  disabled={isRunning}
                />
                <Button
                  size="large"
                  type="primary"
                  disabled={!localPath || isRunning}
                  onClick={() => fetchLocalBranches(localPath)}
                  style={{ background: "#7c3aed", border: "none" }}
                >
                  Detect
                </Button>
              </Space.Compact>

              {/* Branch selector — shown once a git repo is detected */}
              {(localBranches.length > 0 || localBranchLoading) && (
                <Space align="center">
                  <Text style={{ fontSize: 12, color: isDark ? "#9ca3af" : "#6b7280" }}>
                    Branch:
                  </Text>
                  <select
                    value={localBranch}
                    onChange={(e) => handleLocalBranchChange(e.target.value)}
                    disabled={isRunning || localBranchLoading}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: `1px solid ${isDark ? "#374151" : "#d1d5db"}`,
                      background: isDark ? "#1f2937" : "#fff",
                      color: isDark ? "#f3f4f6" : "#111827",
                      fontSize: 13,
                      cursor: localBranchLoading ? "not-allowed" : "pointer",
                    }}
                  >
                    {localBranches.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  {localBranchLoading && (
                    <Text type="secondary" style={{ fontSize: 12 }}>switching...</Text>
                  )}
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Select a branch to load its test files
                  </Text>
                </Space>
              )}
            </Space>
          )}
        </Space>
      ),
      style: panelStyle,
    },
    {
      key: "tests",
      label: (
        <Space>
          <FolderOutlined />
          <Text strong>Test Files & Configuration</Text>
          {selectedCount > 0 && (
            <Tag color="green" style={{ borderRadius: 4 }}>
              {selectedCount} selected
            </Tag>
          )}
        </Space>
      ),
      children: treeData.length > 0 || treeLoading ? (
        <Row gutter={[20, 20]}>
          <Col xs={24} lg={12}>
            <TestTreeSelector
              treeData={treeData}
              loading={treeLoading}
              totalTests={totalTests}
              onSelectionChange={setSelectedKeys}
              selectedKeys={selectedKeys}
              disabled={isRunning}
              basePath={basePath}
            />
          </Col>
          <Col xs={24} lg={12}>
            <RunConfigPanel
              browser={browser}
              onBrowserChange={setBrowser}
              retries={retries}
              onRetriesChange={setRetries}
              runMode={runMode}
              onRunModeChange={setRunMode}
              workerCount={workerCount}
              onWorkerCountChange={setWorkerCount}
              selectedCount={selectedCount}
              isRunning={isRunning}
              runProgress={runProgress}
              currentStep={currentStep}
              onRun={handleRun}
              onStop={handleStop}
              disabled={sourceMode === "remote" ? !branch : !localPath}
              fixMode={fixMode}
              onFixModeChange={setFixMode}
              maxFixAttempts={maxFixAttempts}
              onMaxFixAttemptsChange={setMaxFixAttempts}
              maxComplianceFixes={maxComplianceFixes}
              onMaxComplianceFixesChange={setMaxComplianceFixes}
            />
          </Col>
        </Row>
      ) : (
        <Text type="secondary">Select a repo and branch first to load test files.</Text>
      ),
      style: panelStyle,
    },
    {
      key: "progress",
      label: (
        <Space>
          <DashboardOutlined />
          <Text strong>Run Progress</Text>
          {isRunning && (
            <Tag color="processing" style={{ borderRadius: 4 }}>
              {runTotal > 0 ? `${specsExecuted} / ${runTotal} files` : (currentStep || "Preparing...")}
            </Tag>
          )}
          {!isRunning && showResults && resultConclusion && (
            <Tag
              color={resultConclusion === "success" ? "success" : "error"}
              style={{ borderRadius: 4 }}
            >
              {resultConclusion === "success" ? `Passed ${resultPassed}/${resultTotal}` : `Failed ${resultFailed}/${resultTotal}`}
            </Tag>
          )}
          {runError && !isRunning && (
            <Tag color="error" style={{ borderRadius: 4 }}>Error</Tag>
          )}
        </Space>
      ),
      extra: isRunning ? (
        <Button
          size="small"
          danger
          icon={<StopOutlined />}
          onClick={(e) => { e.stopPropagation(); handleStop(); }}
          style={{ borderRadius: 4 }}
        >
          Kill
        </Button>
      ) : undefined,
      children: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {runId && (isRunning || runError) && (
            <RunProgress
              events={events}
              lastEvent={lastEvent}
              sseStatus={sseStatus}
              runId={runId}
              error={runError}
            />
          )}
          {showResults && (
            <RunResults
              conclusion={resultConclusion}
              total={resultTotal}
              passed={resultPassed}
              failed={resultFailed}
              duration={resultDuration}
              results={testResults}
              screenshots={resultScreenshots}
              runId={runId || undefined}
              onRerunAll={handleRerunAll}
              onRerunFailed={handleRerunFailed}
              showFixButton={true}
              onFixFailed={async (failedTest) => {
                console.log("[ft-runner] Fix button clicked, lastWorkDir:", lastWorkDir, "failedTest:", failedTest);

                let wd = lastWorkDir || manualFixInfo?.workDir || "";

                if (!wd && sourceMode === "local" && localPath) {
                  wd = localPath;
                }

                if (!wd && sourceMode === "remote") {
                  // FTRunner repos live at repos/{userId}/{owner}/{repo}/{branch} — ask ensure-repo directly
                  try {
                    const userId = userInfo?.userid || userInfo?.name || "";
                    const params = new URLSearchParams({ userId, owner, repo, branch, source: "FTRunner" });
                    const ensureRes = await fetch(`/api/ft-runner/ensure-repo?${params}`);
                    const ensureData = await ensureRes.json();
                    if (ensureData.exists && ensureData.repoPath) {
                      wd = ensureData.repoPath;
                    }
                  } catch { /* ignore */ }
                }

                if (!wd) {
                  message.error("Workspace not found — please run the tests once first so the repo is set up.");
                  return;
                }

                setLastWorkDir(wd);

                const fileName = failedTest.file;
                const findFile = async (): Promise<boolean> => {
                  const tryPaths = [
                    `cypress/e2e/${fileName}`,
                    fileName,
                  ];
                  for (const p of tryPaths) {
                    try {
                      const res = await fetch(`/api/ft-runner/file?workDir=${encodeURIComponent(wd)}&filePath=${encodeURIComponent(p)}`);
                      const data = await res.json();
                      if (data.success) {
                        openFixEditor(wd, data.filePath, failedTest.error || "Test failed", `Fix the failing test: ${fileName}`);
                        return true;
                      }
                    } catch { /* try next */ }
                  }
                  try {
                    const res = await fetch(`/api/ft-runner/file?workDir=${encodeURIComponent(wd)}&filePath=${encodeURIComponent(fileName)}&search=true`);
                    const data = await res.json();
                    if (data.success) {
                      openFixEditor(wd, data.filePath, failedTest.error || "Test failed", `Fix the failing test: ${fileName}`);
                      return true;
                    }
                  } catch { /* ignore */ }
                  return false;
                };

                const found = await findFile();
                if (!found) {
                  message.error(`Could not find file: ${fileName} in clone directory`);
                }
              }}
              disabled={isRunning}
            />
          )}
          {/* Workspace setup / trigger phase — before runId is assigned */}
          {isRunning && !runId && (
            <div style={{ padding: "24px 0", textAlign: "center" }}>
              <Space direction="vertical" size={12} align="center">
                <LoadingOutlined spin style={{ fontSize: 28, color: isDark ? "#34d399" : "#059669" }} />
                <Text strong style={{ fontSize: 14 }}>{currentStep || "Preparing..."}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {sourceMode === "remote"
                    ? "Setting up your workspace — cloning or updating the repo branch..."
                    : "Preparing local workspace..."}
                </Text>
              </Space>
            </div>
          )}
          {!isRunning && !runId && !showResults && (
            <Text type="secondary">No run in progress. Start a test run to see progress here.</Text>
          )}
        </Space>
      ),
      style: panelStyle,
    },
    ...(showFixEditor && fixEditorData
      ? [
          {
            key: "fix",
            label: (
              <Space>
                <ToolOutlined />
                <Text strong>Manual Fix Editor</Text>
                <Tag color="warning" style={{ borderRadius: 4 }}>
                  Fix Required
                </Tag>
              </Space>
            ),
            children: (
              <FixEditor
                filePath={fixEditorData.filePath}
                fileContent={fixEditorData.content}
                errorMessage={fixEditorData.error}
                diagnosticInfo={fixEditorData.diagnostic}
                workDir={fixEditorData.workDir}
                onSaveAndRerun={() => {
                  setShowFixEditor(false);
                  setFixEditorData(null);
                  setShowResults(false);
                  message.success("Fix pushed to branch — re-running tests...");
                  setTimeout(() => handleRun(), 500);
                }}
                onCancel={() => {
                  setShowFixEditor(false);
                  setFixEditorData(null);
                }}
                disabled={isRunning}
              />
            ),
            style: panelStyle,
          },
        ]
      : []),
    {
      key: "history",
      label: (
        <Space>
          <HistoryOutlined />
          <Text strong>History</Text>
        </Space>
      ),
      children: (
        <RunHistory
          owner={sourceMode === "remote" ? owner : "local"}
          repo={sourceMode === "remote" ? repo : (localPath.split("/").pop() || "")}
          refreshKey={historyRefreshKey}
        />
      ),
      style: panelStyle,
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "12px 0" }}>
      {/* Folder picker modal for local mode */}
      <FolderPickerModal
        open={folderPickerOpen}
        onSelect={(selectedPath) => {
          setLocalPath(selectedPath);
          setFolderPickerOpen(false);
          fetchLocalBranches(selectedPath);
          // Don't scan yet — user must confirm branch first
        }}
        onCancel={() => setFolderPickerOpen(false)}
      />

      {/* User Confirmation Modal for LLM Classification */}
      <Modal
        open={!!confirmationData}
        title="Auto-Fix Classification"
        closable={false}
        footer={[
          <Button key="skip" onClick={() => handleConfirmation("skip")}>
            Skip Auto-Fix
          </Button>,
          <Button key="app" onClick={() => handleConfirmation("app-logic")}>
            It&apos;s an App Bug
          </Button>,
          <Button
            key="test"
            type="primary"
            onClick={() => handleConfirmation("test")}
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
              border: "none",
            }}
          >
            It&apos;s a Test Issue (Fix It)
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>The AI classified this failure as an app-logic bug:</Text>
        </div>
        <div
          style={{
            padding: "12px 16px",
            background: isDark ? "#1f2937" : "#f3f4f6",
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {confirmationData?.message}
        </div>
        {confirmationData?.spec && (
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              File: <Text code style={{ fontSize: 12 }}>{confirmationData.spec.split("/").pop()}</Text>
            </Text>
          </div>
        )}
        {confirmationData?.error && (
          <div
            style={{
              padding: "8px 12px",
              background: isDark ? "#450a0a" : "#fef2f2",
              borderRadius: 6,
              fontSize: 12,
              color: "#dc2626",
              fontFamily: "monospace",
            }}
          >
            {confirmationData.error.slice(0, 200)}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            If you believe the test assertion is wrong (not the app), click &quot;It&apos;s a Test Issue&quot; to re-analyze and auto-fix.
            Auto-confirms as app-logic after 2 minutes.
          </Text>
        </div>
      </Modal>

      {/* Workspace warning: fetch failed but run proceeds on existing clone */}
      {workspaceWarning && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="Workspace may be out of date"
          description={workspaceWarning}
          closable
          onClose={() => setWorkspaceWarning(null)}
          style={{ marginBottom: 12, borderRadius: 8 }}
        />
      )}

      <Collapse
        accordion
        activeKey={activeKey}
        onChange={(key) => setActiveKey(key)}
        bordered={false}
        style={{ background: "transparent" }}
        items={accordionItems}
      />
    </div>
  );
}
