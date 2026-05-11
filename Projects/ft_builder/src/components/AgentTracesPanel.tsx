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
  Tabs,
  Input,
  DatePicker,
} from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import {
  RobotOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  EyeOutlined,
  CodeOutlined,
  BulbOutlined,
  ApiOutlined,
  SearchOutlined,
  BarChartOutlined,
  ExperimentOutlined,
  FieldTimeOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";
import dynamic from "next/dynamic";

const RechartsComponents = dynamic(
  () => import("recharts").then((mod) => {
    const { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip: RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } = mod;
    return { default: ({ type, ...props }: any) => {
      if (type === "pie") {
        return (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={props.data} dataKey="tokens" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                label={({ name, percentage }: any) => `${name} ${percentage}%`}>
                {props.data.map((entry: any) => (
                  <Cell key={entry.name} fill={entry.color || "#6b7280"} />
                ))}
              </Pie>
              <RechartsTooltip formatter={(value: number) => value.toLocaleString()} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );
      }
      if (type === "line") {
        return (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={props.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={props.gridColor || "#e5e7eb"} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: props.tickColor || "#6b7280" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: props.tickColor || "#6b7280" }} />
              <RechartsTooltip contentStyle={props.tooltipStyle} />
              <Line type="monotone" dataKey="passRate" stroke="#059669" strokeWidth={2} dot={{ r: 4 }} name="Pass Rate %" />
            </LineChart>
          </ResponsiveContainer>
        );
      }
      if (type === "stacked-bar") {
        return (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={props.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={props.gridColor || "#e5e7eb"} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: props.tickColor || "#6b7280" }} />
              <YAxis tick={{ fontSize: 11, fill: props.tickColor || "#6b7280" }} />
              <RechartsTooltip contentStyle={props.tooltipStyle} formatter={(v: number) => v.toLocaleString()} />
              <Bar dataKey="setup" stackId="a" fill="#6b7280" name="Setup" />
              <Bar dataKey="generator" stackId="a" fill="#7c3aed" name="Generator" />
              <Bar dataKey="compliance" stackId="a" fill="#059669" name="Compliance" />
              <Bar dataKey="cypress" stackId="a" fill="#f59e0b" name="Cypress" />
              <Bar dataKey="supervisor" stackId="a" fill="#2563eb" name="Supervisor" radius={[4, 4, 0, 0]} />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        );
      }
      return (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={props.data}>
            <CartesianGrid strokeDasharray="3 3" stroke={props.gridColor || "#e5e7eb"} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: props.tickColor || "#6b7280" }} />
            <YAxis tick={{ fontSize: 11, fill: props.tickColor || "#6b7280" }} />
            <RechartsTooltip contentStyle={props.tooltipStyle} />
            <Bar dataKey="latency" fill="#2563eb" radius={[4, 4, 0, 0]} name="Latency (s)" />
            <Bar dataKey="calls" fill="#7c3aed" radius={[4, 4, 0, 0]} name="Calls" />
          </BarChart>
        </ResponsiveContainer>
      );
    }};
  }),
  { ssr: false }
);

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

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

const AGENT_COLORS: Record<string, string> = {
  suggestions: "#8b5cf6",
  setup: "#6b7280",
  generator: "#7c3aed",
  compliance: "#059669",
  cypress: "#f59e0b",
  supervisor: "#2563eb",
};

const AGENT_ICONS: Record<string, React.ReactNode> = {
  suggestions: <ExperimentOutlined />,
  setup: <FieldTimeOutlined />,
  generator: <CodeOutlined />,
  compliance: <CheckCircleOutlined />,
  cypress: <ThunderboltOutlined />,
  supervisor: <BulbOutlined />,
};

