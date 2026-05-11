"use client";

import React, { useEffect, useState } from "react";
import { App, Card, Table, Tag, Space, Typography, Button, Empty, Modal, Descriptions, Timeline, Alert, Tooltip, Popconfirm } from "antd";
import {
  HistoryOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  ClearOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";

const { Text } = Typography;

interface RunHistoryItem {
  run_id: string;
  owner: string;
  repo: string;
  branch: string;
  spec_pattern: string;
  browser: string;
  run_mode: string;
  status: string;
  conclusion: string | null;
  total_specs: number;
  passed_specs: number;
  failed_specs: number;
  duration_ms: number;
  triggered_by: string;
  created_at: string;
}

interface RunDetail {
  runId: string;
  branch: string;
  conclusion: string | null;
  summary: { total: number; passed: number; failed: number; duration: number };
  results: Array<{
    file: string;
    testName: string;
    status: string;
    duration: number;
    error?: string;
  }>;
  complianceResults: Array<{
    testPath: string;
    score: number;
    passed: boolean;
    checks: Array<{ rule: string; passed: boolean; severity: string; message: string }>;
  }>;
  screenshots: string[];
  browser: string;
  runMode: string;
  createdAt: string;
  errorMessage?: string;
}

interface RunHistoryProps {
  owner: string;
  repo: string;
  onSelectRun?: (runId: string) => void;
  refreshKey?: number;
}

export default function RunHistory({ owner, repo, onSelectRun, refreshKey }: RunHistoryProps) {
  const { currentTheme } = useTheme();
  const { modal, message } = App.useApp();
  const isDark = currentTheme === "dark";

  const [runs, setRuns] = useState<RunHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<RunDetail | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      // Pass owner+repo as filters when available; omitting them returns all history
      const body: Record<string, unknown> = { limit: 10, offset: 0 };
      if (owner && repo) { body.owner = owner; body.repo = repo; }
      const res = await fetch("/api/ft-runner/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setRuns(data.runs);
        setTotal(data.total);
      }
    } catch (err) {
      console.error("Failed to fetch run history:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (runId: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    setDetail(null);

    try {
      const [resultsRes, statusRes] = await Promise.all([
        fetch(`/api/ft-runner/results?runId=${runId}`),
        fetch(`/api/ft-runner/status?runId=${runId}`),
      ]);

      const resultsData = await resultsRes.json();
      const statusData = await statusRes.json();

      if (resultsData.success) {
        setDetail({
          ...resultsData,
          complianceResults: resultsData.complianceResults || [],
          errorMessage: statusData?.errorMessage || resultsData?.errorMessage,
        });
      }
    } catch (err) {
      console.error("Failed to fetch run details:", err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    try {
      const res = await fetch("/api/ft-runner/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", runId }),
      });
      const data = await res.json();
      if (data.success) {
        message.success("Run deleted");
        fetchHistory();
      } else {
        message.error(data.message || "Failed to delete run");
      }
    } catch {
      message.error("Failed to delete run");
    }
  };

  const handleClearHistory = () => {
    modal.confirm({
      title: "Clear Run History",
      icon: <ExclamationCircleOutlined />,
      content: owner && repo
        ? `Delete all ${total} run record(s) for ${owner}/${repo}?`
        : `Delete all ${total} run record(s)?`,
      okText: "Clear All",
      okType: "danger",
      onOk: async () => {
        try {
          const res = await fetch("/api/ft-runner/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              owner && repo
                ? { action: "delete", owner, repo, clearAll: true }
                : { action: "delete", clearAll: true }
            ),
          });
          const data = await res.json();
          if (data.success) {
            message.success(data.message);
            fetchHistory();
          } else {
            message.error(data.message || "Failed to clear history");
          }
        } catch {
          message.error("Failed to clear history");
        }
      },
    });
  };

  useEffect(() => {
    fetchHistory();
  }, [owner, repo, refreshKey]);

  const columns = [
    {
      title: "Run ID",
      dataIndex: "run_id",
      key: "run_id",
      width: 180,
      render: (id: string) => (
        <Text code style={{ fontSize: 11 }}>
          {id.slice(0, 22)}...
        </Text>
      ),
    },
    {
      title: "Branch",
      dataIndex: "branch",
      key: "branch",
      render: (_: string, record: RunHistoryItem) => {
        const isLocal = record.owner === "local";
        const branch = record.branch && record.branch !== "local" ? record.branch : null;
        const label = isLocal
          ? `local / ${record.repo || "—"}${branch ? ` / ${branch}` : ""}`
          : `${record.owner}/${record.repo} @ ${record.branch}`;
        return <Tag style={{ borderRadius: 4, fontFamily: "monospace", fontSize: 11 }}>{label}</Tag>;
      },
    },
    {
      title: "Result",
      key: "result",
      width: 120,
      render: (_: any, record: RunHistoryItem) => {
        if (record.status === "completed") {
          return record.conclusion === "success" ? (
            <Space>
              <CheckCircleOutlined style={{ color: "#059669" }} />
              <Text style={{ color: "#059669", fontSize: 12 }}>
                {record.passed_specs}/{record.total_specs}
              </Text>
            </Space>
          ) : (
            <Space>
              <CloseCircleOutlined style={{ color: "#dc2626" }} />
              <Text style={{ color: "#dc2626", fontSize: 12 }}>
                {record.passed_specs}/{record.total_specs}
              </Text>
            </Space>
          );
        }
        if (record.status === "failed") {
          return <Tag color="error">Error</Tag>;
        }
        return <Tag color="processing">{record.status}</Tag>;
      },
    },
    {
      title: "Duration",
      dataIndex: "duration_ms",
      key: "duration",
      width: 100,
      render: (ms: number) => (
        <Space>
          <ClockCircleOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb", fontSize: 12 }} />
          <Text style={{ fontSize: 12 }}>
            {ms <= 0
              ? "—"
              : ms > 60000
              ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
              : `${Math.round(ms / 1000)}s`}
          </Text>
        </Space>
      ),
    },
    {
      title: "By",
      dataIndex: "triggered_by",
      key: "triggered_by",
      width: 80,
      render: (by: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{by}</Text>
      ),
    },
    {
      title: "Date",
      dataIndex: "created_at",
      key: "created_at",
      width: 140,
      render: (date: string) => (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {new Date(date).toLocaleString()}
        </Text>
      ),
    },
    {
      title: "",
      key: "action",
      width: 90,
      render: (_: any, record: RunHistoryItem) => (
        <Space size={0}>
          <Tooltip title="View details">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => fetchDetail(record.run_id)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this run?"
            onConfirm={() => handleDeleteRun(record.run_id)}
            okText="Delete"
            okType="danger"
          >
            <Tooltip title="Delete">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  // Render even without owner/repo — shows all history in that case

  const durationStr = (ms: number) =>
    ms > 60000
      ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
      : `${Math.round(ms / 1000)}s`;

  return (
    <>
      <Card
        title={
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <Space>
              <HistoryOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
              <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
                Run History
              </Text>
              {total > 0 && (
                <Tag color="blue" style={{ borderRadius: 4 }}>
                  {total} runs
                </Tag>
              )}
            </Space>
            <Space>
              {total > 0 && (
                <Tooltip title="Clear all history">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<ClearOutlined />}
                    onClick={handleClearHistory}
                  >
                    Clear
                  </Button>
                </Tooltip>
              )}
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={fetchHistory}
                loading={loading}
              />
            </Space>
          </Space>
        }
        style={cardStyle}
        styles={{ body: { padding: "0 0 8px" } }}
      >
        {runs.length === 0 && !loading ? (
          <Empty description="No runs yet" style={{ padding: 24 }} />
        ) : (
          <Table
            dataSource={runs}
            columns={columns}
            rowKey="run_id"
            loading={loading}
            pagination={false}
            size="small"
            style={{ background: "transparent" }}
          />
        )}
      </Card>

      {/* Detail Modal */}
      <Modal
        title={
          <Space>
            {detail?.conclusion === "success" ? (
              <CheckCircleOutlined style={{ color: "#059669" }} />
            ) : (
              <CloseCircleOutlined style={{ color: "#dc2626" }} />
            )}
            <span>Run Details</span>
            {detail?.conclusion && (
              <Tag color={detail.conclusion === "success" ? "success" : "error"}>
                {detail.conclusion === "success" ? "Passed" : "Failed"}
              </Tag>
            )}
          </Space>
        }
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={700}
        loading={detailLoading}
      >
        {detail && (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {/* Summary */}
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Run ID">
                <Text code style={{ fontSize: 11 }}>{detail.runId}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Branch">
                <Tag>{detail.branch}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Browser">{detail.browser}</Descriptions.Item>
              <Descriptions.Item label="Mode">{detail.runMode}</Descriptions.Item>
              <Descriptions.Item label="Total">{detail.summary.total}</Descriptions.Item>
              <Descriptions.Item label="Duration">{durationStr(detail.summary.duration)}</Descriptions.Item>
              <Descriptions.Item label="Passed">
                <Text style={{ color: detail.summary.passed > 0 ? "#059669" : "#6b7280" }}>
                  {detail.summary.passed}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Failed">
                <Text style={{ color: detail.summary.failed > 0 ? "#dc2626" : "#6b7280" }}>
                  {detail.summary.failed}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Date" span={2}>
                {new Date(detail.createdAt).toLocaleString()}
              </Descriptions.Item>
            </Descriptions>

            {/* No tests ran warning */}
            {detail.summary.total === 0 && detail.conclusion !== "success" && (
              <Alert
                type="warning"
                showIcon
                message="No tests were executed"
                description="The run failed before Cypress could run any tests — likely a setup, server-start, or spec-resolution error. Check the error details below."
              />
            )}

            {/* Error message */}
            {detail.errorMessage && (
              <Alert
                type="error"
                icon={<ExclamationCircleOutlined />}
                showIcon
                message="Error Details"
                description={
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 11,
                      maxHeight: 200,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {detail.errorMessage}
                  </pre>
                }
              />
            )}

            {/* Compliance Improvement Plan — advisory only, never affects pass/fail */}
            {detail.complianceResults?.length > 0 && (
              <div>
                <Space style={{ marginBottom: 8 }}>
                  <Text strong>Compliance Improvement Plan</Text>
                  <Tag color="orange" style={{ fontSize: 11 }}>Advisory</Tag>
                </Space>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="These findings do not affect your test results. They are code-quality suggestions for AI-generated test standards."
                />
                {detail.complianceResults.map((cr) => (
                  <div
                    key={cr.testPath}
                    style={{
                      padding: "10px 14px",
                      border: `1px solid ${cr.passed ? "#a7f3d0" : "#fcd34d"}`,
                      borderRadius: 8,
                      marginBottom: 8,
                      background: cr.passed ? "#ecfdf5" : "#fffbeb",
                    }}
                  >
                    <Space style={{ width: "100%", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 12, fontWeight: 600 }}>
                        {cr.testPath.split("/").pop()}
                      </Text>
                      <Tag color={cr.score >= 90 ? "success" : cr.score >= 70 ? "warning" : "error"}>
                        {cr.score}% compliance
                      </Tag>
                    </Space>
                    {cr.checks?.filter((c) => !c.passed).length > 0 && (
                      <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 11, color: "#92400e" }}>
                        {cr.checks.filter((c) => !c.passed).map((c, i) => (
                          <li key={i}><strong>{c.rule}</strong>{c.message ? ` — ${c.message}` : ""}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Test results */}
            {detail.results.length > 0 && (
              <div>
                <Text strong style={{ display: "block", marginBottom: 8 }}>
                  Test Results
                </Text>
                <div style={{ maxHeight: 300, overflow: "auto" }}>
                  <Timeline
                    items={detail.results.map((r) => ({
                      color: r.status === "passed" ? "green" : r.status === "failed" ? "red" : "gray",
                      children: (
                        <div>
                          <Space style={{ width: "100%", justifyContent: "space-between" }}>
                            <Text
                              style={{
                                fontSize: 12,
                                color: r.status === "passed" ? "#059669" : r.status === "failed" ? "#dc2626" : "#6b7280",
                              }}
                            >
                              {r.testName || r.file.split("/").pop()}
                            </Text>
                            {r.duration > 0 && (
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {(r.duration / 1000).toFixed(1)}s
                              </Text>
                            )}
                          </Space>
                          {r.error && (
                            <div
                              style={{
                                marginTop: 4,
                                padding: "4px 8px",
                                background: "#fef2f2",
                                borderRadius: 4,
                                fontSize: 11,
                                color: "#991b1b",
                                fontFamily: "monospace",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {r.error}
                            </div>
                          )}
                        </div>
                      ),
                    }))}
                  />
                </div>
              </div>
            )}
          </Space>
        )}
      </Modal>
    </>
  );
}
