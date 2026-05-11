"use client";

import React from "react";
import {
  Card,
  Row,
  Col,
  Select,
  Radio,
  Button,
  Space,
  Typography,
  Divider,
  Progress,
  Spin,
  InputNumber,
  Switch,
  Tooltip,
} from "antd";
import {
  PlayCircleOutlined,
  StopOutlined,
  SettingOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";
import { BROWSERS } from "@/types/ft";

const { Text } = Typography;


interface RunConfigPanelProps {
  browser: string;
  onBrowserChange: (browser: string) => void;
  retries: number;
  onRetriesChange: (retries: number) => void;
  runMode: "headless" | "headed";
  onRunModeChange: (mode: "headless" | "headed") => void;
  workerCount: number;
  onWorkerCountChange: (count: number) => void;
  selectedCount: number;
  isRunning: boolean;
  runProgress: number;
  currentStep: string;
  onRun: () => void;
  onStop: () => void;
  disabled?: boolean;
  fixMode: "execute-only" | "auto-fix" | "manual-fix";
  onFixModeChange: (mode: "execute-only" | "auto-fix" | "manual-fix") => void;
  maxFixAttempts: number;
  onMaxFixAttemptsChange: (n: number) => void;
  maxComplianceFixes: number;
  onMaxComplianceFixesChange: (n: number) => void;
}

export default function RunConfigPanel({
  browser,
  onBrowserChange,
  retries,
  onRetriesChange,
  runMode,
  onRunModeChange,
  workerCount,
  onWorkerCountChange,
  selectedCount,
  isRunning,
  runProgress,
  currentStep,
  onRun,
  onStop,
  disabled,
  fixMode,
  onFixModeChange,
  maxFixAttempts,
  onMaxFixAttemptsChange,
  maxComplianceFixes,
  onMaxComplianceFixesChange,
}: RunConfigPanelProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";


  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  return (
    <Card
      title={
        <Space>
          <SettingOutlined style={{ color: isDark ? "#34d399" : "#059669" }} />
          <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
            Run Configuration
          </Text>
        </Space>
      }
      style={cardStyle}
      styles={{ body: { padding: "16px 20px" } }}
    >
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Space style={{ marginBottom: 8 }}>
            <Text strong style={{ color: isDark ? "#e5e7eb" : "#374151", fontSize: 13 }}>
              Browser
            </Text>
            <Tooltip
              title={
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                  <p style={{ marginBottom: 6 }}>Selects which browser Cypress uses to run your tests.</p>
                  <p style={{ marginBottom: 4 }}><strong>Electron</strong> — Default. A bundled Chromium that ships inside Cypress. No install needed, fastest startup, works everywhere. Ideal for CI and headless runs.</p>
                  <p style={{ marginBottom: 4 }}><strong>Chrome</strong> — Real Google Chrome installed on the machine. Closest to actual user experience. Requires Chrome to be installed.</p>
                  <p style={{ marginBottom: 4 }}><strong>Firefox</strong> — Mozilla Firefox. Use when cross-browser coverage is needed.</p>
                  <p style={{ marginBottom: 0 }}><strong>Edge</strong> — Chromium-based Edge. Same engine as Chrome, different build.</p>
                </div>
              }
              styles={{ root: { maxWidth: 360 } }}
            >
              <QuestionCircleOutlined style={{ color: isDark ? "#9ca3af" : "#6b7280", cursor: "help", fontSize: 13 }} />
            </Tooltip>
          </Space>
          <Select
            value={browser}
            onChange={onBrowserChange}
            style={{ width: "100%" }}
            disabled={disabled || isRunning}
            options={BROWSERS.map((b) => ({
              value: b.value,
              label: (
                <Space>
                  <span>{b.icon}</span>
                  <span>{b.label}</span>
                </Space>
              ),
            }))}
          />
        </Col>
        <Col span={12}>
          <Space style={{ marginBottom: 8 }}>
            <Text strong style={{ color: isDark ? "#e5e7eb" : "#374151", fontSize: 13 }}>Retries</Text>
            <Tooltip
              title={<div style={{ fontSize: 12, lineHeight: 1.6 }}><p style={{ marginBottom: 4 }}>How many times Cypress automatically re-runs a failing test before marking it as failed.</p><p style={{ marginBottom: 4 }}><strong>0</strong> — No retry. Failure is reported immediately.</p><p style={{ marginBottom: 4 }}><strong>1–2</strong> — Recommended for most suites. Absorbs occasional flakiness from timing or network jitter.</p><p style={{ marginBottom: 0 }}><strong>3+</strong> — Use sparingly. High retry counts mask genuine failures and slow down runs.</p></div>}
              styles={{ root: { maxWidth: 340 } }}
            >
              <QuestionCircleOutlined style={{ color: isDark ? "#9ca3af" : "#6b7280", cursor: "help", fontSize: 13 }} />
            </Tooltip>
          </Space>
          <Select
            value={retries}
            onChange={onRetriesChange}
            style={{ width: "100%" }}
            disabled={disabled || isRunning}
            options={[
              { value: 0, label: "No retries" },
              { value: 1, label: "1 retry" },
              { value: 2, label: "2 retries" },
              { value: 3, label: "3 retries" },
              { value: 4, label: "4 retries" },
              { value: 5, label: "5 retries" },
            ]}
          />
        </Col>
        <Col span={12}>
          <Space style={{ marginBottom: 8 }}>
            <Text strong style={{ color: isDark ? "#e5e7eb" : "#374151", fontSize: 13 }}>Parallel Workers</Text>
            <Tooltip
              title={<div style={{ fontSize: 12, lineHeight: 1.6 }}><p style={{ marginBottom: 4 }}>Splits your selected test files across multiple independent Cypress processes running simultaneously.</p><p style={{ marginBottom: 4 }}><strong>1 (Sequential)</strong> — One file at a time. Safest, easiest to debug.</p><p style={{ marginBottom: 0 }}><strong>2–4 Workers</strong> — Files are divided between workers, cutting total run time proportionally. Useful when you have many spec files.</p></div>}
              styles={{ root: { maxWidth: 360 } }}
            >
              <QuestionCircleOutlined style={{ color: isDark ? "#9ca3af" : "#6b7280", cursor: "help", fontSize: 13 }} />
            </Tooltip>
          </Space>
          <Select
            value={fixMode !== "execute-only" ? 1 : workerCount}
            onChange={onWorkerCountChange}
            style={{ width: "100%" }}
            disabled={disabled || isRunning || fixMode !== "execute-only"}
            options={[
              { value: 1, label: "1 (Sequential)" },
              { value: 2, label: "2 Workers" },
              { value: 3, label: "3 Workers" },
              { value: 4, label: "4 Workers" },
            ]}
          />
          <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
            {fixMode !== "execute-only"
              ? "Single worker used for fix modes"
              : workerCount > 1
                ? `Specs split across ${workerCount} parallel Cypress processes`
                : "All specs run in a single Cypress process"}
          </Text>
        </Col>
        <Col span={12}>
          <Space style={{ marginBottom: 8 }}>
            <Text strong style={{ color: isDark ? "#e5e7eb" : "#374151", fontSize: 13 }}>Run Mode</Text>
            <Tooltip
              title={<div style={{ fontSize: 12, lineHeight: 1.6 }}><p style={{ marginBottom: 4 }}><strong>Headless</strong> — The browser runs invisibly in the background. Faster, lower memory, ideal for CI and automated runs. Screenshots are still captured on failure.</p><p style={{ marginBottom: 0 }}><strong>Headed</strong> — A real browser window opens and you can watch each test step execute in real time. Use this when debugging a failing test or verifying UI behaviour visually.</p></div>}
              styles={{ root: { maxWidth: 340 } }}
            >
              <QuestionCircleOutlined style={{ color: isDark ? "#9ca3af" : "#6b7280", cursor: "help", fontSize: 13 }} />
            </Tooltip>
          </Space>
          <Radio.Group
            value={runMode}
            onChange={(e) => onRunModeChange(e.target.value)}
            buttonStyle="solid"
            style={{ width: "100%" }}
            disabled={disabled || isRunning}
          >
            <Radio.Button value="headless" style={{ width: "50%", textAlign: "center" }}>
              <EyeInvisibleOutlined style={{ marginRight: 6 }} />
              Headless
            </Radio.Button>
            <Radio.Button value="headed" style={{ width: "50%", textAlign: "center" }}>
              <EyeOutlined style={{ marginRight: 6 }} />
              Headed
            </Radio.Button>
          </Radio.Group>
          <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
            {runMode === "headless"
              ? "Run without browser UI (faster)"
              : "Run with browser UI (for debugging)"}
          </Text>
        </Col>
        {/* Setup Mode hidden — workspace is now managed automatically via ensure-repo */}
        <Col span={24} style={{ display: "none" }}>
          <Radio.Group value={fixMode} onChange={(e) => onFixModeChange(e.target.value)}>
            <Radio.Button value="execute-only" />
            <Radio.Button value="auto-fix" />
            <Radio.Button value="manual-fix" />
          </Radio.Group>

          {fixMode === "auto-fix" && (
            <Row gutter={16} style={{ marginTop: 12 }}>
              <Col span={12}>
                <Space style={{ marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: isDark ? "#9ca3af" : "#6b7280" }}>Max Fix Attempts</Text>
                  <Tooltip
                    title={<div style={{ fontSize: 12, lineHeight: 1.6 }}><p style={{ marginBottom: 4 }}>The maximum number of times the AI will attempt to fix a failing test before giving up and reporting it as unresolvable.</p><p style={{ marginBottom: 0 }}>Each attempt: read the error → rewrite the test → re-run. Higher values give the AI more chances but increase total run time. Default of 10 is a good balance.</p></div>}
                    styles={{ root: { maxWidth: 320 } }}
                  >
                    <QuestionCircleOutlined style={{ color: isDark ? "#6b7280" : "#9ca3af", cursor: "help", fontSize: 11 }} />
                  </Tooltip>
                </Space>
                <InputNumber
                  min={1}
                  max={20}
                  value={maxFixAttempts}
                  onChange={(v) => onMaxFixAttemptsChange(v || 10)}
                  style={{ width: "100%" }}
                  disabled={disabled || isRunning}
                  size="small"
                />
                <Text type="secondary" style={{ fontSize: 10, display: "block", marginTop: 2 }}>
                  LLM fix loop iterations (default 10)
                </Text>
              </Col>
              <Col span={12}>
                <Space style={{ marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: isDark ? "#9ca3af" : "#6b7280" }}>Compliance Fixes</Text>
                  <Tooltip
                    title={<div style={{ fontSize: 12, lineHeight: 1.6 }}><p style={{ marginBottom: 4 }}>After a test passes Cypress, the AI checks whether the test code meets PayPal's FT coding standards (naming conventions, selector patterns, structure).</p><p style={{ marginBottom: 4 }}>If the score is below 90%, the AI regenerates the test. This setting caps how many regeneration passes it gets.</p><p style={{ marginBottom: 0 }}><strong>0</strong> — Skip compliance fixing entirely. <strong>1–2</strong> — Recommended default. <strong>3+</strong> — More passes for stricter quality enforcement.</p></div>}
                    styles={{ root: { maxWidth: 340 } }}
                  >
                    <QuestionCircleOutlined style={{ color: isDark ? "#6b7280" : "#9ca3af", cursor: "help", fontSize: 11 }} />
                  </Tooltip>
                </Space>
                <InputNumber
                  min={0}
                  max={5}
                  value={maxComplianceFixes}
                  onChange={(v) => onMaxComplianceFixesChange(v || 2)}
                  style={{ width: "100%" }}
                  disabled={disabled || isRunning}
                  size="small"
                />
                <Text type="secondary" style={{ fontSize: 10, display: "block", marginTop: 2 }}>
                  Compliance fix passes (default 2)
                </Text>
              </Col>
            </Row>
          )}
        </Col>
      </Row>

      <Divider style={{ margin: "16px 0" }} />

      <Space style={{ width: "100%" }} direction="vertical" size={12}>
        {!isRunning ? (
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            onClick={onRun}
            disabled={disabled || selectedCount === 0}
            block
            style={{
              height: 48,
              borderRadius: 8,
              background:
                selectedCount === 0 || disabled
                  ? undefined
                  : "linear-gradient(135deg, #059669 0%, #10b981 100%)",
              border: "none",
              fontWeight: 600,
            }}
          >
            Run {selectedCount} Test{selectedCount !== 1 ? "s" : ""}
          </Button>
        ) : (
          <Button
            danger
            size="large"
            icon={<StopOutlined />}
            onClick={onStop}
            block
            style={{ height: 48, borderRadius: 8, fontWeight: 600 }}
          >
            Stop Execution
          </Button>
        )}

        {isRunning && (
          <div
            style={{
              padding: 12,
              background: isDark ? "#1f2937" : "#f9fafb",
              borderRadius: 8,
            }}
          >
            <Progress
              percent={Math.round(runProgress)}
              status="active"
              strokeColor={{ "0%": "#059669", "100%": "#10b981" }}
            />
            <Space style={{ marginTop: 8 }}>
              <Spin size="small" />
              <Text style={{ fontSize: 12, color: isDark ? "#9ca3af" : "#6b7280" }}>
                {currentStep || "Starting..."}
              </Text>
            </Space>
          </div>
        )}
      </Space>
    </Card>
  );
}
