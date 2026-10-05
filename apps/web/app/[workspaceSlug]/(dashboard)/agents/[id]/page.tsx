"use client";

import { use } from "react";
import { AgentDetailPage } from "@inkway/views/agents/agent-detail-page";

export default function AgentDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <AgentDetailPage agentId={id} />;
}
