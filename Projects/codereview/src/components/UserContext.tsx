"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

const AUTH_SERVICE_URL = "https://sparkle-dashboard.dev52-test-apps-sparkle.dev52.cbf.dev.paypalinc.com:4443/api/redirectWithUserInfo";
const STORAGE_KEY = "sparkx-user-info";

export interface UserInfo {
  issuer?: string;
  _authStatement?: {
    AuthInstant: string;
    SessionIndex: string;
  };
  nameID?: string;
  nameIDFormat?: string;
  manager?: string;
  name: string;
  description?: string;
  title?: string;
  department?: string;
  userid?: string;
  qid?: string;
  storedAt?: string;
  [key: string]: any;
}

interface UserContextType {
  userInfo: UserInfo | null;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const decodeUserInfo = (encodedUserInfo: string): UserInfo => {
  try {
    const decodedString = Buffer.from(encodedUserInfo, "base64").toString("utf-8");
    return JSON.parse(decodedString) as UserInfo;
  } catch (error) {
    console.error("Failed to decode user info:", error);
    throw new Error("Invalid user information format");
  }
};

export const saveUserInfoToStorage = (userInfo: UserInfo): void => {
  const userWithTimestamp = { ...userInfo, storedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userWithTimestamp));
};

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 1. Check if userInfo is in URL (returning from SAML)
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const userInfoParam = params.get("userInfo");

      if (userInfoParam) {
        try {
          console.log("Found userInfo in URL, decoding...");
          const decodedUserInfo = decodeUserInfo(userInfoParam);

          // Save to localStorage
          const userWithTimestamp = {
            ...decodedUserInfo,
            storedAt: new Date().toISOString(),
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(userWithTimestamp));
          setUserInfo(userWithTimestamp);

          // Clean up URL
          window.history.replaceState({}, document.title, window.location.pathname);
          console.log("User info saved from SAML response");
        } catch (error) {
          console.error("Failed to process userInfo from URL:", error);
        } finally {
          setIsLoading(false);
        }
        return;
      }
    }

    // 2. Check if userInfo exists in localStorage
    try {
      const storedUser = localStorage.getItem(STORAGE_KEY);
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser) as UserInfo;
        setUserInfo(parsedUser);
        console.log("User info loaded from localStorage");
      } else {
        const currentUrl = globalThis.location.origin;
        const baseUrl = currentUrl.endsWith("/") ? currentUrl : `${currentUrl}/`;
        globalThis.location.href = `${AUTH_SERVICE_URL}?to=${encodeURIComponent(baseUrl)}`;
        return;
      }
    } catch (error) {
      console.error("Failed to load user info:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value: UserContextType = {
    userInfo,
    isLoading,
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
};
