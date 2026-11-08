"use client";

import { cn } from "@repo/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DirtyContext } from "./store-settings";

type Tab = { id: string; label: string };

/**
 * Tab bar for /admin/settings. Tabs are links (?tab=…), so they work without
 * JavaScript; with it, leaving a tab with unsaved edits asks first.
 */
export function SettingsTabs({
  tabs,
  active,
  children,
}: {
  tabs: Tab[];
  active: string;
  children: ReactNode;
}) {
  const t = useTranslations("settings");
  // Dirty state belongs to one tab, so switching tabs starts clean.
  const [dirtyTab, setDirtyTab] = useState<string | null>(null);
  const dirty = dirtyTab === active;
  const ctx = useMemo(() => ({ setDirty: (d: boolean) => setDirtyTab(d ? active : null) }), [active]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <DirtyContext.Provider value={ctx}>
      <nav
        role="tablist"
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-neutral-200 px-4 dark:border-neutral-800"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            role="tab"
            aria-selected={tab.id === active}
            href={`/admin/settings?tab=${tab.id}`}
            scroll={false}
            onClick={(e) => {
              if (tab.id !== active && dirty && !window.confirm(t("unsavedConfirm"))) e.preventDefault();
            }}
            className={cn(
              "flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap",
              tab.id === active
                ? "border-[var(--brand)] text-[var(--brand)]"
                : "border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div role="tabpanel" className="pt-5">
        {children}
      </div>
    </DirtyContext.Provider>
  );
}
