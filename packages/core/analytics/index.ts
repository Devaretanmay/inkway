/**
 * Inkway is local-first and does not collect product analytics or crash
 * telemetry. These inert exports keep call sites source-compatible while
 * upstream UI code is pruned; no browser storage, network, or identifiers are
 * touched here.
 */
export const EVENT_SCHEMA_VERSION = 0;

export interface AnalyticsConfig {
  key?: string;
  host?: string;
  appVersion?: string;
  environment?: string;
}

export type ClientType = "desktop" | "web";

export function detectClientType(): ClientType {
  if (typeof window === "undefined") return "web";
  const runtime = window as unknown as { electron?: unknown; desktopAPI?: unknown };
  return runtime.electron || runtime.desktopAPI ? "desktop" : "web";
}

export function initAnalytics(_config?: AnalyticsConfig | null): boolean {
  return false;
}

export function identify(_userId: string, _userProperties?: Record<string, unknown>): void {}
export function resetAnalytics(): void {}

export interface CaptureEventOptions {
  sendInstantly?: boolean;
  onCaptured?: () => void;
}

export function captureEvent(
  _name: string,
  _props?: Record<string, unknown>,
  options?: CaptureEventOptions,
): void {
  options?.onCaptured?.();
}

export function captureException(
  _error: unknown,
  _props?: Record<string, unknown>,
  options?: CaptureEventOptions,
): void {
  options?.onCaptured?.();
}

export function setPersonProperties(_props: Record<string, unknown>): void {}
export function captureSignupSource(): void {}
