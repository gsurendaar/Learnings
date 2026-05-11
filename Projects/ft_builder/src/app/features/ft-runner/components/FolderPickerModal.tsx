"use client";

import React, { useState, useRef } from "react";
import { Modal, Button, Space, Typography, Progress, Alert, Tag } from "antd";
import {
  FolderOpenOutlined,
  UploadOutlined,
  CheckCircleOutlined,
  FileOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/components/ThemeProvider";
import { useUser } from "@/components/UserContext";

const { Text } = Typography;

// Directories excluded from upload (large / unnecessary for test execution)
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  "out",
]);

interface FolderPickerModalProps {
  open: boolean;
  onSelect: (folderPath: string) => void;
  onCancel: () => void;
}

export default function FolderPickerModal({ open, onSelect, onCancel }: FolderPickerModalProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const { userInfo } = useUser();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null);
  const [filteredCount, setFilteredCount] = useState(0);
  const [hasCypress, setHasCypress] = useState(false);

  const reset = () => {
    setUploading(false);
    setUploadProgress(0);
    setError(null);
    setSelectedFolderName(null);
    setFilteredCount(0);
    setHasCypress(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const allFiles = Array.from(e.target.files || []);
    if (allFiles.length === 0) return;

    const folderName = (allFiles[0] as any).webkitRelativePath?.split("/")[0] || "project";
    setSelectedFolderName(folderName);
    setError(null);

    // Filter out excluded directories and .DS_Store
    const files = allFiles.filter((file) => {
      const relPath: string = (file as any).webkitRelativePath || file.name;
      const parts = relPath.split("/");
      return (
        !parts.some((p) => EXCLUDED_DIRS.has(p)) &&
        file.name !== ".DS_Store"
      );
    });

    const cypressDetected = files.some((f) =>
      ((f as any).webkitRelativePath as string)?.includes("/cypress/e2e/")
    );
    setHasCypress(cypressDetected);
    setFilteredCount(files.length);

    await uploadFiles(files);
  };

  const uploadFiles = async (files: File[]) => {
    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      const userId = userInfo?.userid || userInfo?.name || "anonymous";
      formData.append("userId", userId);

      files.forEach((file) => {
        formData.append("files", file);
        formData.append("paths", (file as any).webkitRelativePath || file.name);
      });

      const serverPath = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 95));
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText);
              if (data.success) {
                setUploadProgress(100);
                resolve(data.path);
              } else {
                reject(new Error(data.message || "Upload failed"));
              }
            } catch {
              reject(new Error("Invalid server response"));
            }
          } else {
            reject(new Error(`Upload failed (HTTP ${xhr.status})`));
          }
        };

        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.open("POST", "/api/ft-runner/upload-project");
        xhr.send(formData);
      });

      // Brief pause so user sees 100%
      await new Promise((r) => setTimeout(r, 400));
      onSelect(serverPath);
      reset();
    } catch (err: any) {
      setError(err?.message || "Upload failed");
      setUploading(false);
    }
  };

  const cardBg = isDark ? "#1f2937" : "#f9fafb";
  const borderColor = isDark ? "#374151" : "#e5e7eb";

  return (
    <Modal
      open={open}
      title={
        <Space>
          <FolderOpenOutlined style={{ color: "#7c3aed" }} />
          <span>Select Local Project Folder</span>
        </Space>
      }
      onCancel={handleCancel}
      footer={null}
      width={480}
      styles={{ body: { padding: "24px" } }}
      afterClose={reset}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {error && (
          <Alert
            type="error"
            message={error}
            showIcon
            closable
            onClose={() => setError(null)}
          />
        )}

        {/* Initial pick state */}
        {!uploading && !selectedFolderName && (
          <>
            <div
              style={{
                border: `2px dashed ${borderColor}`,
                borderRadius: 8,
                background: cardBg,
                padding: "32px 24px",
                textAlign: "center",
              }}
            >
              <FolderOpenOutlined
                style={{ fontSize: 40, color: "#7c3aed", marginBottom: 12 }}
              />
              <div style={{ marginBottom: 8 }}>
                <Text strong>Browse your computer for a project folder</Text>
              </div>
              <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 16 }}>
                Files will be uploaded to the server for test execution.
                <br />
                <code style={{ fontSize: 11 }}>node_modules</code>,{" "}
                <code style={{ fontSize: 11 }}>.git</code> and build dirs are excluded automatically.
              </Text>
              <Button
                type="primary"
                icon={<UploadOutlined />}
                size="large"
                onClick={() => fileInputRef.current?.click()}
                style={{ background: "#7c3aed", border: "none" }}
              >
                Browse Local Folder
              </Button>
            </div>

            {/* Hidden file input with webkitdirectory */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={handleFileInputChange}
              {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
            />
          </>
        )}

        {/* Upload in progress */}
        {uploading && (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Space>
              <FolderOpenOutlined style={{ color: "#7c3aed" }} />
              <Text strong>{selectedFolderName}</Text>
              {hasCypress && <Tag color="green">cypress/e2e detected</Tag>}
            </Space>
            <Space>
              <FileOutlined style={{ color: "#6b7280" }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Uploading {filteredCount} files to server…
              </Text>
            </Space>
            <Progress
              percent={uploadProgress}
              status="active"
              strokeColor="#7c3aed"
              style={{ marginBottom: 0 }}
            />
          </Space>
        )}

        {/* Upload complete (brief flash before modal closes) */}
        {!uploading && selectedFolderName && (
          <Space>
            <CheckCircleOutlined style={{ color: "#22c55e", fontSize: 18 }} />
            <Text strong style={{ color: "#22c55e" }}>
              Upload complete — loading tests…
            </Text>
          </Space>
        )}
      </Space>
    </Modal>
  );
}
