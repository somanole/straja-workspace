export type EvalTargetType = "agent" | "flow"
export type EvalMode = "dry_run" | "sandbox" | "production"
export type EvalRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled"
export type EvalCaseStatus = "passed" | "failed" | "warning" | "skipped" | "error"

export type EvalAssertionType =
  | "status_equals"
  | "route_equals"
  | "route_not_equals"
  | "required_tools_used"
  | "forbidden_tools_not_used"
  | "max_tool_calls"
  | "no_tool_errors"
  | "output_exists"
  | "output_contains"
  | "output_not_contains"
  | "output_matches_regex"
  | "max_duration_ms"
  | "max_input_tokens"
  | "max_output_tokens"
  | "max_total_tokens"
  | "expected_policy_hits"
  | "forbidden_policy_hits"
  | "final_decision_equals"
  | "no_system_prompt_exposure"
  | "no_secret_exposure"
  | "delivery_status_equals"

export interface EvalAssertion {
  type: EvalAssertionType
  value?: unknown
  config?: {
    missingDataStatus?: "failed" | "warning" | "skipped"
  }
}

export interface EvalAssertionResult {
  assertion_type: EvalAssertionType
  expected: unknown
  actual: unknown
  status: EvalCaseStatus
  message: string
}

export interface EvalSuite {
  id: string
  name: string
  description: string
  builtin: boolean
  created_at: string
  updated_at: string
  case_ids: string[]
  last_run_id?: string
}

export interface EvalCase {
  id: string
  suite_id: string
  name: string
  description: string
  target_type: EvalTargetType
  target_id: string
  mode: EvalMode
  input_text: string
  assertions: EvalAssertion[]
  enabled: boolean
  builtin: boolean
  created_at: string
  updated_at: string
}

export interface EvalRun {
  id: string
  suite_id: string
  status: EvalRunStatus
  started_at: string
  finished_at?: string
  total_cases: number
  passed: number
  failed: number
  warnings: number
  skipped: number
  avg_duration_ms?: number
  total_tokens?: number
  created_by?: string
  mode?: EvalMode
}

export interface EvalCaseResult {
  id: string
  run_id: string
  case_id: string
  status: EvalCaseStatus
  trace_id?: string
  started_at: string
  finished_at: string
  duration_ms: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  failure_reasons: string[]
  warning_reasons: string[]
  assertion_results: EvalAssertionResult[]
  input?: string
  output_preview?: string
  target?: { type: EvalTargetType; id: string }
  mode?: EvalMode
  raw_trace_summary?: Record<string, unknown>
}

export interface EvalSuiteListItem extends EvalSuite {
  case_count: number
  last_run?: EvalRun | null
}

export interface EvalSuiteDetail extends EvalSuite {
  cases: EvalCase[]
  last_run?: EvalRun | null
}

export interface EvalCaseDraftFromTrace {
  suite: {
    suggested_name: string
    suggested_description: string
  }
  case: {
    name: string
    description: string
    target_type: EvalTargetType
    target_id: string
    mode: EvalMode
    input_text: string
    assertions: EvalAssertion[]
    assertion_options: Array<{ key: string; label: string; checked: boolean }>
  }
}
