"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  AGENT_DESCRIPTION_MAX_LENGTH,
  applyDraftModelChange,
  applyDraftRuntimeChange,
  type AgentDraft,
  type AgentPermissionScope,
} from "@inkway/core/agents";
import { useConfigStore } from "@inkway/core/config";
import type { MemberWithUser, RuntimeDevice } from "@inkway/core/types";
import { Checkbox } from "@inkway/ui/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@inkway/ui/components/ui/collapsible";
import { Input } from "@inkway/ui/components/ui/input";
import { Textarea } from "@inkway/ui/components/ui/textarea";
import { cn } from "@inkway/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import { AvatarUploadControl } from "../../common/avatar-upload-control";
import { useT } from "../../i18n";
import {
  SettingsCard,
  SettingsSection,
} from "../../settings/components/settings-layout";
import { CharCounter } from "../components/char-counter";
import { ServiceTierSettingField } from "../components/inspector/service-tier-setting-field";
import { ThinkingSettingField } from "../components/inspector/thinking-prop-row";
import { ModelDropdown } from "../components/model-dropdown";
import { RuntimePicker } from "../components/runtime-picker";
import { SkillMultiSelect } from "../components/skill-multi-select";
import { ConversationStartersEditor } from "../components/conversation-starters-editor";

const PERMISSION_SCOPES: AgentPermissionScope[] = [
  "private",
  "workspace",
  "members",
];

