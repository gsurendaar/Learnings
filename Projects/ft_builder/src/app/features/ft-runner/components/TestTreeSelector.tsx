"use client";

import React, { useState, useMemo } from "react";
import {
  Card,
  Tree,
  Button,
  Space,
  Typography,
  Input,
  Tag,
  Tooltip,
  Spin,
  Empty,
  Select,
} from "antd";
import type { TreeDataNode, TreeProps } from "antd";
import {
  FolderOutlined,
  FileOutlined,
  SearchOutlined,
  ExpandOutlined,
  CompressOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";
import { SPEC_SUITES } from "@/types/ft";

const { Text } = Typography;

interface TestTreeSelectorProps {
  treeData: TreeDataNode[];
  loading: boolean;
  totalTests: number;
  onSelectionChange: (selectedKeys: React.Key[]) => void;
  selectedKeys: React.Key[];
  disabled?: boolean;
  basePath?: string;
}

// Add icons to tree nodes
function addIcons(nodes: TreeDataNode[], isDark: boolean): TreeDataNode[] {
  return nodes.map((node) => ({
    ...node,
    icon: node.isLeaf ? (
      <FileOutlined style={{ color: "#7c3aed" }} />
    ) : (
      <FolderOutlined style={{ color: isDark ? "#34d399" : "#059669" }} />
    ),
    children: node.children ? addIcons(node.children, isDark) : undefined,
  }));
}

// Count leaf nodes
function countLeaves(nodes: TreeDataNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.isLeaf) count++;
    if (node.children) count += countLeaves(node.children);
  }
  return count;
}

// Collect all keys
function collectKeys(nodes: TreeDataNode[], leavesOnly = false): React.Key[] {
  const keys: React.Key[] = [];
  for (const node of nodes) {
    if (!leavesOnly || node.isLeaf) keys.push(node.key);
    if (node.children) keys.push(...collectKeys(node.children, leavesOnly));
  }
  return keys;
}

// Collect folder keys
function collectFolderKeys(nodes: TreeDataNode[]): React.Key[] {
  const keys: React.Key[] = [];
  for (const node of nodes) {
    if (node.children) {
      keys.push(node.key);
      keys.push(...collectFolderKeys(node.children));
    }
  }
  return keys;
}

export default function TestTreeSelector({
  treeData,
  loading,
  totalTests,
  onSelectionChange,
  selectedKeys,
  disabled,
  basePath,
}: TestTreeSelectorProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [autoExpandParent, setAutoExpandParent] = useState(true);
  const [searchValue, setSearchValue] = useState("");
  const [selectedSuite, setSelectedSuite] = useState<string | null>(null);

  const selectedCount = selectedKeys.filter(
    (key) => typeof key === "string" && (key.endsWith(".cy.ts") || key.endsWith(".cy.js"))
  ).length;

  const decoratedTree = useMemo(() => addIcons(treeData, isDark), [treeData, isDark]);

  const onExpand: TreeProps["onExpand"] = (keys) => {
    setExpandedKeys(keys);
    setAutoExpandParent(false);
  };

  const onCheck: TreeProps["onCheck"] = (keys) => {
    onSelectionChange(keys as React.Key[]);
    setSelectedSuite(null); // Clear suite selection when manually picking
  };

  const onSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setSearchValue(value);
    if (value) {
      const expanded: string[] = [];
      const search = (nodes: TreeDataNode[], parentKey = "") => {
        for (const node of nodes) {
          const nodeKey = node.key as string;
          if (nodeKey.toLowerCase().includes(value.toLowerCase())) {
            if (parentKey) expanded.push(parentKey);
          }
          if (node.children) search(node.children, nodeKey);
        }
      };
      search(treeData);
      setExpandedKeys([...new Set(expanded)]);
      setAutoExpandParent(true);
    }
  };

  const selectAll = () => {
    onSelectionChange(collectKeys(treeData));
    setSelectedSuite(null);
  };

  const deselectAll = () => {
    onSelectionChange([]);
    setSelectedSuite(null);
  };

  const handleSuiteSelect = (suiteKey: string) => {
    setSelectedSuite(suiteKey);
    // When a suite is selected, we select all matching files by pattern
    // For the UI, we just select all files since the actual pattern matching
    // happens on the server via specPattern
    if (suiteKey === "all") {
      selectAll();
    }
  };

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
    height: "100%",
  };

  return (
    <Card
      title={
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Space size={4} wrap>
            <FolderOutlined style={{ color: isDark ? "#34d399" : "#059669" }} />
            <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
              Test Files
            </Text>
            <Tag color="purple" style={{ borderRadius: 4 }}>
              {totalTests} tests
            </Tag>
            {basePath && (
              <Text code style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>
                {basePath}
              </Text>
            )}
          </Space>
          <Space size={4}>
            <Tooltip title="Expand All">
              <Button
                type="text"
                size="small"
                icon={<ExpandOutlined />}
                onClick={() => setExpandedKeys(collectFolderKeys(treeData))}
                disabled={disabled || loading}
              />
            </Tooltip>
            <Tooltip title="Collapse All">
              <Button
                type="text"
                size="small"
                icon={<CompressOutlined />}
                onClick={() => setExpandedKeys([])}
                disabled={disabled || loading}
              />
            </Tooltip>
          </Space>
        </Space>
      }
      style={cardStyle}
      styles={{ body: { padding: "12px 16px" } }}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {/* Quick Suite Selector */}
        <Select
          placeholder="Quick select a test suite..."
          value={selectedSuite}
          onChange={handleSuiteSelect}
          style={{ width: "100%" }}
          allowClear
          onClear={() => setSelectedSuite(null)}
          disabled={disabled || loading}
          options={Object.entries(SPEC_SUITES).map(([key, suite]) => ({
            value: key,
            label: (
              <Space>
                <span>{suite.label}</span>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {suite.description}
                </Text>
              </Space>
            ),
          }))}
        />

        {/* Search */}
        <Input
          placeholder="Search test files..."
          prefix={<SearchOutlined style={{ color: isDark ? "#9ca3af" : "#6b7280" }} />}
          value={searchValue}
          onChange={onSearch}
          allowClear
          disabled={disabled || loading}
        />

        {/* Selection Controls */}
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Space>
            <Button size="small" onClick={selectAll} disabled={disabled || loading}>
              Select All
            </Button>
            <Button size="small" onClick={deselectAll} disabled={disabled || loading}>
              Deselect All
            </Button>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {selectedCount} selected
          </Text>
        </Space>

        {/* Tree */}
        <div
          style={{
            maxHeight: 400,
            overflowY: "auto",
            border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
            borderRadius: 8,
            padding: 8,
            background: isDark ? "#1f2937" : "#ffffff",
            minHeight: 200,
          }}
        >
          {loading ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <Spin />
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">Loading test files...</Text>
              </div>
            </div>
          ) : treeData.length === 0 ? (
            <Empty
              description="No test files found. Select a repo and branch first."
              style={{ padding: 40 }}
            />
          ) : (
            <Tree
              checkable
              onExpand={onExpand}
              expandedKeys={expandedKeys}
              autoExpandParent={autoExpandParent}
              onCheck={onCheck}
              checkedKeys={selectedKeys}
              treeData={decoratedTree}
              showIcon
              disabled={disabled}
              style={{
                background: "transparent",
                color: isDark ? "#e5e7eb" : "#374151",
              }}
            />
          )}
        </div>

      </Space>
    </Card>
  );
}
