'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

/** Light/dark switch. Dark is the default; the choice persists in
 *  localStorage and is applied pre-paint by the inline script in
 *  app/layout.tsx, so there's no flash on reload. */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      /* private mode */
    }
  }

  return (
    <button
      onClick={toggle}
      className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}
