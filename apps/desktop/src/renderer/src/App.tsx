import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CoreProvider } from "@inkway/core/platform";
import { pickLocale, type SupportedLocale } from "@inkway/core/i18n";
import { useAuthStore } from "@inkway/core/auth";
import { useWelcomeStore } from "@inkway/core/onboarding";
import { workspaceKeys } from "@inkway/core/workspace/queries";
import { useWorkspaceList } from "@inkway/core/workspace";
import { api } from "@inkway/core/api";
import { useHasOnboarded } from "@inkway/core/paths";
import { setCurrentWorkspace } from "@inkway/core/platform";
import { ThemeProvider } from "@inkway/ui/components/common/theme-provider";
import { InkwayIcon } from "@inkway/ui/components/common/inkway-icon";
import { Toaster } from "@inkway/ui/components/ui/sonner";
import { DesktopAuthRecoveryPage } from "./pages/auth-recovery";
import { DesktopShell } from "./components/desktop-layout";
import { UpdateNotification } from "./components/update-notification";
import { IssueWindow } from "./components/issue-window";
import { useTabStore } from "./stores/tab-store";
import { useWindowOverlayStore } from "./stores/window-overlay-store";
import { useOpenSettingsShortcut } from "./hooks/use-open-settings-shortcut";
import { useTabSelectionShortcut } from "./hooks/use-tab-selection-shortcut";
import { useDaemonIPCBridge } from "./platform/daemon-ipc-bridge";
import { syncDaemonForLocalApp } from "./platform/daemon-local-sync";
import { createDesktopLocaleAdapter } from "./platform/i18n-adapter";
import { RESOURCES } from "@inkway/views/locales";
import { DiagnosticRouteReporter } from "./platform/diagnostic-route-reporter";
import {
  tearDownOnLogout,
  tearDownOnSessionExpiry,
  type SessionTeardown,
} from "./platform/session-teardown";

// BCP-47 region tags for the <html lang> attribute, mirroring
// apps/web/app/layout.tsx HTML_LANG. index.html ships a static lang="en";
// we sync it to the resolved locale at boot so screen readers announce the
// right language AND the Japanese-scoped CJK font override in globals.css
// (`html[lang|="ja"]`) can take effect.
const HTML_LANG: Record<SupportedLocale, string> = {
  en: "en",
  "zh-Hans": "zh-CN",
  ko: "ko-KR",
  ja: "ja-JP",
  fr: "fr-FR",
};


/**
 * Cmd/Ctrl+W: close the active tab. When the last real tab is closed
 * (or no tabs/workspace exist — for example during startup recovery), close the window.
 *
 * Mounted at the App root so every renderer state — including loading,
 * onboarding, and runtime-config errors — has a working Cmd+W
 * handler. Without this, states outside the tab shell would swallow the
 * shortcut and do nothing.
 */
function useCmdWCloseTab() {
  useEffect(() => {
    return window.desktopAPI.onCloseActiveTab(() => {
      if (window.desktopAPI.windowContext?.kind === "issue") {
        window.desktopAPI.closeWindow();
        return;
      }
      const store = useTabStore.getState();
      const { activeWorkspaceSlug, byWorkspace } = store;
      if (!activeWorkspaceSlug) {
        // No workspace — nothing to close, dismiss the window.
        window.desktopAPI.closeWindow();
        return;
      }
      const group = byWorkspace[activeWorkspaceSlug];
      if (!group || group.tabs.length <= 1) {
        // Last tab (or no tabs) — close the window.
        window.desktopAPI.closeWindow();
        return;
      }
      // Multiple tabs — close the active one.
      store.closeActiveTab();
    });
  }, []);
}

function IssueWindowContent() {
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);
  const authStatus = useAuthStore((state) => state.status);
  const context = window.desktopAPI.windowContext ?? { kind: "main" as const };

  if (context.kind !== "issue") return null;
  if (authStatus === "recovering") return <DesktopAuthRecoveryPage />;
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <InkwayIcon className="size-6 animate-pulse" />
      </div>
    );
  }

  return user ? <IssueWindow context={context} /> : <LocalServiceRecoveryPage />;
}

