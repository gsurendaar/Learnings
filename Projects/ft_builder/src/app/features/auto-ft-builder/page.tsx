"use client";

import { Layout, Result, Button, Card, Typography } from "antd";
import {
  BuildOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { ModernHeader } from "@/components/ModernHeader";
import { useTheme } from "@/components/ThemeProvider";

const { Content } = Layout;
const { Paragraph } = Typography;

export default function AutoFTBuilderPage() {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  return (
    <Layout
      style={{
        minHeight: "100vh",
        background: isDark ? "#111827" : "#f9fafb",
      }}
    >
      <ModernHeader />
      <Content style={{ padding: "48px 24px" }}>
        <Card
          style={{
            maxWidth: 600,
            margin: "0 auto",
            background: isDark ? "#1f2937" : "#ffffff",
            border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
            borderRadius: 12,
          }}
        >
          <Result
            icon={
              <BuildOutlined
                style={{ color: "#722ed1", fontSize: 64 }}
              />
            }
            title="Auto FT Builder"
            subTitle="This feature is under development"
            extra={
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => router.push("/")}
              >
                Back to Home
              </Button>
            }
          >
            <Paragraph
              style={{
                color: isDark ? "#9ca3af" : "#6b7280",
                textAlign: "center",
              }}
            >
              Automatically generate functional tests from your code using AI.
              Analyze code paths and produce comprehensive test suites. This
              feature will be available soon.
            </Paragraph>
          </Result>
        </Card>
      </Content>
    </Layout>
  );
}
