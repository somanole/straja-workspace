import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  buildEvalCaseFromTrace,
  createEvalCase,
  createEvalSuite,
  deleteEvalCase,
  duplicateEvalSuite,
  getEvalRun,
  getEvalRunResults,
  getEvalSuite,
  listEvalSuites,
  runEvalSuite,
  updateEvalCase,
} from "@/lib/api"

export function useEvalSuites() {
  return useQuery({
    queryKey: ["evals", "suites"],
    queryFn: listEvalSuites,
    staleTime: 10_000,
  })
}

export function useEvalSuite(id: string | null) {
  return useQuery({
    queryKey: ["evals", "suite", id],
    queryFn: () => getEvalSuite(id!),
    enabled: Boolean(id),
    staleTime: 5_000,
  })
}

export function useEvalRun(id: string | null) {
  return useQuery({
    queryKey: ["evals", "run", id],
    queryFn: () => getEvalRun(id!),
    enabled: Boolean(id),
    staleTime: 5_000,
  })
}

export function useEvalRunResults(id: string | null) {
  return useQuery({
    queryKey: ["evals", "run", id, "results"],
    queryFn: () => getEvalRunResults(id!),
    enabled: Boolean(id),
    staleTime: 5_000,
  })
}

export function useCreateEvalSuite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createEvalSuite,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evals", "suites"] })
    },
  })
}

export function useDuplicateEvalSuite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: duplicateEvalSuite,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evals", "suites"] })
    },
  })
}

export function useRunEvalSuite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: runEvalSuite,
    onSuccess: (payload) => {
      qc.invalidateQueries({ queryKey: ["evals", "suites"] })
      qc.invalidateQueries({ queryKey: ["evals", "suite", payload.suite.id] })
      qc.invalidateQueries({ queryKey: ["evals", "run", payload.run.id] })
      qc.invalidateQueries({ queryKey: ["evals", "run", payload.run.id, "results"] })
    },
  })
}

export function useCreateEvalCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createEvalCase,
    onSuccess: ({ case: item }) => {
      qc.invalidateQueries({ queryKey: ["evals", "suites"] })
      qc.invalidateQueries({ queryKey: ["evals", "suite", item.suite_id] })
    },
  })
}

export function useUpdateEvalCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof updateEvalCase>[1] }) =>
      updateEvalCase(id, updates),
    onSuccess: ({ case: item }) => {
      qc.invalidateQueries({ queryKey: ["evals", "suites"] })
      qc.invalidateQueries({ queryKey: ["evals", "suite", item.suite_id] })
    },
  })
}

export function useDeleteEvalCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteEvalCase,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evals", "suites"] })
    },
  })
}

export function useBuildEvalCaseFromTrace() {
  return useMutation({
    mutationFn: buildEvalCaseFromTrace,
  })
}