export default function AgentTracesPanel({ latestRunId }: AgentTracesPanelProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const [runId, setRunId] = useState<string>(latestRunId || "");
  const [loading, setLoading] = useState(false);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [summary, setSummary] = useState<TraceSummary | null>(null);
  const [testResults, setTestResults] = useState<Array<{ file: string; test_name: string; status: string; duration_ms: number; error_message: string; attempt_number: number }>>([]);
  const [runHistory, setRunHistory] = useState<Array<{ runId: string; createdAt: string; conclusion: string; specPattern: string; triggeredBy: string }>>([]);
  const [availableWorkflows, setAvailableWorkflows] = useState<string[]>([]);
  const [filterWorkflow, setFilterWorkflow] = useState<string>("all");
  const [filterConclusion, setFilterConclusion] = useState<string>("all");
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Overview & Search state
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [overviewData, setOverviewData] = useState<any>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchAgent, setSearchAgent] = useState("all");
  const [searchAction, setSearchAction] = useState("all");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Global filters: date range + user + pipeline
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [filterUserId, setFilterUserId] = useState<string>("all");
  const [filterPipeline, setFilterPipeline] = useState<string>("all");
  const [availableUsers, setAvailableUsers] = useState<string[]>([]);
  const [availablePipelines, setAvailablePipelines] = useState<string[]>([]);

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
    try {
      const statusRes = await fetch(`/api/ft-runner/status?runId=${encodeURIComponent(rid)}`);
      const statusData = await statusRes.json();
      if (statusData.success && statusData.testResults) {
        setTestResults(statusData.testResults);
      } else {
        setTestResults([]);
      }
    } catch { setTestResults([]); }
    setLoading(false);
  };

  const fetchRunHistory = async (workflow?: string, conclusion?: string) => {
    try {
      const params = new URLSearchParams();
      if (workflow && workflow !== "all") params.set("workflow", workflow);
      if (conclusion && conclusion !== "all") params.set("conclusion", conclusion);
      const qs = params.toString();
      const res = await fetch(`/api/ft-runner/history${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      if (data.success && data.runs) {
        const runs = data.runs
          .filter((r: any) => r.run_mode !== "suggestions")
          .map((r: any) => ({
            runId: r.run_id,
            createdAt: r.created_at,
            conclusion: r.conclusion || r.status || "unknown",
            specPattern: r.spec_pattern || "",
            triggeredBy: r.triggered_by || "",
          }));
        setRunHistory(runs);
        if (data.workflows) setAvailableWorkflows(data.workflows);
        if (!runId && runs.length > 0) {
          setRunId(runs[0].runId);
          fetchTraces(runs[0].runId);
        }
      }
    } catch { /* ignore */ }
  };

  const buildFilterParams = () => {
    const params = new URLSearchParams();
    if (dateRange && dateRange[0]) params.set("dateFrom", dateRange[0].format("YYYY-MM-DD"));
    if (dateRange && dateRange[1]) params.set("dateTo", dateRange[1].format("YYYY-MM-DD"));
    if (filterUserId !== "all") params.set("userId", filterUserId);
    if (filterPipeline !== "all") params.set("pipeline", filterPipeline);
    return params;
  };

  const fetchOverview = async () => {
    setOverviewLoading(true);
    try {
      const params = buildFilterParams();
      params.set("action", "overview");
      const res = await fetch(`/api/ft-runner/chat-smith?${params.toString()}`);
      const data = await res.json();
      if (data.success) setOverviewData(data);
    } catch { /* ignore */ }
    setOverviewLoading(false);
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/ft-runner/chat-smith?action=users");
      const data = await res.json();
      if (data.success) setAvailableUsers(data.users || []);
    } catch { /* ignore */ }
  };

  const fetchPipelines = async () => {
    try {
      const res = await fetch("/api/ft-runner/chat-smith?action=pipelines");
      const data = await res.json();
      if (data.success) setAvailablePipelines(data.pipelines || []);
    } catch { /* ignore */ }
  };

  const fetchSearch = async () => {
    if (!searchQuery && searchAgent === "all" && searchAction === "all") return;
    setSearchLoading(true);
    try {
      const params = buildFilterParams();
      if (searchQuery) params.set("q", searchQuery);
      if (searchAgent !== "all") params.set("agent", searchAgent);
      if (searchAction !== "all") params.set("actionFilter", searchAction);
      params.set("action", "search");
      const res = await fetch(`/api/ft-runner/chat-smith?${params.toString()}`);
      const data = await res.json();
      if (data.success) setSearchResults(data.results || []);
    } catch { /* ignore */ }
    setSearchLoading(false);
  };

  useEffect(() => {
    fetchOverview();
    fetchRunHistory();
    fetchUsers();
    fetchPipelines();
  }, []);

  useEffect(() => {
    if (latestRunId && latestRunId !== runId) {
      setRunId(latestRunId);
      fetchTraces(latestRunId);
    }
  }, [latestRunId]);

  const cardStyle = {
    borderRadius: 10,
    border: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
    background: isDark ? "#1e293b" : "#ffffff",
    boxShadow: isDark ? "none" : "0 1px 3px rgba(0,0,0,0.06)",
  };

  const agentNames = summary ? Object.keys(summary.agentBreakdown) : [];
  const totalTokensByAgent = agentNames.map((name) => ({
    name,
    tokens: summary!.agentBreakdown[name].tokens,
    percentage: summary!.totalTokens > 0
      ? Math.round((summary!.agentBreakdown[name].tokens / summary!.totalTokens) * 100)
      : 0,
  }));

  const searchColumns = [
    { title: "Time", dataIndex: "timestamp", key: "timestamp", width: 150, render: (v: string) => new Date(v).toLocaleString() },
    { title: "Run", dataIndex: "runId", key: "runId", width: 130, render: (v: string) => (
      <Button type="link" size="small" onClick={() => { setRunId(v); fetchTraces(v); setActiveTab("traces"); }}>{v.slice(0, 18)}...</Button>
    )},
    { title: "Agent", dataIndex: "agent", key: "agent", width: 90, render: (v: string) => <Tag color={AGENT_COLORS[v] || "#6b7280"}>{v}</Tag> },
    { title: "Action", dataIndex: "action", key: "action", width: 100 },
    { title: "File", dataIndex: "targetFile", key: "targetFile", width: 160, ellipsis: true, render: (v: string) => v ? v.split("/").pop() : "-" },
    { title: "Reason / Guidance", dataIndex: "reason", key: "reason", ellipsis: true, render: (v: string) => v ? <Text style={{ fontSize: 11, color: isDark ? "#d1d5db" : "#4b5563" }} title={v}>{v.slice(0, 80)}{v.length > 80 ? "..." : ""}</Text> : "-" },
    { title: "Decision", dataIndex: "decision", key: "decision", width: 100, render: (v: string) => v ? <Tag>{v}</Tag> : "-" },
    { title: "Status", dataIndex: "success", key: "success", width: 70, render: (v: boolean) => v !== false ? <Tag color="success">OK</Tag> : <Tag color="error">Fail</Tag> },
    { title: "Duration", dataIndex: "durationMs", key: "durationMs", width: 80, render: (v: number) => v ? `${Math.round(v / 1000)}s` : "-" },
    { title: "Tokens", dataIndex: "tokenCount", key: "tokenCount", width: 70, render: (v: number) => v ? v.toLocaleString() : "-" },
  ];

  const passTrendData = overviewData?.passTrend?.map((r: any) => ({
    label: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    passRate: r.passRate,
    totalSpecs: r.totalSpecs,
    passedSpecs: r.passedSpecs,
  })) || [];

  const tokenTrendData = (() => {
    if (!overviewData?.tokenTrend) return [];
    const byRun: Record<string, any> = {};
    for (const t of overviewData.tokenTrend) {
      if (!byRun[t.run_id]) byRun[t.run_id] = { label: new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }), setup: 0, generator: 0, compliance: 0, cypress: 0, supervisor: 0 };
      byRun[t.run_id][t.agent] = t.tokens;
    }
    return Object.values(byRun).slice(-20);
  })();

  const datePresets: Array<{ label: string; value: [Dayjs, Dayjs] }> = [
    { label: "Today", value: [dayjs().startOf("day"), dayjs().endOf("day")] },
    { label: "Last 7 Days", value: [dayjs().subtract(7, "day").startOf("day"), dayjs().endOf("day")] },
    { label: "Last 30 Days", value: [dayjs().subtract(30, "day").startOf("day"), dayjs().endOf("day")] },
  ];

  const handleApplyFilters = () => {
    fetchOverview();
    if (searchQuery || searchAgent !== "all" || searchAction !== "all") fetchSearch();
  };

  return (
    <div style={{ padding: "8px 16px 16px" }}>
      {/* Global Filters */}
      <Card
        style={{ ...cardStyle, marginBottom: 16 }}
        styles={{ body: { padding: "12px 16px" } }}
      >
        <Space wrap style={{ width: "100%" }}>
          <Text strong style={{ color: isDark ? "#e5e7eb" : "#374151", fontSize: 13 }}>Filters:</Text>
          <Select
            value={filterPipeline}
            onChange={setFilterPipeline}
            size="small"
            style={{ minWidth: 140 }}
            options={[
              { value: "all", label: "All Pipelines" },
              ...availablePipelines.map((p) => ({ value: p, label: p.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) })),
            ]}
          />
          <DatePicker.RangePicker
            value={dateRange as any}
            onChange={(dates) => setDateRange(dates as [Dayjs | null, Dayjs | null] | null)}
            presets={datePresets}
            size="small"
            allowClear
            placeholder={["Start Date", "End Date"]}
            style={{ minWidth: 240 }}
          />
          <Select
            value={filterUserId}
            onChange={setFilterUserId}
            size="small"
            style={{ minWidth: 160 }}
            options={[
              { value: "all", label: "All Users" },
              ...availableUsers.map((u) => ({ value: u, label: u })),
            ]}
          />
          <Button type="primary" size="small" onClick={handleApplyFilters}>
            Apply
          </Button>
          <Button
            size="small"
            onClick={() => {
              setDateRange(null);
              setFilterUserId("all");
              setFilterPipeline("all");
              setTimeout(() => fetchOverview(), 0);
            }}
          >
            Reset
          </Button>
        </Space>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ background: isDark ? "#1e293b" : "#ffffff", borderRadius: 10, padding: "8px 16px", border: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`, boxShadow: isDark ? "none" : "0 1px 3px rgba(0,0,0,0.06)" }}
        items={[
          {
            key: "overview",
            label: <Space><BarChartOutlined />Overview</Space>,
            children: overviewLoading ? (
              <div style={{ textAlign: "center", padding: 60 }}><Spin size="large" /><div style={{ marginTop: 16 }}><Text type="secondary">Loading analytics...</Text></div></div>
            ) : !overviewData ? (
              <Empty description="No analytics data available" />
            ) : (
              <>
                <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                  <Col xs={12} md={5}>
                    <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                      <Statistic title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>Total Runs</Text>} value={overviewData.stats.totalRuns} prefix={<ExperimentOutlined style={{ color: "#7c3aed" }} />} valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }} />
                    </Card>
                  </Col>
                  <Col xs={12} md={5}>
                    <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                      <Statistic title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>Pass Rate</Text>} value={overviewData.stats.avgPassRate} suffix="%" prefix={<TrophyOutlined style={{ color: overviewData.stats.avgPassRate >= 80 ? "#059669" : overviewData.stats.avgPassRate >= 50 ? "#f59e0b" : "#dc2626" }} />} valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }} />
                    </Card>
                  </Col>
                  <Col xs={12} md={5}>
                    <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                      <Statistic title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>LLM Calls</Text>} value={overviewData.stats.totalLLMCalls} prefix={<RobotOutlined style={{ color: "#2563eb" }} />} valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }} formatter={(v) => formatCompact(Number(v))} />
                    </Card>
                  </Col>
                  <Col xs={12} md={5}>
                    <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                      <Statistic title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>Tokens</Text>} value={overviewData.stats.totalTokens} prefix={<ThunderboltOutlined style={{ color: "#f59e0b" }} />} valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }} formatter={(v) => formatCompact(Number(v))} />
                    </Card>
                  </Col>
                  <Col xs={12} md={4}>
                    <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                      <Statistic title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>Est. Cost</Text>} value={overviewData.stats.estimatedCost || 0} prefix={<Text style={{ color: "#059669", fontSize: 16 }}>$</Text>} valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }} precision={2} />
                    </Card>
                  </Col>
                </Row>

                <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                  <Col xs={24} md={12}>
                    <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }} title={<Text strong style={{ color: isDark ? "#fff" : "#1f2937", fontSize: 13 }}>Pass Rate Trend (Last 20 Runs)</Text>}>
                      {passTrendData.length > 0 ? (
                        <RechartsComponents type="line" data={passTrendData} gridColor={isDark ? "#374151" : "#e5e7eb"} tickColor={isDark ? "#9ca3af" : "#6b7280"} tooltipStyle={{ background: isDark ? "#1f2937" : "#fff", border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}` }} />
                      ) : <Empty description="No trend data" />}
                    </Card>
                  </Col>
                  <Col xs={24} md={12}>
                    <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }} title={<Text strong style={{ color: isDark ? "#fff" : "#1f2937", fontSize: 13 }}>Token Usage by Agent (Last 20 Runs)</Text>}>
                      {tokenTrendData.length > 0 ? (
                        <RechartsComponents type="stacked-bar" data={tokenTrendData} gridColor={isDark ? "#374151" : "#e5e7eb"} tickColor={isDark ? "#9ca3af" : "#6b7280"} tooltipStyle={{ background: isDark ? "#1f2937" : "#fff", border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}` }} />
                      ) : <Empty description="No token data" />}
                    </Card>
                  </Col>
                </Row>

                <Row gutter={[16, 16]}>
                  <Col xs={24} md={12}>
                    <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }} title={<Text strong style={{ color: isDark ? "#fff" : "#1f2937", fontSize: 13 }}>Top Failing Specs</Text>}>
                      <Table size="small" pagination={false} dataSource={overviewData.topFailures} rowKey="file"
                        columns={[
                          { title: "Spec File", dataIndex: "file", key: "file", ellipsis: true, render: (v: string) => <Text style={{ fontSize: 12 }}>{v?.split("/").pop()}</Text> },
                          { title: "Failures", dataIndex: "failCount", key: "failCount", width: 80, sorter: (a: any, b: any) => a.failCount - b.failCount, render: (v: number) => <Tag color="error">{v}</Tag> },
                          { title: "Last Failure", dataIndex: "lastFailure", key: "lastFailure", width: 140, render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{new Date(v).toLocaleDateString()}</Text> },
                        ]}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} md={12}>
                    <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }} title={<Text strong style={{ color: isDark ? "#fff" : "#1f2937", fontSize: 13 }}>Agent Performance</Text>}>
                      <Table size="small" pagination={false} dataSource={overviewData.agentPerformance} rowKey="agent"
                        columns={[
                          { title: "Agent", dataIndex: "agent", key: "agent", render: (v: string) => <Tag color={AGENT_COLORS[v] || "#6b7280"}>{v}</Tag> },
                          { title: "Calls", dataIndex: "totalCalls", key: "totalCalls", width: 70 },
                          { title: "Avg Tokens", dataIndex: "avgTokens", key: "avgTokens", width: 90, render: (v: number) => v?.toLocaleString() || "0" },
                          { title: "Avg Latency", dataIndex: "avgLatencySec", key: "avgLatencySec", width: 90, render: (v: number) => `${v}s` },
                          { title: "Success", dataIndex: "successRate", key: "successRate", width: 80, render: (v: number) => <Tag color={v >= 80 ? "success" : v >= 50 ? "warning" : "error"}>{v}%</Tag> },
                        ]}
                      />
                    </Card>
                  </Col>
                </Row>
              </>
            ),
          },
          {
            key: "traces",
            label: <Space><FieldTimeOutlined />Traces</Space>,
            children: (
              <>
      {/* Run Selector & Filters */}
      <Card style={{ ...cardStyle, marginBottom: 16 }} styles={{ body: { padding: "12px 16px" } }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <Space>
            <ApiOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb", fontSize: 18 }} />
            <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937", fontSize: 15 }}>Run Traces</Text>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchRunHistory(filterWorkflow, filterConclusion); if (runId) fetchTraces(runId); }}>
            Refresh
          </Button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Select
            value={filterWorkflow}
            onChange={(v) => { setFilterWorkflow(v); setRunId(""); fetchRunHistory(v, filterConclusion); }}
            style={{ minWidth: 160 }}
            options={[
              { value: "all", label: "All Workflows" },
              ...availableWorkflows.map((w) => ({ value: w, label: w.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) })),
            ]}
          />
          <Select
            value={filterConclusion}
            onChange={(v) => { setFilterConclusion(v); setRunId(""); fetchRunHistory(filterWorkflow, v); }}
            style={{ minWidth: 120 }}
            options={[
              { value: "all", label: "All Status" },
              { value: "success", label: "Success" },
              { value: "failure", label: "Failure" },
            ]}
          />
          <Select
            value={runId || undefined}
            onChange={(v) => { setRunId(v); fetchTraces(v); }}
            placeholder="Select a run..."
            showSearch
            filterOption={(input, option) => {
              const r = runHistory.find((h: any) => h.runId === option?.value);
              if (!r) return false;
              const search = input.toLowerCase();
              return (
                (r.specPattern || "").toLowerCase().includes(search) ||
                (r.conclusion || "").toLowerCase().includes(search) ||
                (r.triggeredBy || "").toLowerCase().includes(search) ||
                r.runId.toLowerCase().includes(search)
              );
            }}
            style={{ flex: 1, minWidth: 300 }}
            options={[...runHistory]
              .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((r: any) => ({
              value: r.runId,
              label: (
                <Space>
                  <Tag color={r.conclusion === "success" ? "success" : r.conclusion === "failure" ? "error" : "processing"} style={{ fontSize: 10 }}>
                    {r.conclusion}
                  </Tag>
                  <Text style={{ fontSize: 12 }}>{r.specPattern ? r.specPattern.split(",").map((s: string) => s.trim().split("/").pop()).join(", ") : r.runId.slice(0, 25)}</Text>
                  {r.triggeredBy && (
                    <Tag style={{ fontSize: 10, marginLeft: 2 }}>{r.triggeredBy}</Tag>
                  )}
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {new Date(r.createdAt).toLocaleString()}
                  </Text>
                </Space>
              ),
            }))}
          />
        </div>
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
            <Col xs={8} md={8}>
              <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                <Statistic
                  title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>LLM Calls</Text>}
                  value={summary.totalCalls}
                  prefix={<RobotOutlined style={{ color: "#7c3aed" }} />}
                  valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }}
                />
              </Card>
            </Col>
            <Col xs={8} md={8}>
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
            <Col xs={8} md={8}>
              <Card style={cardStyle} styles={{ body: { padding: "16px 20px" } }}>
                <Statistic
                  title={<Text style={{ color: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}>Time Taken</Text>}
                  value={summary.totalLatencyMs >= 60000 ? `${Math.floor(summary.totalLatencyMs / 60000)}m ${Math.round((summary.totalLatencyMs % 60000) / 1000)}s` : `${Math.round(summary.totalLatencyMs / 1000)}s`}
                  prefix={<ClockCircleOutlined style={{ color: "#2563eb" }} />}
                  valueStyle={{ color: isDark ? "#ffffff" : "#1f2937" }}
                />
              </Card>
            </Col>
          </Row>

          {/* Flow Visualization — Agent Pipeline */}
          <Card style={{ ...cardStyle, marginBottom: 16 }} styles={{ body: { padding: "16px 20px" } }}>
            <Space style={{ marginBottom: 12 }}>
              <ApiOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
              <Text strong style={{ color: isDark ? "#fff" : "#1f2937" }}>Agent Pipeline Flow</Text>
            </Space>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, flexWrap: "wrap", padding: "12px 0" }}>
              {(() => {
                const hasSuggestions = traces.some((t) => t.agent === "suggestions");
                const pipelineSteps = [
                  ...(hasSuggestions ? [{ name: "Suggestions", agent: "suggestions", action: "analyze", icon: <ExperimentOutlined />, color: "#8b5cf6" }] : []),
                  { name: "Setup", agent: "setup", action: "clone", icon: <FieldTimeOutlined />, color: "#6b7280" },
                  { name: "Generator", agent: "generator", action: "generate", icon: <CodeOutlined />, color: "#7c3aed" },
                  { name: "Compliance", agent: "compliance", action: "validate", icon: <CheckCircleOutlined />, color: "#059669" },
                  { name: "Cypress Run", agent: "cypress", action: "run", icon: <ThunderboltOutlined />, color: "#f59e0b" },
                  { name: "AI Supervisor", agent: "supervisor", action: "decision", icon: <BulbOutlined />, color: "#2563eb" },
                  { name: "Fix Generator", agent: "generator", action: "regenerate", icon: <CodeOutlined />, color: "#dc2626" },
                ];

                return pipelineSteps.map((step, idx) => {
                  const matchingTraces = traces.filter((t) =>
                    t.agent === step.agent && (step.agent === "setup" || step.agent === "cypress" || t.action?.includes(step.action))
                  );
                  const hasRun = matchingTraces.length > 0;
                  const hasFailed = matchingTraces.some((t) => t.success === false);
                  const totalMs = matchingTraces.reduce((sum, t) => sum + (t.durationMs || 0), 0);
                  const tokens = matchingTraces.reduce((sum, t) => sum + (t.tokenCount || 0), 0);

                  const status = !hasRun ? "pending" : hasFailed ? "failed" : "passed";
                  const statusColor = status === "passed" ? "#059669" : status === "failed" ? "#dc2626" : "#6b7280";
                  const bgColor = isDark
                    ? status === "passed" ? "#05966915" : status === "failed" ? "#dc262615" : "#1f2937"
                    : status === "passed" ? "#d1fae5" : status === "failed" ? "#fef2f2" : "#f3f4f6";

                  return (
                    <React.Fragment key={step.name}>
                      <Tooltip title={
                        hasRun ? `${matchingTraces.length} call(s) | ${Math.round(totalMs / 1000)}s | ${tokens.toLocaleString()} tokens` : "Not executed"
                      }>
                        <div style={{
                          padding: "12px 16px", borderRadius: 10, background: bgColor,
                          border: `2px solid ${statusColor}40`, textAlign: "center", minWidth: 110,
                          position: "relative",
                        }}>
                          <div style={{ fontSize: 20, color: step.color, marginBottom: 4 }}>{step.icon}</div>
                          <Text strong style={{ fontSize: 12, color: isDark ? "#fff" : "#1f2937", display: "block" }}>{step.name}</Text>
                          {hasRun && (
                            <Text style={{ fontSize: 10, color: statusColor, display: "block" }}>
                              {Math.round(totalMs / 1000)}s {tokens > 0 && `| ${tokens.toLocaleString()} tok`}
                            </Text>
                          )}
                          <div style={{
                            position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: "50%",
                            background: statusColor, display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {status === "passed" ? <CheckCircleOutlined style={{ fontSize: 10, color: "#fff" }} /> :
                             status === "failed" ? <CloseCircleOutlined style={{ fontSize: 10, color: "#fff" }} /> :
                             <ClockCircleOutlined style={{ fontSize: 10, color: "#fff" }} />}
                          </div>
                        </div>
                      </Tooltip>
                      {idx < pipelineSteps.length - 1 && (
                        <div style={{ padding: "0 4px", color: isDark ? "#4b5563" : "#d1d5db", fontSize: 18 }}>→</div>
                      )}
                    </React.Fragment>
                  );
                });
              })()}
            </div>
          </Card>

          {/* Per-Script Results */}
          {testResults.length > 0 && (
            <Card style={{ ...cardStyle, marginBottom: 16 }} styles={{ body: { padding: "16px 20px" } }}>
              <Space style={{ marginBottom: 12 }}>
                <ThunderboltOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
                <Text strong style={{ color: isDark ? "#fff" : "#1f2937" }}>Script Results ({testResults.length})</Text>
                <Tag color="success">{testResults.filter((r) => r.status === "passed").length} passed</Tag>
                <Tag color="error">{testResults.filter((r) => r.status === "failed").length} failed</Tag>
              </Space>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {testResults.map((r, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                    borderRadius: 8, background: isDark ? "#111827" : "#f9fafb",
                    border: `1px solid ${r.status === "passed" ? "#05966940" : r.status === "failed" ? "#dc262640" : "#6b728040"}`,
                  }}>
                    {r.status === "passed"
                      ? <CheckCircleOutlined style={{ color: "#059669", fontSize: 16 }} />
                      : r.status === "failed"
                        ? <CloseCircleOutlined style={{ color: "#dc2626", fontSize: 16 }} />
                        : <ClockCircleOutlined style={{ color: "#6b7280", fontSize: 16 }} />}
                    <div style={{ flex: 1 }}>
                      <Text strong style={{ fontSize: 12, color: isDark ? "#e5e7eb" : "#1f2937" }}>
                        {r.file.split("/").pop()}
                      </Text>
                      {r.error_message && (
                        <Text style={{ fontSize: 11, color: "#dc2626", display: "block", marginTop: 2 }}>
                          {r.error_message.split("\n")[0].slice(0, 120)}
                        </Text>
                      )}
                    </div>
                    <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>
                      {r.duration_ms > 0 ? `${Math.round(r.duration_ms / 1000)}s` : "—"}
                    </Text>
                    {r.attempt_number > 1 && (
                      <Tag style={{ fontSize: 10 }}>{r.attempt_number} attempts</Tag>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Analytics Charts */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            {/* Token Distribution Pie Chart */}
            <Col xs={24} md={12}>
              <Card
                title={<Space><ThunderboltOutlined style={{ color: "#f59e0b" }} /><Text strong style={{ color: isDark ? "#fff" : "#1f2937" }}>Token Distribution</Text></Space>}
                style={cardStyle} styles={{ body: { padding: "12px 16px" } }}
              >
                <RechartsComponents
                  type="pie"
                  data={totalTokensByAgent.filter((d) => d.tokens > 0).map((d) => ({ ...d, color: AGENT_COLORS[d.name] || "#6b7280" }))}
                />
              </Card>
            </Col>

            {/* Latency Bar Chart */}
            <Col xs={24} md={12}>
              <Card
                title={<Space><ClockCircleOutlined style={{ color: "#2563eb" }} /><Text strong style={{ color: isDark ? "#fff" : "#1f2937" }}>Latency by Agent</Text></Space>}
                style={cardStyle} styles={{ body: { padding: "12px 16px" } }}
              >
                <RechartsComponents
                  type="bar"
                  data={agentNames.map((name) => ({
                    name: name.charAt(0).toUpperCase() + name.slice(1),
                    latency: Math.round(summary.agentBreakdown[name].latencyMs / 1000),
                    calls: summary.agentBreakdown[name].calls,
                  }))}
                  gridColor={isDark ? "#374151" : "#e5e7eb"}
                  tickColor={isDark ? "#9ca3af" : "#6b7280"}
                  tooltipStyle={{ background: isDark ? "#1f2937" : "#fff", border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`, borderRadius: 8, fontSize: 12 }}
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
              </>
            ),
          },
          {
            key: "search",
            label: <Space><SearchOutlined />Search</Space>,
            children: (
              <>
                <Card style={{ ...cardStyle, marginBottom: 16 }} styles={{ body: { padding: "12px 16px" } }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Input
                      placeholder="Search traces by error, decision, file..."
                      prefix={<SearchOutlined />}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onPressEnter={fetchSearch}
                      style={{ flex: 1, minWidth: 200 }}
                    />
                    <Select value={searchAgent} onChange={setSearchAgent} style={{ width: 140 }}
                      options={[
                        { value: "all", label: "All Agents" },
                        { value: "supervisor", label: "Supervisor" },
                        { value: "generator", label: "Generator" },
                        { value: "compliance", label: "Compliance" },
                      ]}
                    />
                    <Select value={searchAction} onChange={setSearchAction} style={{ width: 140 }}
                      options={[
                        { value: "all", label: "All Actions" },
                        { value: "generate", label: "Generate" },
                        { value: "regenerate", label: "Regenerate" },
                        { value: "decision", label: "Decision" },
                        { value: "triage", label: "Triage" },
                        { value: "validate", label: "Validate" },
                        { value: "skip", label: "Skip" },
                        { value: "compliance-fix", label: "Compliance Fix" },
                      ]}
                    />
                    <Button type="primary" icon={<SearchOutlined />} onClick={fetchSearch} loading={searchLoading}>Search</Button>
                  </div>
                </Card>
                {searchResults.length > 0 ? (
                  <Card style={cardStyle} styles={{ body: { padding: 0 } }}>
                    <Table
                      size="small"
                      dataSource={searchResults}
                      columns={searchColumns}
                      rowKey="id"
                      pagination={{ pageSize: 15, size: "small" }}
                      scroll={{ x: 1000 }}
                    />
                  </Card>
                ) : (
                  <Empty description={<Text type="secondary">{searchLoading ? "Searching..." : "Enter a search query to find traces across all runs"}</Text>} />
                )}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
