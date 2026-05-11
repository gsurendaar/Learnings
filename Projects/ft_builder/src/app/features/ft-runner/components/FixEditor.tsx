"use client";

import React, { useState } from "react";
import {
  Card,
  Button,
  Space,
  Typography,
  Alert,
  Spin,
  Tag,
  Row,
  Col,
  Divider,
} from "antd";
import {
  CloseOutlined,
  SendOutlined,
  BugOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import { useTheme } from "@/components/ThemeProvider";

const { Text, Paragraph } = Typography;

interface FixEditorProps {
  filePath: string;
  fileContent: string;
  errorMessage: string;
  diagnosticInfo: string;
  workDir: string;
  onSaveAndRerun: (newContent: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

export default function FixEditor({
  filePath,
  fileContent,
  errorMessage,
  diagnosticInfo,
  workDir,
  onSaveAndRerun,
  onCancel,
  disabled,
}: FixEditorProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const [content, setContent] = useState(fileContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSavePushRerun = async () => {
    setSaving(true);
    setError(null);

    try {
      // 1. Save the file to the clone directory
      const saveRes = await fetch("/api/ft-runner/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDir, filePath, content }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) {
        setError(`Failed to save file: ${saveData.message}`);
        setSaving(false);
        return;
      }

      // 2. Push the fix to the remote branch
      const pushRes = await fetch("/api/ft-runner/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDir, filePath, action: "push-only" }),
      });
      const pushData = await pushRes.json();
      if (!pushData.success) {
        setError(`Failed to push: ${pushData.message}`);
        setSaving(false);
        return;
      }

      // 3. Close editor and re-trigger the full FT pipeline
      onSaveAndRerun(content);
    } catch (err: any) {
      setError(err?.message || "Failed to save and push");
    } finally {
      setSaving(false);
    }
  };

  const cardStyle = {
    borderRadius: 12,
    border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
    background: isDark ? "#111827" : "#f9fafb",
  };

  return (
    <Card
      title={
        <Space>
          <BugOutlined style={{ color: "#ef4444" }} />
          <Text strong style={{ color: isDark ? "#ffffff" : "#1f2937" }}>
            Fix Editor
          </Text>
          <Tag color="warning">{filePath.split("/").pop()}</Tag>
        </Space>
      }
      extra={
        <Button icon={<CloseOutlined />} onClick={onCancel} type="text" size="small" />
      }
      style={cardStyle}
      styles={{ body: { padding: 0 } }}
    >
      <Row style={{ minHeight: 500 }}>
        {/* Left: Editor */}
        <Col xs={24} lg={14} style={{ borderRight: `1px solid ${isDark ? "#374151" : "#e5e7eb"}` }}>
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${isDark ? "#374151" : "#e5e7eb"}` }}>
            <Space>
              <FileTextOutlined />
              <Text code style={{ fontSize: 12 }}>{filePath}</Text>
            </Space>
          </div>
          <Editor
            height="450px"
            language="typescript"
            theme={isDark ? "vs-dark" : "light"}
            value={content}
            onChange={(val) => setContent(val || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              readOnly: disabled || saving,
            }}
          />
        </Col>

        {/* Right: Error context */}
        <Col xs={24} lg={10}>
          <div style={{ padding: 16, maxHeight: 500, overflow: "auto" }}>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <div>
                <Text strong style={{ fontSize: 13, color: isDark ? "#f87171" : "#dc2626" }}>
                  Error
                </Text>
                <pre
                  style={{
                    marginTop: 4,
                    padding: 10,
                    background: isDark ? "#1e1e1e" : "#fef2f2",
                    borderRadius: 6,
                    fontSize: 11,
                    maxHeight: 180,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: isDark ? "#fca5a5" : "#991b1b",
                  }}
                >
                  {errorMessage}
                </pre>
              </div>

              <Divider style={{ margin: "8px 0" }} />

              <div>
                <Text strong style={{ fontSize: 13, color: isDark ? "#60a5fa" : "#2563eb" }}>
                  AI Diagnosis
                </Text>
                <Paragraph
                  style={{
                    marginTop: 4,
                    padding: 10,
                    background: isDark ? "#1e293b" : "#eff6ff",
                    borderRadius: 6,
                    fontSize: 12,
                    color: isDark ? "#93c5fd" : "#1e40af",
                  }}
                >
                  {diagnosticInfo}
                </Paragraph>
              </div>
            </Space>
          </div>
        </Col>
      </Row>

      {/* Bottom: Actions */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1 }}>
          {error && (
            <Alert
              type="error"
              message={error}
              showIcon
              closable
              onClose={() => setError(null)}
              style={{ padding: "4px 12px" }}
            />
          )}
        </div>

        <Space>
          <Button onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="primary"
            icon={saving ? undefined : <SendOutlined />}
            onClick={handleSavePushRerun}
            loading={saving}
            disabled={disabled || !content}
            style={{
              background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
              border: "none",
            }}
          >
            {saving ? "Pushing..." : "Save, Push & Re-run"}
          </Button>
        </Space>
      </div>
    </Card>
  );
}
