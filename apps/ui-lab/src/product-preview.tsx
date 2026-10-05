import { productLocale, type LabLocale } from "./locale";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAuthStore, registerAuthStore } from "@inkway/core/auth";
import { createChatStore, registerChatStore } from "@inkway/core/chat";
import { setApiInstance } from "@inkway/core/api";
import { WSProvider } from "@inkway/core/realtime";
import { I18nProvider } from "@inkway/core/i18n/react";
import { WorkspaceSlugProvider } from "@inkway/core/paths";
import { workspaceKeys } from "@inkway/core/workspace/queries";
import { setCurrentWorkspace } from "@inkway/core/platform";
import { getIssueSurfaceViewStore } from "@inkway/core/issues/stores/surface-view-store";
import { AppSidebar } from "@inkway/views/layout";
import { IssueDetail, IssuesPage } from "@inkway/views/issues/components";
import {
  NavigationProvider,
  type NavigationAdapter,
} from "@inkway/views/navigation";
import { RESOURCES } from "@inkway/views/locales";
import {
  SidebarInset,
  SidebarProvider,
} from "@inkway/ui/components/ui/sidebar";
import { TooltipProvider } from "@inkway/ui/components/ui/tooltip";
import { Toaster, toast } from "sonner";
import {
  createFixtureApi,
  issues,
  memoryStorage,
  user,
  workspace,
} from "./product-fixtures";

let fixtureLocale: LabLocale = "en";
const api = createFixtureApi(() => fixtureLocale);
setApiInstance(api);
const storage = memoryStorage();
const auth = createAuthStore({ api, storage });
auth.setState({ user, isLoading: false, status: "authenticated" });
registerAuthStore(auth);
registerChatStore(createChatStore({ storage }));
setCurrentWorkspace(workspace.slug, workspace.id);
getIssueSurfaceViewStore("workspace:all").setState({ viewMode: "list" });
const resources = { en: RESOURCES.en, "zh-Hans": RESOURCES["zh-Hans"] };

export function ProductPreview({
  scene,
  locale,
}: {
  scene: "list" | "detail";
  locale: LabLocale;
}) {
  const { t } = useTranslation("uiLab");
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          refetchOnWindowFocus: false,
        },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(workspaceKeys.list(), [workspace]);
    return queryClient;
  });
  useEffect(() => {
    fixtureLocale = locale;
    auth.setState({ user: { ...user, language: productLocale(locale) } });
    // Discard in-flight results from the previous language before refetching.
    void client.cancelQueries().then(() => client.invalidateQueries());
  }, [client, locale]);
  const [path, setPath] = useState(
    scene === "detail" ? `/ui-lab/issues/${issues[0]!.id}` : "/ui-lab/issues",
  );
  const navigation = useMemo<NavigationAdapter>(() => {
    const navigate = (next: string) => {
      if (/^\/ui-lab\/issues(?:\/[^/]+)?$/.test(next)) setPath(next);
      else toast.info(t(($) => $.lab.preview.unavailable));
    };
    return {
      pathname: path,
      searchParams: new URLSearchParams(),
      hash: "",
      push: navigate,
      replace: navigate,
      back: () => setPath("/ui-lab/issues"),
      getShareableUrl: (value) => `${location.origin}${value}`,
    };
  }, [path, t]);
  const issueId = path.split("/")[3];
  return (
    <QueryClientProvider client={client}>
      <WSProvider
        wsUrl="ws://127.0.0.1/ui-lab-disabled"
        authStore={auth}
        storage={storage}
      >
        <I18nProvider locale={productLocale(locale)} resources={resources}>
          <WorkspaceSlugProvider slug={workspace.slug}>
            <NavigationProvider value={navigation}>
              <TooltipProvider>
                <SidebarProvider className="h-svh bg-app-shell">
                  <AppSidebar />
                  <SidebarInset className="relative overflow-hidden">
                    {issueId ? (
                      <IssueDetail issueId={issueId} />
                    ) : (
                      <IssuesPage />
                    )}
                  </SidebarInset>
                </SidebarProvider>
                <Toaster />
              </TooltipProvider>
            </NavigationProvider>
          </WorkspaceSlugProvider>
        </I18nProvider>
      </WSProvider>
    </QueryClientProvider>
  );
}
