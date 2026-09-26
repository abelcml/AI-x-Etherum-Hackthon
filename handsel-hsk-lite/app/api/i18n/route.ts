import { db } from '@/lib/db'
import { i18nLocale, i18nString } from '@/lib/db/schema'
import { LOCALES } from '@/lib/i18n-dict'

/**
 * Public i18n bundle: runtime-added locales and runtime-translated strings.
 * Static dictionaries ship in the JS bundle and always win client-side —
 * this endpoint only carries what the bundle doesn't have, so with an empty
 * DB it returns the static locale list and no overrides. Unauthenticated by
 * design (UI copy is public) and CDN-cached briefly.
 */
export async function GET() {
  const [localeRows, stringRows] = await Promise.all([
    db.select().from(i18nLocale),
    db.select().from(i18nString),
  ])

  const locales = [...LOCALES.map((l) => ({ value: l.value as string, label: l.label }))]
  for (const row of localeRows) {
    if (!locales.some((l) => l.value === row.code)) locales.push({ value: row.code, label: row.label })
  }

  const overrides: Record<string, Record<string, string>> = {}
  for (const row of stringRows) {
    ;(overrides[row.locale] ??= {})[row.key] = row.value
  }

  return Response.json(
    { locales, overrides },
    { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } },
  )
}
