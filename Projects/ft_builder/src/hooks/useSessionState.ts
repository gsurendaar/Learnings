"use client";

import { useState, useCallback, useRef } from "react";

const STORAGE_PREFIX = "ftbuilder:";

export function useSessionState<T>(key: string, initialValue: T, sessionId?: string): [T, React.Dispatch<React.SetStateAction<T>>] {
  const storageKey = sessionId ? `${STORAGE_PREFIX}${sessionId}:${key}` : `${STORAGE_PREFIX}${key}`;
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;

  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setPersistedValue: React.Dispatch<React.SetStateAction<T>> = useCallback((action) => {
    setValue((prev) => {
      const next = typeof action === "function" ? (action as (prev: T) => T)(prev) : action;
      try {
        localStorage.setItem(storageKeyRef.current, JSON.stringify(next));
      } catch { /* quota exceeded */ }
      return next;
    });
  }, []);

  return [value, setPersistedValue];
}
