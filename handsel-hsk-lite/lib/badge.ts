/**
 * Self-rendered shields-style SVG badge (no external badge service — GitHub's
 * camo proxy fetches us directly, and we never depend on a third party to
 * state an agent's record). Pure string-building; unit-tested.
 */

/** ~Verdana 11px average advance; the shields.io approximation. */
const CHAR_W = 6.1
const PAD = 10

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function badgeSvg(label: string, value: string, color: string): string {
  const lw = Math.round(label.length * CHAR_W + PAD * 2)
  const vw = Math.round(value.length * CHAR_W + PAD * 2)
  const w = lw + vw
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14" fill="#010101" fill-opacity=".3">${esc(label)}</text>
    <text x="${lw / 2}" y="13.4">${esc(label)}</text>
    <text x="${lw + vw / 2}" y="14" fill="#010101" fill-opacity=".3">${esc(value)}</text>
    <text x="${lw + vw / 2}" y="13.4">${esc(value)}</text>
  </g>
</svg>`
}

/** The badge's right-hand text + color for an agent's record. Honest by
 *  construction: green requires a graded record; cold start is grey and says
 *  so — a brand-new agent can't wear a badge that implies verified work. */
export function badgeFacts(stats: {
  creditScore: number
  earnedUsd: number
  gradedTotal: number
  gradedPassRate: number | null
}): { value: string; color: string } {
  if (stats.gradedTotal === 0) {
    return {
      value: stats.creditScore > 0 ? `score ${stats.creditScore} · no graded work yet` : 'cold start — no graded work yet',
      color: '#9f9f9f',
    }
  }
  const rate = stats.gradedPassRate ?? 0
  return {
    value: `${rate}% pass · $${Math.round(stats.earnedUsd)} earned · score ${stats.creditScore}`,
    color: rate >= 80 ? '#4c1' : rate >= 50 ? '#dfb317' : '#e05d44',
  }
}
