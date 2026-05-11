"use client";

import { useUser as useUserContext, UserInfo } from "@/components/UserContext";

export interface UseUserReturn {
  userInfo: UserInfo | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  userName: string | null;
  userTitle: string | null;
}

/**
 * Custom hook to access user information
 * Provides convenient access to current user data and authentication state
 */
export const useUser = (): UseUserReturn => {
  const context = useUserContext();

  return {
    userInfo: context.userInfo,
    isLoading: context.isLoading,
    isAuthenticated: !!context.userInfo,
    userName: context.userInfo?.name || null,
    userTitle: context.userInfo?.title || null,
  };
};

export default useUser;
