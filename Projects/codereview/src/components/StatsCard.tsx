"use client";

import React from "react";
import { Card, Statistic } from "antd";
import { useTheme } from "./ThemeProvider";

interface StatsCardProps {
  title: string;
  value: number | string;
  icon?: React.ReactNode;
  color?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  precision?: number;
  loading?: boolean;
  style?: React.CSSProperties;
}

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  icon,
  color = "#3b82f6",
  trend,
  prefix,
  suffix,
  precision,
  loading = false,
  style,
}) => {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  return (
    <Card
      loading={loading}
      style={{
        background: isDark ? "#1f2937" : "#ffffff",
        border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
        borderRadius: "12px",
        boxShadow: isDark 
          ? "0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.3)"
          : "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        transition: "all 0.2s ease-in-out",
        cursor: "pointer",
        ...style,
      }}
      bordered={false}
      bodyStyle={{ padding: "20px" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = isDark 
          ? "0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.4)"
          : "0 4px 6px -1px rgb(0 0 0 / 0.15), 0 2px 4px -2px rgb(0 0 0 / 0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = isDark 
          ? "0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.3)"
          : "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        {icon && (
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              background: `${color}15`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "20px",
              color: color,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        
        <div style={{ flex: 1, minWidth: 0 }}>
          <Statistic
            title={
              <span
                style={{
                  color: isDark ? "#9ca3af" : "#6b7280",
                  fontSize: "14px",
                  fontWeight: 500,
                  marginBottom: "4px",
                  display: "block",
                }}
              >
                {title}
              </span>
            }
            value={value}
            precision={precision}
            prefix={prefix}
            suffix={suffix}
            valueStyle={{
              color: isDark ? "#ffffff" : "#1f2937",
              fontSize: "24px",
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          />
          
          {trend && (
            <div
              style={{
                marginTop: "4px",
                fontSize: "12px",
                color: trend.isPositive ? "#10b981" : "#ef4444",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span>{trend.isPositive ? "↗" : "↘"}</span>
              <span>{Math.abs(trend.value)}%</span>
              <span style={{ color: isDark ? "#9ca3af" : "#6b7280" }}>
                vs last month
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};