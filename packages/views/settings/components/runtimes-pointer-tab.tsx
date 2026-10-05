"use client";

import { Monitor } from "lucide-react";
import { Button } from "@inkway/ui/components/ui/button";
import { useWorkspacePaths } from "@inkway/core/paths";
import { AppLink } from "../../navigation";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";
import { useT } from "../../i18n";

/**
 * Where runtimes are managed.
 *
 * Runtime setup is a first-class part of configuring Ink — an agent is
 * only assignable once it is bound to a runtime — but the management surface
 * is a full page (device health, versions, CLI versions, pricing, remote
 * connections), not a settings form. Phase 1 took Runtimes out of the primary
 * navigation, so Settings is what keeps it reachable.
 *
 * This is a pointer, not a copy: one row, one link, no duplicated state. The
 * pointer keeps no local settings of its own, so the two pages can never
 * disagree about what is connected.
 */
export function RuntimesPointerTab() {
  const { t } = useT("settings");
  const paths = useWorkspacePaths();
  return (
    <SettingsSection
      title={t(($) => $.page.groups.runtimes)}
      description={t(($) => $.page.runtimes_pointer_hint)}
    >
      <SettingsCard>
        <SettingsRow
          label={t(($) => $.page.tabs.runtimes)}
          description={t(($) => $.page.runtimes_pointer_description)}
          size="none"
        >
          <AppLink href={paths.runtimes()}>
            <Button type="button" variant="outline" size="sm" className="gap-1.5">
              <Monitor className="size-3.5" aria-hidden="true" />
              {t(($) => $.page.runtimes_pointer_action)}
            </Button>
          </AppLink>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}