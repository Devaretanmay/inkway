"use client";

import { use } from "react";
import { IssueDetailRoute } from "@inkway/views/issues/components";
import { ErrorBoundary } from "@inkway/ui/components/common/error-boundary";

export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <ErrorBoundary resetKeys={[id]}>
      <IssueDetailRoute routeId={id} />
    </ErrorBoundary>
  );
}
