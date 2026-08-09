"use client";

import {
  forwardRef,
  startTransition,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Clock3, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import type { LegacyContentItem as ContentItem, ContentType } from "@zipo/shared";
import {
  CANONICAL_GENRES,
  canonicalizeGenres,
  genreLabel,
  type CanonicalGenre,
} from "@zipo/shared";
import { useRouter } from "@/i18n/routing";
import { fetchSearchSuggestions, getPosterUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ResilientImage } from "./ResilientImage";

const SUGGESTION_DEBOUNCE_MS = 120;
const URL_DEBOUNCE_MS = 360;
const HISTORY_KEY = "zipo:search:history:v1";
const QUICK_GENRES: CanonicalGenre[] = [
  "action",
  "comedy",
  "fantasy",
  "family",
  "documentary",
  "horror",
];

export interface SearchBarHandle {
  focus: () => void;
}

interface SearchBarProps {
  compact?: boolean;
  className?: string;
  syncWithUrl?: boolean;
  initialQuery?: string;
  initialType?: ContentType | "all";
  initialGenres?: CanonicalGenre[];
  overlay?: boolean;
  onNavigate?: () => void;
}

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(
  function SearchBar(
    {
      compact = false,
      className,
      syncWithUrl = false,
      initialQuery = "",
      initialType = "all",
      initialGenres = [],
      overlay = false,
      onNavigate,
    },
    ref,
  ) {
    const t = useTranslations("common");
    const locale = useLocale();
    const router = useRouter();
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestRef = useRef<AbortController | null>(null);
    const listboxId = `zipo-search-${useId().replace(/:/g, "")}`;
    const initialGenresKey = initialGenres.join(",");
    const [query, setQuery] = useState(initialQuery);
    const [suggestions, setSuggestions] = useState<ContentItem[]>([]);
    const [history, setHistory] = useState<string[]>([]);
    const [open, setOpen] = useState(overlay);
    const [loading, setLoading] = useState(false);
    const [partial, setPartial] = useState(false);
    const [type, setType] = useState<ContentType | "all">(initialType);
    const [genres, setGenres] = useState<CanonicalGenre[]>(initialGenres);
    const [showAllGenres, setShowAllGenres] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const isPortuguese = locale.toLowerCase().startsWith("pt");

    useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

    useEffect(() => {
      setQuery(initialQuery);
      setType(initialType);
      setGenres(canonicalizeGenres(initialGenresKey.split(",")));
    }, [initialGenresKey, initialQuery, initialType]);

    useEffect(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
        setHistory(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string").slice(0, 6) : []);
      } catch {
        setHistory([]);
      }
      if (overlay) window.setTimeout(() => inputRef.current?.focus(), 50);
    }, [overlay]);

    useEffect(() => {
      const close = (event: PointerEvent) => {
        if (!overlay && !rootRef.current?.contains(event.target as Node)) setOpen(false);
      };
      document.addEventListener("pointerdown", close);
      return () => document.removeEventListener("pointerdown", close);
    }, [overlay]);

    const remember = useCallback((value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setHistory((current) => {
        const next = [
          trimmed,
          ...current.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase()),
        ].slice(0, 6);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    }, []);

    const searchPath = useCallback((value: string) => {
      const params = new URLSearchParams({ q: value.trim() });
      if (type !== "all") params.set("type", type);
      if (genres.length) params.set("genres", genres.join(","));
      return `/search?${params}`;
    }, [genres, type]);

    const navigateToSearch = useCallback((value: string) => {
      if (!value.trim()) return;
      remember(value);
      setOpen(false);
      router.push(searchPath(value));
      onNavigate?.();
    }, [onNavigate, remember, router, searchPath]);

    const navigateToSuggestion = useCallback((item: ContentItem) => {
      remember(query || item.title);
      setOpen(false);
      router.push(`/${item.type}/${item.id}`);
      onNavigate?.();
    }, [onNavigate, query, remember, router]);

    const loadSuggestions = useCallback((value: string) => {
      requestRef.current?.abort();
      if (value.trim().length < 2) {
        setSuggestions([]);
        setPartial(false);
        setLoading(false);
        return;
      }
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      void fetchSearchSuggestions(value, {
        type: type === "all" ? undefined : type,
        locale,
        genres,
        signal: controller.signal,
      }).then((response) => {
        if (controller.signal.aborted) return;
        setSuggestions(response.items.slice(0, 8));
        setPartial(response.partial);
        setActiveIndex(-1);
        setOpen(true);
      }).catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSuggestions([]);
          setPartial(false);
        }
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, [genres, locale, type]);

    useEffect(() => {
      if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = setTimeout(
        () => loadSuggestions(query),
        SUGGESTION_DEBOUNCE_MS,
      );
      return () => {
        if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
      };
    }, [loadSuggestions, query]);

    useEffect(() => {
      if (!syncWithUrl || query.trim().length < 2) return;
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
      urlTimerRef.current = setTimeout(() => {
        startTransition(() => router.replace(searchPath(query), { scroll: false }));
      }, URL_DEBOUNCE_MS);
      return () => {
        if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
      };
    }, [query, router, searchPath, syncWithUrl]);

    useEffect(() => () => {
      requestRef.current?.abort();
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
    }, []);

    const submit = (event: FormEvent) => {
      event.preventDefault();
      navigateToSearch(query);
    };

    const toggleGenre = (genre: CanonicalGenre) => {
      setGenres((current) => current.includes(genre)
        ? current.filter((entry) => entry !== genre)
        : [...current, genre]);
      setOpen(true);
    };

    const selectable = suggestions.length > 0
      ? suggestions.map((item) => ({ kind: "suggestion" as const, item }))
      : query.trim().length < 2
        ? history.map((value) => ({ kind: "history" as const, value }))
        : [];

    const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
        return;
      }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && selectable.length > 0) {
        event.preventDefault();
        setOpen(true);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (current + delta + selectable.length) % selectable.length);
        return;
      }
      if (event.key === "Enter" && activeIndex >= 0) {
        const selected = selectable[activeIndex];
        if (!selected) return;
        event.preventDefault();
        if (selected.kind === "suggestion") navigateToSuggestion(selected.item);
        else navigateToSearch(selected.value);
      }
    };

    const showPanel = open && (overlay || query.length > 0 || history.length > 0);
    const typeLabels: Record<ContentType | "all", string> = isPortuguese
      ? { all: "Todos", movie: "Filmes", series: "Séries", anime: "Animes" }
      : { all: "All", movie: "Movies", series: "Series", anime: "Anime" };

    return (
      <div ref={rootRef} className={cn("relative", className)}>
        <form onSubmit={submit} role="search" className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zipo-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            name="q"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(-1);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onInputKeyDown}
            placeholder={t("searchPlaceholder")}
            className={cn(
              "min-h-11 w-full rounded-xl border border-zipo-border bg-zipo-surface pl-10 text-base text-zipo-text placeholder:text-zipo-muted focus:border-zipo-accent focus:outline-none focus:ring-2 focus:ring-zipo-accent/25",
              compact ? "pr-10 md:pr-20" : "pr-12",
            )}
            aria-label={t("searchPlaceholder")}
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listboxId}
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            aria-autocomplete="list"
          />
          {loading ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zipo-accent motion-reduce:animate-none" aria-label={isPortuguese ? "Buscando" : "Searching"} />
          ) : query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSuggestions([]);
                setActiveIndex(-1);
                inputRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-zipo-muted hover:bg-zipo-elevated hover:text-zipo-text"
              aria-label={isPortuguese ? "Limpar busca" : "Clear search"}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </form>

        {showPanel && (
          <div
            id={listboxId}
            role="listbox"
            className={cn(
              "z-[120] overflow-hidden border border-zipo-border bg-zipo-surface shadow-[0_18px_50px_rgb(0_0_0/0.16)]",
              overlay ? "mt-4 rounded-2xl" : "absolute inset-x-0 top-[calc(100%+0.5rem)] rounded-xl",
            )}
          >
            <div className="border-b border-zipo-border-subtle p-3">
              <div className="flex flex-wrap gap-2" aria-label={isPortuguese ? "Tipo de conteúdo" : "Content type"}>
                {(["all", "movie", "series", "anime"] as const).map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    aria-pressed={type === entry}
                    onClick={() => {
                      setType(entry);
                      setActiveIndex(-1);
                    }}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors",
                      type === entry
                        ? "border-zipo-accent bg-zipo-accent/15 text-zipo-accent"
                        : "border-zipo-border text-zipo-muted hover:border-zipo-muted hover:text-zipo-text",
                    )}
                  >
                    {typeLabels[entry]}
                  </button>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap gap-2" aria-label={isPortuguese ? "Filtros rápidos" : "Quick filters"}>
                {QUICK_GENRES.map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    aria-pressed={genres.includes(genre)}
                    onClick={() => toggleGenre(genre)}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors",
                      genres.includes(genre)
                        ? "border-zipo-accent bg-zipo-accent/15 text-zipo-accent"
                        : "border-zipo-border text-zipo-muted hover:border-zipo-muted hover:text-zipo-text",
                    )}
                  >
                    {genreLabel(genre, locale)}
                  </button>
                ))}
                <button
                  type="button"
                  aria-expanded={showAllGenres}
                  onClick={() => setShowAllGenres((value) => !value)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-zipo-border px-3 text-xs font-medium text-zipo-text hover:border-zipo-accent"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  {isPortuguese ? "Todos os gêneros" : "All genres"}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAllGenres && "rotate-180")} aria-hidden="true" />
                </button>
              </div>

              {showAllGenres && (
                <div className="mt-3 grid max-h-44 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-zipo-border-subtle bg-zipo-bg p-2 sm:grid-cols-3" role="group" aria-label={isPortuguese ? "Todos os gêneros" : "All genres"}>
                  {CANONICAL_GENRES.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      aria-pressed={genres.includes(genre)}
                      onClick={() => toggleGenre(genre)}
                      className={cn(
                        "min-h-10 rounded-md px-2 text-left text-xs transition-colors",
                        genres.includes(genre)
                          ? "bg-zipo-accent/15 font-semibold text-zipo-accent"
                          : "text-zipo-muted hover:bg-zipo-elevated hover:text-zipo-text",
                      )}
                    >
                      {genreLabel(genre, locale)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {suggestions.length > 0 ? (
              <div className="max-h-[min(52dvh,430px)] overflow-y-auto p-2">
                {suggestions.map((item, index) => (
                  <button
                    id={`${listboxId}-option-${index}`}
                    key={`${item.type}:${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    onPointerEnter={() => {
                      setActiveIndex(index);
                      router.prefetch(`/${item.type}/${item.id}`);
                    }}
                    onClick={() => navigateToSuggestion(item)}
                    className={cn(
                      "flex min-h-16 w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-zipo-elevated focus-visible:bg-zipo-elevated",
                      activeIndex === index && "bg-zipo-elevated",
                    )}
                  >
                    <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-zipo-bg">
                      <ResilientImage candidates={[getPosterUrl(item), ...(item.posterCandidates ?? [])]} alt="" sizes="40px" placeholderLabel={item.title} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zipo-text">{item.title}</span>
                      <span className="mt-1 block text-xs text-zipo-muted">
                        {typeLabels[item.type]} {item.year ? `· ${item.year}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
                {partial && (
                  <p className="px-2 py-2 text-xs text-zipo-muted" role="status">
                    {isPortuguese ? "Resultados parciais enquanto outras fontes respondem." : "Partial results while other sources respond."}
                  </p>
                )}
                <button type="button" onClick={() => navigateToSearch(query)} className="mt-1 flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-sm font-semibold text-zipo-accent hover:bg-zipo-accent/10">
                  {isPortuguese ? `Ver todos os resultados para “${query.trim()}”` : `See all results for “${query.trim()}”`}
                  <Search className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : query.trim().length >= 2 && !loading ? (
              <div className="p-5 text-center">
                <p className="text-sm font-medium text-zipo-text">{t("noResults")}</p>
                <p className="mt-1 text-xs text-zipo-muted">
                  {isPortuguese ? "Tente outro termo ou ajuste os filtros." : "Try another term or adjust the filters."}
                </p>
              </div>
            ) : history.length > 0 ? (
              <div className="p-2">
                <div className="flex min-h-9 items-center justify-between px-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zipo-muted">
                    {isPortuguese ? "Buscas recentes" : "Recent searches"}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setHistory([]);
                      localStorage.removeItem(HISTORY_KEY);
                    }}
                    className="min-h-9 rounded-md px-2 text-xs font-medium text-zipo-accent hover:bg-zipo-accent/10"
                  >
                    {isPortuguese ? "Limpar" : "Clear"}
                  </button>
                </div>
                {history.map((entry, index) => (
                  <button
                    id={`${listboxId}-option-${index}`}
                    key={entry}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    onPointerEnter={() => {
                      setActiveIndex(index);
                      router.prefetch(searchPath(entry));
                    }}
                    onClick={() => navigateToSearch(entry)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-zipo-text hover:bg-zipo-elevated",
                      activeIndex === index && "bg-zipo-elevated",
                    )}
                  >
                    <Clock3 className="h-4 w-4 text-zipo-muted" aria-hidden="true" />
                    {entry}
                  </button>
                ))}
              </div>
            ) : (
              <p className="p-5 text-center text-sm text-zipo-muted">
                {isPortuguese ? "Digite ao menos 2 caracteres para buscar." : "Type at least 2 characters to search."}
              </p>
            )}
          </div>
        )}
      </div>
    );
  },
);
