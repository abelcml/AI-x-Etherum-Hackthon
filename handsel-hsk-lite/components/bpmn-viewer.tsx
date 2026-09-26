'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'

/** Renders a BPMN 2.0 XML string read-only, with pan/zoom. bpmn-js touches
 *  the DOM directly, so it's loaded client-side only. */
export function BpmnViewer({ xml, heightClassName = 'h-[500px]' }: { xml: string; heightClassName?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let viewer: { importXML: (xml: string) => Promise<unknown>; destroy: () => void; get: (name: string) => any } | null = null
    let cancelled = false

    async function render() {
      try {
        const { default: NavigatedViewer } = await import('bpmn-js/lib/NavigatedViewer')
        if (cancelled || !containerRef.current) return

        viewer = new NavigatedViewer({ container: containerRef.current })
        await viewer.importXML(xml)
        if (cancelled) return

        const canvas = viewer.get('canvas')
        canvas.zoom('fit-viewport')
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      }
    }

    render()
    return () => {
      cancelled = true
      viewer?.destroy()
    }
  }, [xml])

  return (
    <div className="relative">
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive">
          Failed to render diagram: {error}
        </div>
      )}
      <div ref={containerRef} className={`w-full ${heightClassName} rounded-md border border-border bg-white`} />
    </div>
  )
}
