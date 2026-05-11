"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  Row,
  Col,
  Table,
  Space,
  Typography,
  Tag,
  Statistic,
  Timeline,
  Select,
  Button,
  Empty,
  Spin,
  Tooltip,
  Progress,
  Collapse,
} from "antd";
import {
  RobotOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  EyeOutlined,
  CodeOutlined,
  BulbOutlined,
  ApiOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";

const { Text, Title } = Typography;

interface TraceEntry {
  id: number;
  timestamp: string;
  agent: string;
  action: string;
  targetFile?: string;
  decision?: string;
  reason?: string;
  durationMs?: number;
  tokenCount?: number;
  model?: string;
  success?: boolean;
  error?: string;
  metadata?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    latencyMs?: number;
    model?: string;
    prompt?: string;
    response?: string;
  };
}

interface TraceSummary {
  totalCalls: number;
  totalTokens: number;
  totalLatencyMs: number;
  costEstimate: number;
  agentBreakdown: Record<string, {
    calls: number;
    tokens: number;
    latencyMs: number;
    successes: number;
    failures: number;
  }>;
}

interface AgentTracesPanelProps {
  latestRunId?: string;
}

const AGENT_COLORS: Record<string, string> = {
  supervisor: "#2563eb",
  generator: "#7c3aed",
  compliance: "#059669",
};

const AGENT_ICONS: Record<string, React.ReactNode> = {
  supervisor: <BulbOutlined />,
  generator: <CodeOutlined />,
  compliance: <CheckCircleOutlined />,
};

