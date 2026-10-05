"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Trash2, Wifi } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@inkway/core/hooks";
import { runtimeListOptions } from "@inkway/core/runtimes/queries";
import { runtimeDisplayName } from "@inkway/core/runtimes";
import { Button } from "@inkway/ui/components/ui/button";
import { Input } from "@inkway/ui/components/ui/input";

type Provider = "openai" | "anthropic" | "groq";
const models: Record<Provider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-haiku-latest",
  groq: "openai/gpt-oss-120b",
};

export function ProviderSettingsTab({ localDaemonId }: { localDaemonId: string | null }) {
  const workspaceId = useWorkspaceId();
  const [runtimeId, setRuntimeId] = useState("");
  const [provider, setProvider] = useState<Provider>("groq");
  const [model, setModel] = useState(models.groq);
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState<Partial<Record<Provider, boolean>>>({});
  const [editing, setEditing] = useState<Provider | null>(null);
  const { data: runtimes = [] } = useQuery(runtimeListOptions(workspaceId));
  const localRuntimes = useMemo(
    () => runtimes.filter((runtime) => !!localDaemonId && runtime.daemon_id === localDaemonId),
    [localDaemonId, runtimes],
  );

  useEffect(() => {
    let alive = true;
    setConnected({});
    if (runtimeId) for (const name of ["openai", "anthropic", "groq"] as const) {
      void window.daemonAPI.providerCredential({ action: "status", runtimeId, provider: name }).then((result) => {
        if (alive && result.ok && typeof result.present === "boolean") setConnected((current) => ({ ...current, [name]: result.present }));
      }).catch(() => { /* Failed checks remain unknown. */ });
    }
    return () => { alive = false; };
  }, [runtimeId]);
  useEffect(() => {
    if (!localRuntimes.some((runtime) => runtime.id === runtimeId)) {
      setRuntimeId(localRuntimes.find((runtime) => runtime.status === "online")?.id ?? localRuntimes[0]?.id ?? "");
    }
  }, [runtimeId, localRuntimes]);

  async function run(action: "status" | "set" | "delete" | "validate", selected: Provider = provider) {
    setBusy(true);
    setMessage("");
    try {
      const result = await window.daemonAPI.providerCredential({
        action,
        runtimeId,
        provider: selected,
        model: selected === provider ? model : models[selected],
        value: action === "set" ? credential : undefined,
      });
      setMessage(result.message);
      if (action === "set") setCredential("");
      if (action === "status" && result.ok && typeof result.present === "boolean") {
        setConnected((current) => ({ ...current, [selected]: result.present }));
      }
      if (result.ok && (action === "set" || action === "delete")) {
        setConnected((current) => ({ ...current, [selected]: action === "set" }));
        if (action === "set") setEditing(null);
      }
    } catch {
      if (action === "set") setCredential("");
      setMessage("Credential operation could not reach the local runtime.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-3xl space-y-2 p-1">
      <header className="mb-5 space-y-1">
        <h2 className="text-lg font-semibold">API providers</h2>
        <p className="text-sm text-muted-foreground">API keys stay in this computer’s secure credential store and are never sent to the Inkway server.</p>
      </header>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {(["openai", "anthropic", "groq"] as const).map((name) => <article key={name} className="rounded-lg border border-border bg-surface p-4">
          <h3 className="font-medium">{name === "openai" ? "OpenAI" : name === "anthropic" ? "Anthropic" : "Groq"}</h3>
          <p className="mt-1 text-caption text-muted-foreground">{!runtimeId ? "Connect a local tool first" : connected[name] === true ? "Connected" : connected[name] === false ? "Not connected" : "Local status unavailable"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy || !runtimeId} onClick={() => { setProvider(name); setModel(models[name]); setCredential(""); setEditing(name); }}>{connected[name] ? "Replace" : "Connect"}</Button>
            {connected[name] && <><Button size="sm" variant="outline" disabled={busy} onClick={() => void run("validate", name)}>Test</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void run("delete", name)}>Disconnect</Button></>}
          </div>
        </article>)}
      </div>
      <div className="divide-y rounded-lg border border-border">
        <label className="grid gap-2 p-4 text-sm sm:grid-cols-[12rem_1fr] sm:items-center">
          <span>Connected tool</span>
          <select aria-label="Connected tool" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>
            <option value="" disabled>No connected tools</option>
            {localRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtimeDisplayName(runtime)}</option>)}
          </select>
        </label>
        {editing && <><label className="grid gap-2 p-4 text-sm sm:grid-cols-[12rem_1fr] sm:items-center">
          <span>Provider</span>
          <select aria-label="Provider" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={provider} onChange={(event) => { const next = event.target.value as Provider; setProvider(next); setModel(models[next]); }}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="groq">Groq</option>
          </select>
        </label>
        <label className="grid gap-2 p-4 text-sm sm:grid-cols-[12rem_1fr] sm:items-center">
          <span>Model</span>
          <Input aria-label="Model" value={model} onChange={(event) => setModel(event.target.value)} autoComplete="off" />
        </label>
        <label className="grid gap-2 p-4 text-sm sm:grid-cols-[12rem_1fr] sm:items-center">
          <span>API key</span>
          <Input aria-label="API key" type="password" value={credential} onChange={(event) => setCredential(event.target.value)} autoComplete="new-password" />
        </label>
        <div className="flex flex-wrap gap-2 p-4">
          <Button type="button" size="sm" disabled={busy || !runtimeId || !credential} onClick={() => void run("set")}><KeyRound className="mr-1.5 size-3.5" />Save connection</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || !runtimeId.trim()} onClick={() => void run("status")}>Check saved status</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || !runtimeId.trim() || !model.trim()} onClick={() => void run("validate")}><Wifi className="mr-1.5 size-3.5" />Test connection</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || !runtimeId.trim()} onClick={() => void run("delete")}><Trash2 className="mr-1.5 size-3.5" />Remove</Button>
        </div>
        </>}
        {message ? <p className="w-full pt-1 text-sm text-muted-foreground" role="status">{message}</p> : null}
      </div>
    </section>
  );
}
