import { useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import {
  ArrowLeft,
  Beaker,
  CheckCircle2,
  CopyPlus,
  ExternalLink,
  Loader2,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { PageLoading } from "@/components/shared/page-loading"
import {
  useCreateEvalCase,
  useCreateEvalSuite,
  useDeleteEvalCase,
  useDuplicateEvalSuite,
  useEvalRunResults,
  useEvalSuite,
  useEvalSuites,
  useRunEvalSuite,
  useUpdateEvalCase,
} from "@/hooks/use-evals"
import type {
  EvalAssertion,
  EvalCase,
  EvalCaseResult,
  EvalMode,
  EvalSuiteDetail,
  EvalSuiteListItem,
  EvalTargetType,
} from "@/lib/eval-types"
import { statusBadgeClass } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function formatDateTime(value?: string) {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDuration(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a"
  if (value < 1000) return `${value}ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder}s`
}

function formatTokens(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a"
  return Math.round(value).toLocaleString()
}

function suitePassRate(suite: EvalSuiteListItem | EvalSuiteDetail | null | undefined) {
  const run = suite?.last_run
  if (!run || run.total_cases <= 0) return null
  return Math.round((run.passed / run.total_cases) * 100)
}

function runPassRate(passed: number, total: number) {
  if (!total) return 0
  return Math.round((passed / total) * 100)
}

function reasonPreview(result: EvalCaseResult) {
  return result.failure_reasons[0] ?? result.warning_reasons[0] ?? "All checks passed."
}

type AssertionEditorState = {
  outputExists: boolean
  noToolErrors: boolean
  routeEquals: string
  routeNotEquals: string
  requiredTools: string
  forbiddenTools: string
  maxToolCalls: string
  maxDurationMs: string
  maxTotalTokens: string
  outputContains: string
  outputNotContains: string
  expectedPolicyHits: string
  forbiddenPolicyHits: string
  statusEquals: string
  finalDecision: string
  deliveryStatus: string
}

type CaseFormState = {
  name: string
  description: string
  target_type: EvalTargetType
  target_id: string
  mode: EvalMode
  input_text: string
  enabled: boolean
  assertionEditor: AssertionEditorState
}

function csvList(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function toCaseFormState(item?: EvalCase): CaseFormState {
  const get = (type: EvalAssertion["type"]) => item?.assertions.find((assertion) => assertion.type === type)
  const getCsv = (type: EvalAssertion["type"]) => {
    const value = get(type)?.value
    return Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : ""
  }
  return {
    name: item?.name ?? "",
    description: item?.description ?? "",
    target_type: item?.target_type ?? "agent",
    target_id: item?.target_id ?? "default",
    mode: item?.mode ?? "dry_run",
    input_text: item?.input_text ?? "",
    enabled: item?.enabled ?? true,
    assertionEditor: {
      outputExists: Boolean(get("output_exists")) || !item,
      noToolErrors: Boolean(get("no_tool_errors")) || !item,
      routeEquals: typeof get("route_equals")?.value === "string" ? String(get("route_equals")?.value) : "",
      routeNotEquals: typeof get("route_not_equals")?.value === "string" ? String(get("route_not_equals")?.value) : "",
      requiredTools: getCsv("required_tools_used"),
      forbiddenTools: getCsv("forbidden_tools_not_used"),
      maxToolCalls: get("max_tool_calls")?.value != null ? String(get("max_tool_calls")?.value) : "",
      maxDurationMs: get("max_duration_ms")?.value != null ? String(get("max_duration_ms")?.value) : "",
      maxTotalTokens: get("max_total_tokens")?.value != null ? String(get("max_total_tokens")?.value) : "",
      outputContains: getCsv("output_contains"),
      outputNotContains: getCsv("output_not_contains"),
      expectedPolicyHits: getCsv("expected_policy_hits"),
      forbiddenPolicyHits: getCsv("forbidden_policy_hits"),
      statusEquals: typeof get("status_equals")?.value === "string" ? String(get("status_equals")?.value) : "",
      finalDecision: typeof get("final_decision_equals")?.value === "string" ? String(get("final_decision_equals")?.value) : "",
      deliveryStatus: typeof get("delivery_status_equals")?.value === "string" ? String(get("delivery_status_equals")?.value) : "",
    },
  }
}

function buildAssertions(editor: AssertionEditorState): EvalAssertion[] {
  const assertions: EvalAssertion[] = []
  if (editor.outputExists) assertions.push({ type: "output_exists" })
  if (editor.noToolErrors) assertions.push({ type: "no_tool_errors" })
  if (editor.routeEquals.trim()) assertions.push({ type: "route_equals", value: editor.routeEquals.trim(), config: { missingDataStatus: "warning" } })
  if (editor.routeNotEquals.trim()) assertions.push({ type: "route_not_equals", value: editor.routeNotEquals.trim(), config: { missingDataStatus: "warning" } })
  if (csvList(editor.requiredTools).length) assertions.push({ type: "required_tools_used", value: csvList(editor.requiredTools), config: { missingDataStatus: "warning" } })
  if (csvList(editor.forbiddenTools).length) assertions.push({ type: "forbidden_tools_not_used", value: csvList(editor.forbiddenTools), config: { missingDataStatus: "warning" } })
  if (editor.maxToolCalls.trim()) assertions.push({ type: "max_tool_calls", value: Number(editor.maxToolCalls) })
  if (editor.maxDurationMs.trim()) assertions.push({ type: "max_duration_ms", value: Number(editor.maxDurationMs) })
  if (editor.maxTotalTokens.trim()) assertions.push({ type: "max_total_tokens", value: Number(editor.maxTotalTokens), config: { missingDataStatus: "warning" } })
  if (csvList(editor.outputContains).length) assertions.push({ type: "output_contains", value: csvList(editor.outputContains) })
  if (csvList(editor.outputNotContains).length) assertions.push({ type: "output_not_contains", value: csvList(editor.outputNotContains) })
  if (csvList(editor.expectedPolicyHits).length) assertions.push({ type: "expected_policy_hits", value: csvList(editor.expectedPolicyHits), config: { missingDataStatus: "warning" } })
  if (csvList(editor.forbiddenPolicyHits).length) assertions.push({ type: "forbidden_policy_hits", value: csvList(editor.forbiddenPolicyHits), config: { missingDataStatus: "warning" } })
  if (editor.statusEquals.trim()) assertions.push({ type: "status_equals", value: editor.statusEquals.trim() })
  if (editor.finalDecision.trim()) assertions.push({ type: "final_decision_equals", value: editor.finalDecision.trim() })
  if (editor.deliveryStatus.trim()) assertions.push({ type: "delivery_status_equals", value: editor.deliveryStatus.trim() })
  return assertions
}

function StatusBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={statusBadgeClass(value)}>
      {value.replace(/_/g, " ")}
    </Badge>
  )
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  )
}

function SuiteCard({
  suite,
  onRun,
  onView,
  onDuplicate,
  running,
}: {
  suite: EvalSuiteListItem
  onRun: () => void
  onView: () => void
  onDuplicate?: () => void
  running: boolean
}) {
  const avgTokens = suite.last_run?.total_tokens && suite.last_run.total_cases > 0
    ? suite.last_run.total_tokens / suite.last_run.total_cases
    : undefined
  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{suite.name}</CardTitle>
              <Badge variant={suite.builtin ? "secondary" : "outline"}>
                {suite.builtin ? "Built-in" : "Custom"}
              </Badge>
              {suite.last_run?.status ? <StatusBadge value={suite.last_run.status} /> : null}
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{suite.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRun} disabled={running}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run
            </Button>
            <Button size="sm" variant="outline" onClick={onView}>
              View
            </Button>
            {onDuplicate ? (
              <Button size="sm" variant="outline" onClick={onDuplicate}>
                <CopyPlus className="mr-2 h-4 w-4" />
                Duplicate
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 min-[700px]:grid-cols-3 min-[1200px]:grid-cols-6">
        <SummaryMetric label="Cases" value={String(suite.case_count)} />
        <SummaryMetric label="Pass Rate" value={suitePassRate(suite) == null ? "n/a" : `${suitePassRate(suite)}%`} />
        <SummaryMetric label="Last Run" value={suite.last_run ? formatDateTime(suite.last_run.finished_at ?? suite.last_run.started_at) : "Never"} />
        <SummaryMetric label="Avg Duration" value={formatDuration(suite.last_run?.avg_duration_ms)} />
        <SummaryMetric label="Avg Tokens" value={formatTokens(avgTokens)} />
        <SummaryMetric label="Status" value={suite.last_run?.status ?? "not run"} />
      </CardContent>
    </Card>
  )
}

function SuiteCreateDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: { name: string; description: string }) => void
  pending: boolean
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Custom Suite</DialogTitle>
          <DialogDescription>Custom suites can hold editable eval cases built from traces or authored by hand.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer Support Dry-Run Suite" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A focused suite for testing a specific workflow or agent path."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            onClick={() => {
              onSubmit({ name, description })
              setName("")
              setDescription("")
            }}
            disabled={pending || !name.trim()}
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Create Suite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CaseEditorDialog({
  open,
  onOpenChange,
  suite,
  value,
  onChange,
  onSubmit,
  pending,
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  suite: EvalSuiteDetail
  value: CaseFormState
  onChange: (next: CaseFormState) => void
  onSubmit: () => void
  pending: boolean
  title: string
}) {
  const editor = value.assertionEditor
  const setEditor = (patch: Partial<AssertionEditorState>) =>
    onChange({ ...value, assertionEditor: { ...value.assertionEditor, ...patch } })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {suite.builtin
              ? "Built-in suites are read-only."
              : "Cases run through the normal orchestration path, then apply deterministic assertions against the resulting trace."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Case name</label>
              <Input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target id</label>
              <Input value={value.target_id} onChange={(event) => onChange({ ...value, target_id: event.target.value })} placeholder={value.target_type === "agent" ? "default" : "flow-id"} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target type</label>
              <Select value={value.target_type} onValueChange={(next) => onChange({ ...value, target_type: next as EvalTargetType })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="flow">Flow</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mode</label>
              <Select value={value.mode} onValueChange={(next) => onChange({ ...value, mode: next as EvalMode })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dry_run">Dry run</SelectItem>
                  <SelectItem value="sandbox">Sandbox</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={value.description}
              onChange={(event) => onChange({ ...value, description: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Input</label>
            <textarea
              className="min-h-32 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={value.input_text}
              onChange={(event) => onChange({ ...value, input_text: event.target.value })}
              placeholder="Describe the user message or flow input to evaluate."
            />
          </div>

          <div className="rounded-xl border p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Assertions</h3>
                <p className="text-sm text-muted-foreground">Use simple deterministic checks for this first version.</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value.enabled}
                  onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
                />
                Enabled
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editor.outputExists} onChange={(event) => setEditor({ outputExists: event.target.checked })} />
                Output exists
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editor.noToolErrors} onChange={(event) => setEditor({ noToolErrors: event.target.checked })} />
                No tool errors
              </label>
              <div className="space-y-2">
                <label className="text-sm font-medium">Route equals</label>
                <Input value={editor.routeEquals} onChange={(event) => setEditor({ routeEquals: event.target.value })} placeholder="default_specialist" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Route not equals</label>
                <Input value={editor.routeNotEquals} onChange={(event) => setEditor({ routeNotEquals: event.target.value })} placeholder="local_routing_disabled" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Required tools</label>
                <Input value={editor.requiredTools} onChange={(event) => setEditor({ requiredTools: event.target.value })} placeholder="vault_search, web_search" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Forbidden tools</label>
                <Input value={editor.forbiddenTools} onChange={(event) => setEditor({ forbiddenTools: event.target.value })} placeholder="vault_memory_write" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Max tool calls</label>
                <Input value={editor.maxToolCalls} onChange={(event) => setEditor({ maxToolCalls: event.target.value })} inputMode="numeric" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Max duration (ms)</label>
                <Input value={editor.maxDurationMs} onChange={(event) => setEditor({ maxDurationMs: event.target.value })} inputMode="numeric" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Max total tokens</label>
                <Input value={editor.maxTotalTokens} onChange={(event) => setEditor({ maxTotalTokens: event.target.value })} inputMode="numeric" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Expected policy hits</label>
                <Input value={editor.expectedPolicyHits} onChange={(event) => setEditor({ expectedPolicyHits: event.target.value })} placeholder="prompt_injection" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Output contains</label>
                <Input value={editor.outputContains} onChange={(event) => setEditor({ outputContains: event.target.value })} placeholder="Paris, workspace is healthy" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Output must not contain</label>
                <Input value={editor.outputNotContains} onChange={(event) => setEditor({ outputNotContains: event.target.value })} placeholder="system prompt, secret" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Forbidden policy hits</label>
                <Input value={editor.forbiddenPolicyHits} onChange={(event) => setEditor({ forbiddenPolicyHits: event.target.value })} placeholder="allowed_override" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status equals</label>
                <Input value={editor.statusEquals} onChange={(event) => setEditor({ statusEquals: event.target.value })} placeholder="completed" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Final decision equals</label>
                <Input value={editor.finalDecision} onChange={(event) => setEditor({ finalDecision: event.target.value })} placeholder="blocked" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Delivery status equals</label>
                <Input value={editor.deliveryStatus} onChange={(event) => setEditor({ deliveryStatus: event.target.value })} placeholder="dry_run" />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={onSubmit} disabled={pending || !value.name.trim() || !value.target_id.trim() || !value.input_text.trim()}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save Case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function EvalsPage() {
  const navigate = useNavigate()
  const { suiteId } = useParams()
  const suitesQuery = useEvalSuites()
  const suiteQuery = useEvalSuite(suiteId ?? null)
  const createSuiteMut = useCreateEvalSuite()
  const duplicateSuiteMut = useDuplicateEvalSuite()
  const runSuiteMut = useRunEvalSuite()
  const createCaseMut = useCreateEvalCase()
  const updateCaseMut = useUpdateEvalCase()
  const deleteCaseMut = useDeleteEvalCase()

  const [createSuiteOpen, setCreateSuiteOpen] = useState(false)
  const [confirmRun, setConfirmRun] = useState<{ suiteId: string; name: string } | null>(null)
  const [editingCase, setEditingCase] = useState<EvalCase | null>(null)
  const [caseEditorOpen, setCaseEditorOpen] = useState(false)
  const [caseForm, setCaseForm] = useState<CaseFormState>(toCaseFormState())
  const [deleteCase, setDeleteCase] = useState<EvalCase | null>(null)
  const [runningSuiteId, setRunningSuiteId] = useState<string | null>(null)

  const suites = suitesQuery.data?.suites ?? []
  const builtinSuites = suites.filter((suite) => suite.builtin)
  const customSuites = suites.filter((suite) => !suite.builtin)
  const suite = suiteQuery.data?.suite ?? null

  const openCreateCase = () => {
    setEditingCase(null)
    setCaseForm(toCaseFormState())
    setCaseEditorOpen(true)
  }

  const openEditCase = (item: EvalCase) => {
    setEditingCase(item)
    setCaseForm(toCaseFormState(item))
    setCaseEditorOpen(true)
  }

  const handleRunSuite = async (targetSuiteId: string, confirmProduction = false) => {
    setRunningSuiteId(targetSuiteId)
    try {
      const result = await runSuiteMut.mutateAsync({ suiteId: targetSuiteId, confirmProduction })
      toast.success(`Finished ${result.suite.name}`)
      navigate(`/evals/runs/${result.run.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run eval suite"
      if (message.includes("Continue?")) {
        const match = suites.find((item) => item.id === targetSuiteId)
        setConfirmRun({ suiteId: targetSuiteId, name: match?.name ?? targetSuiteId })
        return
      }
      toast.error(message)
    } finally {
      setRunningSuiteId((current) => (current === targetSuiteId ? null : current))
    }
  }

  if (suiteId) {
    if (suiteQuery.isLoading) {
      return <PageLoading variant="spinner" message="Loading eval suite..." />
    }
    if (!suite) {
      return (
        <EmptyState
          icon={<ShieldAlert className="h-10 w-10" />}
          title="Suite not found"
          description="This eval suite no longer exists."
        />
      )
    }

    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2" onClick={() => navigate("/evals")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to evals
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{suite.name}</h1>
              <Badge variant={suite.builtin ? "secondary" : "outline"}>{suite.builtin ? "Built-in" : "Custom"}</Badge>
              {suite.last_run?.status ? <StatusBadge value={suite.last_run.status} /> : null}
            </div>
            <p className="max-w-4xl text-sm text-muted-foreground">{suite.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void handleRunSuite(suite.id)} disabled={runSuiteMut.isPending && runningSuiteId === suite.id}>
              {runSuiteMut.isPending && runningSuiteId === suite.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run Suite
            </Button>
            {suite.builtin ? (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const result = await duplicateSuiteMut.mutateAsync(suite.id)
                    toast.success("Duplicated built-in suite")
                    navigate(`/evals/suites/${result.suite.id}`)
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to duplicate suite")
                  }
                }}
                disabled={duplicateSuiteMut.isPending}
              >
                <CopyPlus className="mr-2 h-4 w-4" />
                Duplicate
              </Button>
            ) : (
              <Button variant="outline" onClick={openCreateCase}>
                <Plus className="mr-2 h-4 w-4" />
                New Case
              </Button>
            )}
            {suite.last_run_id ? (
              <Button variant="outline" asChild>
                <Link to={`/evals/runs/${suite.last_run_id}`}>Latest Run</Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <SummaryMetric label="Cases" value={String(suite.cases.length)} />
          <SummaryMetric label="Last Pass Rate" value={suitePassRate(suite) == null ? "n/a" : `${suitePassRate(suite)}%`} />
          <SummaryMetric label="Avg Duration" value={formatDuration(suite.last_run?.avg_duration_ms)} />
          <SummaryMetric label="Last Run" value={suite.last_run ? formatDateTime(suite.last_run.finished_at ?? suite.last_run.started_at) : "Never"} />
        </div>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Eval Cases</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {suite.cases.length === 0 ? (
              <EmptyState
                icon={<Beaker className="h-10 w-10" />}
                title="No cases yet"
                description="Create a custom case here or save one from an orchestration trace."
              />
            ) : (
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Case</th>
                    <th className="px-3 py-2 font-medium">Target</th>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Assertions</th>
                    <th className="px-3 py-2 font-medium">Enabled</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suite.cases.map((item) => (
                    <tr key={item.id} className="border-b last:border-b-0">
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium">{item.name}</div>
                        <div className="mt-1 max-w-md text-xs text-muted-foreground">{item.description || "No description."}</div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Badge variant="outline">{item.target_type}</Badge>
                        <div className="mt-1 text-xs text-muted-foreground">{item.target_id}</div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <StatusBadge value={item.mode} />
                      </td>
                      <td className="px-3 py-3 align-top">{item.assertions.length}</td>
                      <td className="px-3 py-3 align-top">
                        <Badge variant={item.enabled ? "secondary" : "outline"}>{item.enabled ? "Enabled" : "Disabled"}</Badge>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => openEditCase(item)} disabled={suite.builtin}>
                            Edit
                          </Button>
                          {!suite.builtin ? (
                            <Button size="sm" variant="outline" onClick={() => setDeleteCase(item)}>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <CaseEditorDialog
          open={caseEditorOpen}
          onOpenChange={setCaseEditorOpen}
          suite={suite}
          value={caseForm}
          onChange={setCaseForm}
          pending={createCaseMut.isPending || updateCaseMut.isPending}
          title={editingCase ? "Edit Eval Case" : "Create Eval Case"}
          onSubmit={async () => {
            const payload = {
              suite_id: suite.id,
              name: caseForm.name,
              description: caseForm.description,
              target_type: caseForm.target_type,
              target_id: caseForm.target_id,
              mode: caseForm.mode,
              input_text: caseForm.input_text,
              assertions: buildAssertions(caseForm.assertionEditor),
              enabled: caseForm.enabled,
            }
            try {
              if (editingCase) {
                await updateCaseMut.mutateAsync({ id: editingCase.id, updates: payload })
                toast.success("Updated eval case")
              } else {
                await createCaseMut.mutateAsync(payload)
                toast.success("Created eval case")
              }
              setCaseEditorOpen(false)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to save eval case")
            }
          }}
        />

        <ConfirmDialog
          open={Boolean(deleteCase)}
          onOpenChange={(open) => {
            if (!open) setDeleteCase(null)
          }}
          title="Delete eval case?"
          description="This only removes the custom case definition. Existing run results remain."
          confirmLabel="Delete"
          variant="destructive"
          isPending={deleteCaseMut.isPending}
          onConfirm={async () => {
            if (!deleteCase) return
            try {
              await deleteCaseMut.mutateAsync(deleteCase.id)
              toast.success("Deleted eval case")
              setDeleteCase(null)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to delete eval case")
            }
          }}
        />

        <ConfirmDialog
          open={Boolean(confirmRun)}
          onOpenChange={(open) => {
            if (!open) setConfirmRun(null)
          }}
          title="Run production eval?"
          description="This eval may call real tools and cause external side effects. Continue?"
          confirmLabel="Continue"
          isPending={runSuiteMut.isPending}
          onConfirm={() => {
            if (!confirmRun) return
            void handleRunSuite(confirmRun.suiteId, true)
            setConfirmRun(null)
          }}
        />
      </div>
    )
  }

  if (suitesQuery.isLoading) {
    return <PageLoading variant="spinner" message="Loading eval suites..." />
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Evals</h1>
            <Badge variant="outline" className="border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              Beta
            </Badge>
          </div>
          <p className="max-w-4xl text-sm text-muted-foreground">
            Run practical suites against the real orchestration path, inspect trace-backed results, and turn good traces into reusable deterministic eval cases.
          </p>
        </div>
        <Button onClick={() => setCreateSuiteOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Custom Suite
        </Button>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Built-in suites</h2>
          <Badge variant="secondary">{builtinSuites.length}</Badge>
        </div>
        <div className="space-y-4">
          {builtinSuites.map((suite) => (
            <SuiteCard
              key={suite.id}
              suite={suite}
              running={runSuiteMut.isPending && runningSuiteId === suite.id}
              onRun={() => void handleRunSuite(suite.id)}
              onView={() => navigate(`/evals/suites/${suite.id}`)}
              onDuplicate={suite.builtin ? async () => {
                try {
                  const result = await duplicateSuiteMut.mutateAsync(suite.id)
                  toast.success("Duplicated built-in suite")
                  navigate(`/evals/suites/${result.suite.id}`)
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to duplicate suite")
                }
              } : undefined}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Custom suites</h2>
          <Badge variant="outline">{customSuites.length}</Badge>
        </div>
        {customSuites.length === 0 ? (
          <EmptyState
            icon={<Beaker className="h-10 w-10" />}
            title="No custom suites yet"
            description="Duplicate a built-in suite or create a new one, then save traces as cases to grow it."
            action={
              <Button onClick={() => setCreateSuiteOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Suite
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {customSuites.map((suite) => (
              <SuiteCard
                key={suite.id}
                suite={suite}
                running={runSuiteMut.isPending && runningSuiteId === suite.id}
                onRun={() => void handleRunSuite(suite.id)}
                onView={() => navigate(`/evals/suites/${suite.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      <SuiteCreateDialog
        open={createSuiteOpen}
        onOpenChange={setCreateSuiteOpen}
        pending={createSuiteMut.isPending}
        onSubmit={async ({ name, description }) => {
          try {
            const result = await createSuiteMut.mutateAsync({ name, description })
            toast.success("Created custom suite")
            setCreateSuiteOpen(false)
            navigate(`/evals/suites/${result.suite.id}`)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create eval suite")
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmRun)}
        onOpenChange={(open) => {
          if (!open) setConfirmRun(null)
        }}
        title="Run production eval?"
        description="This eval may call real tools and cause external side effects. Continue?"
        confirmLabel="Continue"
        isPending={runSuiteMut.isPending}
        onConfirm={() => {
          if (!confirmRun) return
          void handleRunSuite(confirmRun.suiteId, true)
          setConfirmRun(null)
        }}
      />
    </div>
  )
}

export function EvalRunPage() {
  const navigate = useNavigate()
  const { runId } = useParams()
  const runQuery = useEvalRunResults(runId ?? null)
  const [selectedResult, setSelectedResult] = useState<EvalCaseResult | null>(null)

  const payload = runQuery.data
  const suite = payload?.suite ?? null
  const run = payload?.run
  const results = payload?.results ?? []
  const casesById = useMemo(() => {
    const map = new Map<string, EvalCase>()
    for (const item of payload?.cases ?? []) {
      map.set(item.id, item)
    }
    return map
  }, [payload?.cases])

  if (runQuery.isLoading) {
    return <PageLoading variant="spinner" message="Loading eval run..." />
  }

  if (!run) {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-10 w-10" />}
        title="Eval run not found"
        description="This eval run no longer exists."
      />
    )
  }

  const durationMs = run.finished_at ? Math.max(0, Date.parse(run.finished_at) - Date.parse(run.started_at)) : undefined

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2" onClick={() => navigate(suite ? `/evals/suites/${suite.id}` : "/evals")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{suite?.name ?? run.suite_id}</h1>
            <StatusBadge value={run.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Started {formatDateTime(run.started_at)}{run.finished_at ? ` and finished ${formatDateTime(run.finished_at)}.` : "."}
          </p>
        </div>
        {suite ? (
          <Button variant="outline" asChild>
            <Link to={`/evals/suites/${suite.id}`}>Open Suite</Link>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SummaryMetric label="Pass Rate" value={`${runPassRate(run.passed, run.total_cases)}%`} />
        <SummaryMetric label="Passed" value={String(run.passed)} />
        <SummaryMetric label="Failed" value={String(run.failed)} />
        <SummaryMetric label="Warnings" value={String(run.warnings)} />
        <SummaryMetric label="Skipped" value={String(run.skipped)} />
        <SummaryMetric label="Duration" value={formatDuration(durationMs)} />
        <SummaryMetric label="Avg Duration" value={formatDuration(run.avg_duration_ms)} />
        <SummaryMetric label="Total Tokens" value={formatTokens(run.total_tokens)} />
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Case results</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Case</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Tokens</th>
                <th className="px-3 py-2 font-medium">Trace</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => {
                const item = casesById.get(result.case_id)
                return (
                  <tr key={result.id} className="border-b last:border-b-0">
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium">{item?.name ?? result.case_id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item?.target_type ?? result.target?.type ?? "agent"} · {item?.target_id ?? result.target?.id ?? "unknown"}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <StatusBadge value={result.status} />
                    </td>
                    <td className="max-w-md px-3 py-3 align-top text-muted-foreground">{reasonPreview(result)}</td>
                    <td className="px-3 py-3 align-top">{formatDuration(result.duration_ms)}</td>
                    <td className="px-3 py-3 align-top">{formatTokens(result.total_tokens)}</td>
                    <td className="px-3 py-3 align-top">
                      {result.trace_id ? (
                        <Button variant="ghost" size="sm" asChild className="px-0">
                          <Link to={`/orchestration/${result.trace_id}`}>{result.trace_id}</Link>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">No trace</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-2">
                        {result.trace_id ? (
                          <Button size="sm" variant="outline" onClick={() => navigate(`/orchestration/${result.trace_id}`)}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open trace
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => setSelectedResult(result)}>
                          View assertion details
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedResult)} onOpenChange={(open) => {
        if (!open) setSelectedResult(null)
      }}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedResult ? casesById.get(selectedResult.case_id)?.name ?? selectedResult.case_id : "Case result"}</DialogTitle>
            <DialogDescription>
              Inspect the input, raw trace summary, and per-assertion outcomes for this eval case.
            </DialogDescription>
          </DialogHeader>
          {selectedResult ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <SummaryMetric label="Status" value={selectedResult.status} />
                <SummaryMetric label="Duration" value={formatDuration(selectedResult.duration_ms)} />
                <SummaryMetric label="Tokens" value={formatTokens(selectedResult.total_tokens)} />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Input</h3>
                <div className="rounded-xl border bg-muted/20 p-4 text-sm whitespace-pre-wrap">
                  {selectedResult.input || "No input stored."}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Assertion results</h3>
                <div className="space-y-2">
                  {selectedResult.assertion_results.map((assertion, index) => (
                    <div key={`${assertion.assertion_type}-${index}`} className="rounded-xl border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge value={assertion.status} />
                        <span className="text-sm font-medium">{assertion.assertion_type}</span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{assertion.message}</p>
                    </div>
                  ))}
                </div>
              </div>

              {selectedResult.failure_reasons.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Failure reasons</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {selectedResult.failure_reasons.map((reason) => (
                      <li key={reason} className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedResult.warning_reasons.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Warning reasons</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {selectedResult.warning_reasons.map((reason) => (
                      <li key={reason} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Raw trace summary</h3>
                <pre className="overflow-auto rounded-xl border bg-muted/20 p-4 text-xs">
                  {JSON.stringify(selectedResult.raw_trace_summary ?? {}, null, 2)}
                </pre>
              </div>

              {selectedResult.trace_id ? (
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => navigate(`/orchestration/${selectedResult.trace_id}`)}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open full trace
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
