"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Form,
  Input,
  Button,
  Alert,
  Space,
  Typography,
  Spin,
  Divider,
  Row,
  Col,
  Tooltip,
  Select,
} from "antd";
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  BulbOutlined,
  LockOutlined,
  GithubOutlined,
  CloudOutlined,
  RobotOutlined,
  ForkOutlined,
  BranchesOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";
import { useInitialization } from "@/components/InitializationContext";
import { useUser } from "@/components/UserContext";

const { Title, Text, Paragraph } = Typography;

export default function FTBuilderInitializePage() {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const { initializeSetup, isInitializing, initError, credentials } = useInitialization();
  const { userInfo } = useUser();

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{
    llm?: string;
    github?: string;
    baseUrl?: string;
  }>({});

  // Model selection
  const DEFAULT_MODEL = "claude-opus-4-6";
  const [availableModels, setAvailableModels] = useState<Array<{ id: string }>>([{ id: DEFAULT_MODEL }]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(DEFAULT_MODEL);
  const [loadingModels, setLoadingModels] = useState(false);

  // Repo & Branch selection
  const [repos, setRepos] = useState<Array<{ name: string; full_name: string; owner: string }>>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [branches, setBranches] = useState<Array<{ name: string }>>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | undefined>();
  const [selectedOwner, setSelectedOwner] = useState<string | undefined>();
  const [selectedBranch, setSelectedBranch] = useState<string | undefined>();

  // Clone status
  const [cloneStatus, setCloneStatus] = useState<"idle" | "cloning" | "ready" | "error">("idle");
  const [cloneMessage, setCloneMessage] = useState("");

  // Pre-fill from existing credentials
  useEffect(() => {
    if (credentials) {
      form.setFieldsValue({
        baseUrl: credentials.baseUrl,
        llmApiKey: credentials.llmApiKey,
        githubToken: credentials.githubToken,
      });
      setSelectedModel(credentials.modelId || DEFAULT_MODEL);
      // Pre-fill repo/branch from saved credentials
      if (credentials.repoOwner && credentials.repoName) {
        setSelectedOwner(credentials.repoOwner);
        setSelectedRepo(credentials.repoName);
        setSelectedBranch(credentials.repoBranch);
        // Add saved repo to dropdown list so it shows
        setRepos((prev) => {
          const fullName = `${credentials.repoOwner}/${credentials.repoName}`;
          if (prev.some((r) => r.full_name === fullName)) return prev;
          return [...prev, { name: credentials.repoName!, full_name: fullName, owner: credentials.repoOwner! }];
        });
        // Fetch branches for the saved repo
        if (credentials.githubToken) {
          fetchBranches(credentials.repoOwner, credentials.repoName, credentials.githubToken);
        }
      }
      // Auto-fetch repos if token exists
      if (credentials.githubToken) {
        fetchRepos(credentials.githubToken);
      }
    }
  }, [credentials]);

  const fetchModels = async (baseUrl: string, apiKey: string) => {
    if (!baseUrl?.trim() || !apiKey?.trim()) return;
    setLoadingModels(true);
    try {
      const params = new URLSearchParams({ baseUrl, apiKey });
      const res = await fetch(`/api/review-sparkx/models?${params}`);
      const data = await res.json();
      if (data.success && data.models?.length > 0) {
        setAvailableModels(data.models);
        if (!selectedModel) {
          const claude = data.models.find((m: { id: string }) =>
            m.id.toLowerCase().includes("claude")
          );
          setSelectedModel(claude?.id || data.models[0].id);
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoadingModels(false);
    }
  };

  const fetchRepos = async (token: string) => {
    if (!token?.trim()) return;
    setReposLoading(true);
    setReposError(null);
    try {
      const res = await fetch("/api/ft-runner/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubToken: token }),
      });
      const data = await res.json();
      if (data.success && data.repos?.length > 0) {
        setRepos(data.repos);
      } else {
        setReposError(data.message || "No repositories found");
      }
    } catch (err: any) {
      setReposError(err?.message || "Failed to fetch repositories");
    } finally {
      setReposLoading(false);
    }
  };

  const fetchBranches = async (owner: string, repo: string, token: string) => {
    if (!owner || !repo || !token) return;
    setBranchesLoading(true);
    try {
      const res = await fetch("/api/ft-runner/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, githubToken: token }),
      });
      const data = await res.json();
      if (data.success && data.branches?.length > 0) {
        setBranches(data.branches);
      }
    } catch {
      // silently fail
    } finally {
      setBranchesLoading(false);
    }
  };

  const handleRepoChange = (fullName: string) => {
    const repo = repos.find((r) => r.full_name === fullName);
    if (repo) {
      setSelectedRepo(repo.name);
      setSelectedOwner(repo.owner);
      setSelectedBranch(undefined);
      setBranches([]);
      const token = form.getFieldValue("githubToken") || credentials?.githubToken;
      if (token) {
        fetchBranches(repo.owner, repo.name, token);
      }
    }
  };

  const handleSubmit = async (values: any) => {
    setLoading(true);
    setError(null);
    setValidationErrors({});

    try {
      const { llmApiKey, githubToken, baseUrl } = values;

      if (!llmApiKey?.trim()) {
        setValidationErrors((prev) => ({ ...prev, llm: "LLM API Key is required" }));
        setLoading(false);
        return;
      }
      if (!githubToken?.trim()) {
        setValidationErrors((prev) => ({ ...prev, github: "GitHub PAT Token is required" }));
        setLoading(false);
        return;
      }
      if (!baseUrl?.trim()) {
        setValidationErrors((prev) => ({ ...prev, baseUrl: "Base URL is required" }));
        setLoading(false);
        return;
      }
      if (!selectedRepo || !selectedOwner) {
        setError("Please select a repository");
        setLoading(false);
        return;
      }
      if (!selectedBranch) {
        setError("Please select a branch");
        setLoading(false);
        return;
      }

      await initializeSetup(
        llmApiKey.trim(),
        githubToken.trim(),
        baseUrl.trim(),
        selectedModel,
        selectedOwner && selectedRepo
          ? { owner: selectedOwner, name: selectedRepo, branch: selectedBranch }
          : undefined
      );

      // Clone repo if selected
      if (selectedOwner && selectedRepo) {

        // Clone/update the repo for the user
        setCloneStatus("cloning");
        setCloneMessage(`Cloning ${selectedOwner}/${selectedRepo} (${selectedBranch || "default"} branch)...`);

        try {
          const userId = userInfo?.userid || userInfo?.name || selectedOwner || "unknown";

          const cloneRes = await fetch("/api/ft-runner/ensure-repo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              githubToken: githubToken.trim(),
              owner: selectedOwner,
              repo: selectedRepo,
              branch: selectedBranch || "develop",
            }),
          });
          const cloneData = await cloneRes.json();

          if (cloneData.success) {
            setCloneStatus("ready");
            setCloneMessage(cloneData.cloned ? "Repository cloned successfully" : "Repository updated successfully");
          } else {
            setCloneStatus("error");
            setCloneMessage(cloneData.error || "Failed to clone repository");
          }
        } catch (cloneErr: any) {
          setCloneStatus("error");
          setCloneMessage(cloneErr?.message || "Failed to clone repository");
        }
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/ftbuilder");
      }, 3000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Initialization failed";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
        <Row justify="center" style={{ marginBottom: "32px" }}>
          <Col xs={24} sm={20} md={16} lg={12} xl={10}>
            <Card style={{ boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)" }}>
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                {/* Header */}
                <div>
                  <Title level={2} style={{ margin: 0, marginBottom: "8px" }}>
                    <CloudOutlined /> Initialize FT Builder
                  </Title>
                  <Paragraph style={{ margin: 0, color: "#666" }}>
                    Configure your credentials and select a repository to start building functional tests
                  </Paragraph>
                </div>

                <Divider style={{ margin: "16px 0" }} />

                {success && (
                  <Alert
                    message="Initialization Successful!"
                    description="Your credentials have been saved. Redirecting to FT Builder..."
                    type="success"
                    icon={<CheckCircleOutlined />}
                    showIcon
                  />
                )}

                {error && (
                  <Alert
                    message="Initialization Failed"
                    description={error}
                    type="error"
                    icon={<ExclamationCircleOutlined />}
                    showIcon
                    closable
                    onClose={() => setError(null)}
                  />
                )}

                {initError && !error && (
                  <Alert
                    message="Initialization Error"
                    description={initError}
                    type="error"
                    icon={<ExclamationCircleOutlined />}
                    showIcon
                    closable
                  />
                )}

                <Alert
                  message="What happens during initialization?"
                  description={
                    <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                      <li>Your LLM API key will be validated</li>
                      <li>Your GitHub PAT token will be verified</li>
                      <li>Repository will be cloned/updated for test generation</li>
                      <li>Credentials will be securely stored locally</li>
                    </ul>
                  }
                  type="info"
                  icon={<BulbOutlined />}
                  showIcon
                />

                {/* Form */}
                <Form
                  form={form}
                  layout="vertical"
                  onFinish={handleSubmit}
                  requiredMark={false}
                  autoComplete="off"
                >
                  {/* Base URL */}
                  <Form.Item
                    label="LLM API Base URL"
                    name="baseUrl"
                    rules={[
                      { required: true, message: "Please enter the LLM API base URL" },
                      { pattern: /^https?:\/\/.+/, message: "Please enter a valid URL" },
                    ]}
                    validateStatus={validationErrors.baseUrl ? "error" : ""}
                    help={validationErrors.baseUrl}
                  >
                    <Input
                      prefix={<CloudOutlined />}
                      placeholder="https://api.example.com"
                      disabled={loading || success}
                    />
                  </Form.Item>

                  {/* LLM API Key */}
                  <Form.Item
                    label={
                      <span>
                        LLM API Key{" "}
                        <Tooltip title="Your LLM provider API key">
                          <BulbOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="llmApiKey"
                    rules={[
                      { required: true, message: "Please enter your LLM API key" },
                      { min: 10, message: "API key seems too short" },
                    ]}
                    validateStatus={validationErrors.llm ? "error" : ""}
                    help={validationErrors.llm}
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="sk-... or your API key"
                      disabled={loading || success}
                    />
                  </Form.Item>

                  {/* GitHub PAT */}
                  <Form.Item
                    label={
                      <span>
                        GitHub PAT Token{" "}
                        <Tooltip title="Personal Access Token for GitHub API access">
                          <BulbOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="githubToken"
                    rules={[
                      { required: true, message: "Please enter your GitHub PAT token" },
                      { min: 10, message: "Token seems too short" },
                    ]}
                    validateStatus={validationErrors.github ? "error" : ""}
                    help={validationErrors.github}
                  >
                    <Input.Password
                      prefix={<GithubOutlined />}
                      placeholder="ghp_... or your PAT token"
                      disabled={loading || success}
                      onChange={(e) => {
                        const token = e.target.value;
                        if (token.length > 20) {
                          fetchRepos(token);
                        }
                      }}
                    />
                  </Form.Item>

                  {/* LLM Model */}
                  <Form.Item
                    label={
                      <span>
                        LLM Model{" "}
                        <Tooltip title="Select the AI model. Click Fetch Models after entering Base URL and API Key.">
                          <BulbOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                  >
                    <Space.Compact style={{ width: "100%" }}>
                      <Select
                        placeholder={loadingModels ? "Loading..." : "Select a model"}
                        value={selectedModel}
                        onChange={setSelectedModel}
                        loading={loadingModels}
                        style={{ flex: 1 }}
                        notFoundContent={loadingModels ? <Spin size="small" /> : "Click Fetch Models"}
                        options={availableModels.map((m) => ({ label: m.id, value: m.id }))}
                        showSearch
                        allowClear
                        disabled={loading || success}
                      />
                      <Button
                        icon={<RobotOutlined />}
                        onClick={() => {
                          const v = form.getFieldsValue();
                          fetchModels(v.baseUrl, v.llmApiKey);
                        }}
                        loading={loadingModels}
                        disabled={loading || success}
                      >
                        Fetch Models
                      </Button>
                    </Space.Compact>
                  </Form.Item>

                  <Divider style={{ margin: "16px 0" }}>Repository Selection</Divider>

                  {/* Repository */}
                  <Form.Item
                    label={
                      <span>
                        <ForkOutlined style={{ marginRight: 4 }} />
                        Select Repository *
                      </span>
                    }
                    rules={[{ required: true, message: "Repository is required" }]}
                  >
                    <Select
                      placeholder={reposLoading ? "Loading repositories..." : "Select a repository"}
                      value={selectedRepo ? `${selectedOwner}/${selectedRepo}` : undefined}
                      onChange={handleRepoChange}
                      loading={reposLoading}
                      showSearch
                      filterOption={(input, option) =>
                        (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                      }
                      notFoundContent={
                        reposLoading
                          ? <Spin size="small" />
                          : reposError
                            ? <Text type="danger" style={{ fontSize: 12 }}>{reposError}</Text>
                            : "Enter GitHub PAT token to load repos"
                      }
                      options={repos.map((r) => ({
                        label: r.full_name,
                        value: r.full_name,
                      }))}
                      disabled={loading || success}
                    />
                    {reposError && (
                      <Text type="danger" style={{ fontSize: 11 }}>{reposError}</Text>
                    )}
                  </Form.Item>

                  {/* Branch */}
                  <Form.Item
                    label={
                      <span>
                        <BranchesOutlined style={{ marginRight: 4 }} />
                        Select Branch *
                      </span>
                    }
                    rules={[{ required: true, message: "Branch is required" }]}
                  >
                    <Select
                      placeholder={branchesLoading ? "Loading branches..." : "Select a branch"}
                      value={selectedBranch}
                      onChange={setSelectedBranch}
                      loading={branchesLoading}
                      showSearch
                      notFoundContent={
                        branchesLoading
                          ? <Spin size="small" />
                          : "Select a repository first"
                      }
                      options={branches.map((b) => ({
                        label: b.name,
                        value: b.name,
                      }))}
                      disabled={!selectedRepo || loading || success}
                    />
                  </Form.Item>

                  {/* Clone Status */}
                  {cloneStatus === "cloning" && (
                    <Alert
                      type="info"
                      showIcon
                      icon={<Spin size="small" />}
                      message="Setting up workspace..."
                      description={cloneMessage}
                      style={{ marginBottom: 16, borderRadius: 8 }}
                    />
                  )}
                  {cloneStatus === "ready" && (
                    <Alert
                      type="success"
                      showIcon
                      message="Workspace Ready"
                      description={cloneMessage}
                      style={{ marginBottom: 16, borderRadius: 8 }}
                    />
                  )}
                  {cloneStatus === "error" && (
                    <Alert
                      type="warning"
                      showIcon
                      message="Workspace setup issue"
                      description={`${cloneMessage}. You can retry from the FT Builder page.`}
                      style={{ marginBottom: 16, borderRadius: 8 }}
                    />
                  )}

                  {/* Submit */}
                  <Form.Item>
                    <Button
                      type="primary"
                      size="large"
                      block
                      htmlType="submit"
                      loading={loading || isInitializing}
                      disabled={success || !selectedRepo || !selectedBranch}
                    >
                      {loading || isInitializing
                        ? "Validating and Initializing..."
                        : "Validate & Initialize"}
                    </Button>
                  </Form.Item>
                </Form>

                {/* Help */}
                <div style={{ background: isDark ? "#1f1f1f" : "#fafafa", padding: "12px", borderRadius: "4px" }}>
                  <Text type="secondary" style={{ fontSize: "12px", display: "block", marginBottom: "8px" }}>
                    <strong>Need help?</strong>
                  </Text>
                  <Text type="secondary" style={{ fontSize: "12px" }}>
                    - Get your LLM API key from your provider&apos;s dashboard
                    <br />
                    - Create a GitHub PAT at{" "}
                    <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">
                      github.com/settings/tokens
                    </a>
                    <br />- Select the repository and branch where your tests will be generated
                  </Text>
                </div>
              </Space>
            </Card>
          </Col>
        </Row>
  );
}
