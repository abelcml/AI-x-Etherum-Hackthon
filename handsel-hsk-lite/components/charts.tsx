"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

const axisProps = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
}

function TooltipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">{children}</div>
  )
}

export function CreditScoreChart({ data }: { data: { month: string; score: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis domain={[700, 900]} {...axisProps} />
        <Tooltip
          cursor={{ stroke: "var(--color-border)" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox>
                <p className="text-muted-foreground">{label}</p>
                <p className="font-mono text-sm font-semibold text-foreground">{payload[0].value} pts</p>
              </TooltipBox>
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill="url(#scoreFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function CreditEvolutionChart({ data }: { data: { label: string; score: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="evolutionFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis domain={["auto", "auto"]} {...axisProps} />
        <Tooltip
          cursor={{ stroke: "var(--color-border)" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox>
                <p className="text-muted-foreground">{label}</p>
                <p className="font-mono text-sm font-semibold text-foreground">{payload[0].value} pts</p>
              </TooltipBox>
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill="url(#evolutionFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function PerformanceChart({ data }: { data: { month: string; tasks: number; success: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis yAxisId="left" {...axisProps} />
        <YAxis yAxisId="right" orientation="right" domain={[94, 100]} {...axisProps} />
        <Tooltip
          cursor={{ fill: "var(--color-secondary)", opacity: 0.4 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox>
                <p className="text-muted-foreground">{label}</p>
                <p className="font-mono text-foreground">{payload[0]?.value} tasks</p>
                <p className="font-mono text-success">{payload[1]?.value}% success</p>
              </TooltipBox>
            ) : null
          }
        />
        <Bar yAxisId="left" dataKey="tasks" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} maxBarSize={22} opacity={0.5} />
        <Line yAxisId="right" type="monotone" dataKey="success" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function DefaultProbabilityChart({
  data,
}: {
  data: { month: string; portfolio: number; agent: number }[]
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis domain={[0, 4]} {...axisProps} unit="%" />
        <Tooltip
          cursor={{ stroke: "var(--color-border)" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox>
                <p className="text-muted-foreground">{label}</p>
                <p className="font-mono text-foreground">Portfolio: {payload[0]?.value}%</p>
                <p className="font-mono text-primary">This agent: {payload[1]?.value}%</p>
              </TooltipBox>
            ) : null
          }
        />
        <Area isAnimationActive={false} type="monotone" dataKey="portfolio" stroke="var(--color-muted-foreground)" strokeWidth={1.5} fill="var(--color-muted-foreground)" fillOpacity={0.08} />
        <Area isAnimationActive={false} type="monotone" dataKey="agent" stroke="var(--color-chart-1)" strokeWidth={2} fill="var(--color-chart-1)" fillOpacity={0.12} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function RiskDistributionChart({
  data,
}: {
  data: { band: string; count: number; fill: string }[]
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="band" {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip
          cursor={{ fill: "var(--color-secondary)", opacity: 0.4 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox>
                <p className="text-muted-foreground">Rating {label}</p>
                <p className="font-mono text-foreground">{payload[0]?.value} agents</p>
              </TooltipBox>
            ) : null
          }
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={44}>
          {data.map((entry) => (
            <Cell key={entry.band} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ExposureChart({ data }: { data: { sector: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis type="number" {...axisProps} unit="M" />
        <YAxis type="category" dataKey="sector" width={92} {...axisProps} />
        <Tooltip
          cursor={{ fill: "var(--color-secondary)", opacity: 0.4 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox>
                <p className="text-muted-foreground">{label}</p>
                <p className="font-mono text-foreground">${payload[0]?.value}M exposure</p>
              </TooltipBox>
            ) : null
          }
        />
        <Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 3, 3, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  )
}
