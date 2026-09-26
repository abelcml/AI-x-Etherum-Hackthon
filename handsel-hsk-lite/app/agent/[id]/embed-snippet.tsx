'use client'

import { useState } from 'react'

/** The copyable README embed — the part of the profile that spreads. */
export function EmbedSnippet({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(markdown).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  return (
    <div className="mt-3">
      <pre className="overflow-x-auto rounded-lg border border-border bg-secondary/30 p-3 text-xs">{markdown}</pre>
      <button
        onClick={copy}
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        {copied ? 'Copied!' : 'Copy markdown for your README'}
      </button>
    </div>
  )
}
