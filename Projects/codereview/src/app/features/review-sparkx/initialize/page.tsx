"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Layout,
  Card,
  Form,
  Input,
  Button,
  Alert,
  Space,
  Typography,
  Spin,
  Divider,
  Row,
  Col,
  Tooltip,
} from "antd";
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  BulbOutlined,
  LockOutlined,
  GithubOutlined,
  CloudOutlined,
} from "@ant-design/icons";
import { ModernHeader } from "@/components/ModernHeader";
import { SubHeader } from "@/components/SubHeader";
import { useTheme } from "@/components/ThemeProvider";
import { useInitialization } from "@/components/InitializationContext";

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

export default function InitializePage() {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const { initializeSetup, isInitializing, initError } = useInitialization();

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{
    llm?: string;
    github?: string;
    baseUrl?: string;
  }>({});

  const handleSubmit = async (values: any) => {
    setLoading(true);
    setError(null);
    setValidationErrors({});

    try {
      const { llmApiKey, githubToken, baseUrl } = values;

      // Validate inputs
      if (!llmApiKey?.trim()) {
        setValidationErrors((prev) => ({
          ...prev,
          llm: "LLM API Key is required",
        }));
        setLoading(false);
        return;
      }

      if (!githubToken?.trim()) {
        setValidationErrors((prev) => ({
          ...prev,
          github: "GitHub PAT Token is required",
        }));
        setLoading(false);
        return;
      }

      if (!baseUrl?.trim()) {
        setValidationErrors((prev) => ({
          ...prev,
          baseUrl: "Base URL is required",
        }));
        setLoading(false);
        return;
      }

      // Call initialization
      await initializeSetup(
        llmApiKey.trim(),
        githubToken.trim(),
        baseUrl.trim()
      );

      setSuccess(true);

      // Redirect to review page after 2 seconds
      setTimeout(() => {
        router.push("/features/review-sparkx");
      }, 2000);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Initialization failed";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <ModernHeader />
      <SubHeader />
      <Content
        style={{
          padding: "24px",
          background: isDark ? "#141414" : "#f5f5f5",
        }}
      >
        <Row justify="center" style={{ marginBottom: "32px" }}>
          <Col xs={24} sm={20} md={16} lg={12} xl={10}>
            <Card
              style={{
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
              }}
            >
              <Space
                direction="vertical"
                size="large"
                style={{ width: "100%" }}
              >
                {/* Header */}
                <div>
                  <Title level={2} style={{ margin: 0, marginBottom: "8px" }}>
                    <CloudOutlined /> Initialize SparkX Review
                  </Title>
                  <Paragraph style={{ margin: 0, color: "#666" }}>
                    Configure your credentials to start using SparkX code review
                  </Paragraph>
                </div>

                <Divider style={{ margin: "16px 0" }} />

                {/* Success Message */}
                {success && (
                  <Alert
                    message="Initialization Successful!"
                    description="Your credentials have been validated and SparkX Node Web has been initialized. Redirecting to review page..."
                    type="success"
                    icon={<CheckCircleOutlined />}
                    showIcon
                  />
                )}

                {/* Error Messages */}
                {error && (
                  <Alert
                    message="Initialization Failed"
                    description={error}
                    type="error"
                    icon={<ExclamationCircleOutlined />}
                    showIcon
                    closable
                    onClose={() => setError(null)}
                  />
                )}

                {initError && !error && (
                  <Alert
                    message="Initialization Error"
                    description={initError}
                    type="error"
                    icon={<ExclamationCircleOutlined />}
                    showIcon
                    closable
                  />
                )}

                {/* Info Alert */}
                <Alert
                  message="What happens during initialization?"
                  description={
                    <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                      <li>Your LLM API key will be validated</li>
                      <li>Your GitHub PAT token will be verified</li>
                      <li>SparkX Node Web will be cloned/updated in the repos/ directory</li>
                      <li>Credentials will be securely stored locally</li>
                    </ul>
                  }
                  type="info"
                  icon={<BulbOutlined />}
                  showIcon
                />

                {/* Form */}
                <Form
                  form={form}
                  layout="vertical"
                  onFinish={handleSubmit}
                  requiredMark="optional"
                  autoComplete="off"
                >
                  {/* Base URL */}
                  <Form.Item
                    label="LLM API Base URL"
                    name="baseUrl"
                    rules={[
                      {
                        required: true,
                        message: "Please enter the LLM API base URL",
                      },
                      {
                        pattern: /^https?:\/\/.+/,
                        message: "Please enter a valid URL (starting with http:// or https://)",
                      },
                    ]}
                    validateStatus={validationErrors.baseUrl ? "error" : ""}
                    help={validationErrors.baseUrl}
                  >
                    <Input
                      prefix={<CloudOutlined />}
                      placeholder="https://api.example.com"
                      disabled={loading || success}
                      type="text"
                    />
                  </Form.Item>

                  {/* LLM API Key */}
                  <Form.Item
                    label={
                      <span>
                        LLM API Key{" "}
                        <Tooltip title="Your Claude or other LLM provider API key">
                          <BulbOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="llmApiKey"
                    rules={[
                      {
                        required: true,
                        message: "Please enter your LLM API key",
                      },
                      {
                        min: 10,
                        message: "API key seems too short",
                      },
                    ]}
                    validateStatus={validationErrors.llm ? "error" : ""}
                    help={validationErrors.llm}
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="sk-... or your API key"
                      disabled={loading || success}
                    />
                  </Form.Item>

                  {/* GitHub PAT */}
                  <Form.Item
                    label={
                      <span>
                        GitHub PAT Token{" "}
                        <Tooltip title="Personal Access Token for GitHub API access">
                          <BulbOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="githubToken"
                    rules={[
                      {
                        required: true,
                        message: "Please enter your GitHub PAT token",
                      },
                      {
                        min: 10,
                        message: "Token seems too short",
                      },
                    ]}
                    validateStatus={validationErrors.github ? "error" : ""}
                    help={validationErrors.github}
                  >
                    <Input.Password
                      prefix={<GithubOutlined />}
                      placeholder="ghp_... or your PAT token"
                      disabled={loading || success}
                    />
                  </Form.Item>

                  {/* Submit Button */}
                  <Form.Item>
                    <Button
                      type="primary"
                      size="large"
                      block
                      htmlType="submit"
                      loading={loading || isInitializing}
                      disabled={success}
                    >
                      {loading || isInitializing
                        ? "Validating and Initializing..."
                        : "Validate & Initialize"}
                    </Button>
                  </Form.Item>
                </Form>

                {/* Help Text */}
                <div style={{ background: isDark ? "#1f1f1f" : "#fafafa", padding: "12px", borderRadius: "4px" }}>
                  <Text
                    type="secondary"
                    style={{ fontSize: "12px", display: "block", marginBottom: "8px" }}
                  >
                    <strong>Need help?</strong>
                  </Text>
                  <Text type="secondary" style={{ fontSize: "12px" }}>
                    - Get your LLM API key from your provider's dashboard
                    <br />
                    - Create a GitHub PAT at{" "}
                    <a
                      href="https://github.com/settings/tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      github.com/settings/tokens
                    </a>
                    <br />- Base URL is your LLM API endpoint (e.g., https://api.openai.com/v1)
                  </Text>
                </div>
              </Space>
            </Card>
          </Col>
        </Row>
      </Content>
    </Layout>
  );
}
