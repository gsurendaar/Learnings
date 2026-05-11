"use client";

import React, { useState } from "react";
import {
  Layout,
  Space,
  Button,
  Dropdown,
  Avatar,
  Badge,
  Tooltip,
  Select,
  Modal,
  Input,
  Typography,
  App,
} from "antd";
import {
  BellOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  MoonOutlined,
  SunOutlined,
  HomeOutlined,
  CodeOutlined,
  PlayCircleOutlined,
  BuildOutlined,
  RocketOutlined,
  KeyOutlined,
  GithubOutlined,
  ApiOutlined,
} from "@ant-design/icons";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";
import { useUser } from "@/hooks/useUser";
import { useInitialization, DEFAULT_LLM_BASE_URL } from "@/components/InitializationContext";
import { features } from "@/config/features";

const { Text } = Typography;

const { Header } = Layout;

const iconMap: Record<string, React.ReactNode> = {
  CodeOutlined: <CodeOutlined />,
  PlayCircleOutlined: <PlayCircleOutlined />,
  BuildOutlined: <BuildOutlined />,
  RocketOutlined: <RocketOutlined />,
};

interface ModernHeaderProps {
  showNotifications?: boolean;
  showThemeSelector?: boolean;
  showUserProfile?: boolean;
}

export const ModernHeader: React.FC<ModernHeaderProps> = ({
  showNotifications = true,
  showThemeSelector = true,
  showUserProfile = true,
}) => {
  const { currentTheme, setTheme, themes } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { userName, userTitle, isLoading } = useUser();
  const visibleNavFeatures = features.filter((f) => f.status === "active");
  const { credentials, initializeSetup, clearInitialization } = useInitialization();
  const { message } = App.useApp();

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsApiKey, setSettingsApiKey] = useState("");
  const [settingsGithubToken, setSettingsGithubToken] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);

  const openSettings = () => {
    setSettingsApiKey(credentials?.llmApiKey || "");
    setSettingsGithubToken(credentials?.githubToken || "");
    setShowSettings(true);
  };

  const handleSaveSettings = async () => {
    if (!settingsApiKey.trim() || !settingsGithubToken.trim()) {
      message.error("Both fields are required");
      return;
    }
    setSettingsSaving(true);
    try {
      await initializeSetup(settingsApiKey.trim(), settingsGithubToken.trim(), DEFAULT_LLM_BASE_URL);
      message.success("Credentials updated");
      setShowSettings(false);
    } catch (err: any) {
      message.error(err?.message || "Failed to save");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleMenuClick = (key: string) => {
    if (key === "settings") openSettings();
    if (key === "logout") {
      clearInitialization();
      router.push("/");
    }
  };

  const userMenuItems = [
    {
      key: "profile",
      label: (
        <Space>
          <UserOutlined />
          <span>Profile</span>
        </Space>
      ),
    },
    {
      key: "settings",
      label: (
        <Space>
          <SettingOutlined />
          <span>Settings</span>
        </Space>
      ),
    },
    {
      type: "divider" as const,
    },
    {
      key: "logout",
      label: (
        <Space>
          <LogoutOutlined />
          <span>Sign Out</span>
        </Space>
      ),
      danger: true,
    },
  ];

  const isDark = currentTheme === "dark";

  const isFeatureActive = (route: string) => pathname.startsWith(route);

  return (
    <>
    <Header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1000,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        background: isDark ? "#1f2937" : "#ffffff",
        borderBottom: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
        boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
      }}
    >
      {/* Logo and Navigation Section */}
      <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }} onClick={() => router.push("/")}>
          <Image
            src="/pp_new.svg"
            alt="PayPal"
            width={32}
            height={32}
            style={{ flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: isDark ? "#ffffff" : "#1f2937",
            }}
          >
            Code Review
          </span>
        </div>

        {/* Navigation Links */}
        <Space size={4}>
          <Button
            type="text"
            icon={<HomeOutlined />}
            onClick={() => router.push("/")}
            style={{
              color: pathname === "/" ? (isDark ? "#ffffff" : "#1f2937") : (isDark ? "#9ca3af" : "#6b7280"),
              fontWeight: pathname === "/" ? 600 : 500,
              borderBottom: pathname === "/" ? `2px solid ${themes[currentTheme].token.colorPrimary}` : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Home
          </Button>
          {visibleNavFeatures.map((feature) => (
              <Button
                key={feature.key}
                type="text"
                icon={iconMap[feature.icon] || <RocketOutlined />}
                onClick={() => router.push(feature.route)}
                style={{
                  color: isFeatureActive(feature.route) ? (isDark ? "#ffffff" : "#1f2937") : (isDark ? "#9ca3af" : "#6b7280"),
                  fontWeight: isFeatureActive(feature.route) ? 600 : 500,
                  borderBottom: isFeatureActive(feature.route) ? `2px solid ${themes[currentTheme].token.colorPrimary}` : "2px solid transparent",
                  borderRadius: 0,
                }}
              >
                {feature.name}
              </Button>
            ))}
        </Space>
      </div>

      {/* Right Section */}
      <Space size={16}>
        {/* Theme Selector */}
        {showThemeSelector && (
          <Select
            value={currentTheme}
            onChange={setTheme}
            style={{ width: 120 }}
            size="small"
            suffixIcon={isDark ? <MoonOutlined /> : <SunOutlined />}
          >
            {Object.entries(themes).map(([key, theme]) => (
              <Select.Option key={key} value={key}>
                {theme.name}
              </Select.Option>
            ))}
          </Select>
        )}

        {/* Notifications */}
        {showNotifications && (
          <Tooltip title="Notifications">
            <Badge count={3} size="small">
              <Button
                type="text"
                icon={<BellOutlined />}
                style={{
                  color: isDark ? "#9ca3af" : "#6b7280",
                }}
              />
            </Badge>
          </Tooltip>
        )}

        {/* Settings */}
        <Tooltip title="Settings">
          <Button
            type="text"
            icon={<SettingOutlined />}
            style={{
              color: isDark ? "#9ca3af" : "#6b7280",
            }}
          />
        </Tooltip>

        {/* User Profile */}
        {showUserProfile && (
          <Dropdown
            menu={{ items: userMenuItems, onClick: ({ key }) => handleMenuClick(key) }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <Button
              type="text"
              style={{
                height: "auto",
                padding: "4px 8px",
                borderRadius: "8px",
                border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
              }}
            >
              <Space size={8}>
                <Avatar
                  size={24}
                  style={{
                    backgroundColor: themes[currentTheme].token.colorPrimary,
                  }}
                  icon={<UserOutlined />}
                />
                <div
                  style={{
                    textAlign: "left",
                    lineHeight: "14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      color: isDark ? "#ffffff" : "#1f2937",
                    }}
                  >
                    {isLoading ? "Loading..." : userName || "User"}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: isDark ? "#9ca3af" : "#6b7280",
                    }}
                  >
                    {isLoading ? "..." : userTitle || "User"}
                  </div>
                </div>
              </Space>
            </Button>
          </Dropdown>
        )}
      </Space>
    </Header>

      {/* Settings Modal */}
      <Modal
        open={showSettings}
        title={
          <Space>
            <SettingOutlined style={{ color: "#059669" }} />
            <span>Update Credentials</span>
          </Space>
        }
        onCancel={() => setShowSettings(false)}
        footer={[
          <Button key="cancel" onClick={() => setShowSettings(false)}>Cancel</Button>,
          <Button
            key="save"
            type="primary"
            loading={settingsSaving}
            onClick={handleSaveSettings}
            disabled={!settingsApiKey.trim() || !settingsGithubToken.trim()}
            style={{ background: "linear-gradient(135deg, #059669 0%, #10b981 100%)", border: "none" }}
          >
            Save
          </Button>,
        ]}
        width={440}
      >
        <Space direction="vertical" size={16} style={{ width: "100%", marginTop: 8 }}>
          <div>
            <Text strong style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
              <GithubOutlined style={{ marginRight: 6 }} />
              GitHub PAT Token
            </Text>
            <Input.Password
              value={settingsGithubToken}
              onChange={(e) => setSettingsGithubToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
            />
          </div>
          <div>
            <Text strong style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
              <ApiOutlined style={{ marginRight: 6 }} />
              Anthropic API Key
            </Text>
            <Input.Password
              value={settingsApiKey}
              onChange={(e) => setSettingsApiKey(e.target.value)}
              placeholder="sk-ant-xxxxxxxxxxxx"
            />
          </div>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Credentials are stored locally in your browser only.
          </Text>
        </Space>
      </Modal>
    </>
  );
};