function AppContent() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const authStatus = useAuthStore((s) => s.status);
  const qc = useQueryClient();

  const runtimeConfig = window.desktopAPI.runtimeConfig.ok
    ? window.desktopAPI.runtimeConfig.config
    : null;

  // Tell the main process which backend URL we talk to, so daemon-manager
  // can pick the matching CLI profile (server_url from ~/.inkway config).
  useEffect(() => {
    if (!runtimeConfig) return;
    window.daemonAPI.setTargetApiUrl(runtimeConfig.apiUrl);
  }, [runtimeConfig]);

  // Start the bundled CLI daemon with the local backend capability. This is
  // installation startup, not account login; the token comes from Electron's
  // runtime configuration and is never read from browser storage.
  useEffect(() => {
    if (!runtimeConfig || !runtimeConfig.localAppToken) return;
    const { apiUrl, localAppToken } = runtimeConfig;
    (async () => {
      try {
        await syncDaemonForLocalApp(
          window.daemonAPI,
          apiUrl,
          localAppToken,
        );
      } catch (err) {
        console.error("Failed to sync the local daemon identity", err);
      }
    })();
  }, [runtimeConfig]);

  // When the local owner starts with zero workspaces and creates their
  // first one, restart the daemon so it picks up the new workspace
  // immediately (otherwise workspaceSyncLoop's next 30s tick would be the
  // earliest pickup point). Specifically scoped to "started empty" because
  // daemon sync already restarts when the local owner token changes.
  const {
    workspaces,
    ready: workspaceListReady,
    unavailable: workspaceListUnavailable,
    isFetching: workspaceListRetrying,
    refetch: retryWorkspaceList,
  } = useWorkspaceList({
    enabled: !!user,
  });
  const wsCount = workspaces.length;
  const hasOnboarded = useHasOnboarded();

  // Bridge local daemon IPC status into the runtimes cache so this user's
  // own daemon flips to offline/online sub-second instead of waiting on the
  // server's 75s sweeper. Resolves wsId from the active tab so workspace
  // switches automatically rebind the subscription.
  const activeWorkspaceSlug = useTabStore((s) => s.activeWorkspaceSlug);
  const activeWsId = activeWorkspaceSlug
    ? workspaces.find((w) => w.slug === activeWorkspaceSlug)?.id
    : undefined;
  useDaemonIPCBridge(activeWsId);

  // Pre-workspace overlay routing for desktop. Mirrors the web layout
  // hard gate via overlays (desktop has no URL bar, so we open the
  // onboarding overlay instead of router.replace):
  //   onboarded + has workspace      → no overlay, dashboard
  //   un-onboarded (any wsCount):
  //     pending invites on email     → /invitations overlay
  //     no invites                   → /onboarding overlay
  //   onboarded + no workspace       → /workspaces/new overlay
  //
  // V3 invariant: `onboarded_at != null` is the only path into the
  // dashboard. CreateWorkspace does not mark onboarded; only Step 3's
  // CompleteOnboarding (and AcceptInvitation) flip the flag. A user who
  // somehow has a workspace but no onboarded mark must be sent back to
  // /onboarding — we also clear the active workspace so the dashboard
  // doesn't render under the overlay with stale workspace context.
  useEffect(() => {
    if (!user || !workspaceListReady) return undefined;
    const { overlay, open } = useWindowOverlayStore.getState();
    if (overlay) return undefined;
    if (hasOnboarded && wsCount > 0) return undefined;
    if (!hasOnboarded) {
      // Stale workspace context (if any) would leak X-Workspace-Slug
      // headers into onboarding-time API calls. Clear it before opening
      // the overlay.
      setCurrentWorkspace(null, null);
      // Look up pending invitations by email. Network blip is non-fatal —
      // fall through to onboarding so the user isn't stuck on a blank
      // window. The sidebar's pending-invitations dropdown will surface
      // missed invites later once they're onboarded.
      let cancelled = false;
      void api
        .listMyInvitations()
        .then((invites) => {
          if (cancelled) return;
          const { overlay: latestOverlay, open: latestOpen } =
            useWindowOverlayStore.getState();
          if (latestOverlay) return;
          if (invites.length > 0) {
            qc.setQueryData(workspaceKeys.myInvitations(), invites);
            latestOpen({ type: "invitations" });
          } else {
            latestOpen({ type: "onboarding" });
          }
        })
        .catch(() => {
          if (cancelled) return;
          const { overlay: latestOverlay, open: latestOpen } =
            useWindowOverlayStore.getState();
          if (latestOverlay) return;
          latestOpen({ type: "onboarding" });
        });
      return () => {
        cancelled = true;
      };
    }
    open({ type: "new-workspace" });
    return undefined;
  }, [user, workspaceListReady, wsCount, workspaces, hasOnboarded, qc]);


  // Validate persisted tab state against the current user's workspace list,
  // and pick an active workspace if none is set. Runs in useLayoutEffect
  // (synchronously after render, before paint) rather than the render
  // phase — the original render-phase pattern triggered React's
  // "Cannot update a component while rendering a different component"
  // warning because `switchWorkspace` is a Zustand setState that the
  // TabBar is subscribed to. useLayoutEffect flushes both renders before
  // the user sees anything, so there's no visible flicker.
  //
  // Gate on authoritative data: pending and initial errors expose no data,
  // while a failed background refetch retains the last successful list.
  useLayoutEffect(() => {
    if (!workspaceListReady) return;
    const validSlugs = new Set(workspaces.map((w) => w.slug));
    useTabStore.getState().validateWorkspaceSlugs(validSlugs);
    const { activeWorkspaceSlug, switchWorkspace } = useTabStore.getState();
    if (!activeWorkspaceSlug && workspaces.length > 0) {
      switchWorkspace(workspaces[0].slug);
    }
  }, [workspaces, workspaceListReady]);

  // null = undecided (identity or workspace list hasn't settled yet)
  // true  = local startup had zero workspaces; first workspace triggers restart
  // false = workspace exists, or restart has already happened
  const sessionStartedEmptyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!user) {
      sessionStartedEmptyRef.current = null;
      return;
    }
    if (!workspaceListReady) return;
    if (sessionStartedEmptyRef.current === null) {
      sessionStartedEmptyRef.current = wsCount === 0;
      return;
    }
    if (sessionStartedEmptyRef.current && wsCount >= 1) {
      void window.daemonAPI.restart();
      sessionStartedEmptyRef.current = false;
    }
  }, [user, workspaceListReady, wsCount]);

  if (authStatus === "recovering") {
    return <DesktopAuthRecoveryPage />;
  }
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <InkwayIcon className="size-6 animate-pulse" />
      </div>
    );
  }

  if (workspaceListUnavailable) {
    return (
      <DesktopAuthRecoveryPage
        isRetrying={workspaceListRetrying}
        onRetry={() => {
          void retryWorkspaceList();
        }}
      />
    );
  }

  return user ? <DesktopShell /> : <LocalServiceRecoveryPage />;
}

