"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSessionState } from "@/hooks/useSessionState";
import {
  Card,
  Input,
  Button,
  Space,
  Typography,
  Tag,
  Tooltip,
  Divider,
  Progress,
  List,
  Steps,
  Spin,
  Select,
  TreeSelect,
  Modal,
} from "antd";
import {
  FileAddOutlined,
  FolderOpenOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  FileTextOutlined,
  ApartmentOutlined,
  SearchOutlined,
  UnorderedListOutlined,
  SafetyCertificateOutlined,
  ArrowRightOutlined,
  EyeOutlined,
  EditOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import dynamic from "next/dynamic";
import { useTheme } from "@/components/ThemeProvider";
import { useInitialization } from "@/components/InitializationContext";
import { useUser } from "@/components/UserContext";
import type { FTSuggestion, ManualUseCase, ComplianceResult } from "@/types/ft";
import { CONSOLE_FOLDERS } from "@/types/ft";
import SuggestionsTable from "./SuggestionsTable";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const { Text } = Typography;

interface GeneratedFile {
  path: string;
  name: string;
  status: "success" | "warning" | "error";
  message?: string;
}

type FlowStep = "input" | "suggestions" | "generating" | "results";

interface CreateFTPanelProps {
  sessionId?: string;
  onNavigateToRun?: () => void;
  onFilesGenerated?: (
    files: Array<{ path: string; name: string; status: string }>,
    compliance?: ComplianceResult[]
  ) => void;
  onGenerationProgress?: (isGenerating: boolean, progress: number) => void;
  workspaceReady?: boolean;
}

export default function CreateFTPanel({ sessionId, onNavigateToRun, onFilesGenerated, onGenerationProgress, workspaceReady = true }: CreateFTPanelProps) {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const { credentials } = useInitialization();
  const { userInfo } = useUser();
  const userId = userInfo?.userid || userInfo?.name || "";

  // Input state (persisted across navigation)
  const [selectedFolder, setSelectedFolder] = useSessionState<string>("selectedFolder", "", sessionId);
  const [selectedSubfolder, setSelectedSubfolder] = useSessionState<string>("selectedSubfolder", "", sessionId);
  const [consoleFolders, setConsoleFolders] = useState<Array<{ name: string; description: string; componentsCount: number }>>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [subfolders, setSubfolders] = useState<string[]>([]);
  const [subfoldersLoading, setSubfoldersLoading] = useState(false);
  const [outputFolderName, setOutputFolderName] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");

  // Load console folders dynamically from user's cloned repo on mount
  React.useEffect(() => {
    const loadFolders = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch("/api/ft-runner/list-subfolders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ folder: "components/console", userId }),
        });
        clearTimeout(timeout);
        const data = await res.json();
        if (data.success && data.subfolders?.length > 0) {
          setConsoleFolders(
            data.subfolders.map((name: string) => {
              // Match with static CONSOLE_FOLDERS for description if available
              const staticInfo = CONSOLE_FOLDERS.find((f) => f.name === name);
              return {
                name,
                description: staticInfo?.description || "",
                componentsCount: staticInfo?.componentsCount || 0,
              };
            })
          );
        } else {
          // Fall back to static list
          setConsoleFolders(CONSOLE_FOLDERS.map((f) => ({ name: f.name, description: f.description, componentsCount: f.componentsCount })));
        }
      } catch {
        // Fall back to static list on error
        setConsoleFolders(CONSOLE_FOLDERS.map((f) => ({ name: f.name, description: f.description, componentsCount: f.componentsCount })));
      } finally {
        setFoldersLoading(false);
      }
    };
    loadFolders();
  }, [userId]);

  // Existing FTs for selected workflow
  const [existingFTs, setExistingFTs] = useState<Array<{ name: string; path: string }>>([]);
  const [existingFTsLoading, setExistingFTsLoading] = useState(false);

  // Load existing FTs when folder/subfolder changes
  React.useEffect(() => {
    if (!selectedFolder || !workspaceReady) {
      setExistingFTs([]);
      return;
    }
    const workflow = selectedSubfolder || selectedFolder;
    setExistingFTsLoading(true);

    // Search cypress/e2e/workflows/{workflow}/ for existing .cy.ts files
    fetch("/api/ft-runner/list-subfolders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: `cypress/e2e/workflows/${workflow}`, userId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.files?.length > 0) {
          setExistingFTs(data.files.map((f: string) => ({
            name: f,
            path: `cypress/e2e/workflows/${workflow}/${f}`,
          })));
        } else {
          setExistingFTs([]);
        }
      })
      .catch(() => setExistingFTs([]))
      .finally(() => setExistingFTsLoading(false));
  }, [selectedFolder, selectedSubfolder, workspaceReady, userId]);

  // Suggestions state (persisted across navigation)
  const [currentStep, setCurrentStep] = useSessionState<FlowStep>("currentStep", "input", sessionId);
  const [suggestions, setSuggestions] = useSessionState<FTSuggestion[]>("suggestions", [], sessionId);
  const [manualUseCases, setManualUseCases] = useState<ManualUseCase[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionsProgress, setSuggestionsProgress] = useState(0);
  const [suggestionsProgressLabel, setSuggestionsProgressLabel] = useState("");
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [suggestionsSourceFiles, setSuggestionsSourceFiles] = useState<string[]>([]);
  const [suggestionsTotalFiles, setSuggestionsTotalFiles] = useState(0);
  const [suggestionsRunId, setSuggestionsRunId] = useState<string | null>(null);
  const [automationIdCount, setAutomationIdCount] = useState<number>(0);
  const [automationCoverage, setAutomationCoverage] = useState<number>(0);
  const [interactiveElements, setInteractiveElements] = useState<number>(0);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [viewingCode, setViewingCode] = useState<{ path: string; content: string; editing: boolean } | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [saving, setSaving] = useState(false);

  const viewGeneratedCode = async (filePath: string, editing = false) => {
    const searchPaths = [
      `${userId}/sparkxnodeweb/${filePath}`,
    ];

    for (const searchPath of searchPaths) {
      try {
        const res = await fetch(`/api/ft-runner/browse-repo?path=${encodeURIComponent(searchPath)}&content=true`);
        const data = await res.json();
        if (data.success && data.content) {
          setViewingCode({ path: filePath, content: data.content, editing });
          setEditedContent(data.content);
          return;
        }
      } catch { /* try next */ }
    }

    try {
      const fileName = filePath.split("/").pop() || filePath;
      const res = await fetch(`/api/ft-runner/browse-repo?path=&search=${encodeURIComponent(fileName)}&content=true`);
      const data = await res.json();
      if (data.success && data.content) {
        setViewingCode({ path: filePath, content: data.content, editing });
        setEditedContent(data.content);
        return;
      }
    } catch { /* ignore */ }

    try {
      const fileName = filePath.split("/").pop() || filePath;
      const res = await fetch(`/api/ft-runner/artifacts?runId=latest&filePath=${encodeURIComponent(fileName)}`);
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 10) {
          setViewingCode({ path: filePath, content: text, editing });
          setEditedContent(text);
          return;
        }
      }
    } catch { /* ignore */ }
  };

  const saveEditedCode = async () => {
    if (!viewingCode) return;
    setSaving(true);
    try {
      const workDir = `repos/${userId}/sparkxnodeweb`;
      const res = await fetch("/api/ft-runner/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDir, filePath: viewingCode.path, content: editedContent }),
      });
      const data = await res.json();
      if (data.success) {
        setViewingCode({ ...viewingCode, content: editedContent, editing: false });
      }
    } catch { /* ignore */ }
    setSaving(false);
  };
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [complianceResults, setComplianceResults] = useState<ComplianceResult[]>([]);

  const folderPath = selectedSubfolder
    ? `components/console/${selectedFolder}/${selectedSubfolder}`
    : selectedFolder
    ? `components/console/${selectedFolder}`
    : "";
  // Subfolder is required when the folder has subfolders (e.g., "workflows" has 25+ subfolders)
  const subfolderRequired = subfolders.length > 0;
  const isInputValid = !!selectedFolder && workspaceReady && (!subfolderRequired || !!selectedSubfolder);

  // Restore subfolders when selectedFolder is loaded from session
  useEffect(() => {
    if (!selectedFolder || subfolders.length > 0) return;
    fetch("/api/ft-runner/list-subfolders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: `components/console/${selectedFolder}`, userId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.subfolders?.length > 0) {
          setSubfolders(data.subfolders);
        }
      })
      .catch(() => {});
  }, [selectedFolder, userId]);

  // Load subfolders when a parent folder is selected (for workflows especially)
  const handleFolderChange = async (folder: string) => {
    setSelectedFolder(folder);
    setSelectedSubfolder("");
    setSubfolders([]);
    setSubfoldersLoading(true);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
      const listRes = await fetch("/api/ft-runner/list-subfolders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ folder: `components/console/${folder}`, userId }),
      });
      clearTimeout(timeout);
      const listData = await listRes.json();
      if (listData.success && listData.subfolders?.length > 0) {
        setSubfolders(listData.subfolders);
      }
    } catch {
      // Non-critical - subfolders just won't be available
    } finally {
      setSubfoldersLoading(false);
    }
  };

  const stepsItems = [
    { title: "Select Components", icon: <ApartmentOutlined /> },
    { title: "Review Suggestions", icon: <UnorderedListOutlined /> },
    { title: "Generate Tests", icon: <ThunderboltOutlined /> },
  ];

  const currentStepIndex =
    currentStep === "input" ? 0 :
    currentStep === "suggestions" ? 1 :
    2;

  // ── Get FT Suggestions ──
  // Generate session ID and redirect when user selects a subfolder (before suggestions)
  useEffect(() => {
    if (!sessionId && selectedFolder && selectedSubfolder) {
      const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(`ftbuilder:${newId}:selectedFolder`, JSON.stringify(selectedFolder));
      localStorage.setItem(`ftbuilder:${newId}:selectedSubfolder`, JSON.stringify(selectedSubfolder));
      router.push(`/ftbuilder/${newId}`);
    }
  }, [sessionId, selectedFolder, selectedSubfolder, router]);

  const handleGetSuggestions = async () => {
    setIsLoadingSuggestions(true);
    setSuggestionsError(null);
    setSuggestionsProgress(0);
    setSuggestionsProgressLabel("Scanning source files...");

    // Progress ticks with elapsed time — AI typically takes 30-90 seconds
    const timeouts: NodeJS.Timeout[] = [];
    const startTime = Date.now();

    const progressSteps = [
      { pct: 10, label: "Scanning source files...", delay: 2000 },
      { pct: 25, label: "Reading component code...", delay: 5000 },
      { pct: 40, label: "Analyzing components with AI...", delay: 10000 },
      { pct: 55, label: "Generating test case suggestions...", delay: 20000 },
      { pct: 70, label: "Evaluating priority & coverage...", delay: 35000 },
      { pct: 80, label: "Checking existing tests...", delay: 45000 },
    ];

    for (const step of progressSteps) {
      timeouts.push(
        setTimeout(() => {
          setSuggestionsProgress(step.pct);
          setSuggestionsProgressLabel(step.label);
        }, step.delay)
      );
    }

    // After 50s, show live elapsed time so user knows it's not stuck
    timeouts.push(
      setTimeout(() => {
        const tick = setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          setSuggestionsProgressLabel(`Waiting for AI response... (${elapsed}s)`);
          setSuggestionsProgress(Math.min(85 + Math.floor(elapsed / 20), 98));
        }, 2000);
        timeouts.push(tick as unknown as NodeJS.Timeout);
      }, 50000)
    );

    try {
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min timeout

      const response = await fetch("/api/ft-runner/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          selectedFolders: selectedSubfolder
            ? [`${selectedFolder}/${selectedSubfolder}`]
            : [selectedFolder],
          manualPaths: [],
          llmApiKey: credentials?.llmApiKey || "",
          llmBaseUrl: credentials?.baseUrl || "",
          llmModel: credentials?.modelId || undefined,
          githubToken: credentials?.githubToken || "",
          userId: userId || undefined,
          triggeredBy: userId || undefined,
          customPrompt: customPrompt.trim() || undefined,
        }),
      });
      clearTimeout(fetchTimeout);

      const data = await response.json();
      timeouts.forEach(clearTimeout);

      if (!response.ok || data.error) {
        setSuggestionsError(data.error || "Failed to get suggestions");
        setSuggestionsProgress(0);
        setIsLoadingSuggestions(false);
        return;
      }

      setSuggestionsProgress(100);
      setSuggestionsProgressLabel("Done!");

      setSuggestions(
        (data.suggestions || []).map((s: FTSuggestion) => ({
          ...s,
          selected: true, // Select all by default
        }))
      );
      setSuggestionsSourceFiles(data.sourceFiles || []);
      setSuggestionsTotalFiles(data.totalSourceFiles || 0);
      if (data.suggestionsRunId) setSuggestionsRunId(data.suggestionsRunId);
      setAutomationIdCount(data.totalAutomationIds || 0);
      setAutomationCoverage(data.automationCoverage || 0);
      setInteractiveElements(data.totalInteractiveElements || 0);

      // Show warning if AI returned 0 suggestions despite finding source files
      if (data.warning) {
        setSuggestionsError(data.warning);
      }

      setCurrentStep("suggestions");
    } catch (err) {
      timeouts.forEach(clearTimeout);
      const msg = err instanceof Error
        ? err.name === "AbortError"
          ? "Request timed out after 5 minutes. The AI may be overloaded — try again or select a smaller folder."
          : err.message
        : "Failed to get suggestions";
      setSuggestionsError(msg);
      setSuggestionsProgress(0);
    } finally {
      timeouts.forEach(clearTimeout);
      setIsLoadingSuggestions(false);
    }
  };

  // ── Generate Tests ──
  const handleGenerate = async (withSuggestions: boolean) => {
    setIsGenerating(true);
    setGenerationProgress(10);
    setGeneratedFiles([]);
    setGenerationError(null);
    setCurrentStep("generating");

    // Open Run panel immediately and show generation progress
    onGenerationProgress?.(true, 10);
    onNavigateToRun?.();

    try {
      const body: Record<string, unknown> = {
        selectedFolders: selectedSubfolder
          ? [`${selectedFolder}/${selectedSubfolder}`]
          : [selectedFolder],
        manualPaths: [],
        outputFolderName: outputFolderName.trim() || undefined,
        validateAfterGenerate: false,
        llmApiKey: credentials?.llmApiKey || "",
        llmBaseUrl: credentials?.baseUrl || "",
        llmModel: credentials?.modelId || undefined,
        githubToken: credentials?.githubToken || "",
        triggeredBy: userId || undefined,
        customPrompt: customPrompt.trim() || undefined,
        suggestionsRunId: suggestionsRunId || undefined,
      };

      // Include selected suggestions and manual use cases
      // Separate existing vs new — existing ones skip the LLM entirely
      const existingFiles: GeneratedFile[] = [];
      if (withSuggestions) {
        const selectedSuggestions = suggestions.filter((s) => s.selected);
        const newSuggestions = selectedSuggestions.filter((s) => !s.exists);
        const alreadyExisting = selectedSuggestions.filter((s) => s.exists);

        // Add existing suggestions directly to results (no LLM call needed)
        for (const s of alreadyExisting) {
          existingFiles.push({
            path: s.specFileName,
            name: s.specFileName,
            status: "warning",
            message: "Already exists — skipped generation",
          });
        }

        body.selectedSuggestions = newSuggestions;
        body.manualUseCases = manualUseCases;
      }

      // If nothing to generate (all existing + no manual), skip API call
      const hasNewWork =
        !withSuggestions ||
        (body.selectedSuggestions as unknown[])?.length > 0 ||
        manualUseCases.length > 0;

      if (!hasNewWork) {
        setGeneratedFiles(existingFiles);
        onFilesGenerated?.(existingFiles, []);
        setGenerationProgress(100);
        setCurrentStep("results");
        setIsGenerating(false);
        onGenerationProgress?.(false, 100);
        return;
      }

      const response = await fetch("/api/ft-runner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const initData = await response.json();

      if (!response.ok || initData.error) {
        setGenerationError(initData.error || "Generation failed");
        setIsGenerating(false);
        onGenerationProgress?.(false, 0);
        return;
      }

      const statusUrl = initData.statusUrl;
      setGenerationProgress(30);
      onGenerationProgress?.(true, 30);

      // Poll status endpoint until generation completes
      const pollForResults = async (): Promise<void> => {
        const maxAttempts = 120; // 10 minutes max (5s intervals)
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, 5000));

          try {
            const statusRes = await fetch(statusUrl);
            const statusData = await statusRes.json();

            if (statusData.status === "completed" || statusData.status === "failed") {
              setGenerationProgress(100);

              const files: GeneratedFile[] = (statusData.generatedFiles || []).map(
                (f: { testPath: string; status: string; error?: string }) => ({
                  path: f.testPath,
                  name: f.testPath.split("/").pop() || f.testPath,
                  status:
                    f.status === "created"
                      ? "success"
                      : f.status === "skipped"
                      ? "warning"
                      : "error",
                  message: f.error,
                })
              );

              const allFiles = [...existingFiles, ...files];
              setGeneratedFiles(allFiles);
              setComplianceResults(statusData.complianceResults || []);
              onFilesGenerated?.(allFiles, statusData.complianceResults || []);
              setCurrentStep("results");
              setIsGenerating(false);
              onGenerationProgress?.(false, 100);
              return;
            }

            // Update progress based on steps
            const steps = statusData.steps || [];
            const completedSteps = steps.filter((s: { status: string }) => s.status === "completed").length;
            const pct = 30 + Math.min(60, completedSteps * 20);
            setGenerationProgress(pct);
            onGenerationProgress?.(true, pct);
          } catch {
            // Retry on network error
          }
        }

        setGenerationError("Generation timed out. Check server logs.");
        setIsGenerating(false);
        onGenerationProgress?.(false, 0);
      };

      await pollForResults();
    } catch (err) {
      setGenerationError(
        err instanceof Error ? err.message : "Generation failed"
      );
      setIsGenerating(false);
      onGenerationProgress?.(false, 0);
    }
  };

  const handleReset = () => {
    setCurrentStep("input");
    setSelectedFolder("");
    setSelectedSubfolder("");
    setSubfolders([]);
    setOutputFolderName("");
    setSuggestions([]);
    setManualUseCases([]);
    setGeneratedFiles([]);
    setGenerationError(null);
    setSuggestionsError(null);
    setComplianceResults([]);
  };

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  return (
    <div style={{ padding: "8px 16px 16px" }}>
      {/* Steps Indicator */}
      <div style={{ marginBottom: 20 }}>
        <Steps
          current={currentStepIndex}
          items={stepsItems}
          size="small"
          style={{ maxWidth: 600, margin: "0 auto" }}
        />
      </div>

      {/* ════════════════════════════════════════════ */}
      {/* STEP 1: Input Selection                      */}
      {/* ════════════════════════════════════════════ */}
      {currentStep === "input" && (
        <Card
          title={
            <Space>
              <ApartmentOutlined
                style={{ color: isDark ? "#a78bfa" : "#7c3aed" }}
              />
              <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
                Component Source
              </Text>
            </Space>
          }
          style={{ ...cardStyle, maxWidth: 720, margin: "0 auto" }}
          styles={{ body: { padding: "20px 24px" } }}
        >
          {/* Component Folder - Mandatory (Dropdown) */}
          <div style={{ marginBottom: 20 }}>
            <Text
              strong
              style={{
                display: "block",
                marginBottom: 8,
                color: isDark ? "#e5e7eb" : "#374151",
              }}
            >
              Component Folder
              <Text type="danger" style={{ marginLeft: 4 }}>*</Text>
              <Tooltip title="Select the console component folder to analyze for test generation.">
                <InfoCircleOutlined
                  style={{
                    marginLeft: 8,
                    color: isDark ? "#9ca3af" : "#6b7280",
                  }}
                />
              </Tooltip>
            </Text>
            <Select
              value={selectedFolder || undefined}
              onChange={handleFolderChange}
              placeholder={!workspaceReady ? "Waiting for workspace setup..." : foldersLoading ? "Loading folders from repo..." : "Select a component folder"}
              size="large"
              style={{ width: "100%" }}
              showSearch
              loading={foldersLoading}
              disabled={!workspaceReady}
              filterOption={(input, option) =>
                (option?.value as string || "").toLowerCase().includes(input.toLowerCase()) ||
                (option?.desc as string || "").toLowerCase().includes(input.toLowerCase())
              }
              options={consoleFolders.map((f) => ({
                value: f.name,
                desc: f.description,
                label: (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <FolderOpenOutlined style={{ color: isDark ? "#a78bfa" : "#7c3aed" }} />
                    <span style={{ fontWeight: 500 }}>{f.name}</span>
                    {f.description && <span style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>{f.description}</span>}
                    {f.componentsCount > 0 && <Tag style={{ fontSize: 10, borderRadius: 4, marginLeft: "auto" }}>{f.componentsCount} files</Tag>}
                  </div>
                ),
              }))}
            />
            {selectedFolder && (
              <Text
                type="secondary"
                style={{ fontSize: 12, display: "block", marginTop: 4 }}
              >
                Path: <Text code style={{ fontSize: 11 }}>components/console/{selectedFolder}/</Text>
                {" "}{consoleFolders.find((f) => f.name === selectedFolder)?.description}
              </Text>
            )}
          </div>

          {/* Subfolder - Required when parent has subfolders */}
          {selectedFolder && (subfolders.length > 0 || subfoldersLoading) && (
            <div style={{ marginBottom: 20 }}>
              <Text
                strong
                style={{
                  display: "block",
                  marginBottom: 8,
                  color: isDark ? "#e5e7eb" : "#374151",
                }}
              >
                Subfolder
                {subfolderRequired
                  ? <Text type="danger" style={{ marginLeft: 4 }}>*</Text>
                  : <Tag style={{ marginLeft: 8, borderRadius: 4, fontSize: 11 }}>Optional</Tag>
                }
                <Tooltip title={subfolderRequired ? "Select a specific workflow to generate tests for." : "Narrow down to a specific subfolder."}>
                  <InfoCircleOutlined
                    style={{
                      marginLeft: 8,
                      color: isDark ? "#9ca3af" : "#6b7280",
                    }}
                  />
                </Tooltip>
              </Text>
              <Select
                value={selectedSubfolder || undefined}
                onChange={setSelectedSubfolder}
                placeholder={subfoldersLoading ? "Loading subfolders..." : "Select a subfolder (optional)"}
                size="large"
                style={{ width: "100%" }}
                loading={subfoldersLoading}
                disabled={!workspaceReady}
                allowClear={!subfolderRequired}
                showSearch
                options={subfolders.map((sf) => ({
                  value: sf,
                  label: (
                    <Space>
                      <FolderOpenOutlined />
                      <span>{sf}</span>
                    </Space>
                  ),
                }))}
              />
              {selectedSubfolder && (
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                  Full path: <Text code style={{ fontSize: 11 }}>{folderPath}</Text>
                </Text>
              )}
            </div>
          )}

          {/* Existing FTs for this workflow */}
          {(existingFTs.length > 0 || existingFTsLoading) && (
            <div style={{ marginTop: 16, marginBottom: 16 }}>
              <Divider style={{ margin: "8px 0" }} />
              <Text
                strong
                style={{
                  display: "block",
                  marginBottom: 8,
                  color: isDark ? "#e5e7eb" : "#374151",
                }}
              >
                Existing FTs for this workflow
                <Tag color="green" style={{ marginLeft: 8, borderRadius: 4, fontSize: 11 }}>
                  {existingFTsLoading ? "Loading..." : `${existingFTs.length} test(s)`}
                </Tag>
              </Text>
              {existingFTs.length > 0 && (
                <div
                  style={{
                    maxHeight: 150,
                    overflowY: "auto",
                    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                    borderRadius: 6,
                    background: isDark ? "#1f2937" : "#f0fdf4",
                    padding: "4px 0",
                  }}
                >
                  {existingFTs.map((ft) => (
                    <div
                      key={ft.path}
                      style={{
                        padding: "4px 12px",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        borderBottom: `1px solid ${isDark ? "#374151" : "#f3f4f6"}`,
                      }}
                    >
                      <CheckCircleOutlined style={{ color: "#059669", fontSize: 12 }} />
                      <Text code style={{ fontSize: 11 }}>{ft.name}</Text>
                    </div>
                  ))}
                </div>
              )}
              <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
                New suggestions will avoid duplicating these. The AI will use them as reference when generating new tests.
              </Text>
            </div>
          )}

          <Divider style={{ margin: "16px 0" }} />

          {/* Output Folder Name - Optional */}
          <div style={{ marginBottom: 24 }}>
            <Text
              strong
              style={{
                display: "block",
                marginBottom: 8,
                color: isDark ? "#e5e7eb" : "#374151",
              }}
            >
              Output Folder Name
              <Tag style={{ marginLeft: 8, borderRadius: 4, fontSize: 11 }}>Optional</Tag>
              <Tooltip title="Tests will be generated in cypress/e2e/{folder-name}/. Leave empty to use default folder structure. Path will be validated against the project.">
                <InfoCircleOutlined
                  style={{
                    marginLeft: 8,
                    color: isDark ? "#9ca3af" : "#6b7280",
                  }}
                />
              </Tooltip>
            </Text>
            <Input
              value={outputFolderName}
              onChange={(e) => setOutputFolderName(e.target.value)}
              placeholder="e.g., my-tests (optional)"
              prefix={<FolderOpenOutlined />}
              size="large"
            />
            <Text
              type="secondary"
              style={{ fontSize: 12, display: "block", marginTop: 4 }}
            >
              Target:{" "}
              <Text code style={{ fontSize: 11 }}>
                cypress/e2e/{outputFolderName || "{component-name}"}/
              </Text>
            </Text>
          </div>

          <Divider style={{ margin: "16px 0" }} />

          {/* Custom Prompt - Optional */}
          <div style={{ marginBottom: 24 }}>
            <Text
              strong
              style={{
                display: "block",
                marginBottom: 8,
                color: isDark ? "#e5e7eb" : "#374151",
              }}
            >
              Custom Instructions
              <Tag style={{ marginLeft: 8, borderRadius: 4, fontSize: 11 }}>Optional</Tag>
              <Tooltip title="Add extra instructions for the AI when generating suggestions and test code. These are appended to the system prompt.">
                <InfoCircleOutlined
                  style={{
                    marginLeft: 8,
                    color: isDark ? "#9ca3af" : "#6b7280",
                  }}
                />
              </Tooltip>
            </Text>
            <Input.TextArea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={"e.g., Focus on PayPal buyer flows only. Include negative test cases for invalid payment amounts. Test with both USD and EUR currencies."}
              rows={3}
              style={{ fontSize: 13 }}
            />
            <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
              These instructions will be added to the AI prompt for both suggestions and test generation.
            </Text>
          </div>

          {/* Get FT Suggestions Button / Progress */}
          {isLoadingSuggestions ? (
            <div
              style={{
                padding: "16px 20px",
                background: isDark ? "#1f2937" : "#f9fafb",
                borderRadius: 8,
                border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: 600, color: isDark ? "#a78bfa" : "#7c3aed" }}>
                  {suggestionsProgressLabel}
                </Text>
                <Text style={{ fontSize: 12, color: isDark ? "#9ca3af" : "#6b7280" }}>
                  {suggestionsProgress}%
                </Text>
              </div>
              <Progress
                percent={suggestionsProgress}
                status="active"
                strokeColor={{ "0%": "#7c3aed", "100%": "#a855f7" }}
                size="small"
                showInfo={false}
              />
            </div>
          ) : (
            <Button
              type="primary"
              size="large"
              icon={<SearchOutlined />}
              onClick={handleGetSuggestions}
              disabled={!isInputValid}
              block
              style={{
                height: 48,
                borderRadius: 8,
                background: !isInputValid
                  ? undefined
                  : "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
                border: "none",
                fontWeight: 600,
              }}
            >
              Get FT Suggestions
            </Button>
          )}

          {/* Suggestions Error */}
          {suggestionsError && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                background: isDark ? "#7f1d1d" : "#fef2f2",
                borderRadius: 8,
                border: `1px solid ${isDark ? "#991b1b" : "#fecaca"}`,
              }}
            >
              <Text style={{ fontSize: 12, color: isDark ? "#fca5a5" : "#991b1b" }}>
                {suggestionsError}
              </Text>
            </div>
          )}
        </Card>
      )}

      {/* ════════════════════════════════════════════ */}
      {/* STEP 2: Review Suggestions                   */}
      {/* ════════════════════════════════════════════ */}
      {currentStep === "suggestions" && (
        <SuggestionsTable
          suggestions={suggestions}
          onSuggestionsChange={setSuggestions}
          manualUseCases={manualUseCases}
          onManualUseCasesChange={setManualUseCases}
          onGenerate={() => handleGenerate(true)}
          onBack={() => setCurrentStep("input")}
          isGenerating={isGenerating}
          isDark={isDark}
          sourceFiles={suggestionsSourceFiles}
          totalSourceFiles={suggestionsTotalFiles}
          automationIdCount={automationIdCount}
          automationCoverage={automationCoverage}
          interactiveElements={interactiveElements}
        />
      )}

      {/* ════════════════════════════════════════════ */}
      {/* STEP 3: Generating / Results                 */}
      {/* ════════════════════════════════════════════ */}
      {currentStep === "generating" && (
        <Card style={{ ...cardStyle, marginTop: 20 }} styles={{ body: { padding: "24px" } }}>
          <div style={{ textAlign: "center" }}>
            <Spin size="large" />
            <div style={{ marginTop: 20 }}>
              <Progress
                percent={generationProgress}
                status="active"
                strokeColor={{ "0%": "#7c3aed", "100%": "#a855f7" }}
              />
              <Text
                style={{
                  fontSize: 12,
                  color: isDark ? "#9ca3af" : "#6b7280",
                  display: "block",
                  marginTop: 8,
                }}
              >
                Generating tests via AI... This may take a minute per file.
              </Text>
            </div>

            {generationError && (
              <div
                style={{
                  marginTop: 16,
                  padding: "8px 12px",
                  background: isDark ? "#7f1d1d" : "#fef2f2",
                  borderRadius: 8,
                  border: `1px solid ${isDark ? "#991b1b" : "#fecaca"}`,
                }}
              >
                <Text style={{ fontSize: 12, color: isDark ? "#fca5a5" : "#991b1b" }}>
                  {generationError}
                </Text>
              </div>
            )}
          </div>
        </Card>
      )}

      {currentStep === "results" && (
        <Card
          title={
            <Space>
              <CheckCircleOutlined style={{ color: "#059669", fontSize: 18 }} />
              <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
                Generation Complete
              </Text>
              <Tag color="success" style={{ borderRadius: 4 }}>
                {generatedFiles.filter((f) => f.status === "success").length} new
              </Tag>
              {generatedFiles.some((f) => f.status === "warning") && (
                <Tag color="orange" style={{ borderRadius: 4 }}>
                  {generatedFiles.filter((f) => f.status === "warning").length} already exist
                </Tag>
              )}
              {generatedFiles.some((f) => f.status === "error") && (
                <Tag color="error" style={{ borderRadius: 4 }}>
                  {generatedFiles.filter((f) => f.status === "error").length} failed
                </Tag>
              )}
            </Space>
          }
          style={{ ...cardStyle, marginTop: 20 }}
          styles={{ body: { padding: "16px 20px" } }}
        >
          <List
            size="small"
            dataSource={generatedFiles}
            renderItem={(file) => {
              const fileName = file.path.split("/").pop() || file.path;
              const cr = complianceResults.find((c) => c.testPath.endsWith(fileName) || fileName.includes(c.testPath.split("/").pop() || ""));
              return (
                <List.Item
                  style={{
                    padding: "8px 12px",
                    background: isDark ? "#1f2937" : "#f9fafb",
                    borderRadius: 6,
                    marginBottom: 8,
                  }}
                >
                  <Space style={{ width: "100%", justifyContent: "space-between" }}>
                    <Space>
                      <FileTextOutlined
                        style={{ color: isDark ? "#a78bfa" : "#7c3aed" }}
                      />
                      <Text
                        code
                        style={{ fontSize: 12, color: isDark ? "#e5e7eb" : "#374151" }}
                      >
                        {file.path}
                      </Text>
                    </Space>
                    <Space>
                      {cr && (
                        <Tooltip title={`${cr.checks.filter((c) => c.passed).length}/${cr.checks.length} checks passed`}>
                          <Tag
                            icon={<SafetyCertificateOutlined />}
                            color={cr.score >= 90 ? "success" : cr.score >= 70 ? "orange" : "error"}
                            style={{ borderRadius: 4, fontSize: 11, fontWeight: 600 }}
                          >
                            {cr.score}%
                          </Tag>
                        </Tooltip>
                      )}
                      <Button
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => viewGeneratedCode(file.path)}
                        style={{ borderRadius: 4, fontSize: 11 }}
                      >
                        View
                      </Button>
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => viewGeneratedCode(file.path, true)}
                        style={{ borderRadius: 4, fontSize: 11 }}
                      >
                        Edit
                      </Button>
                      <Tag
                        color={
                          file.status === "success"
                            ? "success"
                            : file.status === "warning"
                            ? "orange"
                            : "error"
                        }
                        icon={
                          file.status === "success" ? (
                            <CheckCircleOutlined />
                          ) : (
                            <WarningOutlined />
                          )
                        }
                        style={{ borderRadius: 4 }}
                      >
                        {file.status === "success"
                          ? "New"
                          : file.status === "warning"
                          ? "Already Exists"
                          : "Failed"}
                      </Tag>
                    </Space>
                  </Space>
                </List.Item>
              );
            }}
          />
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-start" }}>
            <Button icon={<FileAddOutlined />} onClick={handleReset}>
              Generate More
            </Button>
          </div>
        </Card>
      )}
      {/* Code Viewer/Editor Modal */}
      <Modal
        open={!!viewingCode}
        title={
          <Space>
            {viewingCode?.editing ? (
              <EditOutlined style={{ color: "#7c3aed" }} />
            ) : (
              <FileTextOutlined style={{ color: "#7c3aed" }} />
            )}
            <Text strong>{viewingCode?.path.split("/").pop()}</Text>
            {viewingCode?.editing && (
              <Tag color="blue" style={{ marginLeft: 8, fontSize: 10 }}>EDITING</Tag>
            )}
          </Space>
        }
        onCancel={() => setViewingCode(null)}
        footer={viewingCode?.editing ? (
          <Space>
            <Button onClick={() => setViewingCode({ ...viewingCode!, editing: false })}>
              Cancel
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={saveEditedCode}
            >
              Save
            </Button>
          </Space>
        ) : (
          <Button
            icon={<EditOutlined />}
            onClick={() => {
              if (viewingCode) {
                setViewingCode({ ...viewingCode, editing: true });
                setEditedContent(viewingCode.content);
              }
            }}
          >
            Edit
          </Button>
        )}
        width={1000}
        styles={{ body: { padding: 0 } }}
      >
        {viewingCode && (
          <>
            <div style={{ padding: "8px 16px", background: isDark ? "#1f2937" : "#f3f4f6", fontSize: 11, fontFamily: "monospace", color: isDark ? "#9ca3af" : "#6b7280" }}>
              {viewingCode.path}
            </div>
            <MonacoEditor
              height="600px"
              language="typescript"
              theme={isDark ? "vs-dark" : "light"}
              value={viewingCode.editing ? editedContent : viewingCode.content}
              onChange={(value) => { if (viewingCode.editing) setEditedContent(value || ""); }}
              options={{
                readOnly: !viewingCode.editing,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                wordWrap: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
