"use client";

import React, { useMemo } from "react";
import { Image, Typography, Space, Empty, Tag } from "antd";
import { CameraOutlined } from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";

const { Text } = Typography;

interface ScreenshotGalleryProps {
  screenshots: string[];
  runId: string;
}

/**
 * Groups screenshots by spec file and displays them in a gallery with preview.
 * Screenshots follow Cypress naming: `{specfile}/{testname} (failed).png`
 */
export default function ScreenshotGallery({ screenshots, runId }: ScreenshotGalleryProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const grouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const s of screenshots) {
      // Parse spec name from path: screenshots/specfile/testname.png or just filename
      const parts = s.replace(/\\/g, "/").split("/");
      // Try to extract a meaningful group name
      let groupKey = "Screenshots";
      if (parts.length >= 2) {
        // e.g., "cypress/reports/screenshots/spec.cy.ts/test name (failed).png"
        const specIdx = parts.findIndex((p) => p.endsWith(".cy.ts") || p.endsWith(".cy.js"));
        if (specIdx >= 0) {
          groupKey = parts[specIdx];
        } else {
          groupKey = parts[parts.length - 2];
        }
      }
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(s);
    }
    return groups;
  }, [screenshots]);

  if (!screenshots.length) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <Space style={{ marginBottom: 12 }}>
        <CameraOutlined style={{ color: isDark ? "#60a5fa" : "#2563eb" }} />
        <Text strong style={{ color: isDark ? "#e5e7eb" : "#374151" }}>
          Screenshots ({screenshots.length})
        </Text>
      </Space>

      <Image.PreviewGroup>
        {Array.from(grouped.entries()).map(([specName, paths]) => (
          <div key={specName} style={{ marginBottom: 16 }}>
            <Tag color={isDark ? "blue" : "processing"} style={{ marginBottom: 8, fontSize: 11 }}>
              {specName}
            </Tag>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {paths.map((p, i) => {
                const src = `/api/ft-runner/artifacts?runId=${encodeURIComponent(runId)}&filePath=${encodeURIComponent(p)}`;
                const fileName = p.split("/").pop() || p;
                return (
                  <div
                    key={i}
                    style={{
                      border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                      borderRadius: 6,
                      overflow: "hidden",
                      background: isDark ? "#1f2937" : "#f9fafb",
                    }}
                  >
                    <Image
                      src={src}
                      alt={fileName}
                      width={200}
                      height={120}
                      style={{ objectFit: "cover" }}
                      fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWYyOTM3Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZpbGw9IiM2YjcyODAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmb250LXNpemU9IjEyIj5ObyBQcmV2aWV3PC90ZXh0Pjwvc3ZnPg=="
                    />
                    <Text
                      type="secondary"
                      style={{
                        display: "block",
                        fontSize: 10,
                        padding: "2px 4px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 200,
                      }}
                    >
                      {fileName}
                    </Text>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </Image.PreviewGroup>

      {screenshots.length === 0 && (
        <Empty description="No screenshots captured" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
}
