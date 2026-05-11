"use client";

import { Layout } from "antd";
import { ModernHeader } from "@/components/ModernHeader";
import { SubHeader } from "@/components/SubHeader";
import { useTheme } from "@/components/ThemeProvider";
import { PlayCircleOutlined } from "@ant-design/icons";

const { Content } = Layout;

export default function FTRunnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <SubHeader
        title="FT Runner"
        subtitle="Run Functional Tests remotely and track results"
        breadcrumbs={[
          {
            title: "FT Runner",
            icon: <PlayCircleOutlined />,
          },
        ]}
      />
      <Content
        style={{
          padding: "24px",
          background: isDark ? "#111827" : "#f9fafb",
        }}
      >
        {children}
      </Content>
    </Layout>
  );
}
