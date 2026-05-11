"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface Credentials {
  llmApiKey: string;
  githubToken: string;
  baseUrl: string;
  modelId?: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
}

export interface StoredCredentials extends Credentials {
  initializedAt: string;
}

interface InitializationContextType {
  isInitialized: boolean;
  credentials: Credentials | null;
  initError: string | null;
  isInitializing: boolean;
  initializeSetup: (
    llmApiKey: string,
    githubToken: string,
    baseUrl: string,
    modelId?: string,
    repo?: { owner: string; name: string; branch?: string }
  ) => Promise<void>;
  clearInitialization: () => void;
  loadFromLocalStorage: () => void;
}

const InitializationContext = createContext<InitializationContextType | undefined>(
  undefined
);

const STORAGE_KEY = "sparkx-credentials";
export const DEFAULT_LLM_BASE_URL = "https://aiplatform.dev51.cbf.dev.paypalinc.com/cosmosai/llm/v1";

// Also migrate legacy FT Runner keys into unified storage
const LEGACY_KEYS = ["ft-runner-github-token", "ft-runner-llm-key"];

export const InitializationProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load credentials from localStorage on mount
  useEffect(() => {
    loadFromLocalStorage();
  }, []);

  const loadFromLocalStorage = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const creds: StoredCredentials = JSON.parse(stored);
        if (creds.llmApiKey && creds.githubToken) {
          setCredentials({
            llmApiKey: creds.llmApiKey,
            githubToken: creds.githubToken,
            baseUrl: creds.baseUrl || DEFAULT_LLM_BASE_URL,
            modelId: creds.modelId,
            repoOwner: creds.repoOwner,
            repoName: creds.repoName,
            repoBranch: creds.repoBranch,
          });
          setIsInitialized(true);
          setInitError(null);
          setIsLoading(false);
          return;
        }
      }

      // Try migrating from legacy FT Runner keys
      const legacyToken = localStorage.getItem("ft-runner-github-token");
      const legacyLlm = localStorage.getItem("ft-runner-llm-key");
      if (legacyToken && legacyLlm) {
        const migrated: StoredCredentials = {
          llmApiKey: legacyLlm,
          githubToken: legacyToken,
          baseUrl: DEFAULT_LLM_BASE_URL,
          initializedAt: new Date().toISOString(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
        setCredentials(migrated);
        setIsInitialized(true);
        setInitError(null);
      }
    } catch (error) {
      console.error("Failed to load credentials from localStorage:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const initializeSetup = async (
    llmApiKey: string,
    githubToken: string,
    baseUrl: string,
    modelId?: string,
    repo?: { owner: string; name: string; branch?: string }
  ) => {
    setIsInitializing(true);
    setInitError(null);

    try {
      if (!llmApiKey.trim()) throw new Error("Anthropic API Key is required");
      if (!githubToken.trim()) throw new Error("GitHub PAT Token is required");

      // Optional: validate credentials via API
      try {
        const response = await fetch("/api/review-sparkx/initialize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ llmApiKey, githubToken, baseUrl }),
        });
        const data = await response.json();
        if (data.success) {
          if (!data.llmValid) console.warn("LLM API key validation failed - saving anyway");
          if (!data.githubValid) console.warn("GitHub token validation failed - saving anyway");
        }
      } catch {
        console.warn("Credential validation API unavailable - saving credentials without validation");
      }

      // Store credentials — preserve existing repo/model if not explicitly provided
      const prev = credentials;
      const storedCreds: StoredCredentials = {
        llmApiKey,
        githubToken,
        baseUrl: baseUrl || DEFAULT_LLM_BASE_URL,
        modelId: modelId ?? prev?.modelId,
        repoOwner: repo?.owner ?? prev?.repoOwner,
        repoName: repo?.name ?? prev?.repoName,
        repoBranch: repo?.branch ?? prev?.repoBranch,
        initializedAt: new Date().toISOString(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedCreds));
      LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));

      setCredentials({
        llmApiKey,
        githubToken,
        baseUrl: storedCreds.baseUrl,
        modelId: storedCreds.modelId,
        repoOwner: storedCreds.repoOwner,
        repoName: storedCreds.repoName,
        repoBranch: storedCreds.repoBranch,
      });
      setIsInitialized(true);
      setInitError(null);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      setInitError(errorMessage);
      throw error;
    } finally {
      setIsInitializing(false);
    }
  };

  const clearInitialization = () => {
    localStorage.removeItem(STORAGE_KEY);
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
    setCredentials(null);
    setIsInitialized(false);
    setInitError(null);
  };

  const value: InitializationContextType = {
    isInitialized,
    credentials,
    initError,
    isInitializing,
    initializeSetup,
    clearInitialization,
    loadFromLocalStorage,
  };

  if (isLoading) {
    return null;
  }

  return (
    <InitializationContext.Provider value={value}>
      {children}
    </InitializationContext.Provider>
  );
};

export const useInitialization = () => {
  const context = useContext(InitializationContext);
  if (!context) {
    throw new Error(
      "useInitialization must be used within an InitializationProvider"
    );
  }
  return context;
};
