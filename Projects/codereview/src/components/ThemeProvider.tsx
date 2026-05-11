"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { App, ConfigProvider, theme as antTheme } from "antd";
import CredentialGate from "@/components/CredentialGate";

// Theme configurations
const themes = {
  corporate: {
    name: "Corporate",
    token: {
      colorPrimary: "#2563eb",
      colorInfo: "#2563eb", 
      colorSuccess: "#16a34a",
      colorWarning: "#ea580c",
      colorError: "#dc2626",
      borderRadius: 8,
      wireframe: false,
    },
    algorithm: antTheme.defaultAlgorithm,
  },
  
  modern: {
    name: "Modern",
    token: {
      colorPrimary: "#7c3aed",
      colorInfo: "#7c3aed",
      colorSuccess: "#059669", 
      colorWarning: "#d97706",
      colorError: "#e11d48",
      borderRadius: 12,
      wireframe: false,
    },
    algorithm: antTheme.defaultAlgorithm,
  },

  ocean: {
    name: "Ocean",
    token: {
      colorPrimary: "#0891b2",
      colorInfo: "#0891b2",
      colorSuccess: "#0d9488",
      colorWarning: "#f59e0b", 
      colorError: "#ef4444",
      borderRadius: 10,
      wireframe: false,
    },
    algorithm: antTheme.defaultAlgorithm,
  },

  dark: {
    name: "Dark",
    token: {
      colorPrimary: "#3b82f6",
      colorInfo: "#3b82f6",
      colorSuccess: "#10b981",
      colorWarning: "#f59e0b",
      colorError: "#ef4444",
      borderRadius: 8,
      wireframe: false,
    },
    algorithm: antTheme.darkAlgorithm,
  }
};

type ThemeType = keyof typeof themes;

interface ThemeContextType {
  currentTheme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  themes: typeof themes;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState<ThemeType>("corporate");

  useEffect(() => {
    const savedTheme = localStorage.getItem("app-theme") as ThemeType;
    if (savedTheme && themes[savedTheme]) {
      setCurrentTheme(savedTheme);
    }
  }, []);

  const setTheme = (theme: ThemeType) => {
    setCurrentTheme(theme);
    localStorage.setItem("app-theme", theme);
  };

  const currentThemeConfig = themes[currentTheme];

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, themes }}>
      <ConfigProvider
        theme={{
          token: currentThemeConfig.token,
          algorithm: currentThemeConfig.algorithm,
          components: {
            Layout: {
              headerBg: currentTheme === "dark" ? "#1f2937" : "#ffffff",
              headerColor: currentTheme === "dark" ? "#ffffff" : "#1f2937",
              headerHeight: 64,
              headerPadding: "0 24px",
            },
            Button: {
              borderRadius: currentThemeConfig.token.borderRadius,
            },
            Card: {
              borderRadius: currentThemeConfig.token.borderRadius,
            },
            Input: {
              borderRadius: currentThemeConfig.token.borderRadius,
            },
          },
        }}
      >
        <App message={{ getContainer: () => document.body, maxCount: 3 }}>
          <CredentialGate>
            {children}
          </CredentialGate>
        </App>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
};