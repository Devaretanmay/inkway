"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@inkway/core/api";
import { useCreateWorkspace, useWorkspaceList } from "@inkway/core/workspace";
import { completeOnboarding } from "@inkway/core/onboarding";
import { useAuthStore } from "@inkway/core/auth";
import type {
  Agent,
  AgentRuntime,
  CreateAgentRequest,
  Issue,
  Project,
  Workspace,
} from "@inkway/core/types";
import { Button } from "@inkway/ui/components/ui/button";
import { Input } from "@inkway/ui/components/ui/input";
import { useT } from "./../i18n";
import { pickDirectory, validateLocalDirectory } from "../platform/local-directory";
import { nameToWorkspaceSlug } from "../workspace/slug";

type Step = "runtime" | "provider" | "agent" | "repository" | "issue";
type Provider = "groq" | "openai" | "anthropic";
type CredentialResult = { ok: boolean; message: string };
type DesktopBridge = {
  daemonAPI?: {
    getStatus?: () => Promise<{ state: string; deviceName?: string; agents?: string[] }>;
    start?: () => Promise<{ success: boolean; error?: string }>;
    providerCredential?: (request: {
      action: "status" | "set" | "delete" | "validate";
      runtimeId: string;
      provider: Provider;
      model?: string;
      value?: string;
    }) => Promise<CredentialResult>;
  };
};

const PROVIDERS: { id: Provider; label: string; model: string }[] = [
  { id: "groq", label: "Groq", model: "openai/gpt-oss-120b" },
  { id: "openai", label: "OpenAI", model: "gpt-4.1-mini" },
  { id: "anthropic", label: "Anthropic", model: "claude-3-5-haiku-latest" },
];
const cliLabel = (provider: string) => {
  const p = provider.toLowerCase();
  if (p.includes("claude")) return "Claude Code";
  if (p.includes("codex")) return "Codex";
  if (p.includes("opencode")) return "OpenCode";
  return provider || "Local tool";
};

