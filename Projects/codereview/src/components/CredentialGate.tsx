"use client";

import React, { useState } from "react";
import { Modal, Input, Space, Typography, Button, Alert } from "antd";
import { KeyOutlined, GithubOutlined, ApiOutlined } from "@ant-design/icons";
import { useInitialization, DEFAULT_LLM_BASE_URL } from "@/components/InitializationContext";

const { Text, Title } = Typography;

/**
 * Credential gate modal — renders inside ConfigProvider/App so Ant Design works properly.
 * Blocks the entire app until GitHub PAT + Anthropic API Key are provided.
 * Wrap your page content with this component.
 */
export default function CredentialGate({ children }: { children: React.ReactNode }) {
  const { isInitialized, isInitializing, initError, initializeSetup } = useInitialization();

  const [apiKey, setApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");

  const handleSave = async () => {
    try {
      await initializeSetup(apiKey, githubToken, DEFAULT_LLM_BASE_URL);
    } catch {
      // error is set in context
    }
  };

  return (
    <>
      <Modal
        open={!isInitialized}
        closable={false}
        maskClosable={false}
        footer={null}
        centered
        width={480}
        styles={{
          body: { padding: "24px" },
          mask: { backdropFilter: "blur(8px)" },
        }}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <KeyOutlined style={{ fontSize: 36, color: "#059669" }} />
            <Title level={4} style={{ margin: "12px 0 4px" }}>
              Welcome to GitLogs
            </Title>
            <Text type="secondary">
              Enter your credentials to get started. These are stored locally in your browser.
            </Text>
          </div>

          <div>
            <Text strong style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
              <GithubOutlined style={{ marginRight: 6 }} />
              GitHub PAT Token *
            </Text>
            <Input.Password
              placeholder="ghp_xxxxxxxxxxxx"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              size="large"
              onPressEnter={apiKey.trim() ? handleSave : undefined}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Personal Access Token from github.com with repo scope
            </Text>
          </div>

          <div>
            <Text strong style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
              <ApiOutlined style={{ marginRight: 6 }} />
              Anthropic API Key *
            </Text>
            <Input.Password
              placeholder="sk-ant-xxxxxxxxxxxx"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              size="large"
              onPressEnter={githubToken.trim() ? handleSave : undefined}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              API key for Claude (used for test generation and auto-fix)
            </Text>
          </div>

          {initError && (
            <Alert type="error" message={initError} showIcon />
          )}

          <Button
            type="primary"
            size="large"
            block
            loading={isInitializing}
            disabled={!apiKey.trim() || !githubToken.trim()}
            onClick={handleSave}
            style={{
              height: 48,
              borderRadius: 8,
              background: apiKey.trim() && githubToken.trim()
                ? "linear-gradient(135deg, #059669 0%, #10b981 100%)"
                : undefined,
              border: "none",
              fontWeight: 600,
            }}
          >
            Save & Continue
          </Button>
        </Space>
      </Modal>

      {children}
    </>
  );
}
