"use client";

import React from "react";
import { Card } from "antd";
import { useTheme } from "./ThemeProvider";

interface ModernCardProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  bordered?: boolean;
  hoverable?: boolean;
  loading?: boolean;
  size?: "default" | "small";
  type?: "inner" | undefined;
  cover?: React.ReactNode;
  actions?: React.ReactNode[];
  bodyStyle?: React.CSSProperties;
  headStyle?: React.CSSProperties;
}

export const ModernCard: React.FC<ModernCardProps> = ({
  children,
  title,
  extra,
  className,
  style,
  bordered = true,
  hoverable = false,
  loading = false,
  size = "default",
  type,
  cover,
  actions,
  bodyStyle,
  headStyle,
  ...props
}) => {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const modernStyle: React.CSSProperties = {
    background: isDark ? "#1f2937" : "#ffffff",
    border: bordered ? `1px solid ${isDark ? "#374151" : "#e5e7eb"}` : "none",
    borderRadius: "12px",
    boxShadow: isDark 
      ? "0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.3)"
      : "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    transition: "all 0.2s ease-in-out",
    ...style,
  };

  const modernHeadStyle: React.CSSProperties = {
    background: isDark ? "#374151" : "#f9fafb",
    borderBottom: `1px solid ${isDark ? "#4b5563" : "#e5e7eb"}`,
    borderRadius: "12px 12px 0 0",
    ...headStyle,
  };

  const modernBodyStyle: React.CSSProperties = {
    padding: size === "small" ? "12px" : "20px",
    ...bodyStyle,
  };

  const hoverStyle: React.CSSProperties = hoverable ? {
    cursor: "pointer",
    "&:hover": {
      transform: "translateY(-2px)",
      boxShadow: isDark 
        ? "0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.4)"
        : "0 4px 6px -1px rgb(0 0 0 / 0.15), 0 2px 4px -2px rgb(0 0 0 / 0.15)",
    }
  } : {};

  return (
    <Card
      title={title}
      extra={extra}
      className={className}
      style={{ ...modernStyle, ...hoverStyle }}
      bordered={false}
      loading={loading}
      size={size}
      type={type}
      cover={cover}
      actions={actions}
      bodyStyle={modernBodyStyle}
      headStyle={title ? modernHeadStyle : undefined}
      {...props}
    >
      {children}
    </Card>
  );
};