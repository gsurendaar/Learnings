"use client";

import React, { useState, useMemo } from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
  Divider,
  Timeline,
  Button,
  Space,
  Typography,
  Tag,
  Tooltip,
  Collapse,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
  BugOutlined,
  CodeOutlined,
  DisconnectOutlined,
  FieldTimeOutlined,
  AimOutlined,
  WarningOutlined,
  DownOutlined,
  CameraOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Modal } from "antd";
import { useTheme } from "@/components/ThemeProvider";
import ScreenshotGallery from "./ScreenshotGallery";

const { Text } = Typography;

// ============= Error Classification =============

interface ClassifiedError {
  category: string;
  summary: string;
  tagColor: string;
  icon: React.ReactNode;
}

function classifyError(error: string): ClassifiedError {
  const e = error.trim();

  // ReferenceError: X is not defined
  const refMatch = e.match(/ReferenceError:\s*(\w+)\s+is not defined/i);
  if (refMatch) {
    return {
      category: "Variable Error",
      summary: `"${refMatch[1]}" is not defined \u2014 check for typos in variable names`,
      tagColor: "orange",
      icon: <CodeOutlined />,
    };
  }

  // SyntaxError
  if (/SyntaxError/i.test(e)) {
    const msg = e.replace(/^SyntaxError:\s*/i, "").split("\n")[0];
    return {
      category: "Syntax Error",
      summary: msg || "Invalid syntax in code",
      tagColor: "red",
      icon: <BugOutlined />,
    };
  }

  // TypeError: Cannot read properties of null/undefined
  const typeErrMatch = e.match(/TypeError:.*Cannot read propert(?:y|ies) of (null|undefined)/i);
  if (typeErrMatch) {
    return {
      category: "Null Reference",
      summary: `Tried to access a property on ${typeErrMatch[1]}`,
      tagColor: "orange",
      icon: <WarningOutlined />,
    };
  }

  // TypeError (other)
  if (/^TypeError:/i.test(e)) {
    const msg = e.replace(/^TypeError:\s*/i, "").split("\n")[0];
    return {
      category: "Type Error",
      summary: msg,
      tagColor: "orange",
      icon: <BugOutlined />,
    };
  }

  // AssertionError: expected 'X' to equal 'Y'
  const assertMatch = e.match(/Assert(?:ion)?Error:\s*expected\s+'([^']*)'\s+to\s+equal\s+'([^']*)'/i);
  if (assertMatch) {
    return {
      category: "Assertion Mismatch",
      summary: `Expected "${assertMatch[2]}" but got "${assertMatch[1]}"`,
      tagColor: "purple",
      icon: <AimOutlined />,
    };
  }

  // AssertionError: expected to contain / include
  const containMatch = e.match(/Assert(?:ion)?Error:\s*expected\s+'([^']*)'\s+to\s+(contain|include)\s+'([^']*)'/i);
  if (containMatch) {
    return {
      category: "Assertion Mismatch",
      summary: `Expected "${containMatch[1]}" to contain "${containMatch[3]}"`,
      tagColor: "purple",
      icon: <AimOutlined />,
    };
  }

  // Timed out + Expected to find element
  const elementMatch = e.match(/Timed out.*?Expected to find element:\s*`([^`]+)`/i);
  if (elementMatch) {
    return {
      category: "Missing Element",
      summary: `Element ${elementMatch[1]} not found on page`,
      tagColor: "blue",
      icon: <AimOutlined />,
    };
  }

  // Timed out retrying after Nms
  const timeoutMatch = e.match(/Timed out retrying after (\d+)ms/i);
  if (timeoutMatch) {
    const secs = Math.round(parseInt(timeoutMatch[1]) / 1000);
    const detail = e.match(/:\s*(.+)/)?.[1]?.split("\n")[0] || "";
    return {
      category: "Timeout",
      summary: `Timed out after ${secs}s${detail ? ` \u2014 ${detail.slice(0, 80)}` : ""}`,
      tagColor: "gold",
      icon: <FieldTimeOutlined />,
    };
  }

  // ESOCKETTIMEDOUT / ECONNREFUSED / connection errors
  if (/ESOCKETTIMEDOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(e)) {
    return {
      category: "Connection Error",
      summary: "Server not responding \u2014 may need restart or is still loading",
      tagColor: "default",
      icon: <DisconnectOutlined />,
    };
  }

  // cy.visit() failed
  if (/cy\.visit\(\).*failed/i.test(e)) {
    return {
      category: "Page Load Error",
      summary: "Failed to load the page \u2014 server may not be running",
      tagColor: "default",
      icon: <DisconnectOutlined />,
    };
  }

  // CypressError (generic)
  if (/^CypressError:/i.test(e)) {
    const msg = e.replace(/^CypressError:\s*/i, "").split("\n")[0];
    return {
      category: "Cypress Error",
      summary: msg.length > 100 ? msg.slice(0, 100) + "..." : msg,
      tagColor: "red",
      icon: <BugOutlined />,
    };
  }

  // Default: extract first meaningful line
  const firstLine = e.split("\n").find((l) => l.trim() && !l.trim().startsWith("at ")) || e.split("\n")[0];
  return {
    category: "Test Error",
    summary: firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine,
    tagColor: "red",
    icon: <ExclamationCircleOutlined />,
  };
}

interface RetryAttemptItem {
  attempt: number;
  status: "passed" | "failed" | "pending" | "skipped";
  error?: string;
  duration: number;
}

interface TestResultItem {
  file: string;
  testName: string;
  status: "passed" | "failed" | "pending" | "skipped";
  duration: number;
  error?: string;
  attempts?: number;
  retryAttempts?: RetryAttemptItem[];
}

interface RunResultsProps {
  conclusion: "success" | "failure" | null;
  total: number;
  passed: number;
  failed: number;
  duration: number;
  results: TestResultItem[];
  onRerunAll: () => void;
  onRerunFailed: () => void;
  onFixFailed?: (result: TestResultItem) => void;
  showFixButton?: boolean;
  disabled?: boolean;
  screenshots?: string[];
  runId?: string;
}

export default function RunResults({
  conclusion,
  total,
  passed,
  failed,
  duration,
  results,
  onRerunAll,
  onRerunFailed,
  onFixFailed,
  showFixButton,
  disabled,
  screenshots,
  runId,
}: RunResultsProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const [lightboxFile, setLightboxFile] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const screenshotsByFile = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const s of screenshots ?? []) {
      const parts = s.replace(/\\/g, "/").split("/");
      const specIdx = parts.findIndex((p) => p.endsWith(".cy.ts") || p.endsWith(".cy.js"));
      const key = specIdx >= 0 ? parts[specIdx] : (parts[parts.length - 2] ?? "misc");
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(s);
    }
    return grouped;
  }, [screenshots]);

  const lightboxScreenshots = lightboxFile ? (screenshotsByFile.get(lightboxFile) ?? []) : [];

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  const durationStr = duration > 60000
    ? `${Math.floor(duration / 60000)}m ${Math.round((duration % 60000) / 1000)}s`
    : `${Math.round(duration / 1000)}s`;

  const totalFiles = new Set(results.map((r) => r.file.split("/").pop() || r.file)).size;
  const totalTests = results.length;
  const pendingCount = results.filter((r) => r.status === "pending" || r.status === "skipped").length;

  return (
    <>
    <Card
      title={
        <Space>
          {conclusion === "failure" ? (
            <CloseCircleOutlined style={{ color: "#dc2626" }} />
          ) : (
            <CheckCircleOutlined style={{ color: "#059669" }} />
          )}
          <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
            Test Results
          </Text>
          <Tag
            color={conclusion === "failure" ? "error" : "success"}
            style={{ borderRadius: 4 }}
          >
            {conclusion === "failure" ? "Failed" : "Passed"}
          </Tag>
        </Space>
      }
      style={cardStyle}
      styles={{ body: { padding: "16px 20px" } }}
    >
      {/* Stats Row */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col flex="1">
          <Statistic
            title={
              <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>Files</Text>
            }
            value={totalFiles}
            valueStyle={{ fontSize: 22, color: isDark ? "#ffffff" : "#1f2937" }}
          />
        </Col>
        <Col flex="1">
          <Statistic
            title={
              <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>Tests</Text>
            }
            value={totalTests}
            valueStyle={{ fontSize: 22, color: isDark ? "#c084fc" : "#7c3aed" }}
          />
        </Col>
        <Col flex="1">
          <Statistic
            title={
              <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>Passed</Text>
            }
            value={passed}
            valueStyle={{ fontSize: 22, color: "#059669" }}
            prefix={<CheckCircleOutlined />}
          />
        </Col>
        <Col flex="1">
          <Statistic
            title={
              <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>Failed</Text>
            }
            value={failed}
            valueStyle={{ fontSize: 22, color: "#dc2626" }}
            prefix={<CloseCircleOutlined />}
          />
        </Col>
        <Col flex="1">
          <Statistic
            title={
              <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>Pending</Text>
            }
            value={pendingCount}
            valueStyle={{ fontSize: 22, color: isDark ? "#fbbf24" : "#d97706" }}
            prefix={<ClockCircleOutlined />}
          />
        </Col>
        <Col flex="1">
          <Statistic
            title={
              <Text style={{ fontSize: 11, color: isDark ? "#9ca3af" : "#6b7280" }}>Duration</Text>
            }
            value={durationStr}
            valueStyle={{ fontSize: 22, color: isDark ? "#60a5fa" : "#2563eb" }}
            prefix={<ClockCircleOutlined />}
          />
        </Col>
      </Row>

      <Divider style={{ margin: "12px 0" }} />

      {/* Test Timeline */}
      <div style={{ maxHeight: 300, overflowY: "auto", paddingRight: 8 }}>
        <Timeline
          items={results.map((result) => ({
            color: result.status === "passed" ? "green" : result.status === "failed" ? "red" : "gray",
            children: (
              <div>
                <Space style={{ width: "100%", justifyContent: "space-between" }}>
                  <Space size={8}>
                    <Text
                      style={{
                        fontSize: 12,
                        color:
                          result.status === "passed"
                            ? isDark ? "#34d399" : "#059669"
                            : result.status === "failed"
                            ? isDark ? "#f87171" : "#dc2626"
                            : isDark ? "#9ca3af" : "#6b7280",
                      }}
                    >
                      {result.file.split("/").pop() || result.testName}
                    </Text>
                    {result.retryAttempts && result.retryAttempts.length > 1 && (
                      <Tag
                        color={result.status === "passed" ? "success" : "warning"}
                        style={{ borderRadius: 4, fontSize: 10 }}
                      >
                        {result.retryAttempts.length} tries
                      </Tag>
                    )}
                  </Space>
                  <Space size={8}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {(result.duration / 1000).toFixed(1)}s
                    </Text>
                    {(() => {
                      const fileKey = result.file.split("/").pop() ?? "";
                      const specKey = Array.from(screenshotsByFile.keys()).find(
                        (k) => result.file.includes(k) || k.includes(fileKey)
                      );
                      return specKey ? (
                        <Tooltip title={`${screenshotsByFile.get(specKey)?.length ?? 0} screenshot(s)`}>
                          <Button
                            type="text"
                            size="small"
                            icon={<CameraOutlined />}
                            style={{ color: isDark ? "#60a5fa" : "#2563eb", padding: "0 4px", height: 20, fontSize: 13 }}
                            onClick={() => { setLightboxFile(specKey); setLightboxIndex(0); }}
                          />
                        </Tooltip>
                      ) : null;
                    })()}
                    {showFixButton && result.status === "failed" && onFixFailed && (
                      <Tooltip title="Open in Fix Editor">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          style={{ color: isDark ? "#c084fc" : "#7c3aed", padding: "0 4px", height: 20 }}
                          onClick={() => onFixFailed(result)}
                        />
                      </Tooltip>
                    )}
                  </Space>
                </Space>

                {/* Retry attempts breakdown */}
                {result.retryAttempts && result.retryAttempts.length > 1 && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: "6px 10px",
                      background: isDark ? "#1f293780" : "#f9fafb",
                      borderRadius: 6,
                      borderLeft: `3px solid ${isDark ? "#4b5563" : "#d1d5db"}`,
                    }}
                  >
                    {result.retryAttempts.map((attempt) => (
                      <div
                        key={attempt.attempt}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: attempt.attempt < result.retryAttempts!.length ? 4 : 0,
                          fontSize: 11,
                        }}
                      >
                        <Tag
                          style={{
                            borderRadius: 4,
                            fontSize: 10,
                            margin: 0,
                            padding: "0 4px",
                            lineHeight: "18px",
                          }}
                          color={
                            attempt.status === "passed"
                              ? "success"
                              : attempt.status === "failed"
                              ? "error"
                              : "default"
                          }
                        >
                          Try {attempt.attempt}
                        </Tag>
                        <Text
                          style={{
                            fontSize: 11,
                            color:
                              attempt.status === "passed"
                                ? isDark ? "#34d399" : "#059669"
                                : attempt.status === "failed"
                                ? isDark ? "#f87171" : "#dc2626"
                                : isDark ? "#9ca3af" : "#6b7280",
                          }}
                        >
                          {attempt.status === "passed"
                            ? "Passed"
                            : attempt.error
                            ? classifyError(attempt.error).summary
                            : "Failed"}
                        </Text>
                      </div>
                    ))}
                  </div>
                )}

                {/* Single-attempt error (no retries) — expandable */}
                {(!result.retryAttempts || result.retryAttempts.length <= 1) && result.error && (() => {
                  const classified = classifyError(result.error);
                  return (
                    <Collapse
                      size="small"
                      ghost
                      style={{ marginTop: 4 }}
                      items={[{
                        key: "error",
                        label: (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Tag
                              color={classified.tagColor}
                              style={{ borderRadius: 4, fontSize: 10, margin: 0, flexShrink: 0 }}
                              icon={classified.icon}
                            >
                              {classified.category}
                            </Tag>
                            <Text style={{ fontSize: 12, color: isDark ? "#f87171" : "#dc2626" }}>
                              {classified.summary}
                            </Text>
                          </div>
                        ),
                        children: (
                          <pre
                            style={{
                              margin: 0,
                              padding: 10,
                              background: isDark ? "#1a1a2e" : "#fef2f2",
                              borderRadius: 6,
                              fontSize: 11,
                              lineHeight: 1.5,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              maxHeight: 300,
                              overflowY: "auto",
                              color: isDark ? "#fca5a5" : "#991b1b",
                              fontFamily: "monospace",
                            }}
                          >
                            {result.error}
                          </pre>
                        ),
                      }]}
                    />
                  );
                })()}
              </div>
            ),
          }))}
        />
      </div>

      {/* Action Buttons */}
      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={onRerunAll} disabled={disabled}>
          Rerun All
        </Button>
        {failed > 0 && (
          <Button
            type="primary"
            danger
            icon={<ReloadOutlined />}
            onClick={onRerunFailed}
            disabled={disabled}
          >
            Rerun Failed ({failed})
          </Button>
        )}
      </div>

      {/* Screenshots Section */}
      {screenshots && screenshots.length > 0 && runId && (
        <>
          <Divider style={{ margin: "16px 0" }} />
          <Collapse
            defaultActiveKey={["screenshots"]}
            items={[{
              key: "screenshots",
              label: (
                <Space>
                  <CameraOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
                  <Text strong style={{ fontSize: 13, color: isDark ? "#e5e7eb" : "#374151" }}>
                    Screenshots ({screenshots.length})
                  </Text>
                </Space>
              ),
              children: <ScreenshotGallery screenshots={screenshots} runId={runId} />,
            }]}
          />
        </>
      )}
    </Card>

      {/* Screenshot lightbox */}
      <Modal
        open={!!lightboxFile}
        onCancel={() => setLightboxFile(null)}
        footer={null}
        centered
        width={900}
        styles={{ body: { padding: 0, background: "#0d1117" } }}
        style={{ top: 20 }}
      >
        {lightboxFile && lightboxScreenshots.length > 0 && (
          <div style={{ background: "#0d1117", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#e5e7eb", fontSize: 12, fontFamily: "monospace" }}>{lightboxFile}</span>
              <span style={{ color: "#6b7280", fontSize: 11 }}>{lightboxIndex + 1} / {lightboxScreenshots.length}</span>
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 480, padding: "16px 60px" }}>
              <Button
                type="text"
                icon={<LeftOutlined />}
                disabled={lightboxIndex === 0}
                onClick={() => setLightboxIndex((i) => i - 1)}
                style={{ position: "absolute", left: 8, color: lightboxIndex === 0 ? "#374151" : "#e5e7eb", fontSize: 18, height: 48, width: 48 }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/ft-runner/artifacts?runId=${encodeURIComponent(runId ?? "")}&filePath=${encodeURIComponent(lightboxScreenshots[lightboxIndex])}`}
                alt={lightboxScreenshots[lightboxIndex].split("/").pop()}
                style={{ maxWidth: "100%", maxHeight: 520, objectFit: "contain", borderRadius: 4, display: "block" }}
              />
              <Button
                type="text"
                icon={<RightOutlined />}
                disabled={lightboxIndex === lightboxScreenshots.length - 1}
                onClick={() => setLightboxIndex((i) => i + 1)}
                style={{ position: "absolute", right: 8, color: lightboxIndex === lightboxScreenshots.length - 1 ? "#374151" : "#e5e7eb", fontSize: 18, height: 48, width: 48 }}
              />
            </div>
            <div style={{ padding: "8px 16px", borderTop: "1px solid #30363d", color: "#6b7280", fontSize: 11, fontFamily: "monospace", textAlign: "center" }}>
              {lightboxScreenshots[lightboxIndex].split("/").pop()}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
