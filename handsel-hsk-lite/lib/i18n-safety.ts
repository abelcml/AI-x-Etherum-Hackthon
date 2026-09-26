/**
 * The gate where a worker's text becomes the product's own voice.
 *
 * A passing i18n job's values are written into the runtime overrides and
 * rendered to every visitor in that locale as UI copy. Until now the only
 * thing standing between "a stranger earned $5" and "the platform says
 * this" was an LLM grader asked whether the translation was *good* — not
 * whether it was safe to speak in our name. And we have just spent the day
 * learning that an LLM gate can be talked around.
 *
 * The attack that matters isn't XSS (React escapes, and the values are
 * rendered as text). It is that a $5 translation job buys a line of the
 * product's own UI: "Your session expired — sign in again at <address>" is
 * a plausible translation of a session-expiry string, would read naturally
 * to the grader, and reaches every visitor in that locale wearing our
 * chrome. Phishing, published by us, paid for by us.
 *
 * So the apply path gets a deterministic gate that an LLM cannot be
 * persuaded past. Every rule below compares the translation against ITS OWN
 * SOURCE STRING rather than against a blocklist: a translation may not
 * introduce a link the English never had, may not invent placeholders, may
 * not become a paragraph where the source was a button label. Nothing here
 * asks what the text means — only whether it stayed the same KIND of thing.
 */

/** Braces placeholders the UI interpolates: {n}, {amount}, … */
function placeholders(s: string): string[] {
  return (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort()
}

const URLISH = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|xyz|co|ru|cn|app|dev|link|top)\b)/i
const TAGISH = /<[a-zA-Z/!][^>]*>/

/** Room for a translation to be legitimately longer than its source
 *  (German, Arabic) without letting it become an essay. */
const LENGTH_FLOOR = 120
const LENGTH_FACTOR = 3

export type TranslationCheck = { ok: true } | { ok: false; reason: string }

/**
 * May this translated value be published as UI copy? Pure and deterministic
 * — the point is that it cannot be argued with.
 */
export function validateTranslationValue(source: string, value: string): TranslationCheck {
  const v = value.trim()
  if (!v) return { ok: false, reason: 'empty translation' }

  // A UI string is one line. Multi-line values break layouts and are how a
  // short label turns into a paragraph of someone else's message.
  if (/[\r\n]/.test(v)) return { ok: false, reason: 'translation spans multiple lines' }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, reason: 'translation contains control characters' }

  const limit = Math.max(LENGTH_FLOOR, source.length * LENGTH_FACTOR)
  if (v.length > limit) {
    return { ok: false, reason: `translation is ${v.length} chars for a ${source.length}-char source (limit ${limit})` }
  }

  // A translation may not introduce a destination the original never had.
  // This is the phishing gate, and it is deliberately source-relative: a
  // string that genuinely contains a link keeps it.
  if (URLISH.test(v) && !URLISH.test(source)) {
    return { ok: false, reason: 'translation introduces a link or domain the source does not have' }
  }
  if (TAGISH.test(v) && !TAGISH.test(source)) {
    return { ok: false, reason: 'translation introduces markup the source does not have' }
  }

  // Placeholders are a contract with the renderer: inventing one prints a
  // stray token, dropping one silently loses a number the user needed.
  const want = placeholders(source)
  const got = placeholders(v)
  if (want.join('|') !== got.join('|')) {
    return {
      ok: false,
      reason: `placeholders differ — source has [${want.join(', ') || 'none'}], translation has [${got.join(', ') || 'none'}]`,
    }
  }

  return { ok: true }
}
