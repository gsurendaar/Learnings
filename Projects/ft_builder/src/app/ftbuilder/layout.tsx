"use client";

import { useState } from "react";
import { Layout, Button, message } from "antd";
import { ModernHeader } from "@/components/ModernHeader";
import { SubHeader } from "@/components/SubHeader";
import { useTheme } from "@/components/ThemeProvider";
import { BuildOutlined, ClearOutlined } from "@ant-design/icons";

const { Content } = Layout;

export default function FTBuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const [clearing, setClearing] = useState(false);

  const handleCleanup = async () => {
    setClearing(true);
    try {
      const res = await fetch("/api/ft-runner/cleanup", { method: "POST" });
      const data = await res.json();
      const memLine = data.details?.find((d: string) => d.startsWith("Memory:"));
      message.success(memLine || data.message);
    } catch {
      message.error("Cleanup failed");
    }
    setClearing(false);
  };

  return (
    <Layout
      style={{
        minHeight: "100vh",
        background: isDark ? "#0c1929" : "#85c1e9",
      }}
    >
      <ModernHeader />
      <SubHeader
        title="FT Builder"
        subtitle="Create, Run, and Review Functional Tests for SparkX Components"
        breadcrumbs={[
          {
            title: "FT Builder",
            icon: <BuildOutlined />,
          },
        ]}
        actions={
          <Button
            icon={<ClearOutlined />}
            loading={clearing}
            onClick={handleCleanup}
            size="small"
            style={{ borderRadius: 6 }}
          >
            Cleanup
          </Button>
        }
      />
      <Content
        style={{
          padding: "24px",
          background: isDark ? "#0c1929" : "#85c1e9",
        }}
      >
        {children}
      </Content>
    </Layout>
  );
}
