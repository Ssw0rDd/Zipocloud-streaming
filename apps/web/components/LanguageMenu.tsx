"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { LOCALE_REGISTRY } from "@zipo/shared";
import {
  locales,
  type Locale,
  usePathname,
  useRouter,
} from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LanguageMenu() {
  const t = useTranslations("nav");
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!open) return;
    const selected = optionRefs.current[currentLocale];
    selected?.focus();
    selected?.scrollIntoView({ block: "nearest" });
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, currentLocale]);

  const switchLocale = (locale: Locale) => {
    const query = window.location.search;
    router.replace(`${pathname}${query}`, { locale });
    setOpen(false);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const active = document.activeElement;
    const currentIndex = locales.findIndex(
      (locale) => optionRefs.current[locale] === active,
    );
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = (currentIndex + delta + locales.length) % locales.length;
    optionRefs.current[locales[next]!]?.focus();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-zipo-border-subtle px-3 text-zipo-muted transition-colors hover:border-zipo-border hover:text-zipo-text"
        aria-label={t("selectLanguage")}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Globe className="h-4 w-4" aria-hidden="true" />
        <span className="hidden text-xs font-semibold uppercase lg:inline">
          {currentLocale}
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t("selectLanguage")}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-50 mt-1.5 max-h-80 w-48 overflow-y-auto rounded-lg border border-zipo-border-subtle bg-zipo-elevated p-1 shadow-lg"
        >
          {locales.map((locale) => {
            const selected = locale === currentLocale;
            return (
              <button
                key={locale}
                ref={(node) => {
                  optionRefs.current[locale] = node;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => switchLocale(locale)}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between rounded-md px-3 text-left text-sm text-zipo-text transition-colors hover:bg-zipo-surface hover:text-zipo-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zipo-accent",
                  selected && "bg-zipo-accent/10 text-zipo-accent",
                )}
              >
                <span>{LOCALE_REGISTRY[locale].nativeName}</span>
                {selected && <Check className="h-4 w-4" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
