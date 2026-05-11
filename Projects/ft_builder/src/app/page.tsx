"use client";

import { Layout, Row, Col, Typography, Space } from "antd";
import { RocketOutlined } from "@ant-design/icons";
import { ModernHeader } from "@/components/ModernHeader";
import { FeatureCard } from "@/components/FeatureCard";
import { useTheme } from "@/components/ThemeProvider";
import { features } from "@/config/features";

const activeFeatures = features.filter((f) => f.status === "active");

const { Content } = Layout;
const { Title, Paragraph } = Typography;

export default function Home() {
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
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          {/* Hero Section */}
          <Space
            direction="vertical"
            size={4}
            style={{ width: "100%", textAlign: "center", marginBottom: 48 }}
          >
            <Title
              level={2}
              style={{
                margin: 0,
                color: isDark ? "#ffffff" : "#1f2937",
              }}
            >
              <RocketOutlined style={{ marginRight: 12 }} />
              FT Builder Platform
            </Title>
            <Paragraph
              style={{
                fontSize: 16,
                color: isDark ? "#9ca3af" : "#6b7280",
                maxWidth: 600,
                margin: "8px auto 0",
              }}
            >
              AI-powered functional test generation, execution, and auto-fixing
              — build comprehensive Cypress test suites from your source code.
            </Paragraph>
          </Space>

          {/* Feature Cards Grid */}
          <Row gutter={[24, 24]} justify="center">
            {activeFeatures.map((feature) => (
              <Col key={feature.key} xs={24} sm={12} lg={8}>
                <FeatureCard feature={feature} />
              </Col>
            ))}
          </Row>
        </div>
      </Content>
    </Layout>
  );
}
