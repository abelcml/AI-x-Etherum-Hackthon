'use client'

/**
 * Minimal client-side i18n: a context, a t() lookup, and a header
 * switcher. The choice persists in localStorage; English is both the
 * default and the fallback for any string a dictionary hasn't covered
 * yet — untranslated pages degrade to English, never to blank keys.
 *
 * Two string sources, strict precedence:
 *   1. static dictionaries in lib/i18n-dict.ts (human-reviewed, in-bundle)
 *   2. runtime overrides from /api/i18n (LLM-translated via the admin UI
 *      with a registered API key; also carries runtime-added locales)
 *   3. English, then the raw key.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { DICTIONARIES, LOCALES, type Locale } from '@/lib/i18n-dict'

type LocaleOption = { value: string; label: string }
type Overrides = Record<string, Record<string, string>>

type I18n = {
  locale: string
  locales: LocaleOption[]
  setLocale: (l: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

// {token} placeholders survive translation verbatim (the prompt demands it),
// so interpolation happens after lookup, in every language.
function interpolate(raw: string, params?: Record<string, string | number>) {
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
}

const I18nContext = createContext<I18n>({
  locale: 'en',
  locales: LOCALES,
  setLocale: () => {},
  t: (key, params) => interpolate(DICTIONARIES.en[key] ?? key, params),
})

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<string>('en')
  const [locales, setLocales] = useState<LocaleOption[]>(LOCALES)
  const [overrides, setOverrides] = useState<Overrides>({})

  useEffect(() => {
    try {
      const stored = localStorage.getItem('locale')
      if (stored) setLocaleState(stored) // runtime locales validate once the bundle loads
    } catch {
      /* private mode */
    }
    // Runtime bundle: locales added from the admin UI + LLM-translated strings.
    fetch('/api/i18n')
      .then((r) => (r.ok ? r.json() : null))
      .then((bundle) => {
        if (!bundle) return
        setLocales(bundle.locales)
        setOverrides(bundle.overrides)
      })
      .catch(() => {}) // static dictionaries keep working without it
  }, [])

  // Keep <html lang> honest so browser auto-translate (Chrome/Safari) and
  // screen readers see the real page language instead of a hardcoded "en".
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = (l: string) => {
    setLocaleState(l)
    try {
      localStorage.setItem('locale', l)
    } catch {
      /* private mode */
    }
  }

  const t = (key: string, params?: Record<string, string | number>) =>
    interpolate(
      DICTIONARIES[locale as Locale]?.[key] ?? overrides[locale]?.[key] ?? DICTIONARIES.en[key] ?? key,
      params,
    )

  return <I18nContext.Provider value={{ locale, locales, setLocale, t }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

export function LanguageSwitcher() {
  const { locale, locales, setLocale } = useI18n()
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-md border border-border px-2 text-muted-foreground hover:bg-secondary">
      <Globe className="size-4" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        className="bg-transparent text-xs font-medium outline-none"
        aria-label="Language"
      >
        {locales.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
