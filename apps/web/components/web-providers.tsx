"use client";

import type { LocaleResources, SupportedLocale } from "@inkway/core/i18n";
import { I18nProvider } from "@inkway/core/i18n/react";
import { WebNavigationProvider } from "@/platform/navigation";
import { WebScrollRestorationProvider } from "@/platform/scroll-restoration";

export function WebProviders({
  children,
  locale,
  resources,
}: {
  children: React.ReactNode;
  locale: SupportedLocale;
  resources: Record<string, LocaleResources>;
}) {
  return (
    <I18nProvider locale={locale} resources={resources}>
      <WebNavigationProvider>
        <WebScrollRestorationProvider>{children}</WebScrollRestorationProvider>
      </WebNavigationProvider>
    </I18nProvider>
  );
}
