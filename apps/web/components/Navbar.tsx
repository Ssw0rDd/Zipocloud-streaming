"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, LogOut, ListMusic, Search, UserRound, History } from "lucide-react";
import type { UserTier } from "@zipo/shared";
import { cn } from "@/lib/utils";
import { ZiPoLogo } from "@/components/ZiPoLogo";
import { TierBadge } from "@/components/TierBadge";
import { SearchBar, type SearchBarHandle } from "./SearchBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { LanguageMenu } from "./LanguageMenu";
import { setActiveProfileId } from "@/lib/api-client";

const EASE = [0.25, 0.1, 0.25, 1] as const;

interface NavbarProps {
  userTier?: UserTier;
}

/**
 * Site chrome. NSFW look/theme hide are driven by `body.site-nsfw` CSS only —
 * no client site-mode helpers (avoids stale HMR ReferenceErrors).
 */
export function Navbar({ userTier: serverTier = "guest" }: NavbarProps) {
  const t = useTranslations("nav");
  const tp = useTranslations("playlists");
  const tc = useTranslations("common");
  const { tier: clientTier, isLoggedIn, logout } = useAuth();
  const userTier: UserTier = isLoggedIn ? clientTier : serverTier;
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<SearchBarHandle>(null);
  const mobileSearchButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const searchButton = mobileSearchButtonRef.current;
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      searchButton?.focus();
    };
  }, [searchOpen]);

  const links = [
    { href: "/", label: t("home") },
    { href: "/explore/movie", label: t("movies") },
    { href: "/explore/series", label: t("series") },
    { href: "/explore/anime", label: t("anime") },
  ] as const;

  const navLinkClass = (href: string) =>
    cn(
      "rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-200 min-h-[44px] inline-flex items-center",
      pathname === href || pathname.startsWith(href + "/")
        ? "text-zipo-accent"
        : "text-zipo-muted hover:text-zipo-text",
    );

  return (
    <header className="nsfw-nav fixed top-0 z-50 w-full border-b border-zipo-border-subtle bg-zipo-bg/80 backdrop-blur-xl supports-[backdrop-filter]:bg-zipo-bg/70">
      <nav
        className="zipo-safe-x mx-auto flex h-16 max-w-[1536px] items-center justify-between gap-4 px-4 sm:px-6"
        aria-label={t("mainNav")}
      >
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2"
          aria-label="ZiPo — Início"
        >
          <ZiPoLogo variant="monogram" />
          <ZiPoLogo variant="wordmark" className="hidden sm:inline" />
          <span
            className="nsfw-badge-18 ml-0.5 hidden sm:inline-flex"
            aria-label="Conteúdo adulto"
          >
            18+
          </span>
        </Link>

        <div className="hidden items-center gap-0.5 lg:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={navLinkClass(link.href)}>
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden w-[min(30vw,28rem)] lg:block">
            <SearchBar ref={searchRef} compact />
          </div>

          <button
            ref={mobileSearchButtonRef}
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-md bg-zipo-accent text-[var(--zipo-on-accent)] lg:hidden"
            aria-label={tc("search")}
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>

          <span className="hide-on-nsfw contents">
            <ThemeToggle />
          </span>

          <LanguageMenu />

          {userTier === "guest" ? (
            <Link
              href="/auth/login"
              className="hidden min-h-[44px] items-center rounded-md bg-zipo-accent px-4 py-2.5 text-sm font-medium text-[var(--zipo-on-accent)] transition-colors duration-200 hover:bg-zipo-accent-hover sm:inline-flex"
            >
              {tc("login")}
            </Link>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link
                href="/profile"
                className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-zipo-border-subtle px-3 py-2.5 text-sm text-zipo-muted transition-colors duration-200 hover:border-zipo-border hover:text-zipo-text"
                title={t("profile")}
              >
                <UserRound className="h-4 w-4" aria-hidden="true" />
                <span className="hidden xl:inline">{t("profile")}</span>
              </Link>
              <Link
                href="/profile/playlists"
                className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-zipo-border-subtle px-3 py-2.5 text-sm text-zipo-muted transition-colors duration-200 hover:border-zipo-border hover:text-zipo-text"
                title={tp("title")}
              >
                <ListMusic className="h-4 w-4" aria-hidden="true" />
                <span className="hidden lg:inline">{tp("title")}</span>
              </Link>
              <Link
                href="/profile/history"
                className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-zipo-border-subtle px-3 py-2.5 text-sm text-zipo-muted transition-colors duration-200 hover:border-zipo-border hover:text-zipo-text"
                title={t("history")}
              >
                <History className="h-4 w-4" aria-hidden="true" />
                <span className="hidden lg:inline">{t("history")}</span>
              </Link>
              <TierBadge tier={userTier} label={tc(userTier)} />
              <button
                type="button"
                onClick={() => {
                  setActiveProfileId(null);
                  void logout();
                }}
                className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-zipo-border-subtle px-3 py-2.5 text-sm text-zipo-muted transition-colors duration-200 hover:border-zipo-border hover:text-zipo-text"
                title={tc("logout")}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden lg:inline">{tc("logout")}</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-zipo-border-subtle text-zipo-text lg:hidden"
            aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden border-t border-zipo-border-subtle bg-zipo-surface lg:hidden"
          >
            <div className="space-y-1 p-4">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-[44px] items-center rounded-md px-3 text-sm text-zipo-text transition-colors hover:bg-zipo-elevated"
                >
                  {link.label}
                </Link>
              ))}
              {userTier === "guest" ? (
                <Link
                  href="/auth/login"
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-[44px] items-center justify-center rounded-md bg-zipo-accent px-3 text-sm font-medium text-[var(--zipo-on-accent)]"
                >
                  {tc("login")}
                </Link>
              ) : (
                <>
                  <Link
                    href="/profile"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm text-zipo-text transition-colors hover:bg-zipo-elevated"
                  >
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                    {t("profile")}
                  </Link>
                  <Link
                    href="/profile/playlists"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm text-zipo-text transition-colors hover:bg-zipo-elevated"
                  >
                    <ListMusic className="h-4 w-4" aria-hidden="true" />
                    {tp("title")}
                  </Link>
                  <Link
                    href="/profile/history"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm text-zipo-text transition-colors hover:bg-zipo-elevated"
                  >
                    <History className="h-4 w-4" aria-hidden="true" />
                    {t("history")}
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveProfileId(null);
                      void logout();
                      setMobileOpen(false);
                    }}
                    className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-zipo-border-subtle px-3 text-sm text-zipo-muted"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {tc("logout")}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="zipo-mobile-search fixed inset-0 z-[200] bg-zipo-bg/98 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label={tc("search")}
          >
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              className="zipo-mobile-search-close absolute flex h-11 w-11 items-center justify-center rounded-lg border border-zipo-border text-zipo-text"
              aria-label={t("closeMenu")}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="mx-auto max-w-2xl">
              <SearchBar ref={searchRef} overlay onNavigate={() => setSearchOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
