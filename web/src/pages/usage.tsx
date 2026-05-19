import { useEffect, useMemo, useRef, useState } from "react"
import {
  BarChart3,
  Cloud,
  Coins,
  Cpu,
  DollarSign,
  ExternalLink,
  RefreshCw,
  Settings2,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { PageLoading } from "@/components/shared/page-loading"
import { useUpdateUsagePricing, useUsageOverview, useUsagePricing } from "@/hooks/use-usage"
import type { UsageOverviewBreakdownRow, UsageOverviewDailyRow, UsageOverviewResponse, UsagePricingCost } from "@/lib/types"

type UsageMetric = "tokens" | "requests"

const DAY_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
]

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0"
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0"
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value)
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%"
  return `${Math.round(value * 100)}%`
}

function deriveDefaultDates(days: number) {
  const end = new Date()
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

function useDateRangeState(defaultDays = 7) {
  const defaults = deriveDefaultDates(defaultDays)
  const [presetDays, setPresetDays] = useState<number>(defaultDays)
  const [draftStartDate, setDraftStartDate] = useState(defaults.startDate)
  const [draftEndDate, setDraftEndDate] = useState(defaults.endDate)
  const [appliedStartDate, setAppliedStartDate] = useState(defaults.startDate)
  const [appliedEndDate, setAppliedEndDate] = useState(defaults.endDate)

  const applyPreset = (days: number) => {
    const next = deriveDefaultDates(days)
    setPresetDays(days)
    setDraftStartDate(next.startDate)
    setDraftEndDate(next.endDate)
    setAppliedStartDate(next.startDate)
    setAppliedEndDate(next.endDate)
  }

  const applyCustom = () => {
    if (!draftStartDate || !draftEndDate) return
    setPresetDays(0)
    setAppliedStartDate(draftStartDate)
    setAppliedEndDate(draftEndDate)
  }

  return {
    presetDays,
    draftStartDate,
    draftEndDate,
    appliedStartDate,
    appliedEndDate,
    setDraftStartDate,
    setDraftEndDate,
    applyPreset,
    applyCustom,
  }
}

function MetricCard(props: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sublabel?: string
  valueClassName?: string
}) {
  const Icon = props.icon
  return (
    <Card className="gap-0">
      <CardContent className="px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{props.label}</div>
            <div className={`text-xl font-semibold tracking-tight ${props.valueClassName ?? ""}`.trim()}>{props.value}</div>
            {props.sublabel ? <div className="text-sm text-muted-foreground">{props.sublabel}</div> : null}
          </div>
          <div className="rounded-full border bg-muted/40 p-2.5 text-muted-foreground">
            <Icon className="size-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function UsageStackedBars(props: {
  rows: UsageOverviewDailyRow[]
  metric: UsageMetric
}) {
  const { rows, metric } = props
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState<{ date: string; x: number; y: number } | null>(null)
  const series = rows.map((row) => {
    if (metric === "requests") {
      return {
        date: row.date,
        local: row.localRequests,
        cloud: row.cloudRequests,
        primary: row.cloudRequests,
        secondary: row.localRequests,
        total: row.requests,
      }
    }
    return {
      date: row.date,
      local: row.localTokens,
      cloud: row.cloudTokens,
      primary: row.cloudTokens,
      secondary: row.localTokens,
      total: row.tokens,
    }
  })
  const maxTotal = Math.max(...series.map((row) => row.total), 0)
  const hoveredRow = hovered ? series.find((row) => row.date === hovered.date) ?? null : null

  if (!rows.length || maxTotal <= 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        No usage in this date range yet.
      </div>
    )
  }

  const width = 920
  const height = 320
  const paddingLeft = 16
  const paddingRight = 16
  const paddingTop = 16
  const paddingBottom = 34
  const chartHeight = height - paddingTop - paddingBottom
  const chartWidth = width - paddingLeft - paddingRight
  const slotWidth = chartWidth / series.length
  const barWidth = Math.max(8, Math.min(26, slotWidth * 0.6))
  const y = (value: number) => chartHeight - (value / maxTotal) * chartHeight

  const formatValue = (value: number) => formatCompactNumber(value)
  const formatHoverDate = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  const hoverSummaryLabel = metric === "tokens" ? "tokens" : "requests"
  const tooltipWidth = 206
  const tooltipLeft = hovered && chartRef.current
    ? Math.max(12, Math.min(chartRef.current.clientWidth - tooltipWidth - 12, hovered.x + 14))
    : 0
  const tooltipTop = hovered && chartRef.current
    ? Math.max(12, Math.min(chartRef.current.clientHeight - 118, hovered.y - 18))
    : 0

  const roundedTopPath = (x: number, yTop: number, widthPx: number, heightPx: number, radiusPx: number) => {
    const r = Math.max(0, Math.min(radiusPx, widthPx / 2, heightPx))
    const bottomY = yTop + heightPx
    if (r <= 0) {
      return `M ${x} ${bottomY} L ${x} ${yTop} L ${x + widthPx} ${yTop} L ${x + widthPx} ${bottomY} Z`
    }
    return [
      `M ${x} ${bottomY}`,
      `L ${x} ${yTop + r}`,
      `Q ${x} ${yTop} ${x + r} ${yTop}`,
      `L ${x + widthPx - r} ${yTop}`,
      `Q ${x + widthPx} ${yTop} ${x + widthPx} ${yTop + r}`,
      `L ${x + widthPx} ${bottomY}`,
      "Z",
    ].join(" ")
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div ref={chartRef} className="relative">
          {hoveredRow ? (
            <div
              className="pointer-events-none absolute z-10 w-[min(206px,calc(100%-24px))] rounded-xl border bg-background/95 px-4 py-3 shadow-xl backdrop-blur"
              style={{ left: `${tooltipLeft}px`, top: `${tooltipTop}px` }}
            >
              <div className="text-sm font-medium">{formatHoverDate(hoveredRow.date)}</div>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 text-muted-foreground">
                    <span className="inline-block size-2 rounded-full bg-slate-400" />
                    <span>Cloud</span>
                  </div>
                  <span>{formatCompactNumber(hoveredRow.cloud)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 text-muted-foreground">
                    <span className="inline-block size-2 rounded-full bg-emerald-500" />
                    <span>Local</span>
                  </div>
                  <span>{formatCompactNumber(hoveredRow.local)}</span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Total</span>
                    <span>{formatCompactNumber(hoveredRow.total)} {hoverSummaryLabel}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[320px] w-full overflow-visible"
          onMouseLeave={() => setHovered(null)}
        >
          {[0, 0.5, 1].map((tick, index) => {
            const value = maxTotal * tick
            const yPos = paddingTop + y(value)
            return (
              <g key={index}>
                <line
                  x1={paddingLeft}
                  x2={width - paddingRight}
                  y1={yPos}
                  y2={yPos}
                  stroke="currentColor"
                  className="text-border"
                  strokeDasharray={index === 0 ? undefined : "3 6"}
                />
                <text
                  x={paddingLeft}
                  y={yPos - 6}
                  fontSize="11"
                  fill="currentColor"
                  className="text-muted-foreground"
                >
                  {formatValue(value)}
                </text>
              </g>
            )
          })}
          {series.map((row, index) => {
            const x = paddingLeft + index * slotWidth + (slotWidth - barWidth) / 2
            const primaryHeight = (row.primary / maxTotal) * chartHeight
            const secondaryHeight = (row.secondary / maxTotal) * chartHeight
            const active = hovered?.date === row.date
            const topSegmentRadius = Math.min(6, barWidth / 2)
            const primaryY = paddingTop + chartHeight - primaryHeight
            const secondaryY = paddingTop + chartHeight - primaryHeight - secondaryHeight
            return (
              <g key={row.date}>
                <rect
                  x={paddingLeft + index * slotWidth}
                  y={paddingTop}
                  width={slotWidth}
                  height={chartHeight}
                  fill="transparent"
                  onMouseMove={(event) => {
                    const bounds = chartRef.current?.getBoundingClientRect()
                    if (!bounds) return
                    setHovered({
                      date: row.date,
                      x: event.clientX - bounds.left,
                      y: event.clientY - bounds.top,
                    })
                  }}
                />
                {secondaryHeight > 0 ? (
                  <rect
                    x={x}
                    y={primaryY}
                    width={barWidth}
                    height={primaryHeight}
                    fill="currentColor"
                    className={active ? "text-slate-300" : "text-slate-400"}
                  />
                ) : (
                  <path
                    d={roundedTopPath(x, primaryY, barWidth, primaryHeight, topSegmentRadius)}
                    fill="currentColor"
                    className={active ? "text-slate-300" : "text-slate-400"}
                  />
                )}
                {secondaryHeight > 0 ? (
                  <path
                    d={roundedTopPath(x, secondaryY, barWidth, secondaryHeight, topSegmentRadius)}
                    fill="currentColor"
                    className={active ? "text-emerald-400" : "text-emerald-500/85"}
                  />
                ) : null}
                {(index === 0 || index === series.length - 1 || series.length <= 10 || index % Math.ceil(series.length / 6) === 0) ? (
                  <text
                    x={x + barWidth / 2}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="11"
                    fill="currentColor"
                    className="text-muted-foreground"
                  >
                    {row.date.slice(5)}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="inline-flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-slate-400" />
          <span>Cloud usage</span>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-emerald-500" />
          <span>Local usage</span>
        </div>
      </div>
    </div>
  )
}

function BreakdownBars(props: {
  title: string
  description: string
  rows: UsageOverviewBreakdownRow[]
}) {
  const maxValue = Math.max(...props.rows.map((row) => row.benchmarkEquivalentCostUsd || row.totalTokens), 0)
  return (
    <Card className="gap-0">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.rows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            No usage yet.
          </div>
        ) : (
          props.rows.map((row) => {
            const width = maxValue > 0 ? ((row.benchmarkEquivalentCostUsd || row.totalTokens) / maxValue) * 100 : 0
            return (
              <div key={`${row.provider}:${row.model ?? "provider"}`} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{row.label}</span>
                    <Badge variant={row.local ? "default" : "outline"}>{row.local ? "Local" : "Cloud"}</Badge>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <div>{formatCompactNumber(row.totalTokens)} tokens</div>
                    <div>{formatCompactUsd(row.actualCostUsd)} actual</div>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="flex h-full">
                    <div
                      className="bg-slate-400"
                      style={{
                        width: `${Math.max(2, width * (row.actualCostUsd / Math.max(row.benchmarkEquivalentCostUsd, 0.0001))) }%`,
                      }}
                    />
                    {row.estimatedSavingsUsd > 0 ? (
                      <div
                        className="bg-emerald-500"
                        style={{
                          width: `${Math.max(
                            2,
                            width * (row.estimatedSavingsUsd / Math.max(row.benchmarkEquivalentCostUsd, 0.0001)),
                          )}%`,
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

function AgentTable(props: { rows: UsageOverviewResponse["byAgent"] }) {
  return (
    <Card className="gap-0">
      <CardHeader>
        <CardTitle>Top agents</CardTitle>
        <CardDescription>How usage is distributed across your specialist team.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.rows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            No agent usage yet.
          </div>
        ) : (
          props.rows.slice(0, 8).map((row) => (
            <div
              key={row.agentId}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{row.agentName}</div>
                <div className="text-sm text-muted-foreground">
                  {formatCompactNumber(row.requests)} requests · {formatCompactNumber(row.totalTokens)} tokens
                </div>
              </div>
              <div className="text-right text-sm">
                <div>{formatCompactUsd(row.actualCostUsd)}</div>
                {row.estimatedSavingsUsd > 0 ? (
                  <div className="text-emerald-600 dark:text-emerald-400">
                    +{formatCompactUsd(row.estimatedSavingsUsd)} saved
                  </div>
                ) : (
                  <div className="text-muted-foreground">{formatPercent(row.localTokens / Math.max(1, row.totalTokens))} local</div>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function UsagePage() {
  const range = useDateRangeState(7)
  const [metric, setMetric] = useState<UsageMetric>("tokens")
  const [pricingSheetOpen, setPricingSheetOpen] = useState(false)
  const [selectedPricingModelRef, setSelectedPricingModelRef] = useState("")
  const [pricingForm, setPricingForm] = useState<{
    input: string
    output: string
    cacheRead: string
    cacheWrite: string
  }>({
    input: "",
    output: "",
    cacheRead: "",
    cacheWrite: "",
  })
  const usage = useUsageOverview({
    startDate: range.appliedStartDate,
    endDate: range.appliedEndDate,
  })
  const pricing = useUsagePricing()
  const updatePricing = useUpdateUsagePricing()

  const summary = usage.data
  const showsFlatRateBillingWarning = useMemo(
    () =>
      (summary?.byProvider ?? []).some((row) => row.provider === "openai-codex") ||
      summary?.benchmarkModel?.provider === "openai-codex",
    [summary],
  )
  const providerRows = useMemo(
    () => (summary?.byProvider ?? []).slice(0, 6),
    [summary?.byProvider],
  )
  const modelRows = useMemo(
    () => (summary?.byModel ?? []).slice(0, 8),
    [summary?.byModel],
  )

  useEffect(() => {
    if (!pricing.data) return
    setSelectedPricingModelRef(`${pricing.data.benchmarkModel.provider}/${pricing.data.benchmarkModel.model}`)
    setPricingForm({
      input: String(pricing.data.cost.input),
      output: String(pricing.data.cost.output),
      cacheRead: String(pricing.data.cost.cacheRead),
      cacheWrite: String(pricing.data.cost.cacheWrite),
    })
  }, [pricing.data])

  const selectedPricingModel = useMemo(() => {
    if (!pricing.data) return null
    return (
      pricing.data.models.find(
        (entry) => `${entry.provider}/${entry.model}` === selectedPricingModelRef,
      ) ?? pricing.data.models[0] ?? null
    )
  }, [pricing.data, selectedPricingModelRef])

  useEffect(() => {
    if (!selectedPricingModel) return
    setPricingForm({
      input: String(selectedPricingModel.cost.input),
      output: String(selectedPricingModel.cost.output),
      cacheRead: String(selectedPricingModel.cost.cacheRead),
      cacheWrite: String(selectedPricingModel.cost.cacheWrite),
    })
  }, [selectedPricingModel])

  const handlePricingFieldChange = (field: keyof typeof pricingForm, value: string) => {
    setPricingForm((current) => ({ ...current, [field]: value }))
  }

  const parsePricingValue = (value: string): number => {
    const normalized = Number.parseFloat(value.trim())
    return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0
  }

  const pricingHasChanges = selectedPricingModel
    ? (
        parsePricingValue(pricingForm.input) !== selectedPricingModel.cost.input ||
        parsePricingValue(pricingForm.output) !== selectedPricingModel.cost.output ||
        parsePricingValue(pricingForm.cacheRead) !== selectedPricingModel.cost.cacheRead ||
        parsePricingValue(pricingForm.cacheWrite) !== selectedPricingModel.cost.cacheWrite
      )
    : false

  const savePricing = () => {
    if (!selectedPricingModel) return
    const cost: UsagePricingCost = {
      input: parsePricingValue(pricingForm.input),
      output: parsePricingValue(pricingForm.output),
      cacheRead: parsePricingValue(pricingForm.cacheRead),
      cacheWrite: parsePricingValue(pricingForm.cacheWrite),
    }
    updatePricing.mutate({
      provider: selectedPricingModel.provider,
      model: selectedPricingModel.model,
      cost,
    })
  }

  return (
    <PageShell className="max-w-6xl">
      <PageHeader
        title="Usage"
        description="Track token usage across providers and see how much local models are saving."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPricingSheetOpen(true)}>
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Pricing settings
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void usage.refetch()} aria-label="Refresh usage">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      />

      <Sheet open={pricingSheetOpen} onOpenChange={setPricingSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Pricing settings</SheetTitle>
            <SheetDescription>
              Choose the benchmark model and edit the per-million token prices used for usage estimates.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-6">
            {pricing.isLoading ? (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                Loading pricing…
              </div>
            ) : pricing.isError ? (
              <div className="rounded-xl border border-destructive/35 bg-destructive/5 px-4 py-4 text-sm text-destructive">
                {pricing.error instanceof Error ? pricing.error.message : "Failed to load benchmark pricing."}
              </div>
            ) : pricing.data && selectedPricingModel ? (
              <>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Benchmark model</div>
                  <Select value={selectedPricingModelRef} onValueChange={setSelectedPricingModelRef}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {pricing.data.models.map((entry) => (
                        <SelectItem key={`${entry.provider}/${entry.model}`} value={`${entry.provider}/${entry.model}`}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline">{selectedPricingModel.label}</Badge>
                    {selectedPricingModel.official ? <Badge variant="secondary">Official default</Badge> : null}
                    <a
                      href={selectedPricingModel.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Pricing source
                    </a>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium">Input / 1M tokens</span>
                    <Input
                      inputMode="decimal"
                      value={pricingForm.input}
                      onChange={(event) => handlePricingFieldChange("input", event.target.value)}
                      placeholder="2.50"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium">Output / 1M tokens</span>
                    <Input
                      inputMode="decimal"
                      value={pricingForm.output}
                      onChange={(event) => handlePricingFieldChange("output", event.target.value)}
                      placeholder="15.00"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium">Cached input / 1M</span>
                    <Input
                      inputMode="decimal"
                      value={pricingForm.cacheRead}
                      onChange={(event) => handlePricingFieldChange("cacheRead", event.target.value)}
                      placeholder="0.25"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium">Cache write / 1M</span>
                    <Input
                      inputMode="decimal"
                      value={pricingForm.cacheWrite}
                      onChange={(event) => handlePricingFieldChange("cacheWrite", event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                </div>

                <div className="space-y-3 rounded-xl border px-4 py-4">
                  <div className="text-sm text-muted-foreground">
                    Saving here both updates the selected model’s pricing and makes it the benchmark used for local-savings estimates.
                  </div>
                  <Button onClick={savePricing} disabled={!pricingHasChanges || updatePricing.isPending}>
                    {updatePricing.isPending ? "Saving…" : "Save pricing"}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* Date range controls — separate row so they don't squeeze the header */}
      <div className="flex flex-wrap items-center gap-2">
        {DAY_PRESETS.map((preset) => (
          <Button
            key={preset.days}
            variant={range.presetDays === preset.days ? "default" : "outline"}
            size="sm"
            onClick={() => range.applyPreset(preset.days)}
          >
            {preset.label}
          </Button>
        ))}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Input
            type="date"
            className="h-8 w-auto min-w-0 text-sm"
            value={range.draftStartDate}
            onChange={(event) => range.setDraftStartDate(event.target.value)}
          />
          <span>&ndash;</span>
          <Input
            type="date"
            className="h-8 w-auto min-w-0 text-sm"
            value={range.draftEndDate}
            onChange={(event) => range.setDraftEndDate(event.target.value)}
          />
          <Button size="sm" variant="outline" onClick={range.applyCustom}>Apply</Button>
        </div>
      </div>

      {usage.isLoading ? (
        <PageLoading variant="spinner" message="Loading usage data..." />
      ) : (
      <>

      {usage.isError ? (
        <Card className="gap-0 border-destructive/35 bg-destructive/5">
          <CardContent className="px-5 py-5 text-sm text-destructive">
            {usage.error instanceof Error ? usage.error.message : "Failed to load usage overview."}
          </CardContent>
        </Card>
      ) : null}

      {showsFlatRateBillingWarning ? (
        <Card className="gap-0 border-amber-500/30 bg-amber-500/5">
          <CardContent className="px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            Codex OAuth can be flat-rate. These spend numbers are token-based estimates and may overstate actual billed cost on subscription plans.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          icon={DollarSign}
          label="Actual spend"
          value={formatCompactUsd(summary?.totals.actualCostUsd ?? 0)}
          sublabel="Provider-billed cost"
        />
        <MetricCard
          icon={Coins}
          label="Estimated saved"
          value={formatCompactUsd(summary?.totals.estimatedSavingsUsd ?? 0)}
          valueClassName="text-emerald-600 dark:text-emerald-400"
          sublabel="Local execution vs benchmark"
        />
        <MetricCard
          icon={BarChart3}
          label="Benchmark equivalent"
          value={formatCompactUsd(summary?.totals.benchmarkEquivalentCostUsd ?? 0)}
          sublabel={summary?.benchmarkModel ? summary.benchmarkModel.label : "No cloud benchmark priced"}
        />
        <MetricCard
          icon={Cpu}
          label="Total tokens"
          value={formatCompactNumber(summary?.totals.totalTokens ?? 0)}
          sublabel={`${formatCompactNumber(summary?.totals.localTokens ?? 0)} local / ${formatCompactNumber(summary?.totals.cloudTokens ?? 0)} cloud`}
        />
        <MetricCard
          icon={Cloud}
          label="Local share"
          value={formatPercent(summary?.totals.localShare ?? 0)}
          sublabel={`${formatCompactNumber(summary?.totals.localRequests ?? 0)} local requests / ${formatCompactNumber(summary?.totals.cloudRequests ?? 0)} cloud`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2.2fr)_minmax(280px,0.9fr)]">
        <Card className="gap-0">
          <CardHeader>
            <CardTitle>Daily usage</CardTitle>
            <CardDescription>
              {metric === "tokens"
                ? "Token volume split between cloud and local execution."
                : "Request volume split between cloud and local execution."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {([
                ["tokens", "Tokens"],
                ["requests", "Requests"],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  variant={metric === value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMetric(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <UsageStackedBars rows={summary?.daily ?? []} metric={metric} />
          </CardContent>
        </Card>

        <Card className="gap-0">
          <CardHeader>
            <CardTitle>Usage at a glance</CardTitle>
            <CardDescription>Quick breakdown of where usage is happening right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3">
              <div className="rounded-xl border px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Requests</div>
                <div className="mt-1 text-lg font-semibold">{formatCompactNumber(summary?.totals.requestCount ?? 0)}</div>
              </div>
              <div className="rounded-xl border px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Local vs cloud</div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${Math.max(0, Math.min(100, (summary?.totals.localShare ?? 0) * 100))}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                  <span>{formatCompactNumber(summary?.totals.localTokens ?? 0)} local</span>
                  <span>{formatCompactNumber(summary?.totals.cloudTokens ?? 0)} cloud</span>
                </div>
              </div>
              <div className="rounded-xl border px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Benchmark</div>
                <div className="mt-1 text-base font-medium">
                  {summary?.benchmarkModel?.label ?? "No priced cloud benchmark configured"}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Used for estimated savings on local model runs.
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">Top providers</div>
              {providerRows.length === 0 ? (
                <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  No provider usage yet.
                </div>
              ) : (
                providerRows.map((row) => (
                  <div key={row.label} className="rounded-xl border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{row.label}</span>
                        <Badge variant={row.local ? "default" : "outline"}>{row.local ? "Local" : "Cloud"}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{formatCompactUsd(row.benchmarkEquivalentCostUsd)}</div>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {formatCompactNumber(row.totalTokens)} tokens · {formatCompactNumber(row.requests)} requests
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownBars
          title="Provider breakdown"
          description="Cloud providers show actual spend. Local providers add estimated savings against your benchmark."
          rows={summary?.byProvider ?? []}
        />
        <BreakdownBars
          title="Model breakdown"
          description="Which exact models are consuming the most tokens and where local usage offsets cloud cost."
          rows={modelRows}
        />
      </div>

      <AgentTable rows={summary?.byAgent ?? []} />

      <Card className="gap-0">
        <CardHeader>
          <CardTitle>Methodology</CardTitle>
          <CardDescription>How to read the numbers on this page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <div className="rounded-xl border px-4 py-4">
            <div className="mb-2 font-medium">Actual spend</div>
            <div className="text-sm text-muted-foreground">
              Direct provider cost from the usage logs. Local providers typically report zero direct spend here.
            </div>
          </div>
          <div className="rounded-xl border px-4 py-4">
            <div className="mb-2 font-medium">Estimated local savings</div>
            <div className="text-sm text-muted-foreground">
              Approximation of what local input/output tokens would have cost on the benchmark cloud model.
            </div>
          </div>
          <div className="rounded-xl border px-4 py-4">
            <div className="mb-2 font-medium">Benchmark equivalent</div>
            <div className="text-sm text-muted-foreground">
              Actual spend plus estimated local savings. Useful for seeing what local execution avoided.
            </div>
          </div>
        </CardContent>
      </Card>
      </>
      )}
    </PageShell>
  )
}