export function InkwayFirstRun({
  onComplete,
  onRuntimeRefresh,
}: {
  onComplete: (workspace: Workspace, destination: { kind: "issue"; issueId: string }) => void;
  onRuntimeRefresh?: () => void | Promise<void>;
}) {
  const { t } = useT("onboarding");
  const user = useAuthStore((s) => s.user);
  const { workspaces, ready: workspacesReady, refetch: refetchWorkspaces } = useWorkspaceList();
  const createWorkspace = useCreateWorkspace();
  const [step, setStep] = useState<Step>("runtime");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [runtimes, setRuntimes] = useState<AgentRuntime[]>([]);
  const [runtimeId, setRuntimeId] = useState("");
  const [machine, setMachine] = useState("");
  const [runtimeState, setRuntimeState] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<Provider>("groq");
  const [model, setModel] = useState(PROVIDERS[0]!.model);
  const [credential, setCredential] = useState("");
  const [providerSaved, setProviderSaved] = useState(false);
  const [providerConnected, setProviderConnected] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [agentKind, setAgentKind] = useState<"cli" | "native">("cli");
  const [agentName, setAgentName] = useState("My coding agent");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("My repository");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [issueTitle, setIssueTitle] = useState("");
  const [issueDescription, setIssueDescription] = useState("");

  useEffect(() => {
    if (!workspace && workspaces.length) setWorkspace(workspaces[0]!);
  }, [workspace, workspaces]);

  const desktop = useCallback(() =>
    typeof window === "undefined" ? undefined : (window as unknown as DesktopBridge), []);

  const refreshRuntime = useCallback(async (start = false) => {
    setError("");
    setRuntimeState("checking");
    const bridge = desktop()?.daemonAPI;
    if (start && bridge?.start) {
      const started = await bridge.start();
      if (!started.success) setError(started.error || t(($) => $.inkway_first_run.tool_failed));
    } else if (start && onRuntimeRefresh) {
      await onRuntimeRefresh();
    }
    try {
      const status = await bridge?.getStatus?.();
      if (status) {
      setMachine(status.deviceName || "This computer");
        setRuntimeState(status.state === "running" ? "ready" : "offline");
      } else {
      setMachine("This computer");
        setRuntimeState("offline");
      }
    } catch {
      setRuntimeState("offline");
    }
    if (workspace) {
      try {
        const available = await api.listRuntimes({ workspace_id: workspace.id }, workspace.slug);
        setRuntimes(available);
        setRuntimeId((current) => available.some((r) => r.id === current && r.status === "online")
          ? current
          : (available.find((r) => r.status === "online")?.id ?? ""));
      } catch {
        setRuntimes([]);
      }
    }
  }, [desktop, onRuntimeRefresh, t, workspace]);

  useEffect(() => { void refreshRuntime(); }, [refreshRuntime]);

  const selectedRuntime = useMemo(
    () => runtimes.find((runtime) => runtime.id === runtimeId && runtime.status === "online") ?? null,
    [runtimes, runtimeId],
  );

  useEffect(() => {
    if (step !== "provider" || !selectedRuntime) return;
    void desktop()?.daemonAPI?.providerCredential?.({
      action: "status", runtimeId: selectedRuntime.id, provider,
    }).then((result) => {
      setProviderSaved(result.ok);
      setProviderConnected(false);
    }).catch(() => {
      setProviderSaved(false);
      setProviderConnected(false);
    });
  }, [desktop, provider, selectedRuntime, step]);

  useEffect(() => {
    if (step !== "repository" || !workspace) return;
    void api.listProjects(undefined, workspace.slug)
      .then((result) => {
        setProjects(result.projects);
        setProjectId((current) => current || result.projects[0]?.id || "");
      })
      .catch(() => setProjects([]));
  }, [step, workspace]);

  async function createOrSelectWorkspace() {
    if (workspace) return workspace;
    const name = workspaceName.trim() || `${user?.name?.trim() || "My"} Workspace`;
    const slug = nameToWorkspaceSlug(name);
    if (!slug) {
      setWorkspaceError(t(($) => $.inkway_first_run.choose_workspace_slug));
      return null;
    }
    setBusy(true);
    setWorkspaceError("");
    try {
      const created = await createWorkspace.mutateAsync({ name, slug });
      setWorkspace(created);
      await refetchWorkspaces();
      return created;
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : t(($) => $.inkway_first_run.workspace_failed));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveProvider() {
    if (!selectedRuntime || !credential.trim()) return;
    setBusy(true);
    setProviderMessage("");
    try {
      const result = await desktop()?.daemonAPI?.providerCredential?.({
        action: "set", runtimeId: selectedRuntime.id, provider, model, value: credential,
      });
      setCredential("");
      if (result?.ok) {
        setProviderSaved(true);
        setProviderConnected(false);
        setProviderMessage(t(($) => $.inkway_first_run.provider_saved, { provider: PROVIDERS.find((item) => item.id === provider)?.label }));
      } else {
        setProviderSaved(false);
        setProviderConnected(false);
        setProviderMessage(t(($) => $.inkway_first_run.desktop_required));
      }
    } catch {
      setCredential("");
      setProviderMessage(t(($) => $.inkway_first_run.credential_failed));
    } finally {
      setBusy(false);
    }
  }

  async function checkProvider() {
    if (!selectedRuntime) return;
    setBusy(true);
    setProviderMessage("");
    try {
      const result = await desktop()?.daemonAPI?.providerCredential?.({
        action: "validate", runtimeId: selectedRuntime.id, provider, model,
      });
      setProviderConnected(!!result?.ok);
      setProviderMessage(result?.ok ? t(($) => $.inkway_first_run.connection_verified) : t(($) => $.inkway_first_run.provider_check_failed));
    } catch {
      setProviderMessage(t(($) => $.inkway_first_run.provider_validate_failed));
    } finally {
      setBusy(false);
    }
  }

  async function createFirstAgent() {
    if (!workspace || !selectedRuntime || !agentName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const request: CreateAgentRequest = {
        name: agentName.trim(),
        description: agentKind === "cli" ? "CLI coding agent" : "Native API coding agent",
        runtime_id: selectedRuntime.id,
        ...(agentKind === "native" ? {
          model,
          runtime_config: { execution_type: "native", provider, model },
        } : {}),
      };
      const created = await api.createAgent(request, workspace.slug);
      setAgent(created);
      setStep("repository");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(($) => $.inkway_first_run.agent_failed));
    } finally {
      setBusy(false);
    }
  }

  async function registerRepository() {
    if (!workspace) return;
    setBusy(true);
    setError("");
    try {
      if (repositoryPath.trim()) {
        const validation = await validateLocalDirectory(repositoryPath.trim());
        if (!validation.ok && validation.reason !== "unsupported") {
          throw new Error(validation.error || t(($) => $.inkway_first_run.repository_unreadable));
        }
        if (!selectedRuntime?.daemon_id) {
          throw new Error(t(($) => $.inkway_first_run.repository_runtime_unavailable));
        }
        const created = await api.createProject({
          title: projectName.trim() || repositoryPath.trim().split(/[\\/]/).filter(Boolean).at(-1) || "Repository",
          status: "in_progress",
          resources: [{
            resource_type: "local_directory",
            resource_ref: {
              local_path: repositoryPath.trim(),
              daemon_id: selectedRuntime.daemon_id,
              label: projectName.trim() || undefined,
              execution_mode: "in_place",
            },
          }],
        }, workspace.slug);
        setProjects((current) => [created, ...current]);
        setProjectId(created.id);
      } else if (projectId) {
        // Existing project is already registered through the workspace's repository mechanism.
      }
      setStep("issue");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(($) => $.inkway_first_run.repository_failed));
    } finally {
      setBusy(false);
    }
  }

  async function createFirstIssue() {
    if (!workspace || !issueTitle.trim()) return;
    setBusy(true);
    setError("");
    try {
      const issue: Issue = await api.createIssue({
        title: issueTitle.trim(),
        description: issueDescription.trim() || undefined,
        project_id: projectId || undefined,
        ...(agent ? { assignee_type: "agent", assignee_id: agent.id } : {}),
      }, workspace.slug);
      await completeOnboarding("full", workspace.id);
      onComplete(workspace, { kind: "issue", issueId: issue.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(($) => $.inkway_first_run.issue_failed));
    } finally {
      setBusy(false);
    }
  }

  const index = step === "runtime" || step === "provider" ? 0 : step === "agent" ? 1 : 2;
  const labels = [
    t(($) => $.inkway_first_run.step_connect),
    t(($) => $.inkway_first_run.create_agent_step),
    t(($) => $.inkway_first_run.first_issue),
  ];

  return (
    <div className="flex h-full min-h-[620px] flex-col bg-background">
      <header className="border-b border-border px-6 py-5 sm:px-10">
        <p className="text-sm font-medium text-muted-foreground">{t(($) => $.inkway_first_run.step_count, { current: index + 1, total: 3 })}</p>
        <h1 className="mt-1 font-serif text-display font-semibold tracking-tight">
          {step === "runtime" ? t(($) => $.inkway_first_run.welcome) : labels[index]}
        </h1>
        <nav aria-label={t(($) => $.inkway_first_run.steps_label)} className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-3">
          {labels.map((label, i) => <span key={label} aria-current={i === index ? "step" : undefined} className={`flex items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-body font-medium ${i === index ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}><span aria-hidden="true" className={`flex size-6 shrink-0 items-center justify-center rounded-full text-caption ${i === index ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{i + 1}</span>{label}</span>)}
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-6 py-7 sm:px-10">
        {step === "runtime" && <>
          <div className="rounded-xl border border-border p-4" aria-live="polite">
            <h2 className="font-medium">{runtimeState === "ready" ? t(($) => $.inkway_first_run.tool_ready) : runtimeState === "checking" ? t(($) => $.inkway_first_run.checking_tools) : t(($) => $.inkway_first_run.no_tool)}</h2>
            {runtimeState === "ready" && <p className="mt-1 text-sm text-muted-foreground">{t(($) => $.inkway_first_run.machine, { machine })}</p>}
            {runtimes.length > 0 && <ul className="mt-3 space-y-1 text-sm">{runtimes.map((runtime) => <li key={runtime.id}>{cliLabel(runtime.provider)} <span className="text-muted-foreground">{runtime.status === "online" ? t(($) => $.inkway_first_run.tool_ready) : t(($) => $.inkway_first_run.no_tool)}</span></li>)}</ul>}
            {runtimeState === "offline" && <Button className="mt-3" variant="outline" onClick={() => void refreshRuntime(true)}>{t(($) => $.inkway_first_run.check_again)}</Button>}
            {runtimeState === "offline" && <p className="mt-3 text-sm text-muted-foreground">{t(($) => $.inkway_first_run.install_tools_hint)}</p>}
          </div>
          {!workspace && workspacesReady && workspaces.length === 0 && <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="inkway-workspace">{t(($) => $.inkway_first_run.workspace_name)}</label>
            <Input id="inkway-workspace" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder={t(($) => $.inkway_first_run.workspace_placeholder, { name: user?.name || "My" })} />
            <Button type="button" variant="outline" disabled={busy} onClick={() => void createOrSelectWorkspace()}>{t(($) => $.inkway_first_run.create_workspace)}</Button>
            {workspaceError && <p role="alert" className="text-sm text-destructive">{workspaceError}</p>}
          </div>}
          <p className="text-sm text-muted-foreground">{t(($) => $.inkway_first_run.connect_a_tool)}</p>
        </>}

        {step === "provider" && <>
          <p className="text-sm text-muted-foreground">{t(($) => $.inkway_first_run.optional_provider)}</p>
          <label className="text-sm font-medium" htmlFor="inkway-provider">{t(($) => $.inkway_first_run.provider)}</label>
          <select id="inkway-provider" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={provider} onChange={(event) => {
            const next = event.target.value as Provider;
            setProvider(next);
            setModel(PROVIDERS.find((item) => item.id === next)?.model || "");
            setProviderSaved(false);
            setProviderConnected(false);
          }}>{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          <label className="text-sm font-medium" htmlFor="inkway-model">{t(($) => $.inkway_first_run.model)}</label>
          <Input id="inkway-model" value={model} onChange={(event) => setModel(event.target.value)} />
          <label className="text-sm font-medium" htmlFor="inkway-provider-key">{t(($) => $.inkway_first_run.api_key)}</label>
          <Input id="inkway-provider-key" type="password" autoComplete="new-password" value={credential} onChange={(event) => setCredential(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || !credential.trim() || !selectedRuntime} onClick={() => void saveProvider()}>{t(($) => $.inkway_first_run.connect_button)}</Button>
            <Button type="button" variant="outline" disabled={busy || !selectedRuntime || !providerSaved} onClick={() => void checkProvider()}>{t(($) => $.inkway_first_run.test_connection)}</Button>
          </div>
          {providerMessage && <p role="status" className="text-sm text-muted-foreground">{providerMessage}</p>}
          <p className="text-xs text-muted-foreground">{t(($) => $.inkway_first_run.credentials_local)}</p>
        </>}

        {step === "agent" && <>
          <p className="text-sm text-muted-foreground">{t(($) => $.inkway_first_run.choose_agent_tool)}</p>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="agent-kind" checked={agentKind === "cli"} onChange={() => setAgentKind("cli")} />{t(($) => $.inkway_first_run.local_cli_agent)}</label>
            <label className={`flex items-center gap-2 ${providerConnected ? "" : "text-muted-foreground"}`}><input type="radio" name="agent-kind" checked={agentKind === "native"} disabled={!providerConnected} onChange={() => setAgentKind("native")} />{t(($) => $.inkway_first_run.native_api_agent)} {!providerConnected && <span>({t(($) => $.inkway_first_run.connect_provider_first)})</span>}</label>
          </fieldset>
          <label className="text-sm font-medium" htmlFor="inkway-agent-name">{t(($) => $.inkway_first_run.agent_name)}</label>
          <Input id="inkway-agent-name" value={agentName} onChange={(event) => setAgentName(event.target.value)} />
          <label className="text-sm font-medium" htmlFor="inkway-runtime">{t(($) => $.inkway_first_run.tool)}</label>
          <select id="inkway-runtime" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>{runtimes.filter((runtime) => runtime.status === "online").map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.custom_name || runtime.name} · {cliLabel(runtime.provider)}</option>)}</select>
          {agentKind === "native" && <p className="text-sm text-muted-foreground">{t(($) => $.inkway_first_run.provider_and_model, { provider: PROVIDERS.find((item) => item.id === provider)?.label, model })}</p>}
          <Button type="button" disabled={busy || !selectedRuntime || !agentName.trim()} onClick={() => void createFirstAgent()}>{t(($) => $.inkway_first_run.create_agent)}</Button>
        </>}

        {step === "repository" && <>
          <p className="text-sm text-muted-foreground">{t(($) => $.inkway_first_run.choose_repository)}</p>
          {projects.length > 0 && <label className="grid gap-2 text-sm">{t(($) => $.inkway_first_run.existing_repository)}<select className="h-10 rounded-md border border-input bg-background px-3" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">{t(($) => $.inkway_first_run.choose_later)}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>}
          <label className="grid gap-2 text-sm">{t(($) => $.inkway_first_run.repository_name)}<Input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
          <label className="grid gap-2 text-sm">{t(($) => $.inkway_first_run.repository_folder)}<Input value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} placeholder={t(($) => $.inkway_first_run.repository_folder_placeholder)} /></label>
          <Button type="button" variant="outline" disabled={busy} onClick={async () => {
            const picked = await pickDirectory(repositoryPath || undefined);
            if (picked.ok && picked.path) setRepositoryPath(picked.path);
          }}>{t(($) => $.inkway_first_run.choose_folder)}</Button>
        </>}

        {step === "issue" && <>
          <p className="text-sm text-muted-foreground">{t(($) => $.inkway_first_run.issue_intro)}</p>
          <label className="grid gap-2 text-sm">{t(($) => $.inkway_first_run.issue_title)}<Input value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} autoFocus /></label>
          <label className="grid gap-2 text-sm">{t(($) => $.inkway_first_run.description)}<textarea className="min-h-28 rounded-md border border-input bg-background p-3" value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} /></label>
          {projectId && <p className="text-sm text-muted-foreground">{t(($) => $.inkway_first_run.repository, { name: projects.find((project) => project.id === projectId)?.title || projectName })}</p>}
          {agent && <p className="text-sm text-muted-foreground">{t(($) => $.inkway_first_run.assigned_to, { name: agent.name })}</p>}
          <Button type="button" disabled={busy || !issueTitle.trim()} onClick={() => void createFirstIssue()}>{t(($) => $.inkway_first_run.create_and_run)}</Button>
        </>}

        {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <footer className="mt-auto flex justify-between border-t border-border pt-4">
          <Button type="button" variant="ghost" disabled={busy || index === 0} onClick={() => setStep((["runtime", "provider", "agent", "repository", "issue"] as Step[])[index - 1]!)}>{t(($) => $.inkway_first_run.back)}</Button>
          {step !== "issue" && <Button type="button" disabled={busy || step === "agent" || (step === "runtime" && (!workspace || !selectedRuntime))} onClick={() => {
            if (step === "runtime") setStep("provider");
            else if (step === "provider") setStep("agent");
            else if (step === "agent" && agent) setStep("repository");
            else if (step === "repository") void registerRepository();
          }}>{step === "provider" ? t(($) => $.inkway_first_run.skip_for_now) : step === "agent" && !agent ? t(($) => $.inkway_first_run.create_agent_above) : t(($) => $.inkway_first_run.continue)}</Button>}
        </footer>
      </main>
    </div>
  );
}