export default function AgentTracesPanel({ latestRunId }: AgentTracesPanelProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const [runId, setRunId] = useState<string>(latestRunId || "");
  const [loading, setLoading] = useState(false);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [summary, setSummary] = useState<TraceSummary | null>(null);
  const [runHistory, setRunHistory] = useState<Array<{ runId: string; createdAt: string; conclusion: string }>>([]);
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filteredTraces = traces.filter((t) => {
    if (filterAgent !== "all" && t.agent !== filterAgent) return false;
    if (filterStatus === "success" && t.success === false) return false;
    if (filterStatus === "failed" && t.success !== false) return false;
    return true;
  });

  const fetchTraces = async (rid: string) => {
    if (!rid) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ft-runner/traces?runId=${encodeURIComponent(rid)}`);
      const data = await res.json();
      if (data.success) {
        setTraces(data.traces || []);
        setSummary(data.summary || null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fetchRunHistory = async () => {
    try {
      const res = await fetch("/api/ft-runner/results?latest=10");
      const data = await res.json();
      if (data.success && data.runs) {
        setRunHistory(data.runs.map((r: any) => ({
          runId: r.run_id || r.runId,
          createdAt: r.created_at || r.createdAt,
          conclusion: r.conclusion || "unknown",
        })));
        if (!runId && data.runs.length > 0) {
          const firstRunId = data.runs[0].run_id || data.runs[0].runId;
          setRunId(firstRunId);
          fetchTraces(firstRunId);
        }
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchRunHistory();
  }, []);

  useEffect(() => {
    if (latestRunId && latestRunId !== runId) {
      setRunId(latestRunId);
      fetchTraces(latestRunId);
    }
  }, [latestRunId]);

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  const agentNames = summary ? Object.keys(summary.agentBreakdown) : [];
  const totalTokensByAgent = agentNames.map((name) => ({
    name,
    tokens: summary!.agentBreakdown[name].tokens,
    percentage: summary!.totalTokens > 0
      ? Math.round((summary!.agentBreakdown[name].tokens / summary!.totalTokens) * 100)
      : 0,
  }));

  return (
    <div style={{ padding: "8px 16px 16px" }}>
      {/* Run Selector */}
      <Card style={{ ...cardStyle, marginBottom: 16 }} styles={{ body: { padding: "12px 16px" } }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Space>
            <ApiOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb", fontSize: 18 }} />
            <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937", fontSize: 15 }}>Agent Traces</Text>
          </Space>
          <Space>
            <Select
              value={runId || undefined}
              onChange={(v) => { setRunId(v); fetchTraces(v); }}
              placeholder="Select a run..."
              style={{ width: 320 }}
              options={runHistory.map((r) => ({
                value: r.runId,
                label: (
                  <Space>
                    <Tag color={r.conclusion === "success" ? "success" : "error"} style={{ fontSize: 10 }}>
                      {r.conclusion}
                    </Tag>
                    <Text style={{ fontSize: 12 }}>{r.runId.slice(0, 30)}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {new Date(r.createdAt).toLocaleString()}
                    </Text>
                  </Space>
                ),
              }))}
            />
            <Button icon={<ReloadOutlined />} onClick={() => { fetchRunHistory(); if (runId) fetchTraces(runId); }}>
              Refresh
            </Button>
          </Space>
        </Space>
      </Card>

      {loading && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}><Text type="secondary">Loading traces...</Text></div>
        </div>
      )}

      {!loading && !summary && (
        <Empty description={
          <Text style={{ color: isDark ? "#9ca3af" : "#6b7280" }}>
            {runId ? "No traces found for this run" : "Select a run to view agent traces"}
          </Text>
        } />
      )}

      {!loading && summary && (
        <>
          {/* Summary Stats */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                <Statistic
                  title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>LLM Calls</Text>}
                  value={summary.totalCalls}
                  prefix={<RobotOutlined style={{ color: "#7c3aed" }} />}
                  valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                <Statistic
                  title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>Total Tokens</Text>}
                  value={summary.totalTokens}
                  prefix={<ThunderboltOutlined style={{ color: "#f59e0b" }} />}
                  valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }}
                  formatter={(v) => Number(v).toLocaleString()}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                <Statistic
                  title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>Time Taken</Text>}
                  value={summary.totalLatencyMs >= 60000 ? `${Math.floor(summary.totalLatencyMs / 60000)}m ${Math.round((summary.totalLatencyMs % 60000) / 1000)}s` : `${Math.round(summary.totalLatencyMs / 1000)}s`}
                  prefix={<ClockCircleOutlined style={{ color: "#2563eb" }} />}
                  valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                <Statistic
                  title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>Est. Cost</Text>}
                  value={summary.costEstimate}
                  prefix={<DollarOutlined style={{ color: "#059669" }} />}
                  precision={2}
                  valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            {/* Left: Agent Breakdown */}
            <Col xs={24} lg={8}>
              <Card
                title={<Space><RobotOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} /><Text strong style={{ color: isDark ? "#fff" : "#1f2937" }}>Agent Breakdown</Text></Space>}
                style={cardStyle}
                styles={{ body: { padding: "12px 16px" } }}
              >
                {agentNames.map((name) => {
                  const stats = summary.agentBreakdown[name];
                  const color = AGENT_COLORS[name] || "#6b7280";
                  const successRate = stats.calls > 0 ? Math.round((stats.successes / stats.calls) * 100) : 0;
                  const tokenPct = totalTokensByAgent.find((t) => t.name === name)?.percentage || 0;

                  return (
                    <div key={name} style={{ marginBottom: 16, padding: 12, background: isDark ? "#1f2937" : "#f3f4f6", borderRadius: 8, borderLeft: `3px solid ${color}` }}>
                      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
                        <Space>
                          {AGENT_ICONS[name] || <RobotOutlined />}
                          <Text strong style={{ color: isDark ? "#fff" : "#1f2937", textTransform: "capitalize" }}>{name}</Text>
                        </Space>
                        <Tag color={successRate >= 80 ? "success" : successRate >= 50 ? "warning" : "error"}>
                          {successRate}% success
                        </Tag>
                      </Space>
                      <Row gutter={[8, 4]}>
                        <Col span={8}>
                          <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280", display: "block" }}>Calls</Text>
                          <Text strong style={{ color: isDark ? "#fff" : "#1f2937" }}>{stats.calls}</Text>
                        </Col>
                        <Col span={8}>
                          <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280", display: "block" }}>Tokens</Text>
                          <Text strong style={{ color: isDark ? "#fff" : "#1f2937" }}>{stats.tokens.toLocaleString()}</Text>
                        </Col>
                        <Col span={8}>
                          <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280", display: "block" }}>Latency</Text>
                          <Text strong style={{ color: isDark ? "#fff" : "#1f2937" }}>{Math.round(stats.latencyMs / 1000)}s</Text>
                        </Col>
                      </Row>
                      <Progress percent={tokenPct} size="small" strokeColor={color} style={{ marginTop: 8 }} format={() => `${tokenPct}% of tokens`} />
                    </div>
                  );
                })}
              </Card>
            </Col>

            {/* Right: Trace Timeline */}
            <Col xs={24} lg={16}>
              <Card
                title={
                  <Space style={{ width: "100%", justifyContent: "space-between" }}>
                    <Space><ClockCircleOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} /><Text strong style={{ color: isDark ? "#fff" : "#1f2937" }}>Execution Timeline</Text></Space>
                    <Space size={8}>
                      <Select value={filterAgent} onChange={setFilterAgent} style={{ width: 130 }} size="small"
                        options={[
                          { value: "all", label: "All Agents" },
                          ...agentNames.map((n) => ({ value: n, label: n.charAt(0).toUpperCase() + n.slice(1) })),
                        ]}
                      />
                      <Select value={filterStatus} onChange={setFilterStatus} style={{ width: 110 }} size="small"
                        options={[
                          { value: "all", label: "All" },
                          { value: "success", label: "Success" },
                          { value: "failed", label: "Failed" },
                        ]}
                      />
                      <Text type="secondary" style={{ fontSize: 11 }}>{filteredTraces.length}/{traces.length}</Text>
                    </Space>
                  </Space>
                }
                style={cardStyle}
                styles={{ body: { padding: "12px 16px", maxHeight: 600, overflowY: "auto" } }}
              >
                <Timeline
                  items={filteredTraces.map((trace) => {
                    const color = AGENT_COLORS[trace.agent] || "#6b7280";
                    const icon = trace.success === false
                      ? <CloseCircleOutlined style={{ color: "#dc2626" }} />
                      : AGENT_ICONS[trace.agent] || <RobotOutlined />;

                    return {
                      dot: icon,
                      children: (
                        <div style={{ padding: "4px 0" }}>
                          <Space style={{ width: "100%", justifyContent: "space-between" }}>
                            <Space size={4}>
                              <Tag color={color} style={{ fontSize: 10, borderRadius: 4, textTransform: "capitalize" }}>{trace.agent}</Tag>
                              <Text strong style={{ fontSize: 13, color: isDark ? "#fff" : "#1f2937" }}>{trace.action}</Text>
                              {trace.decision && (
                                <Tag style={{ fontSize: 10, borderRadius: 4 }}>{trace.decision}</Tag>
                              )}
                            </Space>
                            <Space size={8}>
                              {trace.durationMs != null && (
                                <Tooltip title="LLM latency">
                                  <Tag icon={<ClockCircleOutlined />} style={{ fontSize: 10 }}>
                                    {trace.durationMs > 1000 ? `${(trace.durationMs / 1000).toFixed(1)}s` : `${trace.durationMs}ms`}
                                  </Tag>
                                </Tooltip>
                              )}
                              {trace.tokenCount != null && trace.tokenCount > 0 && (
                                <Tooltip title={trace.metadata ? `${trace.metadata.prompt_tokens || 0} in / ${trace.metadata.completion_tokens || 0} out` : "Total tokens"}>
                                  <Tag icon={<ThunderboltOutlined />} color="gold" style={{ fontSize: 10 }}>
                                    {trace.tokenCount.toLocaleString()}
                                  </Tag>
                                </Tooltip>
                              )}
                            </Space>
                          </Space>
                          {trace.targetFile && (
                            <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280", display: "block", marginTop: 2 }}>
                              {trace.targetFile}
                            </Text>
                          )}
                          {trace.reason && (
                            <div style={{ marginTop: 4, padding: "6px 10px", background: isDark ? "#1f2937" : "#f9fafb", borderRadius: 6, borderLeft: `2px solid ${color}` }}>
                              <Text style={{ fontSize: 12, color: isDark ? "#d1d5db" : "#4b5563" }}>
                                {trace.reason}
                              </Text>
                            </div>
                          )}
                          {trace.error && (
                            <div style={{ marginTop: 4, padding: "6px 10px", background: isDark ? "#7f1d1d20" : "#fef2f2", borderRadius: 6, borderLeft: "2px solid #dc2626" }}>
                              <Text style={{ fontSize: 11, color: "#dc2626" }}>
                                {trace.error.slice(0, 200)}
                              </Text>
                            </div>
                          )}
                          {/* Conversation Replay — expand to see prompt + response */}
                          {(trace.metadata?.prompt || trace.metadata?.response) && (
                            <Collapse
                              size="small"
                              style={{ marginTop: 6, background: "transparent", border: "none" }}
                              items={[{
                                key: "replay",
                                label: <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>View Prompt / Response</Text>,
                                children: (
                                  <div style={{ fontSize: 11, fontFamily: "monospace" }}>
                                    {trace.metadata?.prompt && (
                                      <div style={{ marginBottom: 8 }}>
                                        <Tag color="blue" style={{ fontSize: 10, marginBottom: 4 }}>PROMPT</Tag>
                                        <pre style={{
                                          margin: 0, padding: 8, borderRadius: 6, fontSize: 11, lineHeight: 1.4,
                                          maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
                                          background: isDark ? "#1e293b" : "#f1f5f9", color: isDark ? "#e2e8f0" : "#334155",
                                        }}>
                                          {trace.metadata.prompt}
                                        </pre>
                                      </div>
                                    )}
                                    {trace.metadata?.response && (
                                      <div>
                                        <Tag color="green" style={{ fontSize: 10, marginBottom: 4 }}>RESPONSE</Tag>
                                        <pre style={{
                                          margin: 0, padding: 8, borderRadius: 6, fontSize: 11, lineHeight: 1.4,
                                          maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
                                          background: isDark ? "#1e293b" : "#f1f5f9", color: isDark ? "#e2e8f0" : "#334155",
                                        }}>
                                          {trace.metadata.response}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                ),
                              }]}
                            />
                          )}
                          <Text style={{ fontSize: 10, color: isDark ? "#6b7280" : "#9ca3af", display: "block", marginTop: 2 }}>
                            {trace.timestamp ? new Date(trace.timestamp).toLocaleTimeString() : ""} {trace.model && `| ${trace.model}`}
                          </Text>
                        </div>
                      ),
                    };
                  })}
                />
                {filteredTraces.length === 0 && (
                  <Empty description={<Text type="secondary">{traces.length > 0 ? "No traces match filters" : "No agent activity recorded"}</Text>} />
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