function LocalServiceRecoveryPage() {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-xl rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-title font-semibold">Inkway could not open its local workspace</h1>
        <p className="mt-3 text-body text-muted-foreground">
          Restart Inkway to reconnect to its private local database and server.
        </p>
      </div>
    </div>
  );
}

function BlockingRuntimeConfigError({ message }: { message: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-xl rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-title font-semibold">Desktop configuration error</h1>
        <p className="mt-3 text-body text-muted-foreground">
          Inkway could not load its desktop configuration. Check the existing app data folder and restart the app.
        </p>
        <pre className="mt-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-caption text-muted-foreground">
          {message}
        </pre>
      </div>
    </div>
  );
}

// Binds local identity teardown steps to this renderer's stores and IPC.
const sessionTeardown: SessionTeardown = {
  resetTabs: () => useTabStore.getState().reset(),
  closeOverlay: () => useWindowOverlayStore.getState().close(),
  resetWelcome: () => useWelcomeStore.getState().reset(),
  clearDaemonToken: () => window.daemonAPI.clearToken(),
  stopDaemon: () => window.daemonAPI.stop(),
};

function handleDaemonLogout() {
  return tearDownOnLogout(sessionTeardown);
}

function handleSessionExpired() {
  tearDownOnSessionExpiry(sessionTeardown);
}

