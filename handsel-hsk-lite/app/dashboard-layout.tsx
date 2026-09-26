'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardShell } from '@/components/dashboard-shell'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkSession = async () => {
      try {
        const me = await fetch('/api/me')
        if (!me.ok) {
          router.replace('/sign-in')
          return
        }
        setAuthorized(true)
      } catch (error) {
        console.error('[v0] Session check error:', error)
        router.replace('/sign-in')
      } finally {
        setLoading(false)
      }
    }

    checkSession()
  }, [router])

  if (loading || !authorized) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return <DashboardShell>{children}</DashboardShell>
}
