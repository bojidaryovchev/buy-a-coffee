"use client";

import { createContext, useContext, useMemo } from "react";
import { track, type AnalyticsEvent } from "@/lib/analytics";

/**
 * Client-side analytics context.
 *
 * A thin wrapper so components call `useAnalytics().track(...)` rather than
 * importing a module-level singleton, which keeps them testable.
 */
const AnalyticsContext = createContext<{ track: (event: AnalyticsEvent) => void }>({
  track: () => {},
});

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => ({ track }), []);
  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics() {
  return useContext(AnalyticsContext);
}
