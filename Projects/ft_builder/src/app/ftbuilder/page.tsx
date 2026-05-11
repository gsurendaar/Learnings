"use client";

import React, { useState, useEffect } from "react";
import { useSessionState } from "@/hooks/useSessionState";
import { useRouter } from "next/navigation";
import {
  Collapse,
  ConfigProvider,
  Card,
  Row,
  Col,
  Input,
  Button,
  Alert,
  Space,
  Tag,
  Typography,
  Divider,
  Progress,
  Select,
} from "antd";
import {
  FileAddOutlined,
  PlayCircleOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  FolderOutlined,
  ExperimentOutlined,
  BranchesOutlined,
  LockOutlined,
  LoadingOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";
import { useInitialization } from "@/components/InitializationContext";
import { useUser } from "@/components/UserContext";
import CreateFTPanel from "./components/CreateFTPanel";
import RunFTPanel from "./components/RunFTPanel";
import ReviewFTPanel from "./components/ReviewFTPanel";
import AgentTracesPanel from "./components/AgentTracesPanel";
import type { ComplianceResult } from "@/types/ft";

const { Title, Text, Paragraph } = Typography;


export default function FTBuilderPage({ sessionId }: { sessionId?: string } = {}) {
  const router = useRouter();

  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const { credentials, isInitialized } = useInitialization();
  const { userInfo } = useUser();
  const [activeKey, setActiveKey] = useSessionState<string | string[]>("activeKey", ["create"], sessionId);

  // Repo/branch from app context (set during initialization)
  const repoOwner = credentials?.repoOwner || "";
  const repoName = credentials?.repoName || "";

  const [selectedBranch, setSelectedBranch] = useState(credentials?.repoBranch || "");
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  // Fetch branches only if repo is configured
  useEffect(() => {
    const githubToken = credentials?.githubToken;
    if (!githubToken || !repoOwner || !repoName) return;
    setBranchesLoading(true);
    fetch("/api/ft-runner/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubToken, owner: repoOwner, repo: repoName }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.branches?.length > 0) {
          setBranches(data.branches.map((b: any) => b.name || b));
        }
      })
      .catch(() => {})
      .finally(() => setBranchesLoading(false));
  }, [credentials?.githubToken, repoOwner, repoName]);

  // Workspace setup state
  const [repoSetupStatus, setRepoSetupStatus] = useState<"idle" | "cloning" | "ready" | "error">("idle");
  const [repoSetupMessage, setRepoSetupMessage] = useState("");

  // Auto-clone repo for user on branch change or first visit
  useEffect(() => {
    const userId = userInfo?.userid || userInfo?.name;
    const githubToken = credentials?.githubToken;
    if (!userId || !githubToken) return;

    setRepoSetupStatus("cloning");
    setRepoSetupMessage(`Setting up workspace (${selectedBranch} branch)...`);

    fetch("/api/ft-runner/ensure-repo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, githubToken, userName: userInfo?.name, owner: repoOwner, repo: repoName, branch: selectedBranch, source: "FTBuilder" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setRepoSetupStatus("ready");
          setRepoSetupMessage(data.cloned ? `Workspace ready (cloned ${selectedBranch})` : `Workspace ready (${selectedBranch})`);
        } else {
          setRepoSetupStatus("error");
          setRepoSetupMessage(data.error || "Failed to set up workspace");
        }
      })
      .catch((err) => {
        setRepoSetupStatus("error");
        setRepoSetupMessage(err.message || "Failed to set up workspace");
      });
  }, [userInfo, credentials?.githubToken, selectedBranch]);

  // Shared state: generated FT files from Create → Run (persisted across navigation)
  const [generatedFTFiles, setGeneratedFTFiles] = useSessionState<Array<{ path: string; name: string; status: string }>>("generatedFiles", [], sessionId);
  const [ftComplianceResults, setFTComplianceResults] = useSessionState<ComplianceResult[]>("complianceResults", [], sessionId);
  const [latestRunId, setLatestRunId] = useSessionState<string>("latestRunId", "", sessionId);
  const [autoRunFT, setAutoRunFT] = useState(false);
  const [ftGenerating, setFtGenerating] = useState(false);
  const [ftGenerationProgress, setFtGenerationProgress] = useState(0);


  const panelStyle = {
    marginBottom: 16,
    background: isDark ? "#1f2937" : "#ffffff",
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
  };

  const panels = [
    {
      key: "create",
      label: (
        <Space size="middle">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: isDark ? "#7c3aed20" : "#f3e8ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FileAddOutlined
              style={{ fontSize: 18, color: isDark ? "#a78bfa" : "#7c3aed" }}
            />
          </div>
          <div>
            <Text
              strong
              style={{
                fontSize: 15,
                color: isDark ? "#ffffff" : "#1f2937",
                display: "block",
              }}
            >
              Create FT (Functional Tests)
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: isDark ? "#9ca3af" : "#6b7280",
              }}
            >
              Generate Cypress tests from component paths
            </Text>
          </div>
        </Space>
      ),
      children: (
        <CreateFTPanel
          sessionId={sessionId}
          onNavigateToRun={() => { setAutoRunFT(true); setActiveKey(["run"]); }}
          onFilesGenerated={(files, compliance) => {
            setGeneratedFTFiles(files);
            setFTComplianceResults(compliance || []);
          }}
          onGenerationProgress={(generating, progress) => {
            setFtGenerating(generating);
            setFtGenerationProgress(progress);
          }}
          workspaceReady={repoSetupStatus === "ready"}
        />
      ),
      style: panelStyle,
    },
    {
      key: "run",
      label: (
        <Space size="middle">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: isDark ? "#059669/20" : "#d1fae5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PlayCircleOutlined
              style={{ fontSize: 18, color: isDark ? "#34d399" : "#059669" }}
            />
          </div>
          <div>
            <Text
              strong
              style={{
                fontSize: 15,
                color: isDark ? "#ffffff" : "#1f2937",
                display: "block",
              }}
            >
              Run FT(s)
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: isDark ? "#9ca3af" : "#6b7280",
              }}
            >
              Execute functional tests with real-time status
            </Text>
          </div>
        </Space>
      ),
      children: (
        <RunFTPanel
          sessionId={sessionId}
          generatedFiles={generatedFTFiles}
          complianceResults={ftComplianceResults}
          onRunComplete={() => setActiveKey(["review"])}
          onRunIdChange={(id) => setLatestRunId(id)}
          autoRun={autoRunFT}
          isGenerating={ftGenerating}
          generationProgress={ftGenerationProgress}
        />
      ),
      style: panelStyle,
    },
    {
      key: "review",
      label: (
        <Space size="middle">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: isDark ? "#2563eb20" : "#dbeafe",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <EyeOutlined
              style={{ fontSize: 18, color: isDark ? "#60a5fa" : "#2563eb" }}
            />
          </div>
          <div>
            <Text
              strong
              style={{
                fontSize: 15,
                color: isDark ? "#ffffff" : "#1f2937",
                display: "block",
              }}
            >
              Review FT(s)
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: isDark ? "#9ca3af" : "#6b7280",
              }}
            >
              Review changes and push to Git branches
            </Text>
          </div>
        </Space>
      ),
      children: (
        <ReviewFTPanel
          userId={userInfo?.userid || userInfo?.name}
          githubToken={credentials?.githubToken}
          generatedFiles={generatedFTFiles}
        />
      ),
      style: panelStyle,
    },
    {
      key: "agent-activities",
      label: (
        <Space size="middle">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: isDark ? "#f5920020" : "#fff7ed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RobotOutlined
              style={{ fontSize: 18, color: isDark ? "#fbbf24" : "#d97706" }}
            />
          </div>
          <div>
            <Text
              strong
              style={{
                fontSize: 15,
                color: isDark ? "#ffffff" : "#1f2937",
                display: "block",
              }}
            >
              Agent Activities
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: isDark ? "#9ca3af" : "#6b7280",
              }}
            >
              LLM traces, agent decisions, and execution timeline
            </Text>
          </div>
        </Space>
      ),
      children: <AgentTracesPanel latestRunId={latestRunId} />,
      style: panelStyle,
    },
  ];

  return (
    <ConfigProvider
      theme={{
        components: {
          Collapse: {
            headerBg: "transparent",
            contentPadding: 0,
            headerPadding: "16px 20px",
          },
          Card: {
            borderRadiusLG: 12,
          },
        },
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {isInitialized && repoOwner ? (
          <>

            {/* Credentials Status Bar */}
            <Card
              size="small"
              style={{
                marginBottom: 16,
                borderRadius: 8,
                border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                background: isDark ? "#1f2937" : "#ffffff",
              }}
              styles={{ body: { padding: "12px 16px" } }}
            >
              <Row justify="space-between" align="middle">
                <Col>
                  <Space>
                    <CheckCircleOutlined style={{ color: "#10b981", fontSize: 16 }} />
                    <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
                      Status: Initialized & Ready
                    </Text>
                    {credentials?.modelId && (
                      <Tag color="blue" style={{ borderRadius: 4 }}>
                        {credentials.modelId}
                      </Tag>
                    )}
                    <Tag color="green" style={{ borderRadius: 4 }}>
                      {repoOwner}/{repoName}
                    </Tag>
                    {selectedBranch && (
                      <Tag color="cyan" style={{ borderRadius: 4 }}>
                        {selectedBranch}
                      </Tag>
                    )}
                  </Space>
                </Col>
                <Col>
                  <Button
                    type="default"
                    size="small"
                    onClick={() => router.push("/ftbuilder/initialize")}
                  >
                    Re-initialize Credentials
                  </Button>
                </Col>
              </Row>
            </Card>

            {/* Branch Selector */}
            <Card
              size="small"
              style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`, background: isDark ? "#111827" : "#f9fafb" }}
              styles={{ body: { padding: "8px 16px" } }}
            >
              <Space>
                <Text style={{ fontSize: 13, color: isDark ? "#9ca3af" : "#6b7280" }}>Branch:</Text>
                <Select
                  value={selectedBranch}
                  onChange={setSelectedBranch}
                  style={{ minWidth: 200 }}
                  size="small"
                  showSearch
                  loading={branchesLoading}
                  options={branches.map((b) => ({ value: b, label: b }))}
                />
              </Space>
            </Card>

            {/* Workspace setup status */}
            {repoSetupStatus === "cloning" && (
              <Alert
                type="info"
                showIcon
                icon={<LoadingOutlined spin />}
                message="Setting up workspace..."
                description={repoSetupMessage}
                style={{ marginBottom: 12, borderRadius: 8 }}
              />
            )}
            {repoSetupStatus === "error" && (
              <Alert
                type="error"
                showIcon
                message="Workspace setup failed"
                description={repoSetupMessage}
                action={
                  <Button size="small" onClick={() => setRepoSetupStatus("idle")}>
                    Retry
                  </Button>
                }
                style={{ marginBottom: 12, borderRadius: 8 }}
              />
            )}

            {/* Main Accordion Panels */}
            <Collapse
              accordion
              activeKey={activeKey}
              onChange={setActiveKey}
              items={panels}
              size="large"
              expandIconPosition="end"
              style={{
                background: "transparent",
                border: "none",
              }}
            />
          </>
        ) : (
          <Card
            style={{
              borderRadius: 12,
              border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
              background: isDark ? "#1f2937" : "#ffffff",
              textAlign: "center",
              padding: "48px 24px",
            }}
          >
            <Space direction="vertical" size={16} align="center">
              <LockOutlined style={{ fontSize: 48, color: isDark ? "#6b7280" : "#9ca3af" }} />
              <Title level={4} style={{ margin: 0, color: isDark ? "#ffffff" : "#1f2937" }}>
                Initialize Required
              </Title>
              <Text style={{ color: isDark ? "#9ca3af" : "#6b7280", maxWidth: 400, display: "block" }}>
                Configure your LLM API key, GitHub token, and select a repository before using FT Builder.
              </Text>
              <Button
                type="primary"
                size="large"
                onClick={() => router.push("/ftbuilder/initialize")}
                style={{ borderRadius: 8 }}
              >
                Initialize FT Builder
              </Button>
            </Space>
          </Card>
        )}
      </div>
    </ConfigProvider>
  );
}