export default function App() {
  const { version, os } = window.desktopAPI.appInfo;
  const systemLocale = window.desktopAPI.systemLocale;
  const runtimeConfigResult = window.desktopAPI.runtimeConfig;
  // The fallback keeps renderer HMR safe while a main/preload rebuild is
  // restarting Electron; packaged builds always expose windowContext.
  const windowContext =
    window.desktopAPI.windowContext ?? { kind: "main" as const };
  useCmdWCloseTab();
  // Mounted at the App root for the same reason as Cmd+W: the chord has to
  // work in every renderer state, not only inside the tab shell.
  useOpenSettingsShortcut();
  // Fixed browser-style tab selection is also owned by main so it remains
  // available while focus sits inside editors, inputs, menus, or dialogs.
  useTabSelectionShortcut();

  // Stable identity reference so downstream effects (WS reconnect) don't
  // tear down on every parent render.
  const identity = useMemo(
    () => ({ platform: "desktop", version, os }),
    [version, os],
  );
  // Locale resolution happens once at app boot. Switching language goes
  // through window.location.reload() to avoid hydration mismatch.
  const localeAdapter = useMemo(
    () => createDesktopLocaleAdapter(systemLocale),
    [systemLocale],
  );
  const locale = useMemo(() => pickLocale(localeAdapter), [localeAdapter]);
  const resources = useMemo(
    () => ({ [locale]: RESOURCES[locale] }),
    [locale],
  );

  // Keep <html lang> in sync with the resolved locale (index.html hardcodes
  // "en"). Drives the lang-scoped Japanese CJK font override and a11y.
  // useLayoutEffect (not useEffect) so lang is committed before the first
  // paint — otherwise Japanese users would see one frame of Kanji rendered
  // with the Chinese-first fallback stack before the override kicks in.
  useLayoutEffect(() => {
    document.documentElement.lang = HTML_LANG[locale];
  }, [locale]);

  // React to OS-level language changes detected by main on focus regain.
  // Only act when the user is following the system signal (no explicit
  // Settings choice) — otherwise their preference wins. Cross-device sync
  // for the explicit-choice case is handled inside CoreProvider.
  useEffect(() => {
    return window.desktopAPI.onSystemLocaleChanged((nextSystemLocale) => {
      if (localeAdapter.getUserChoice()) return;
      const next = pickLocale({
        ...localeAdapter,
        getSystemPreferences: () =>
          nextSystemLocale ? [nextSystemLocale] : [],
      });
      if (next === locale) return;
      localeAdapter.persist(next);
      window.location.reload();
    });
  }, [localeAdapter, locale]);

  return (
    <ThemeProvider>
      {runtimeConfigResult.ok ? (
        <CoreProvider
          apiBaseUrl={runtimeConfigResult.config.apiUrl}
          wsUrl={runtimeConfigResult.config.wsUrl}
          onLogout={
            windowContext.kind === "main" ? handleDaemonLogout : undefined
          }
          onSessionExpired={
            windowContext.kind === "main" ? handleSessionExpired : undefined
          }
          identity={identity}
          localAppToken={runtimeConfigResult.config.localAppToken}
          locale={locale}
          resources={resources}
          localeAdapter={localeAdapter}
        >
          {windowContext.kind === "main" && <DiagnosticRouteReporter />}
          {windowContext.kind === "issue" ? (
            <IssueWindowContent />
          ) : (
            <AppContent />
          )}
        </CoreProvider>
      ) : (
        <BlockingRuntimeConfigError message={runtimeConfigResult.error.message} />
      )}
      <Toaster />
      {windowContext.kind === "main" && <UpdateNotification />}
    </ThemeProvider>
  );
}
