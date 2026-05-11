"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  Row,
  Col,
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Tooltip,
  Select,
  Input,
  Badge,
  Divider,
  Alert,
  Modal,
  Checkbox,
  Spin,
  Empty,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  EyeOutlined,
  BranchesOutlined,
  GithubOutlined,
  PlusOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileAddOutlined,
  EditOutlined,
  DiffOutlined,
  SendOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  LinkOutlined,
  CopyOutlined,
  PullRequestOutlined,
} from "@ant-design/icons";
import dynamic from "next/dynamic";
import { useTheme } from "@/components/ThemeProvider";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const { Text } = Typography;
const { TextArea } = Input;

interface ReviewableFile {
  path: string;
  fileName: string;
  status: "new" | "modified";
  content?: string;
}

interface ReviewFTPanelProps {
  userId?: string;
  githubToken?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  generatedFiles?: Array<{ path: string; name: string; content?: string; status: string }>;
}

export default function ReviewFTPanel({
  userId,
  githubToken,
  owner = "OnePayPal",
  repo = "sparkxnodeweb",
  branch: baseBranch = "main",
  generatedFiles: externalFiles,
}: ReviewFTPanelProps = {}) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("develop");
  const [commitMessage, setCommitMessage] = useState("");
  const [isPushing, setIsPushing] = useState(false);
  const [showNewBranchModal, setShowNewBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [createPR, setCreatePR] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [pushResult, setPushResult] = useState<{ success: boolean; commitSha?: string; branch?: string; filesCommitted?: number; prUrl?: string; error?: string } | null>(null);

  // Real data state
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>("");
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [viewingFile, setViewingFile] = useState<ReviewableFile | null>(null);

  // Build reviewable files from generated files
  const reviewableFiles: ReviewableFile[] = (externalFiles || []).map((f) => ({
    path: f.path,
    fileName: f.name || f.path.split("/").pop() || f.path,
    status: "new" as const,
    content: f.content,
  }));

  // Fetch branches from user's repo
  const fetchBranches = async () => {
    if (!userId) return;
    setBranchesLoading(true);
    try {
      const repoPath = `${process.cwd ? "" : ""}repos/${userId}/${repo}`;
      const res = await fetch(`/api/ft-runner/local-branches?path=${encodeURIComponent(repoPath)}`);
      const data = await res.json();
      if (data.success) {
        setBranches(data.branches || []);
        setCurrentBranch(data.currentBranch || "");
        if (data.currentBranch) {
          setSelectedBranch(data.currentBranch);
        }
      }
    } catch { /* ignore */ }
    setBranchesLoading(false);
  };

  useEffect(() => {
    fetchBranches();
  }, [userId]);

  // Auto-select all files when they appear
  useEffect(() => {
    if (reviewableFiles.length > 0 && selectedFiles.length === 0) {
      setSelectedFiles(reviewableFiles.map((f) => f.path));
    }
  }, [externalFiles]);

  const viewFileContent = async (file: ReviewableFile) => {
    if (file.content) {
      setViewingFile(file);
      return;
    }
    try {
      const searchPath = `${userId}/${repo}/${file.path}`;
      const res = await fetch(`/api/ft-runner/browse-repo?path=${encodeURIComponent(searchPath)}&content=true`);
      const data = await res.json();
      if (data.success && data.content) {
        setViewingFile({ ...file, content: data.content });
        return;
      }
    } catch { /* ignore */ }
    setViewingFile(file);
  };

  const columns: ColumnsType<ReviewableFile> = [
    {
      title: "File",
      dataIndex: "fileName",
      key: "fileName",
      render: (name: string, record: ReviewableFile) => (
        <Space>
          <FileTextOutlined style={{ color: isDark ? "#a78bfa" : "#7c3aed" }} />
          <div>
            <Text strong style={{ display: "block", fontSize: 13, color: isDark ? "#ffffff" : "#1f2937" }}>
              {name}
            </Text>
            <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>
              {record.path.replace(name, "")}
            </Text>
          </div>
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => (
        <Tag
          color={status === "new" ? "success" : "warning"}
          icon={status === "new" ? <FileAddOutlined /> : <EditOutlined />}
          style={{ borderRadius: 4, textTransform: "capitalize" }}
        >
          {status}
        </Tag>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_, record: ReviewableFile) => (
        <Space size={4}>
          <Tooltip title="View Code">
            <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => viewFileContent(record)} />
          </Tooltip>
          <Tooltip title="Copy Path">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(record.path);
                message.success("Path copied!");
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const handlePush = async () => {
    if (!commitMessage.trim()) {
      message.error("Please enter a commit message");
      return;
    }
    if (selectedFiles.length === 0) {
      message.error("Please select files to push");
      return;
    }
    if (!userId || !githubToken) {
      message.error("User ID and GitHub token are required to push");
      return;
    }

    setIsPushing(true);
    try {
      const filesToCommit = selectedFiles.map((filePath) => {
        const genFile = externalFiles?.find((f) => f.path === filePath);
        return { path: filePath, content: genFile?.content || "" };
      });

      const res = await fetch("/api/ft-runner/create-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          githubToken,
          owner,
          repo,
          branch: selectedBranch || baseBranch,
          files: filesToCommit,
          prTitle: createPR ? (prTitle || commitMessage) : undefined,
          prDescription: createPR
            ? `## Auto-Generated Functional Tests\n\nGenerated by FT Builder.\n\n### Files\n${selectedFiles.map((f) => `- \`${f}\``).join("\n")}`
            : undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setPushResult({
          success: true,
          commitSha: data.commitSha || data.branch,
          branch: data.branch,
          filesCommitted: data.filesCommitted || selectedFiles.length,
          prUrl: data.prUrl,
        });
        message.success(data.prUrl ? "PR created successfully!" : "Pushed to branch!");
      } else {
        setPushResult({ success: false, error: data.error || "Push failed" });
        message.error(data.error || "Failed to push");
      }
    } catch (err: any) {
      setPushResult({ success: false, error: err.message });
      message.error(err.message || "Failed to push");
    } finally {
      setIsPushing(false);
    }
  };

  const handleCreateBranch = () => {
    if (!newBranchName.trim()) {
      message.error("Please enter a branch name");
      return;
    }
    setSelectedBranch(newBranchName);
    setBranches((prev) => [...prev, newBranchName]);
    setShowNewBranchModal(false);
    setNewBranchName("");
    message.success(`Branch "${newBranchName}" will be created on push`);
  };

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  if (!externalFiles || externalFiles.length === 0) {
    return (
      <div style={{ padding: "40px 16px", textAlign: "center" }}>
        <Empty
          description={
            <Space direction="vertical" size={4}>
              <Text style={{ color: isDark ? "#9ca3af" : "#6b7280" }}>
                No generated test files to review yet
              </Text>
              <Text style={{ fontSize: 12, color: isDark ? "#6b7280" : "#9ca3af" }}>
                Generate and run tests in the previous tabs first. After a run completes, files will appear here for review and commit.
              </Text>
            </Space>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 16px 16px" }}>
      <Row gutter={[20, 20]}>
        {/* Left Column - File Selection */}
        <Col xs={24} lg={14}>
          <Card
            title={
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <Space>
                  <FileTextOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
                  <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
                    Generated Files
                  </Text>
                  <Badge count={reviewableFiles.length} style={{ backgroundColor: "#7c3aed" }} />
                </Space>
                <Button type="text" size="small" icon={<ReloadOutlined />} onClick={fetchBranches}>
                  Refresh
                </Button>
              </Space>
            }
            style={cardStyle}
            styles={{ body: { padding: "12px 16px" } }}
          >
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
              {selectedFiles.length} of {reviewableFiles.length} selected
            </Text>

            <Table
              rowSelection={{
                selectedRowKeys: selectedFiles,
                onChange: (keys) => setSelectedFiles(keys as string[]),
              }}
              columns={columns}
              dataSource={reviewableFiles}
              rowKey="path"
              size="small"
              pagination={false}
              scroll={{ y: 400 }}
              style={{ background: isDark ? "#1f2937" : "#ffffff", borderRadius: 8 }}
            />

            <Space style={{ marginTop: 12 }}>
              <Button size="small" onClick={() => setSelectedFiles(reviewableFiles.map((f) => f.path))}>
                Select All
              </Button>
              <Button size="small" onClick={() => setSelectedFiles([])}>
                Deselect All
              </Button>
            </Space>
          </Card>
        </Col>

        {/* Right Column - Push Configuration */}
        <Col xs={24} lg={10}>
          <Card
            title={
              <Space>
                <BranchesOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
                <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
                  Push to Git
                </Text>
              </Space>
            }
            style={cardStyle}
            styles={{ body: { padding: "16px 20px" } }}
          >
            {/* Branch Selection */}
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: "block", marginBottom: 8, color: isDark ? "#e5e7eb" : "#374151", fontSize: 13 }}>
                Target Branch
              </Text>
              <Space.Compact style={{ width: "100%" }}>
                <Select
                  value={selectedBranch}
                  onChange={setSelectedBranch}
                  style={{ width: "calc(100% - 40px)" }}
                  loading={branchesLoading}
                  showSearch
                  optionFilterProp="label"
                  options={branches.map((b) => ({
                    value: b,
                    label: (
                      <Space>
                        <BranchesOutlined style={{ color: b === currentBranch ? "#059669" : "#9ca3af" }} />
                        <span>{b}</span>
                        {b === currentBranch && (
                          <Tag color="success" style={{ fontSize: 10, marginLeft: 4 }}>current</Tag>
                        )}
                      </Space>
                    ),
                  }))}
                />
                <Tooltip title="Create New Branch">
                  <Button icon={<PlusOutlined />} onClick={() => setShowNewBranchModal(true)} />
                </Tooltip>
              </Space.Compact>
            </div>

            {/* Commit Message */}
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: "block", marginBottom: 8, color: isDark ? "#e5e7eb" : "#374151", fontSize: 13 }}>
                Commit Message
              </Text>
              <TextArea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="feat: Add functional tests for refund workflow..."
                rows={3}
                maxLength={500}
                showCount
              />
              <Space style={{ marginTop: 8 }} wrap>
                <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>Quick:</Text>
                {["feat: Add FT tests", "fix: Update FT assertions", "test: Improve coverage"].map((template) => (
                  <Tag key={template} style={{ cursor: "pointer", borderRadius: 4 }} onClick={() => setCommitMessage(template)}>
                    {template}
                  </Tag>
                ))}
              </Space>
            </div>

            {/* Create PR Option */}
            <div style={{ padding: "12px", background: isDark ? "#1f2937" : "#f9fafb", borderRadius: 8, marginBottom: 16 }}>
              <Checkbox checked={createPR} onChange={(e) => setCreatePR(e.target.checked)}>
                <Space direction="vertical" size={2}>
                  <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937", fontSize: 13 }}>
                    <PullRequestOutlined style={{ marginRight: 6 }} />
                    Create Pull Request
                  </Text>
                  <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>
                    Automatically create a PR after pushing
                  </Text>
                </Space>
              </Checkbox>
              {createPR && (
                <div style={{ marginTop: 12, paddingLeft: 24 }}>
                  <Input
                    placeholder="PR Title (optional - uses commit message if empty)"
                    value={prTitle}
                    onChange={(e) => setPrTitle(e.target.value)}
                    prefix={<EditOutlined />}
                  />
                </div>
              )}
            </div>

            {/* Summary */}
            <div style={{ padding: "12px", background: isDark ? "linear-gradient(135deg, #1f2937 0%, #312e81 100%)" : "linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)", borderRadius: 8, marginBottom: 16 }}>
              <Row gutter={[16, 8]}>
                <Col span={12}>
                  <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280", display: "block" }}>Files Selected</Text>
                  <Text strong style={{ fontSize: 18, color: isDark ? "#ffffff" : "#1f2937" }}>{selectedFiles.length}</Text>
                </Col>
                <Col span={12}>
                  <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280", display: "block" }}>Branch</Text>
                  <Text strong style={{ fontSize: 14, color: isDark ? "#60a5fa" : "#2563eb" }}>{selectedBranch || "—"}</Text>
                </Col>
              </Row>
            </div>

            <Divider style={{ margin: "16px 0" }} />

            <Button
              type="primary"
              size="large"
              icon={<SendOutlined />}
              onClick={handlePush}
              loading={isPushing}
              disabled={selectedFiles.length === 0 || !commitMessage.trim()}
              block
              style={{
                height: 48,
                borderRadius: 8,
                background: selectedFiles.length === 0 || !commitMessage.trim() ? undefined : "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)",
                border: "none",
                fontWeight: 600,
              }}
            >
              {isPushing ? "Pushing..." : createPR ? "Push & Create PR" : `Push ${selectedFiles.length} File(s)`}
            </Button>

            {pushResult && (
              <Alert
                type={pushResult.success ? "success" : "error"}
                showIcon
                style={{ marginTop: 16, borderRadius: 8 }}
                message={pushResult.success ? "Successfully Pushed!" : "Push Failed"}
                description={
                  pushResult.success ? (
                    <Space direction="vertical" size={4}>
                      {pushResult.commitSha && (
                        <Text style={{ fontSize: 12 }}>Commit: <Text code style={{ fontSize: 11 }}>{pushResult.commitSha}</Text></Text>
                      )}
                      <Text style={{ fontSize: 12 }}>Branch: <Text strong>{pushResult.branch}</Text></Text>
                      <Text style={{ fontSize: 12 }}>{pushResult.filesCommitted} file(s) committed</Text>
                      {pushResult.prUrl && (
                        <Button type="link" size="small" icon={<LinkOutlined />} href={pushResult.prUrl} target="_blank" style={{ padding: 0, height: "auto" }}>
                          View Pull Request
                        </Button>
                      )}
                    </Space>
                  ) : pushResult.error
                }
              />
            )}
          </Card>

          {/* Connection Status */}
          <Card style={{ ...cardStyle, marginTop: 16 }} styles={{ body: { padding: "12px 16px" } }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Space>
                <GithubOutlined style={{ fontSize: 20, color: isDark ? "#ffffff" : "#1f2937" }} />
                <div>
                  <Text strong style={{ display: "block", fontSize: 13, color: isDark ? "#ffffff" : "#1f2937" }}>
                    {repo}
                  </Text>
                  <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>
                    {owner}/{repo}
                  </Text>
                </div>
              </Space>
              <Tag
                icon={githubToken ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                color={githubToken ? "success" : "error"}
                style={{ borderRadius: 4 }}
              >
                {githubToken ? "Connected" : "No Token"}
              </Tag>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* File Viewer Modal */}
      <Modal
        title={
          <Space>
            <FileTextOutlined style={{ color: "#7c3aed" }} />
            <Text strong>{viewingFile?.fileName}</Text>
          </Space>
        }
        open={!!viewingFile}
        onCancel={() => setViewingFile(null)}
        width={1000}
        footer={null}
        styles={{ body: { padding: 0 } }}
      >
        {viewingFile && (
          <>
            <div style={{ padding: "8px 16px", background: isDark ? "#1f2937" : "#f3f4f6", fontSize: 11, fontFamily: "monospace", color: isDark ? "#9ca3af" : "#6b7280" }}>
              {viewingFile.path}
            </div>
            <MonacoEditor
              height="500px"
              language="typescript"
              theme={isDark ? "vs-dark" : "light"}
              value={viewingFile.content || "// Content not available"}
              options={{
                readOnly: true,
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

      {/* New Branch Modal */}
      <Modal
        title={
          <Space>
            <PlusOutlined style={{ color: "#7c3aed" }} />
            <Text strong>Create New Branch</Text>
          </Space>
        }
        open={showNewBranchModal}
        onCancel={() => setShowNewBranchModal(false)}
        onOk={handleCreateBranch}
        okText="Create Branch"
      >
        <div style={{ marginBottom: 16 }}>
          <Text style={{ display: "block", marginBottom: 8, color: isDark ? "#e5e7eb" : "#374151" }}>
            Branch Name
          </Text>
          <Input
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="feature/my-new-tests"
            prefix={<BranchesOutlined />}
          />
          <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
            Branch will be created from current branch on push
          </Text>
        </div>
      </Modal>
    </div>
  );
}
