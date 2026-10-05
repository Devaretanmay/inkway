import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const inkKeys = {
  fastpaths: (workspaceId: string) => ["workspace", workspaceId, "ink-fastpaths"] as const,
};

export function inkFastPathsOptions(workspaceId: string) {
  return queryOptions({
    queryKey: inkKeys.fastpaths(workspaceId),
    queryFn: () => api.listWorkspaceInkFastPaths(workspaceId),
    enabled: workspaceId.length > 0,
    refetchInterval: 30_000,
  });
}
