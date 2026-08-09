"use client";

import { useReportWebVitals } from "next/web-vitals";

type WebVital = Parameters<typeof useReportWebVitals>[0] extends (metric: infer T) => void
  ? T
  : never;

function reportWebVital(metric: WebVital) {
  const body = JSON.stringify({
    path: window.location.pathname,
    metrics: { [metric.name.toLowerCase()]: metric.value },
    ts: Date.now(),
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/v1/rum", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/v1/rum", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    });
  } catch {
    // Telemetry must never affect navigation or rendering.
  }
}

/**
 * Lightweight RUM: reports LCP/INP/CLS when the browser supports PerformanceObserver.
 * Does not send PII; posts only to same-origin `/api/v1/rum` if the endpoint exists.
 */
export function WebVitalsReporter() {
  useReportWebVitals(reportWebVital);
  return null;
}
