"use client";

import React from "react";
import { Breadcrumb, Space, Typography } from "antd";
import { HomeOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useTheme } from "./ThemeProvider";

const { Title, Text } = Typography;

interface BreadcrumbItem {
  title: string;
  path?: string;
  icon?: React.ReactNode;
}

interface SubHeaderProps {
  title?: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
}

export const SubHeader: React.FC<SubHeaderProps> = ({
  title,
  subtitle,
  breadcrumbs = [],
  actions,
}) => {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const defaultBreadcrumbs: BreadcrumbItem[] = [
    {
      title: "Home",
      path: "/dashboard",
      icon: <HomeOutlined />,
    },
    ...breadcrumbs,
  ];

  return (
    <div
      style={{
        background: isDark ? "#111827" : "#f9fafb",
        borderBottom: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
        padding: "16px 24px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "16px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Breadcrumbs */}
          <Breadcrumb
            style={{ marginBottom: title ? "8px" : "0" }}
            items={defaultBreadcrumbs.map((item) => ({
              title: (
                <Space
                  size="small"
                  style={{
                    color: isDark ? "#9ca3af" : "#6b7280",
                    cursor: item.path ? "pointer" : "default",
                  }}
                  onClick={item.path ? () => router.push(item.path!) : undefined}
                >
                  {item.icon && (
                    <span style={{ fontSize: "12px" }}>{item.icon}</span>
                  )}
                  <span style={{ fontSize: "13px" }}>{item.title}</span>
                </Space>
              ),
            }))}
          />

          {/* Title and Subtitle */}
          {title && (
            <div>
              <Title
                level={2}
                style={{
                  margin: "0 0 4px 0",
                  fontSize: "24px",
                  fontWeight: 600,
                  color: isDark ? "#ffffff" : "#1f2937",
                }}
              >
                {title}
              </Title>
              {subtitle && (
                <Text
                  style={{
                    fontSize: "14px",
                    color: isDark ? "#9ca3af" : "#6b7280",
                  }}
                >
                  {subtitle}
                </Text>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {actions && (
          <div style={{ flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};