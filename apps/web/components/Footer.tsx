"use client";

import { useTranslations } from "next-intl";
import { ZiPoLogo } from "@/components/ZiPoLogo";

export function Footer() {
  const t = useTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-zipo-border-subtle bg-zipo-surface">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:justify-between">
          <div className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-left">
            <div className="flex items-center gap-2.5">
              <ZiPoLogo variant="monogram" />
              <ZiPoLogo variant="wordmark" />
            </div>
            <p className="text-sm text-zipo-muted">
              {t("rights", { year })}
            </p>
          </div>
          <nav
            className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-zipo-muted"
            aria-label={t("legalNav")}
          >
            <a
              href="#"
              className="min-h-[44px] inline-flex items-center transition-colors duration-200 hover:text-zipo-text"
            >
              {t("about")}
            </a>
            <a
              href="#"
              className="min-h-[44px] inline-flex items-center transition-colors duration-200 hover:text-zipo-text"
            >
              {t("terms")}
            </a>
            <a
              href="#"
              className="min-h-[44px] inline-flex items-center transition-colors duration-200 hover:text-zipo-text"
            >
              {t("privacy")}
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
