"use client";

import React from "react";
import { Card, Tag, Typography } from "antd";
import {
  CodeOutlined,
  PlayCircleOutlined,
  BuildOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useTheme } from "./ThemeProvider";
import type { FeatureConfig } from "@/config/features";

const { Title, Paragraph } = Typography;

const iconMap: Record<string, React.ReactNode> = {
  CodeOutlined: <CodeOutlined />,
  PlayCircleOutlined: <PlayCircleOutlined />,
  BuildOutlined: <BuildOutlined />,
  RocketOutlined: <RocketOutlined />,
};

interface FeatureCardProps {
  feature: FeatureConfig;
}

export const FeatureCard: React.FC<FeatureCardProps> = ({ feature }) => {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const isActive = feature.status === "active";

  return (
    <Card
      hoverable={isActive}
      onClick={() => isActive && router.push(feature.route)}
      style={{
        height: "100%",
        borderRadius: 12,
        border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
        background: isDark ? "#1f2937" : "#ffffff",
        cursor: isActive ? "pointer" : "default",
        opacity: isActive ? 1 : 0.7,
        transition: "all 0.3s ease",
      }}
      styles={{
        body: {
          padding: 24,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: `${feature.color}15`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            color: feature.color,
          }}
        >
          {iconMap[feature.icon] || <RocketOutlined />}
        </div>
        <Tag
          color={isActive ? "success" : "default"}
          style={{ borderRadius: 12, fontSize: 11 }}
        >
          {isActive ? "Active" : "Coming Soon"}
        </Tag>
      </div>

      <Title
        level={4}
        style={{
          margin: "0 0 8px 0",
          color: isDark ? "#ffffff" : "#1f2937",
        }}
      >
        {feature.name}
      </Title>

      <Paragraph
        style={{
          color: isDark ? "#9ca3af" : "#6b7280",
          marginBottom: 0,
          flex: 1,
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        {feature.description}
      </Paragraph>
    </Card>
  );
};
