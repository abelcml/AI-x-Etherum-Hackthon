/**
 * Renders a DMN-style decision table as a readable grid — the trust gates,
 * auditable at a glance. Pure presentational; the table data comes from
 * lib/decision-table.ts, the same definitions the settlement path evaluates.
 */
import type { DecisionTable } from '@/lib/decision-table'

const ACTION_STYLE: Record<string, string> = {
  auto_release: 'text-success font-medium',
  refund_repost: 'text-warning font-medium',
  manual_review: 'text-muted-foreground',
  wait: 'text-muted-foreground',
}

export function DecisionTableView({ table }: { table: DecisionTable }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{table.name}</h3>
        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          DMN · {table.hitPolicy}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {table.inputs.map((i) => (
                <th key={i.key} className="border-b border-border px-4 py-2 font-medium">
                  {i.label}
                </th>
              ))}
              {table.outputs.map((o) => (
                <th key={o.key} className="border-b border-l border-border bg-secondary/30 px-4 py-2 font-medium">
                  {o.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rules.map((r, ri) => (
              <tr key={ri} className="align-top">
                {r.when.map((c, ci) => (
                  <td key={ci} className="border-b border-border px-4 py-2 font-mono text-xs text-foreground">
                    {c === '-' ? <span className="text-muted-foreground/50">any</span> : c}
                  </td>
                ))}
                {r.then.map((v, vi) => {
                  const isAction = vi === 0
                  const cls = isAction ? (ACTION_STYLE[String(v)] ?? 'text-foreground') : 'text-muted-foreground'
                  return (
                    <td
                      key={vi}
                      className={`border-b border-l border-border bg-secondary/20 px-4 py-2 ${vi === 0 ? 'font-mono text-xs' : 'text-xs'} ${cls}`}
                    >
                      {String(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
