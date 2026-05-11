"use client";

import React, { useState, useEffect } from "react";
import {
  App,
  Card,
  Select,
  Input,
  Button,
  Space,
  Typography,
  Spin,
  Alert,
  Tag,
  Row,
  Col,
  Tooltip,
} from "antd";
import {
  GithubOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  UserOutlined,
  KeyOutlined,
  ClearOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";

const { Text } = Typography;

interface RepoOption {
  name: string;
  full_name: string;
  description: string;
  updated_at: string;
  owner: string;
}

interface BranchOption {
  name: string;
  sha: string;
  protected: boolean;
}

interface RepoSelectorProps {
  onRepoSelected: (owner: string, repo: string) => void;
  onBranchSelected: (branch: string) => void;
  selectedOwner: string;
  selectedRepo: string;
  selectedBranch: string;
  githubToken: string;
  onTokenSaved?: (token: string) => void;
  disabled?: boolean;
  userId?: string;
}

export default function RepoSelector({
  onRepoSelected,
  onBranchSelected,
  selectedOwner,
  selectedRepo,
  selectedBranch,
  githubToken,
  onTokenSaved,
  disabled,
  userId,
}: RepoSelectorProps) {
  const { currentTheme } = useTheme();
  const { message } = App.useApp();
  const isDark = currentTheme === "dark";

  // Token input state
  const [tokenInput, setTokenInput] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  // Cleanup state
  const [cleaningUp, setCleaningUp] = useState(false);

  // Fetch repos when token is available
  useEffect(() => {
    if (!githubToken) return;

    const fetchRepos = async () => {
      setReposLoading(true);
      setReposError(null);

      try {
        const res = await fetch("/api/ft-runner/repos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ githubToken }),
        });

        const data = await res.json();
        if (data.success) {
          setUsername(data.user);
          setRepos(data.repos);
        } else {
          setReposError(data.message || "Failed to fetch repositories");
        }
      } catch (err: any) {
        setReposError(err?.message || "Failed to fetch repositories");
      } finally {
        setReposLoading(false);
      }
    };

    fetchRepos();
  }, [githubToken]);

  // Fetch branches when a repo is selected
  useEffect(() => {
    if (!selectedOwner || !selectedRepo || !githubToken) {
      setBranches([]);
      return;
    }

    const fetchBranches = async () => {
      setBranchesLoading(true);
      setBranchesError(null);
      setBranches([]);

      try {
        const res = await fetch("/api/ft-runner/branches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: selectedOwner,
            repo: selectedRepo,
            githubToken,
          }),
        });

        const data = await res.json();
        if (data.success) {
          setBranches(data.branches);
        } else {
          setBranchesError(data.message || "Failed to fetch branches");
        }
      } catch (err: any) {
        setBranchesError(err?.message || "Failed to fetch branches");
      } finally {
        setBranchesLoading(false);
      }
    };

    fetchBranches();
  }, [selectedOwner, selectedRepo, githubToken]);

  const handleTokenSubmit = async () => {
    const token = tokenInput.trim();
    if (!token) return;

    setTokenLoading(true);
    setTokenError(null);

    try {
      // Validate the token by trying to fetch repos
      const res = await fetch("/api/ft-runner/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubToken: token }),
      });

      const data = await res.json();
      if (data.success) {
        onTokenSaved?.(token);
        setTokenInput("");
      } else {
        setTokenError(data.message || "Invalid token or failed to fetch repositories");
      }
    } catch (err: any) {
      setTokenError(err?.message || "Failed to validate token");
    } finally {
      setTokenLoading(false);
    }
  };

  const handleRepoChange = (value: string) => {
    const selected = repos.find((r) => r.full_name === value);
    if (selected) {
      onRepoSelected(selected.owner, selected.name);
      onBranchSelected(""); // reset branch on repo change
    }
  };

  const handleBranchChange = (value: string) => {
    onBranchSelected(value);
  };

  const handleCleanup = async () => {
    if (!userId) {
      message.warning("Cannot clean up — user session not ready");
      return;
    }
    setCleaningUp(true);
    try {
      const res = await fetch("/api/ft-runner/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.success) {
        message.success(data.message);
      } else {
        message.error(data.message || "Cleanup failed");
      }
    } catch (err: any) {
      message.error(err?.message || "Cleanup failed");
    } finally {
      setCleaningUp(false);
    }
  };

  const connected = !!selectedOwner && !!selectedRepo && !!selectedBranch;

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  };

  return (
    <Card
      title={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Space>
            <GithubOutlined style={{ color: isDark ? "#34d399" : "#059669" }} />
            <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
              Repository
            </Text>
            {username && (
              <Tag icon={<UserOutlined />} style={{ borderRadius: 4 }}>
                {username}
              </Tag>
            )}
            {connected && (
              <Tag color="success" style={{ borderRadius: 4 }}>
                <CheckCircleOutlined /> Connected
              </Tag>
            )}
          </Space>
          <Tooltip title="Kill stale processes & clean up temp files">
            <Button
              icon={<ClearOutlined />}
              onClick={handleCleanup}
              loading={cleaningUp}
              size="small"
              danger
              type="text"
            >
              Cleanup
            </Button>
          </Tooltip>
        </div>
      }
      style={cardStyle}
      styles={{ body: { padding: "16px 20px" } }}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {/* Token input when no token is available */}
        {!githubToken && (
          <div
            style={{
              padding: "16px",
              background: isDark ? "#1e293b" : "#fffbeb",
              border: `1px solid ${isDark ? "#475569" : "#fcd34d"}`,
              borderRadius: 8,
            }}
          >
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Text strong style={{ fontSize: 13 }}>
                <KeyOutlined /> GitHub Personal Access Token
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Enter your GitHub PAT to load your repositories. The token is stored locally in your browser.
              </Text>
              <Row gutter={8}>
                <Col flex="auto">
                  <Input.Password
                    placeholder="ghp_xxxxxxxxxxxx or your GitHub Enterprise PAT"
                    value={tokenInput}
                    onChange={(e) => {
                      setTokenInput(e.target.value);
                      setTokenError(null);
                    }}
                    onPressEnter={handleTokenSubmit}
                    size="large"
                    prefix={<KeyOutlined style={{ color: isDark ? "#9ca3af" : "#6b7280" }} />}
                  />
                </Col>
                <Col>
                  <Button
                    type="primary"
                    onClick={handleTokenSubmit}
                    loading={tokenLoading}
                    disabled={!tokenInput.trim()}
                    size="large"
                    style={{
                      background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                      border: "none",
                    }}
                  >
                    Connect
                  </Button>
                </Col>
              </Row>
              {tokenError && (
                <Alert
                  type="error"
                  message={tokenError}
                  showIcon
                  closable
                  onClose={() => setTokenError(null)}
                  style={{ marginTop: 4 }}
                />
              )}
            </Space>
          </div>
        )}

        {/* Repo Selector — only show when token is available */}
        {githubToken && (
          <div>
            <Text
              style={{
                fontSize: 12,
                color: isDark ? "#9ca3af" : "#6b7280",
                display: "block",
                marginBottom: 4,
              }}
            >
              Select Repository
            </Text>
            <Select
              showSearch
              placeholder={
                reposLoading
                  ? "Loading repositories..."
                  : "Search and select a repository"
              }
              value={
                selectedOwner && selectedRepo
                  ? `${selectedOwner}/${selectedRepo}`
                  : undefined
              }
              onChange={handleRepoChange}
              loading={reposLoading}
              disabled={disabled || reposLoading}
              style={{ width: "100%" }}
              size="large"
              filterOption={(input, option) =>
                (option?.label ?? "")
                  .toLowerCase()
                  .includes(input.toLowerCase()) ||
                (option?.description ?? "")
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              options={repos.map((r) => ({
                value: r.full_name,
                label: r.full_name,
                description: r.description,
              }))}
              optionRender={(option) => {
                const r = repos.find((repo) => repo.full_name === option.value);
                return (
                  <Space
                    direction="vertical"
                    size={0}
                    style={{ padding: "2px 0" }}
                  >
                    <Space>
                      <Text strong style={{ fontSize: 13 }}>
                        {option.label}
                      </Text>
                      {r?.updated_at && (
                        <Text
                          type="secondary"
                          style={{ fontSize: 11 }}
                        >
                          updated {formatDate(r.updated_at)}
                        </Text>
                      )}
                    </Space>
                    {r?.description && r.description !== "No description" && (
                      <Text
                        type="secondary"
                        style={{ fontSize: 11 }}
                        ellipsis
                      >
                        {r.description}
                      </Text>
                    )}
                  </Space>
                );
              }}
              notFoundContent={
                reposLoading ? (
                  <Spin size="small" />
                ) : (
                  <Text type="secondary">No repositories found</Text>
                )
              }
            />
          </div>
        )}

        {/* Branch Selector */}
        {githubToken && selectedOwner && selectedRepo && (
          <div>
            <Text
              style={{
                fontSize: 12,
                color: isDark ? "#9ca3af" : "#6b7280",
                display: "block",
                marginBottom: 4,
              }}
            >
              Select Branch
            </Text>
            <Select
              showSearch
              placeholder={
                branchesLoading
                  ? "Loading branches..."
                  : "Search and select a branch"
              }
              value={selectedBranch || undefined}
              onChange={handleBranchChange}
              loading={branchesLoading}
              disabled={disabled || branchesLoading}
              style={{ width: "100%" }}
              size="large"
              filterOption={(input, option) =>
                (option?.label ?? "")
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              options={branches.map((b) => ({
                value: b.name,
                label: b.name,
              }))}
              optionRender={(option) => {
                const b = branches.find(
                  (branch) => branch.name === option.value
                );
                return (
                  <Space>
                    <BranchesOutlined
                      style={{
                        color: isDark ? "#34d399" : "#059669",
                      }}
                    />
                    <Text style={{ fontSize: 13 }}>{option.label}</Text>
                    {b?.protected && (
                      <Tag
                        color="orange"
                        style={{ fontSize: 10, borderRadius: 4 }}
                      >
                        protected
                      </Tag>
                    )}
                  </Space>
                );
              }}
              notFoundContent={
                branchesLoading ? (
                  <Spin size="small" />
                ) : (
                  <Text type="secondary">No branches found</Text>
                )
              }
            />
          </div>
        )}

        {/* Errors */}
        {reposError && (
          <Alert
            type="error"
            message={reposError}
            showIcon
            closable
            onClose={() => setReposError(null)}
          />
        )}
        {branchesError && (
          <Alert
            type="error"
            message={branchesError}
            showIcon
            closable
            onClose={() => setBranchesError(null)}
          />
        )}

        {/* Connected summary */}
        {connected && (
          <div
            style={{
              padding: "10px 14px",
              background: isDark ? "#064e3b20" : "#ecfdf5",
              border: `1px solid ${isDark ? "#065f46" : "#a7f3d0"}`,
              borderRadius: 8,
              display: "flex",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div>
              <Text
                style={{
                  fontSize: 11,
                  color: isDark ? "#9ca3af" : "#6b7280",
                  display: "block",
                }}
              >
                Repository
              </Text>
              <Text
                strong
                style={{
                  fontSize: 13,
                  color: isDark ? "#ffffff" : "#1f2937",
                }}
              >
                {selectedOwner}/{selectedRepo}
              </Text>
            </div>
            <div>
              <Text
                style={{
                  fontSize: 11,
                  color: isDark ? "#9ca3af" : "#6b7280",
                  display: "block",
                }}
              >
                Branch
              </Text>
              <Space>
                <BranchesOutlined
                  style={{ color: isDark ? "#34d399" : "#059669" }}
                />
                <Text
                  strong
                  style={{
                    fontSize: 13,
                    color: isDark ? "#34d399" : "#059669",
                  }}
                >
                  {selectedBranch}
                </Text>
              </Space>
            </div>
          </div>
        )}
      </Space>
    </Card>
  );
}
