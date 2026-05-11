"use client";

import React, { useState } from "react";
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Typography,
  Input,
  Tooltip,
  Empty,
  Badge,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ArrowLeftOutlined,
  ThunderboltOutlined,
  FilterOutlined,
} from "@ant-design/icons";
import type { FTSuggestion, ManualUseCase } from "@/types/ft";

const { Text } = Typography;
const { TextArea } = Input;

interface SuggestionsTableProps {
  suggestions: FTSuggestion[];
  onSuggestionsChange: (suggestions: FTSuggestion[]) => void;
  manualUseCases: ManualUseCase[];
  onManualUseCasesChange: (useCases: ManualUseCase[]) => void;
  onGenerate: () => void;
  onBack: () => void;
  isGenerating: boolean;
  isDark: boolean;
  sourceFiles: string[];
  totalSourceFiles: number;
  automationIdCount?: number;
  automationCoverage?: number;
  interactiveElements?: number;
}

const priorityColors: Record<string, string> = {
  P0: "red",
  P1: "orange",
  P2: "blue",
};

const tenantColors: Record<string, string> = {
  PayPal: "blue",
  Venmo: "green",
  Both: "purple",
};

export default function SuggestionsTable({
  suggestions,
  onSuggestionsChange,
  manualUseCases,
  onManualUseCasesChange,
  onGenerate,
  onBack,
  isGenerating,
  isDark,
  sourceFiles,
  totalSourceFiles,
  automationIdCount,
  automationCoverage,
  interactiveElements,
}: SuggestionsTableProps) {
  const isTooLow = automationIdCount !== undefined && (automationIdCount === 0 || (interactiveElements !== undefined && interactiveElements > 0 && automationCoverage !== undefined && automationCoverage < 30));
  const isWarnCoverage = !isTooLow && automationCoverage !== undefined && interactiveElements !== undefined && interactiveElements > 0 && automationCoverage < 90;
  const [newUseCase, setNewUseCase] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);

  const selectedCount = suggestions.filter((s) => s.selected).length + manualUseCases.length;

  // Sort suggestions by priority: P0 first, then P1, then P2
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  const sortedSuggestions = [...suggestions].sort(
    (a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
  );

  const toggleFilter = (filter: string | null) => {
    setPriorityFilter((prev) => (prev === filter ? null : filter));
  };

  const selectAll = () => {
    onSuggestionsChange(suggestions.map((s) => ({ ...s, selected: true })));
  };

  const deselectAll = () => {
    onSuggestionsChange(suggestions.map((s) => ({ ...s, selected: false })));
  };

  const addManualUseCase = () => {
    if (!newUseCase.trim()) return;
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    onManualUseCasesChange([...manualUseCases, { id, description: newUseCase.trim() }]);
    setNewUseCase("");
  };

  const removeManualUseCase = (id: string) => {
    onManualUseCasesChange(manualUseCases.filter((m) => m.id !== id));
  };

  const filteredSuggestions = priorityFilter
    ? sortedSuggestions.filter((s) => {
        if (priorityFilter === "P0") return s.priority === "P0";
        if (priorityFilter === "P0+P1") return s.priority === "P0" || s.priority === "P1";
        return true;
      })
    : sortedSuggestions;

  const columns = [
    {
      title: "Priority",
      dataIndex: "priority",
      key: "priority",
      width: 80,
      render: (priority: string) => (
        <Tag color={priorityColors[priority] || "default"} style={{ borderRadius: 4, fontWeight: 600 }}>
          {priority}
        </Tag>
      ),
      filters: [
        { text: "P0", value: "P0" },
        { text: "P1", value: "P1" },
        { text: "P2", value: "P2" },
      ],
      onFilter: (value: React.Key | boolean, record: FTSuggestion) => record.priority === value,
    },
    {
      title: "Test Case",
      dataIndex: "title",
      key: "title",
      render: (title: string, record: FTSuggestion) => (
        <div>
          <Space size={4} align="center">
            <Text strong style={{ color: isDark ? "#e5e7eb" : "#1f2937", fontSize: 13 }}>
              {title}
            </Text>
            {record.type === "composite" && (
              <Tooltip title={`Combined from ${record.compositeSources?.length || 0} individual cases`}>
                <Tag color="purple" style={{ borderRadius: 4, fontSize: 10, lineHeight: "16px", margin: 0 }}>
                  E2E
                </Tag>
              </Tooltip>
            )}
          </Space>
          <br />
          <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>
            {record.description.length > 120
              ? record.description.slice(0, 120) + "..."
              : record.description}
          </Text>
        </div>
      ),
    },
    {
      title: "Tenant",
      dataIndex: "tenant",
      key: "tenant",
      width: 90,
      render: (tenant: string) => (
        <Tag color={tenantColors[tenant] || "default"} style={{ borderRadius: 4 }}>
          {tenant}
        </Tag>
      ),
    },
    {
      title: "Category",
      dataIndex: "category",
      key: "category",
      width: 130,
      render: (category: string) => (
        <Tag style={{ borderRadius: 4, fontSize: 11 }}>{category}</Tag>
      ),
    },
    {
      title: "Spec File",
      dataIndex: "specFileName",
      key: "specFileName",
      width: 200,
      render: (name: string) => (
        <Tooltip title={name}>
          <Text code style={{ fontSize: 11, color: isDark ? "#c4b5fd" : "#7c3aed" }}>
            {name.length > 35 ? "..." + name.slice(-32) : name}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: "Status",
      dataIndex: "exists",
      key: "exists",
      width: 90,
      render: (exists: boolean) => (
        <Tag
          color={exists ? "orange" : "green"}
          icon={exists ? undefined : <CheckCircleOutlined />}
          style={{ borderRadius: 4, fontSize: 11 }}
        >
          {exists ? "Exists" : "New"}
        </Tag>
      ),
      filters: [
        { text: "New", value: false },
        { text: "Exists", value: true },
      ],
      onFilter: (value: React.Key | boolean, record: FTSuggestion) => record.exists === value,
    },
  ];

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  return (
    <div style={{ marginTop: 20 }}>
      {/* Summary Bar */}
      <Card
        style={{
          ...cardStyle,
          marginBottom: 16,
          background: isDark
            ? "linear-gradient(135deg, #1f2937 0%, #312e81 100%)"
            : "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)",
        }}
        styles={{ body: { padding: "12px 16px" } }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Space size="large">
            <div>
              <Text style={{ fontSize: 24, fontWeight: 700, color: isDark ? "#a78bfa" : "#7c3aed" }}>
                {suggestions.length}
              </Text>
              <Text style={{ fontSize: 12, color: isDark ? "#c4b5fd" : "#6b21a8", marginLeft: 6 }}>
                suggestions found
              </Text>
            </div>
            <div>
              <Text style={{ fontSize: 24, fontWeight: 700, color: isDark ? "#a78bfa" : "#7c3aed" }}>
                {totalSourceFiles}
              </Text>
              <Text style={{ fontSize: 12, color: isDark ? "#c4b5fd" : "#6b21a8", marginLeft: 6 }}>
                files analyzed
              </Text>
            </div>
            <div>
              <Text style={{ fontSize: 24, fontWeight: 700, color: isTooLow ? (isDark ? "#f87171" : "#dc2626") : isWarnCoverage ? (isDark ? "#fbbf24" : "#d97706") : isDark ? "#a78bfa" : "#7c3aed" }}>
                {isTooLow || isWarnCoverage ? `${automationIdCount ?? "—"}/${interactiveElements ?? "—"}` : automationIdCount ?? "—"}
              </Text>
              <Text style={{ fontSize: 12, color: isDark ? "#c4b5fd" : "#6b21a8", marginLeft: 6 }}>
                {isTooLow || isWarnCoverage ? `IDs (${automationCoverage}% coverage)` : "automation IDs"}
              </Text>
              {isTooLow && (
                <Text style={{ fontSize: 11, color: isDark ? "#f87171" : "#dc2626", display: "block" }}>
                  Insufficient — add more automation IDs
                </Text>
              )}
              {isWarnCoverage && (
                <Text style={{ fontSize: 11, color: isDark ? "#fbbf24" : "#d97706", display: "block" }}>
                  Tests may fail, consider adding more IDs
                </Text>
              )}
            </div>
            <div>
              <Badge
                count={selectedCount}
                style={{ backgroundColor: "#7c3aed" }}
                overflowCount={99}
              />
              <Text style={{ fontSize: 12, color: isDark ? "#c4b5fd" : "#6b21a8", marginLeft: 6 }}>
                selected
              </Text>
            </div>
            {suggestions.some((s) => s.exists) && (
              <div>
                <Text style={{ fontSize: 24, fontWeight: 700, color: isDark ? "#fbbf24" : "#d97706" }}>
                  {suggestions.filter((s) => s.exists).length}
                </Text>
                <Text style={{ fontSize: 12, color: isDark ? "#fcd34d" : "#92400e", marginLeft: 6 }}>
                  already exist
                </Text>
              </div>
            )}
          </Space>

          {/* Quick Filter Buttons */}
          <Space>
            <Button
              size="small"
              type={priorityFilter === "P0" ? "primary" : "default"}
              onClick={() => toggleFilter("P0")}
              icon={<FilterOutlined />}
            >
              P0 Only
            </Button>
            <Button
              size="small"
              type={priorityFilter === "P0+P1" ? "primary" : "default"}
              onClick={() => toggleFilter("P0+P1")}
            >
              P0 + P1
            </Button>
            <Button size="small" onClick={selectAll}>
              Select All
            </Button>
            <Button size="small" onClick={deselectAll}>
              Deselect All
            </Button>
          </Space>
        </div>
      </Card>

      {/* Suggestions Table */}
      <Card style={cardStyle} styles={{ body: { padding: "0" } }}>
        {suggestions.length > 0 ? (
          <Table
            dataSource={filteredSuggestions}
            columns={columns}
            rowKey="id"
            size="small"
            pagination={false}
            rowSelection={{
              selectedRowKeys: suggestions.filter((s) => s.selected).map((s) => s.id),
              onChange: (selectedKeys) => {
                const keySet = new Set(selectedKeys as string[]);
                onSuggestionsChange(
                  suggestions.map((s) => ({ ...s, selected: keySet.has(s.id) }))
                );
              },
            }}
            style={{
              background: "transparent",
            }}
            scroll={{ y: 400 }}
          />
        ) : (
          <Empty description="No suggestions generated" style={{ padding: 40 }} />
        )}
      </Card>

      {/* Manual Use Case Addition */}
      <Card
        title={
          <Space>
            <PlusOutlined style={{ color: isDark ? "#a78bfa" : "#7c3aed" }} />
            <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937", fontSize: 13 }}>
              Add Custom Use Case
            </Text>
          </Space>
        }
        style={{ ...cardStyle, marginTop: 16 }}
        styles={{ body: { padding: "12px 16px" } }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <TextArea
            value={newUseCase}
            onChange={(e) => setNewUseCase(e.target.value)}
            placeholder="Describe a test case the AI missed... e.g., 'Verify error toast when save fails with network timeout'"
            autoSize={{ minRows: 1, maxRows: 3 }}
            style={{ flex: 1, borderRadius: 6 }}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                addManualUseCase();
              }
            }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={addManualUseCase}
            disabled={!newUseCase.trim()}
            style={{
              borderRadius: 6,
              background: newUseCase.trim()
                ? "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)"
                : undefined,
              border: "none",
            }}
          >
            Add
          </Button>
        </div>

        {/* List of Manual Use Cases */}
        {manualUseCases.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {manualUseCases.map((uc) => (
              <div
                key={uc.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 10px",
                  marginBottom: 6,
                  background: isDark ? "#1f2937" : "#f3e8ff",
                  borderRadius: 6,
                  border: `1px solid ${isDark ? "#4c1d95" : "#e9d5ff"}`,
                }}
              >
                <Space>
                  <Tag color="purple" style={{ borderRadius: 4, fontSize: 11 }}>
                    Manual
                  </Tag>
                  <Text style={{ fontSize: 12, color: isDark ? "#e5e7eb" : "#374151" }}>
                    {uc.description}
                  </Text>
                </Space>
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  onClick={() => removeManualUseCase(uc.id)}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Action Buttons */}
      <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between" }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={onBack}
          size="large"
          style={{ borderRadius: 8, height: 48 }}
        >
          Back
        </Button>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            onClick={onGenerate}
            loading={isGenerating}
            disabled={selectedCount === 0 || isTooLow}
            style={{
              height: 48,
              borderRadius: 8,
              paddingLeft: 24,
              paddingRight: 24,
              background:
                selectedCount === 0 || isTooLow
                  ? undefined
                  : "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
              border: "none",
              fontWeight: 600,
            }}
          >
            {isGenerating
              ? "Generating & Running..."
              : `Generate and Run FT (${selectedCount})`}
          </Button>
          {isTooLow && (
            <Text style={{ fontSize: 11, color: "#dc2626" }}>
              Insufficient automation ID coverage ({automationCoverage}%) — add more IDs to proceed
            </Text>
          )}
          {isWarnCoverage && (
            <Text style={{ fontSize: 11, color: "#d97706" }}>
              {automationCoverage}% coverage — tests may fail due to missing automation IDs
            </Text>
          )}
        </div>
      </div>
    </div>
  );
}