export function AgentConfigurationPanel({
  draft,
  onChange,
  runtimes,
  runtimesLoading,
  members,
  currentUserId,
  nameError,
  onNameChange,
  compact = false,
  onRuntimeSelect,
  runtimeSwitchPending = false,
  runtimeSwitchInFlight = false,
}: {
  draft: AgentDraft;
  onChange: (draft: AgentDraft) => void;
  runtimes: RuntimeDevice[];
  runtimesLoading: boolean;
  members: MemberWithUser[];
  currentUserId: string | null;
  nameError: string | null;
  onNameChange: (name: string) => void;
  compact?: boolean;
  /** Builder sessions rebind the server-side carrier instead of only editing
   *  the draft. Absent for the plain create flows, where the draft is the only
   *  state that exists. */
  onRuntimeSelect?: (runtimeId: string) => void;
  /** A builder reply is in flight, so the server would refuse the rebind. */
  runtimeSwitchPending?: boolean;
  /** A rebind request is in flight. */
  runtimeSwitchInFlight?: boolean;
}) {
  const { t } = useT("agents");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const conversationStartersSupported = useConfigStore(
    (state) => state.agentConversationStartersSupported,
  );
  const selectedRuntime =
    runtimes.find((runtime) => runtime.id === draft.runtimeId) ?? null;
  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const otherMembers = members.filter(
    (member) => member.user_id !== currentUserId,
  );
  const runtimeLocked = runtimeSwitchPending || runtimeSwitchInFlight;
  const handleRuntimeSelect = (id: string) => {
    if (id === draft.runtimeId) return;
    if (onRuntimeSelect) {
      onRuntimeSelect(id);
      return;
    }
    // Model is per-runtime; clear it — and the per-model thinking / speed
    // overrides — on runtime change so the new runtime resolves its own
    // defaults instead of stale values.
    onChange(applyDraftRuntimeChange(draft, id));
  };

  return (
    <div className={cn("space-y-8", compact && "space-y-6")}>
      <SettingsSection
        title={t(($) => $.creation_studio.sections.identity)}
      >
        <SettingsCard>
          <DraftFieldRow
            compact={compact}
            label={t(($) => $.create_dialog.avatar.change_aria)}
          >
            <div className={cn(!compact && "sm:flex sm:justify-end")}>
              <AvatarUploadControl
                variant="agent"
                value={draft.avatarUrl}
                name={draft.name}
                size={compact ? 52 : 56}
                onUploaded={(url) => set("avatarUrl", url)}
                onEmojiSelected={(value) => set("avatarUrl", value)}
                onClear={() => set("avatarUrl", null)}
              />
            </div>
          </DraftFieldRow>
          <AgentNameField
            compact={compact}
            name={draft.name}
            error={nameError}
            onChange={onNameChange}
          />
          <DraftFieldRow
            compact={compact}
            align="start"
            label={t(($) => $.create_dialog.description_label)}
            htmlFor="agent-create-description"
          >
            <div>
              <Textarea
                id="agent-create-description"
                name="agent-description"
                autoComplete="off"
                aria-label={t(($) => $.create_dialog.description_label)}
                value={draft.description}
                onChange={(event) => set("description", event.target.value)}
                placeholder={t(($) => $.create_dialog.description_placeholder)}
                rows={compact ? 3 : 4}
                // The create API rejects >255 characters with a 400. Cap the
                // input and show the counter so the limit is visible before
                // submitting, matching the settings page.
                maxLength={AGENT_DESCRIPTION_MAX_LENGTH}
                className="resize-y"
              />
              <CharCounter
                length={[...draft.description].length}
                max={AGENT_DESCRIPTION_MAX_LENGTH}
              />
            </div>
          </DraftFieldRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t(($) => $.creation_studio.sections.provider_tool)}
        description={t(($) => $.creation_studio.sections.provider_tool_hint)}
      >
        <SettingsCard>
          <div className="space-y-4 px-4 py-4">
            <fieldset className="flex flex-wrap gap-4 text-label">
              <legend className="mb-2 font-medium">{t(($) => $.creation_studio.provider_tool.execution_legend)}</legend>
              <label className="flex items-center gap-2"><input type="radio" name="agent-execution-type" value="cli" checked={draft.executionType !== "native"} onChange={() => onChange({ ...draft, executionType: "cli", model: "", thinkingLevel: "", serviceTier: "" })} /> {t(($) => $.creation_studio.provider_tool.local_tool)}</label>
              <label className="flex items-center gap-2"><input type="radio" name="agent-execution-type" value="native" checked={draft.executionType === "native"} onChange={() => onChange({ ...draft, executionType: "native", model: "", thinkingLevel: "", serviceTier: "" })} /> {t(($) => $.creation_studio.provider_tool.api_provider)}</label>
            </fieldset>
            {draft.executionType === "native" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-label">{t(($) => $.creation_studio.provider_tool.provider)}
                  <select aria-label={t(($) => $.creation_studio.provider_tool.native_provider_aria)} className="h-9 rounded-md border border-input bg-background px-3" value={draft.nativeProvider ?? "openai"} onChange={(event) => onChange({ ...draft, nativeProvider: event.target.value as AgentDraft["nativeProvider"], model: "" })}>
                    <option value="openai">{t(($) => $.creation_studio.provider_tool.openai)}</option><option value="anthropic">{t(($) => $.creation_studio.provider_tool.anthropic)}</option><option value="groq">{t(($) => $.creation_studio.provider_tool.groq)}</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-label">{t(($) => $.creation_studio.provider_tool.model)}
                  <Input aria-label={t(($) => $.creation_studio.provider_tool.native_model_aria)} value={draft.model} onChange={(event) => set("model", event.target.value)} placeholder={t(($) => $.creation_studio.provider_tool.model_id)} />
                </label>
                <p className="text-caption text-muted-foreground sm:col-span-2">{t(($) => $.creation_studio.provider_tool.credentials_local)}</p>
              </div>
            )}
            <div className={cn("grid gap-4", !compact && "sm:grid-cols-2")}>
            <div className="min-w-0">
              <RuntimePicker
                runtimes={runtimes}
                runtimesLoading={runtimesLoading}
                members={members}
                currentUserId={currentUserId}
                selectedRuntimeId={draft.runtimeId}
                onSelect={handleRuntimeSelect}
                disabled={runtimeLocked}
              />
              {/* A silently greyed-out picker is the worst version of this: the
                  user reaches for it exactly when the current runtime has gone
                  wrong, so say what unblocks it instead of just refusing. */}
              {runtimeSwitchPending && (
                <p className="mt-1.5 text-caption text-muted-foreground">
                  {t(($) => $.creation_studio.builder.switch_runtime_pending)}
                </p>
              )}
            </div>
            {draft.executionType === "native" ? null : <ModelDropdown
              runtimeId={selectedRuntime?.id ?? null}
              runtimeOnline={selectedRuntime?.status === "online"}
              value={draft.model}
              onChange={(value) => onChange(applyDraftModelChange(draft, value))}
              disabled={!selectedRuntime || runtimeSwitchInFlight}
            />}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t(($) => $.creation_studio.sections.behavior)}
      >
        <SettingsCard>
          <DraftFieldRow
            compact
            label={t(($) => $.create_dialog.instructions.label)}
            htmlFor="agent-create-instructions"
          >
            <Textarea
              id="agent-create-instructions"
              name="agent-instructions"
              autoComplete="off"
              aria-label={t(($) => $.create_dialog.instructions.label)}
              value={draft.instructions}
              onChange={(event) => set("instructions", event.target.value)}
              placeholder={t(
                ($) => $.create_dialog.instructions.editor_placeholder,
              )}
              rows={compact ? 9 : 12}
              className="min-h-44 resize-y font-mono text-label leading-6"
            />
          </DraftFieldRow>
        </SettingsCard>
      </SettingsSection>

      {/* Everything below is real, working configuration — none of it is
          removed. It sits behind one disclosure because defining an agent in
          Ink means name, purpose, runtime, model and instructions; the
          rest is tuning and reach, reached deliberately. */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger
          className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-body text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t(($) => $.advanced.label)}
        >
          {advancedOpen ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
          <span className="font-medium">{t(($) => $.advanced.label)}</span>
          <span className="min-w-0 truncate text-caption text-muted-foreground">
            {t(($) => $.advanced.hint)}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className={cn("mt-4 space-y-8", compact && "space-y-6")}>
            <SettingsSection
              title={t(($) => $.creation_studio.sections.behavior)}
            >
              <SettingsCard>
                {conversationStartersSupported ? (
                  <div className="px-4 py-4">
                    <ConversationStartersEditor
                      value={draft.conversationStarters}
                      onChange={(value) => set("conversationStarters", value)}
                    />
                  </div>
                ) : null}
                <div className="px-4 py-4">
                  <SkillMultiSelect
                    selectedIds={draft.skillIds}
                    onChange={(ids) => set("skillIds", ids)}
                  />
                </div>
              </SettingsCard>
            </SettingsSection>

            <SettingsSection
              title={t(($) => $.creation_studio.sections.execution)}
              description={t(($) => $.creation_studio.sections.execution_hint)}
            >
              <SettingsCard>
                {/* Both fields fail closed: they render only when the exact selected
                    model's live catalog advertises the capability (or a value is
                    already set and needs clearing), so an offline runtime, a failed
                    discovery or an empty model shows nothing instead of an input
                    that cannot be honoured. */}
                <AgentExecutionOverrides
                  draft={draft}
                  runtime={selectedRuntime}
                  disabled={runtimeLocked}
                  onChange={onChange}
                />
              </SettingsCard>
            </SettingsSection>

            <SettingsSection
              title={t(($) => $.creation_studio.sections.access)}
            >
              <SettingsCard>
                <div
                  className="space-y-1 p-2"
                  role="radiogroup"
                  aria-label={t(($) => $.creation_studio.sections.access)}
                >
                  {PERMISSION_SCOPES.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      role="radio"
                      aria-checked={draft.permissionScope === scope}
                      onClick={() => set("permissionScope", scope)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        draft.permissionScope === scope && "bg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                          draft.permissionScope === scope && "border-primary",
                        )}
                        aria-hidden="true"
                      >
                        {draft.permissionScope === scope ? (
                          <span className="size-1.5 rounded-full bg-primary" />
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-body font-medium">
                          {t(($) => $.creation_studio.access[scope].title)}
                        </span>
                        <span className="mt-0.5 block text-caption leading-5 text-muted-foreground">
                          {t(($) => $.creation_studio.access[scope].description)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {draft.permissionScope === "members" ? (
                  <div className="max-h-48 overflow-y-auto p-2">
                    {otherMembers.map((member) => {
                      const checked = draft.memberIds.has(member.user_id);
                      return (
                        <label
                          key={member.user_id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => {
                              const next = new Set(draft.memberIds);
                              if (value === true) next.add(member.user_id);
                              else next.delete(member.user_id);
                              set("memberIds", next);
                            }}
                          />
                          <ActorAvatar
                            actorType="member"
                            actorId={member.user_id}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1 truncate text-body">
                            {member.name}
                          </span>
                        </label>
                      );
                    })}
                    {draft.memberIds.size === 0 ? (
                      <p className="px-2 py-1 text-caption text-destructive">
                        {t(($) => $.creation_studio.access.members.required)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </SettingsCard>
            </SettingsSection>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function AgentNameField({
  name,
  error,
  onChange,
  compact = false,
}: {
  name: string;
  error: string | null;
  onChange: (name: string) => void;
  compact?: boolean;
}) {
  const { t } = useT("agents");
  const errorId = "agent-create-name-error";
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!error) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [error]);

  return (
    <DraftFieldRow
      compact={compact}
      label={t(($) => $.create_dialog.name_label)}
      htmlFor="agent-create-name"
    >
      <div className="space-y-1.5">
        <Input
          ref={inputRef}
          id="agent-create-name"
          name="agent-name"
          autoComplete="off"
          aria-label={t(($) => $.create_dialog.name_label)}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          value={name}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t(($) => $.create_dialog.name_placeholder)}
        />
        {error ? (
          <p id={errorId} className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </DraftFieldRow>
  );
}

/**
 * Per-model execution overrides (thinking level + Codex speed) for the create
 * flow. Capability comes from the exact selected model's live catalog on the
 * selected runtime, so nothing renders while that cannot be resolved — an
 * offline runtime, failed discovery, or an empty "use the runtime default"
 * model. That is the same fail-closed rule the settings page follows, and it is
 * why no value can be sent that the daemon would refuse to honour.
 */
export function AgentExecutionOverrides({
  draft,
  runtime,
  disabled = false,
  onChange,
}: {
  draft: AgentDraft;
  runtime: RuntimeDevice | null;
  disabled?: boolean;
  onChange: (draft: AgentDraft) => void;
}) {
  const { t } = useT("agents");
  const runtimeOnline = runtime?.status === "online";
  return (
    <>
      <ThinkingSettingField
        label={t(($) => $.creation_studio.thinking_label)}
        runtimeId={runtime?.id ?? null}
        runtimeOnline={runtimeOnline}
        provider={runtime?.provider ?? ""}
        model={draft.model}
        value={draft.thinkingLevel}
        canEdit={!disabled}
        onChange={(thinkingLevel) => onChange({ ...draft, thinkingLevel })}
      />
      <ServiceTierSettingField
        label={t(($) => $.creation_studio.speed_label)}
        runtimeId={runtime?.id ?? null}
        runtimeOnline={runtimeOnline}
        provider={runtime?.provider ?? ""}
        model={draft.model}
        value={draft.serviceTier}
        canEdit={!disabled}
        onChange={(serviceTier) => onChange({ ...draft, serviceTier })}
      />
    </>
  );
}

function DraftFieldRow({
  label,
  children,
  compact = false,
  align = "center",
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
  align?: "center" | "start";
  htmlFor?: string;
}) {
  return (
    <div
      className={cn(
        "gap-3 px-4 py-4",
        compact
          ? "flex flex-col"
          : "grid sm:grid-cols-[minmax(0,1fr)_minmax(280px,1.2fr)] sm:gap-8",
        !compact && (align === "center" ? "sm:items-center" : "sm:items-start"),
      )}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-body font-medium">
          {label}
        </label>
      ) : (
        <div className="text-body font-medium">{label}</div>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
