'use client'

/**
 * CSS-only celebration overlay (no libraries): a confetti burst and a
 * center card. Used for genuine milestones only — the first verified job
 * a user's worker ever completes — so the moment stays special.
 */
import { useEffect, useMemo } from 'react'

const COLORS = ['#34D399', '#60A5FA', '#FBBF24', '#F87171', '#A78BFA', '#F472B6']

export function Celebration({
  title,
  body,
  onClose,
}: {
  title: string
  body: string
  onClose: () => void
}) {
  // Deterministic-per-mount confetti field.
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: ((i * 13) % 20) / 10,
        duration: 2.2 + ((i * 7) % 14) / 10,
        color: COLORS[i % COLORS.length],
        size: 6 + ((i * 11) % 8),
      })),
    [],
  )

  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label={title}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {pieces.map((p, i) => (
          <span
            key={i}
            className="animate-confetti absolute top-0 rounded-sm"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 0.6,
              backgroundColor: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
            }}
          />
        ))}
      </div>
      <div className="animate-pop mx-4 max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-2xl">
        <p className="text-5xl">⛏️🎉</p>
        <p className="mt-4 text-xl font-bold">{title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <button
          onClick={onClose}
          className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          🚀
        </button>
      </div>
    </div>
  )
}
