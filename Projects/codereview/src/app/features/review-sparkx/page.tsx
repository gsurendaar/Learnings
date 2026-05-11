"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Layout,
  Card,
  Row,
  Col,
  Input,
  Button,
  Space,
  Typography,
  message,
  Spin,
  Alert,
  Tag,
  Divider,
  Empty,
  Progress,
  List,
  Modal,
  Select,
} from "antd";
import { ModernHeader } from "@/components/ModernHeader";
import { SubHeader } from "@/components/SubHeader";
import { useTheme } from "@/components/ThemeProvider";
import { useInitialization } from "@/components/InitializationContext";
import { useUser } from "@/hooks/useUser";
import {
  CodeOutlined,
  SearchOutlined,
  SendOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  BulbOutlined,
  GithubOutlined,
  BranchesOutlined,
  CloudUploadOutlined,
  LinkOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  FolderOpenOutlined,
  SaveOutlined,
  RobotOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface ReviewResult {
  success: boolean;
  prNumber?: string;
  commitId?: string;
  title?: string;
  author?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  review?: {
    summary: string;
    codeQuality: {
      score: number;
      findings: string[];
    };
    bestPractices: {
      score: number;
      findings: string[];
    };
    maintainability: {
      score: number;
      findings: string[];
    };
    impactAnalysis: {
      score: number;
      findings: string[];
    };
    suggestions: string[];
    detailedAnalysis: string;
  };
  error?: string;
  savedReport?: string;
}

interface SavedReport {
  fileName: string;
  identifier: string;
  generatedAt: string;
  overallScore: number;
}

export default function ReviewSparkx() {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const { isInitialized, credentials } = useInitialization();
  const { userName, userTitle } = useUser();

  const [inputValue, setInputValue] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [postingToGithub, setPostingToGithub] = useState(false);
  const [githubCommentUrl, setGithubCommentUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [showReportsModal, setShowReportsModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; object: string }>>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [pulling, setPulling] = useState(false);

  // Load persisted data from localStorage on mount
  useEffect(() => {
    const savedModel = localStorage.getItem("sparkx-last-model");
    const savedInstructions = localStorage.getItem("sparkx-custom-instructions");

    if (savedModel) {
      setSelectedModel(savedModel);
    }

    if (savedInstructions) {
      setCustomInstructions(savedInstructions);
    }
  }, []);

  // Save custom instructions to localStorage whenever they change
  useEffect(() => {
    if (customInstructions.trim()) {
      localStorage.setItem("sparkx-custom-instructions", customInstructions);
    }
  }, [customInstructions]);

  // Save selected model to localStorage whenever it changes
  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem("sparkx-last-model", selectedModel);
    }
  }, [selectedModel]);

  // Check initialization on component mount
  useEffect(() => {
    if (!isInitialized) {
      router.push("/features/review-sparkx/initialize");
    }
  }, [isInitialized, router]);

  // Fetch saved reports and available models on component mount
  useEffect(() => {
    if (isInitialized) {
      fetchSavedReports();
      fetchAvailableModels();
    }
  }, [isInitialized]);

  const fetchAvailableModels = async () => {
    setLoadingModels(true);
    try {
      if (!credentials) {
        console.error("Credentials not available");
        return;
      }

      const params = new URLSearchParams({
        baseUrl: credentials.baseUrl,
        apiKey: credentials.llmApiKey,
      });
      const response = await fetch(`/api/review-sparkx/models?${params}`);
      const data = await response.json();
      if (data.success && data.models) {
        setAvailableModels(data.models);
        // Set default model if available
        if (data.models.length > 0 && !selectedModel) {
          // Prefer claude models if available
          const claudeModel = data.models.find((m: { id: string }) =>
            m.id.toLowerCase().includes("claude")
          );
          const modelToSet = claudeModel?.id || data.models[0].id;
          setSelectedModel(modelToSet);
          localStorage.setItem("sparkx-last-model", modelToSet);
        }
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    } finally {
      setLoadingModels(false);
    }
  };

  const handlePullFromUpstream = async () => {
    setPulling(true);
    try {
      const response = await fetch("/api/review-sparkx/pull", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        message.success(data.message);
      } else {
        message.error(data.message || "Failed to pull from upstream");
      }
    } catch (error) {
      console.error("Error pulling from upstream:", error);
      message.error("Failed to pull from upstream");
    } finally {
      setPulling(false);
    }
  };

  const fetchSavedReports = async () => {
    setLoadingReports(true);
    try {
      const response = await fetch("/api/review-sparkx/reports");
      const data = await response.json();
      if (data.success) {
        setSavedReports(data.reports || []);
      }
    } catch (error) {
      console.error("Failed to fetch reports:", error);
    } finally {
      setLoadingReports(false);
    }
  };

  const loadReport = async (fileName: string) => {
    setLoadingReport(true);
    try {
      const response = await fetch(`/api/review-sparkx/reports/${fileName}`);
      const data = await response.json();
      if (data.success) {
        setSelectedReport(data.report);
        // Convert saved report back to display format
        const reviewResult: ReviewResult = {
          success: true,
          prNumber: data.report.metadata?.identifier?.includes("PR")
            ? data.report.metadata.identifier.replace("PR #", "")
            : undefined,
          commitId: data.report.metadata?.identifier?.includes("Commit")
            ? data.report.metadata.identifier.replace("Commit ", "")
            : undefined,
          title: data.report.metadata?.title,
          author: data.report.metadata?.author,
          filesChanged: data.report.metadata?.filesChanged,
          additions: data.report.metadata?.additions,
          deletions: data.report.metadata?.deletions,
          review: data.report.review,
        };
        setResult(reviewResult);
        setCustomInstructions(data.report.customInstructions || "");
        setShowReportsModal(false);
        message.success("Report loaded successfully");
      } else {
        message.error("Failed to load report");
      }
    } catch (error) {
      console.error("Failed to load report:", error);
      message.error("Failed to load report");
    } finally {
      setLoadingReport(false);
    }
  };

  const handleSubmit = async () => {
    if (!inputValue.trim()) {
      message.error("Please enter a PR number or Commit ID");
      return;
    }

    if (!selectedModel) {
      message.error("Please select an LLM model");
      return;
    }

    if (!credentials) {
      message.error("Credentials not available. Please re-initialize.");
      return;
    }

    setLoading(true);
    setResult(null);
    setGithubCommentUrl(null);

    try {
      const response = await fetch("/api/review-sparkx", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: inputValue.trim(),
          customInstructions: customInstructions.trim() || undefined,
          model: selectedModel,
          username: userName,
          ...(credentials && {
            githubToken: credentials.githubToken,
            llmApiKey: credentials.llmApiKey,
            baseUrl: credentials.baseUrl,
          }),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
        if (data.savedReport) {
          message.success(
            `Code review completed and saved to ${data.savedReport}`,
          );
        } else {
          message.success("Code review completed successfully!");
        }
        // Refresh the reports list
        fetchSavedReports();
      } else {
        setResult({ success: false, error: data.message || "Review failed" });
        message.error(data.message || "Failed to review code");
      }
    } catch (error) {
      console.error("Error:", error);
      setResult({
        success: false,
        error: "Failed to connect to review service",
      });
      message.error("Failed to connect to review service");
    } finally {
      setLoading(false);
    }
  };

  const handlePostToGithub = async () => {
    if (!result?.prNumber || !result?.review) {
      message.error("No PR review to post");
      return;
    }

    if (!credentials) {
      message.error("Credentials not available. Please re-initialize.");
      return;
    }

    setPostingToGithub(true);
    setGithubCommentUrl(null);

    try {
      const response = await fetch("/api/review-sparkx/post-to-github", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prNumber: result.prNumber,
          review: result.review,
          githubToken: credentials.githubToken,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setGithubCommentUrl(data.commentUrl);
        message.success("Review posted to GitHub successfully!");
      } else {
        message.error(data.message || "Failed to post review to GitHub");
      }
    } catch (error) {
      console.error("Error posting to GitHub:", error);
      message.error("Failed to post review to GitHub");
    } finally {
      setPostingToGithub(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return "#10b981";
    if (score >= 6) return "#f59e0b";
    return "#ef4444";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 8) return "Excellent";
    if (score >= 6) return "Good";
    if (score >= 4) return "Needs Improvement";
    return "Poor";
  };

  const renderScoreCard = (
    title: string,
    score: number,
    findings: string[],
    icon: React.ReactNode,
  ) => (
    <Card
      size="small"
      style={{
        background: isDark ? "#1f2937" : "#ffffff",
        border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
        borderRadius: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "12px",
        }}
      >
        <div
          style={{
            background: `linear-gradient(135deg, ${getScoreColor(score)}20, ${getScoreColor(score)}40)`,
            padding: "8px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <Text
            strong
            style={{ fontSize: "14px", color: isDark ? "#ffffff" : "#1f2937" }}
          >
            {title}
          </Text>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                fontSize: "24px",
                fontWeight: "bold",
                color: getScoreColor(score),
              }}
            >
              {score}/10
            </div>
            <Tag color={getScoreColor(score)} style={{ margin: 0 }}>
              {getScoreLabel(score)}
            </Tag>
          </div>
        </div>
      </div>
      <div style={{ marginTop: "8px" }}>
        {findings.map((finding, index) => (
          <div
            key={index}
            style={{
              padding: "6px 10px",
              background: isDark ? "#374151" : "#f3f4f6",
              borderRadius: "6px",
              marginBottom: "6px",
              fontSize: "13px",
              color: isDark ? "#d1d5db" : "#4b5563",
            }}
          >
            {finding}
          </div>
        ))}
      </div>
    </Card>
  );

  return (
    <Layout
      style={{
        minHeight: "100vh",
        background: isDark ? "#111827" : "#f9fafb",
      }}
    >
      <ModernHeader />
      <SubHeader
        title="Review SparkX"
        subtitle="AI-Powered Code Quality Analysis for SparkX Repository"
        breadcrumbs={[
          {
            title: "Review SparkX",
            icon: <CodeOutlined />,
          },
        ]}
      />

      <Content
        style={{
          padding: "24px",
          background: isDark ? "#111827" : "#f9fafb",
        }}
      >
        {/* Credentials Status Bar */}
        <Card
          style={{
            background: isDark ? "#1f2937" : "#ffffff",
            border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
            borderRadius: "12px",
            marginBottom: "24px",
            padding: "12px 16px",
          }}
        >
          <Row justify="space-between" align="middle">
            <Col>
              <Space>
                <CheckCircleOutlined style={{ color: "#10b981", fontSize: "16px" }} />
                <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
                  Status: Initialized & Ready
                </Text>
              </Space>
            </Col>
            <Col>
              <Button
                type="default"
                size="small"
                onClick={() => router.push("/features/review-sparkx/initialize")}
              >
                Re-initialize Credentials
              </Button>
            </Col>
          </Row>
        </Card>

        {/* Input Section */}
        <Card
          style={{
            background: isDark ? "#1f2937" : "#ffffff",
            border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
            borderRadius: "12px",
            marginBottom: "24px",
          }}
        >
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} md={18}>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Text
                  strong
                  style={{
                    fontSize: "16px",
                    color: isDark ? "#ffffff" : "#1f2937",
                  }}
                >
                  <GithubOutlined
                    style={{ marginRight: "8px", color: "#3b82f6" }}
                  />
                  Enter PR Number or Commit ID
                </Text>
                <Input
                  size="large"
                  placeholder="e.g., 123 (PR number) or abc1234 (commit SHA)"
                  prefix={<BranchesOutlined style={{ color: "#9ca3af" }} />}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onPressEnter={handleSubmit}
                  style={{
                    background: isDark ? "#374151" : "#f9fafb",
                    border: `1px solid ${isDark ? "#4b5563" : "#d1d5db"}`,
                    borderRadius: "8px",
                  }}
                />
                <Text type="secondary" style={{ fontSize: "12px" }}>
                  Supports PR numbers (e.g., 42, #42) or commit SHAs (e.g.,
                  abc1234def5678)
                </Text>
              </Space>
            </Col>
            <Col xs={24} md={6}>
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                <Button
                  type="primary"
                  size="large"
                  icon={loading ? <Spin size="small" /> : <SendOutlined />}
                  onClick={handleSubmit}
                  loading={loading}
                  disabled={loading || !inputValue.trim()}
                  style={{
                    width: "100%",
                    height: "48px",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                    border: "none",
                    fontWeight: 600,
                  }}
                >
                  {loading ? "Analyzing..." : "Analyze Code"}
                </Button>
                <Button
                  size="large"
                  icon={<HistoryOutlined />}
                  onClick={() => setShowReportsModal(true)}
                  style={{
                    width: "100%",
                    height: "40px",
                    borderRadius: "8px",
                    background: isDark ? "#374151" : "#f3f4f6",
                    border: `1px solid ${isDark ? "#4b5563" : "#d1d5db"}`,
                    color: isDark ? "#d1d5db" : "#4b5563",
                  }}
                >
                  Saved Reports ({savedReports.length})
                </Button>
                <Button
                  size="large"
                  icon={<SyncOutlined spin={pulling} />}
                  onClick={handlePullFromUpstream}
                  loading={pulling}
                  style={{
                    width: "100%",
                    height: "40px",
                    borderRadius: "8px",
                    background: isDark ? "#374151" : "#f3f4f6",
                    border: `1px solid ${isDark ? "#4b5563" : "#d1d5db"}`,
                    color: isDark ? "#d1d5db" : "#4b5563",
                  }}
                >
                  {pulling ? "Pulling..." : "Pull from Upstream"}
                </Button>
              </Space>
            </Col>
          </Row>

          {/* Model Selection */}
          <Divider
            style={{
              margin: "20px 0 16px 0",
              borderColor: isDark ? "#374151" : "#e5e7eb",
            }}
          />
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Text
                  strong
                  style={{
                    fontSize: "14px",
                    color: isDark ? "#ffffff" : "#1f2937",
                  }}
                >
                  <RobotOutlined style={{ marginRight: "8px", color: "#8b5cf6" }} />
                  Select LLM Model
                </Text>
                <Select
                  size="large"
                  placeholder={loadingModels ? "Loading models..." : "Select a model"}
                  value={selectedModel || undefined}
                  onChange={(value) => setSelectedModel(value)}
                  loading={loadingModels}
                  style={{
                    width: "100%",
                  }}
                  dropdownStyle={{
                    background: isDark ? "#374151" : "#ffffff",
                  }}
                  options={availableModels.map((model) => ({
                    value: model.id,
                    label: (
                      <span style={{ color: isDark ? "#d1d5db" : "#1f2937" }}>
                        {model.id}
                      </span>
                    ),
                  }))}
                  notFoundContent={
                    loadingModels ? (
                      <Spin size="small" />
                    ) : (
                      <Text type="secondary">No models available</Text>
                    )
                  }
                />
                <Text type="secondary" style={{ fontSize: "12px" }}>
                  Choose the AI model to use for code review
                </Text>
              </Space>
            </Col>
          </Row>

          {/* Custom Instructions */}
          <Divider
            style={{
              margin: "20px 0 16px 0",
              borderColor: isDark ? "#374151" : "#e5e7eb",
            }}
          />
          <Space direction="vertical" style={{ width: "100%" }}>
            <Text
              strong
              style={{
                fontSize: "14px",
                color: isDark ? "#ffffff" : "#1f2937",
              }}
            >
              <BulbOutlined style={{ marginRight: "8px", color: "#f59e0b" }} />
              Custom Review Instructions (Optional)
            </Text>
            <TextArea
              placeholder="Provide specific instructions for the AI reviewer. For example:
- Focus on security vulnerabilities
- Check for SQL injection risks
- Review error handling patterns
- Verify accessibility compliance
- Look for performance bottlenecks
- Check naming conventions"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              rows={4}
              style={{
                background: isDark ? "#374151" : "#f9fafb",
                border: `1px solid ${isDark ? "#4b5563" : "#d1d5db"}`,
                borderRadius: "8px",
                resize: "vertical",
              }}
            />
            <Text type="secondary" style={{ fontSize: "12px" }}>
              Leave empty for a general code quality review, or specify what
              aspects you want the AI to focus on
            </Text>
          </Space>
        </Card>

        {/* Loading State */}
        {loading && (
          <Card
            style={{
              background: isDark ? "#1f2937" : "#ffffff",
              border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
              borderRadius: "12px",
              textAlign: "center",
              padding: "48px",
            }}
          >
            <Spin size="large" />
            <div style={{ marginTop: "16px" }}>
              <Text
                style={{
                  fontSize: "16px",
                  color: isDark ? "#9ca3af" : "#6b7280",
                }}
              >
                Fetching code changes and analyzing with AI...
              </Text>
            </div>
            <div style={{ marginTop: "8px" }}>
              <Text type="secondary">This may take a few moments</Text>
            </div>
          </Card>
        )}

        {/* Error State */}
        {result && !result.success && (
          <Alert
            type="error"
            message="Review Failed"
            description={result.error}
            showIcon
            style={{ marginBottom: "24px", borderRadius: "8px" }}
          />
        )}

        {/* Results Section */}
        {result && result.success && result.review && (
          <>
            {/* PR/Commit Info Header */}
            <Card
              style={{
                background: isDark ? "#1f2937" : "#ffffff",
                border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                borderRadius: "12px",
                marginBottom: "24px",
              }}
            >
              <Row gutter={[24, 16]}>
                <Col xs={24} md={12}>
                  <Space direction="vertical" size={4}>
                    <Text type="secondary" style={{ fontSize: "12px" }}>
                      {result.prNumber ? "Pull Request" : "Commit"}
                    </Text>
                    <Title
                      level={4}
                      style={{
                        margin: 0,
                        color: isDark ? "#ffffff" : "#1f2937",
                      }}
                    >
                      {result.prNumber
                        ? `#${result.prNumber}`
                        : result.commitId?.substring(0, 8)}
                    </Title>
                    {result.title && (
                      <Text style={{ color: isDark ? "#d1d5db" : "#4b5563" }}>
                        {result.title}
                      </Text>
                    )}
                  </Space>
                </Col>
                <Col xs={24} md={12}>
                  <Row gutter={[16, 8]}>
                    {result.author && (
                      <Col span={12}>
                        <Text
                          type="secondary"
                          style={{ fontSize: "12px", display: "block" }}
                        >
                          Author
                        </Text>
                        <Text strong>{result.author}</Text>
                      </Col>
                    )}
                    <Col span={12}>
                      <Text
                        type="secondary"
                        style={{ fontSize: "12px", display: "block" }}
                      >
                        Files Changed
                      </Text>
                      <Text strong>{result.filesChanged || 0}</Text>
                    </Col>
                    <Col span={12}>
                      <Text
                        type="secondary"
                        style={{ fontSize: "12px", display: "block" }}
                      >
                        Additions
                      </Text>
                      <Text strong style={{ color: "#10b981" }}>
                        +{result.additions || 0}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text
                        type="secondary"
                        style={{ fontSize: "12px", display: "block" }}
                      >
                        Deletions
                      </Text>
                      <Text strong style={{ color: "#ef4444" }}>
                        -{result.deletions || 0}
                      </Text>
                    </Col>
                  </Row>
                </Col>
              </Row>

              {/* Post to GitHub Button */}
              {result.prNumber && (
                <Divider
                  style={{
                    margin: "16px 0",
                    borderColor: isDark ? "#374151" : "#e5e7eb",
                  }}
                />
              )}
              {result.prNumber && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    flexWrap: "wrap",
                  }}
                >
                  <Button
                    type="primary"
                    icon={
                      postingToGithub ? (
                        <Spin size="small" />
                      ) : (
                        <CloudUploadOutlined />
                      )
                    }
                    onClick={handlePostToGithub}
                    loading={postingToGithub}
                    disabled={postingToGithub || !!githubCommentUrl}
                    style={{
                      background: githubCommentUrl
                        ? "#10b981"
                        : "linear-gradient(135deg, #1f2937, #374151)",
                      border: "none",
                      borderRadius: "8px",
                    }}
                  >
                    {githubCommentUrl
                      ? "Posted to GitHub"
                      : postingToGithub
                        ? "Posting..."
                        : "Post Review to GitHub PR"}
                  </Button>
                  {githubCommentUrl && (
                    <Button
                      type="link"
                      icon={<LinkOutlined />}
                      href={githubCommentUrl}
                      target="_blank"
                      style={{ padding: 0 }}
                    >
                      View Comment on GitHub
                    </Button>
                  )}
                  {!githubCommentUrl && (
                    <Text type="secondary" style={{ fontSize: "12px" }}>
                      Post the AI review summary as a comment on the PR
                    </Text>
                  )}
                  {result.savedReport && (
                    <Tag
                      icon={<SaveOutlined />}
                      color="green"
                      style={{ marginLeft: "auto" }}
                    >
                      Saved: {result.savedReport}
                    </Tag>
                  )}
                </div>
              )}
              {/* Show saved report indicator for commits (non-PR) */}
              {!result.prNumber && result.savedReport && (
                <>
                  <Divider
                    style={{
                      margin: "16px 0",
                      borderColor: isDark ? "#374151" : "#e5e7eb",
                    }}
                  />
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <Tag icon={<SaveOutlined />} color="green">
                      Report saved: {result.savedReport}
                    </Tag>
                  </div>
                </>
              )}
            </Card>

            {/* Overall Score & Summary */}
            <Card
              style={{
                background: isDark
                  ? "linear-gradient(135deg, #1f2937 0%, #111827 100%)"
                  : "linear-gradient(135deg, #ffffff 0%, #f9fafb 100%)",
                border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                borderRadius: "12px",
                marginBottom: "24px",
              }}
            >
              <Row gutter={[24, 16]} align="middle">
                <Col xs={24} md={6}>
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        width: "100px",
                        height: "100px",
                        borderRadius: "50%",
                        background: `conic-gradient(${getScoreColor(
                          Math.round(
                            (result.review.codeQuality.score +
                              result.review.bestPractices.score +
                              result.review.maintainability.score +
                              result.review.impactAnalysis.score) /
                              4,
                          ),
                        )} ${((result.review.codeQuality.score + result.review.bestPractices.score + result.review.maintainability.score + result.review.impactAnalysis.score) / 40) * 360}deg, ${isDark ? "#374151" : "#e5e7eb"} 0deg)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto",
                        padding: "8px",
                      }}
                    >
                      <div
                        style={{
                          width: "84px",
                          height: "84px",
                          borderRadius: "50%",
                          background: isDark ? "#1f2937" : "#ffffff",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "28px",
                            fontWeight: "bold",
                            color: getScoreColor(
                              Math.round(
                                (result.review.codeQuality.score +
                                  result.review.bestPractices.score +
                                  result.review.maintainability.score +
                                  result.review.impactAnalysis.score) /
                                  4,
                              ),
                            ),
                          }}
                        >
                          {(
                            (result.review.codeQuality.score +
                              result.review.bestPractices.score +
                              result.review.maintainability.score +
                              result.review.impactAnalysis.score) /
                            4
                          ).toFixed(1)}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: isDark ? "#9ca3af" : "#6b7280",
                          }}
                        >
                          Overall
                        </div>
                      </div>
                    </div>
                    <Tag
                      color={getScoreColor(
                        Math.round(
                          (result.review.codeQuality.score +
                            result.review.bestPractices.score +
                            result.review.maintainability.score +
                            result.review.impactAnalysis.score) /
                            4,
                        ),
                      )}
                      style={{
                        marginTop: "12px",
                        fontSize: "12px",
                        padding: "4px 12px",
                      }}
                    >
                      {getScoreLabel(
                        Math.round(
                          (result.review.codeQuality.score +
                            result.review.bestPractices.score +
                            result.review.maintainability.score +
                            result.review.impactAnalysis.score) /
                            4,
                        ),
                      )}
                    </Tag>
                  </div>
                </Col>
                <Col xs={24} md={18}>
                  <Space align="center" style={{ marginBottom: "12px" }}>
                    <FileTextOutlined
                      style={{ fontSize: "18px", color: "#3b82f6" }}
                    />
                    <Title
                      level={5}
                      style={{
                        margin: 0,
                        color: isDark ? "#ffffff" : "#1f2937",
                      }}
                    >
                      Summary
                    </Title>
                  </Space>
                  <Paragraph
                    style={{
                      color: isDark ? "#d1d5db" : "#4b5563",
                      fontSize: "15px",
                      margin: 0,
                      lineHeight: 1.8,
                    }}
                  >
                    {result.review.summary}
                  </Paragraph>
                  <Divider
                    style={{
                      margin: "16px 0",
                      borderColor: isDark ? "#374151" : "#e5e7eb",
                    }}
                  />
                  <Row gutter={[16, 8]}>
                    <Col span={6}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <CheckCircleOutlined
                          style={{
                            color: getScoreColor(
                              result.review.codeQuality.score,
                            ),
                          }}
                        />
                        <Text
                          style={{
                            color: isDark ? "#9ca3af" : "#6b7280",
                            fontSize: "12px",
                          }}
                        >
                          Code Quality:{" "}
                          <strong
                            style={{
                              color: getScoreColor(
                                result.review.codeQuality.score,
                              ),
                            }}
                          >
                            {result.review.codeQuality.score}/10
                          </strong>
                        </Text>
                      </div>
                    </Col>
                    <Col span={6}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <InfoCircleOutlined
                          style={{
                            color: getScoreColor(
                              result.review.bestPractices.score,
                            ),
                          }}
                        />
                        <Text
                          style={{
                            color: isDark ? "#9ca3af" : "#6b7280",
                            fontSize: "12px",
                          }}
                        >
                          Best Practices:{" "}
                          <strong
                            style={{
                              color: getScoreColor(
                                result.review.bestPractices.score,
                              ),
                            }}
                          >
                            {result.review.bestPractices.score}/10
                          </strong>
                        </Text>
                      </div>
                    </Col>
                    <Col span={6}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <WarningOutlined
                          style={{
                            color: getScoreColor(
                              result.review.maintainability.score,
                            ),
                          }}
                        />
                        <Text
                          style={{
                            color: isDark ? "#9ca3af" : "#6b7280",
                            fontSize: "12px",
                          }}
                        >
                          Maintainability:{" "}
                          <strong
                            style={{
                              color: getScoreColor(
                                result.review.maintainability.score,
                              ),
                            }}
                          >
                            {result.review.maintainability.score}/10
                          </strong>
                        </Text>
                      </div>
                    </Col>
                    <Col span={6}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <ExclamationCircleOutlined
                          style={{
                            color: getScoreColor(
                              result.review.impactAnalysis.score,
                            ),
                          }}
                        />
                        <Text
                          style={{
                            color: isDark ? "#9ca3af" : "#6b7280",
                            fontSize: "12px",
                          }}
                        >
                          Impact:{" "}
                          <strong
                            style={{
                              color: getScoreColor(
                                result.review.impactAnalysis.score,
                              ),
                            }}
                          >
                            {result.review.impactAnalysis.score}/10
                          </strong>
                        </Text>
                      </div>
                    </Col>
                  </Row>
                </Col>
              </Row>
            </Card>

            {/* Score Cards */}
            <Row gutter={[16, 16]} style={{ marginBottom: "24px" }}>
              <Col xs={24} md={12} lg={6}>
                {renderScoreCard(
                  "Code Quality",
                  result.review.codeQuality.score,
                  result.review.codeQuality.findings,
                  <CheckCircleOutlined
                    style={{
                      fontSize: "20px",
                      color: getScoreColor(result.review.codeQuality.score),
                    }}
                  />,
                )}
              </Col>
              <Col xs={24} md={12} lg={6}>
                {renderScoreCard(
                  "Best Practices",
                  result.review.bestPractices.score,
                  result.review.bestPractices.findings,
                  <InfoCircleOutlined
                    style={{
                      fontSize: "20px",
                      color: getScoreColor(result.review.bestPractices.score),
                    }}
                  />,
                )}
              </Col>
              <Col xs={24} md={12} lg={6}>
                {renderScoreCard(
                  "Maintainability",
                  result.review.maintainability.score,
                  result.review.maintainability.findings,
                  <WarningOutlined
                    style={{
                      fontSize: "20px",
                      color: getScoreColor(result.review.maintainability.score),
                    }}
                  />,
                )}
              </Col>
              <Col xs={24} md={12} lg={6}>
                {renderScoreCard(
                  "Impact Analysis",
                  result.review.impactAnalysis.score,
                  result.review.impactAnalysis.findings,
                  <ExclamationCircleOutlined
                    style={{
                      fontSize: "20px",
                      color: getScoreColor(result.review.impactAnalysis.score),
                    }}
                  />,
                )}
              </Col>
            </Row>

            {/* Suggestions */}
            {result.review.suggestions.length > 0 && (
              <Card
                style={{
                  background: isDark ? "#1f2937" : "#ffffff",
                  border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                  borderRadius: "12px",
                  marginBottom: "24px",
                }}
              >
                <Space align="center" style={{ marginBottom: "16px" }}>
                  <BulbOutlined
                    style={{ fontSize: "20px", color: "#f59e0b" }}
                  />
                  <Title
                    level={5}
                    style={{ margin: 0, color: isDark ? "#ffffff" : "#1f2937" }}
                  >
                    Suggestions for Improvement
                  </Title>
                </Space>
                <div>
                  {result.review.suggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      style={{
                        padding: "12px 16px",
                        background: isDark ? "#374151" : "#fef3c7",
                        borderRadius: "8px",
                        marginBottom: "8px",
                        borderLeft: `4px solid #f59e0b`,
                      }}
                    >
                      <Text style={{ color: isDark ? "#fef3c7" : "#92400e" }}>
                        {index + 1}. {suggestion}
                      </Text>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Detailed Analysis */}
            {result.review.detailedAnalysis &&
            result.review.detailedAnalysis !== "No detailed analysis provided" ? (
              <Card
                style={{
                  background: isDark ? "#1f2937" : "#ffffff",
                  border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                  borderRadius: "12px",
                }}
              >
                <Space align="center" style={{ marginBottom: "16px" }}>
                  <CodeOutlined style={{ fontSize: "20px", color: "#8b5cf6" }} />
                  <Title
                    level={5}
                    style={{ margin: 0, color: isDark ? "#ffffff" : "#1f2937" }}
                  >
                    Detailed Analysis
                  </Title>
                </Space>
                <div
                  style={{
                    background: isDark ? "#111827" : "#f9fafb",
                    padding: "24px",
                    borderRadius: "8px",
                  }}
                >
                  <style jsx global>{`
                    .markdown-content h1,
                    .markdown-content h2,
                    .markdown-content h3 {
                      color: ${isDark ? "#f3f4f6" : "#1f2937"};
                      margin-top: 1.5em;
                      margin-bottom: 0.5em;
                      font-weight: 600;
                    }
                    .markdown-content h1 {
                      font-size: 1.5em;
                      border-bottom: 1px solid ${isDark ? "#374151" : "#e5e7eb"};
                      padding-bottom: 0.3em;
                    }
                    .markdown-content h2 {
                      font-size: 1.3em;
                    }
                    .markdown-content h3 {
                      font-size: 1.1em;
                    }
                    .markdown-content p {
                      margin: 0.8em 0;
                      line-height: 1.7;
                    }
                    .markdown-content ul,
                    .markdown-content ol {
                      margin: 0.5em 0;
                      padding-left: 1.5em;
                    }
                    .markdown-content li {
                      margin: 0.4em 0;
                      line-height: 1.6;
                    }
                    .markdown-content code {
                      background: ${isDark ? "#374151" : "#e5e7eb"};
                      padding: 0.2em 0.4em;
                      border-radius: 4px;
                      font-family: "Fira Code", "Monaco", monospace;
                      font-size: 0.9em;
                      color: ${isDark ? "#f472b6" : "#be185d"};
                    }
                    .markdown-content pre {
                      background: ${isDark ? "#0d1117" : "#1f2937"};
                      padding: 16px;
                      border-radius: 8px;
                      overflow-x: auto;
                      margin: 1em 0;
                    }
                    .markdown-content pre code {
                      background: transparent;
                      padding: 0;
                      color: ${isDark ? "#e5e7eb" : "#f3f4f6"};
                    }
                    .markdown-content strong {
                      color: ${isDark ? "#f9fafb" : "#111827"};
                      font-weight: 600;
                    }
                    .markdown-content blockquote {
                      border-left: 4px solid ${isDark ? "#8b5cf6" : "#6366f1"};
                      margin: 1em 0;
                      padding: 0.5em 1em;
                      background: ${isDark ? "#1e1b4b" : "#eef2ff"};
                      border-radius: 0 8px 8px 0;
                    }
                    .markdown-content blockquote p {
                      margin: 0;
                    }
                    .markdown-content hr {
                      border: none;
                      border-top: 1px solid ${isDark ? "#374151" : "#e5e7eb"};
                      margin: 1.5em 0;
                    }
                    .markdown-content a {
                      color: #3b82f6;
                      text-decoration: none;
                    }
                    .markdown-content a:hover {
                      text-decoration: underline;
                    }
                    .markdown-content table {
                      width: 100%;
                      border-collapse: collapse;
                      margin: 1em 0;
                    }
                    .markdown-content th,
                    .markdown-content td {
                      border: 1px solid ${isDark ? "#374151" : "#e5e7eb"};
                      padding: 8px 12px;
                      text-align: left;
                    }
                    .markdown-content th {
                      background: ${isDark ? "#374151" : "#f3f4f6"};
                      font-weight: 600;
                    }
                  `}</style>
                  <div
                    className="markdown-content"
                    style={{ color: isDark ? "#d1d5db" : "#374151" }}
                  >
                    <ReactMarkdown>
                      {result.review.detailedAnalysis}
                    </ReactMarkdown>
                  </div>
                </div>
              </Card>
            ) : (
              <Alert
                message="Detailed Analysis Unavailable"
                description="The AI model did not generate a detailed analysis for this review. This can happen with very large PRs or when the model response is truncated. Try re-running the review or using a different model."
                type="warning"
                showIcon
                icon={<ExclamationCircleOutlined />}
                style={{
                  borderRadius: "12px",
                  background: isDark ? "#1f2937" : "#fffbe6",
                  border: `1px solid ${isDark ? "#854d0e" : "#ffe58f"}`,
                }}
              />
            )}
          </>
        )}

        {/* Empty State */}
        {!loading && !result && (
          <Card
            style={{
              background: isDark ? "#1f2937" : "#ffffff",
              border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
              borderRadius: "12px",
              textAlign: "center",
              padding: "48px",
            }}
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space direction="vertical" size={8}>
                  <Text
                    style={{
                      fontSize: "16px",
                      color: isDark ? "#9ca3af" : "#6b7280",
                    }}
                  >
                    Enter a PR number or Commit ID to start the code review
                  </Text>
                  <Text type="secondary">
                    The AI will analyze the code changes against the SparkX
                    codebase and provide quality feedback
                  </Text>
                </Space>
              }
            />
          </Card>
        )}
      </Content>

      {/* Saved Reports Modal */}
      <Modal
        title={
          <Space>
            <FolderOpenOutlined style={{ color: "#3b82f6" }} />
            <span>Saved Reports</span>
          </Space>
        }
        open={showReportsModal}
        onCancel={() => setShowReportsModal(false)}
        footer={null}
        width={700}
        styles={{
          content: {
            background: isDark ? "#1f2937" : "#ffffff",
          },
          header: {
            background: isDark ? "#1f2937" : "#ffffff",
            color: isDark ? "#ffffff" : "#1f2937",
          },
        }}
      >
        {loadingReports ? (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <Spin size="large" />
            <div
              style={{
                marginTop: "16px",
                color: isDark ? "#9ca3af" : "#6b7280",
              }}
            >
              Loading reports...
            </div>
          </div>
        ) : savedReports.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text style={{ color: isDark ? "#9ca3af" : "#6b7280" }}>
                No saved reports yet. Complete a code review to save a report.
              </Text>
            }
          />
        ) : (
          <List
            dataSource={savedReports}
            renderItem={(report) => (
              <List.Item
                style={{
                  background: isDark ? "#374151" : "#f9fafb",
                  marginBottom: "8px",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  border: `1px solid ${isDark ? "#4b5563" : "#e5e7eb"}`,
                }}
                actions={[
                  <Button
                    key="load"
                    type="primary"
                    size="small"
                    icon={<FolderOpenOutlined />}
                    loading={loadingReport}
                    onClick={() => loadReport(report.fileName)}
                    style={{
                      background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                      border: "none",
                    }}
                  >
                    Load
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <div
                      style={{
                        width: "48px",
                        height: "48px",
                        borderRadius: "50%",
                        background: `linear-gradient(135deg, ${getScoreColor(report.overallScore)}20, ${getScoreColor(report.overallScore)}40)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "16px",
                          fontWeight: "bold",
                          color: getScoreColor(report.overallScore),
                        }}
                      >
                        {report.overallScore}
                      </span>
                    </div>
                  }
                  title={
                    <Text
                      strong
                      style={{ color: isDark ? "#ffffff" : "#1f2937" }}
                    >
                      {report.identifier}
                    </Text>
                  }
                  description={
                    <Space direction="vertical" size={2}>
                      <Text
                        style={{
                          fontSize: "12px",
                          color: isDark ? "#9ca3af" : "#6b7280",
                        }}
                      >
                        {new Date(report.generatedAt).toLocaleString()}
                      </Text>
                      <Tag color={getScoreColor(report.overallScore)}>
                        Score: {report.overallScore}/10
                      </Tag>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Modal>
    </Layout>
  );
}
