"use client";

import { useEffect, useState } from "react";
import { useUser } from "./UserContext";
import { useSearchParams } from "next/navigation";

interface UserCheckWrapperProps {
  children: React.ReactNode;
}

const AUTH_SERVICE_URL = "https://sparkle-dashboard.dev52-test-apps-sparkle.dev52.cbf.dev.paypalinc.com:4443/api/redirectWithUserInfo";

export const UserCheckWrapper: React.FC<UserCheckWrapperProps> = ({ children }) => {
  const { userInfo, isLoadingUser } = useUser();
  const searchParams = useSearchParams();
  const [hasChecked, setHasChecked] = useState(false);

  // Check if we have userInfo in the URL (returning from SAML)
  const userInfoParam = searchParams.get("userInfo");

  useEffect(() => {
    // Only run once when user loading is complete
    if (!isLoadingUser && !hasChecked) {
      setHasChecked(true);

      // Don't redirect if:
      // 1. User info already exists in localStorage
      // 2. User info is in URL (returning from SAML)
      if (!userInfo && !userInfoParam) {
        const currentUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3210";
        const baseUrl = currentUrl.endsWith("/") ? currentUrl : `${currentUrl}/`;
        const redirectUrl = `${AUTH_SERVICE_URL}?to=${encodeURIComponent(baseUrl)}`;
        window.location.href = redirectUrl;
      }
    }
  }, [userInfo, isLoadingUser, hasChecked, userInfoParam]);

  // Show nothing while checking, then show content if user found
  if (isLoadingUser) {
    return null;
  }

  return <>{children}</>;
};
