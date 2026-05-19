import { useQuery } from "@tanstack/react-query"
import { getFile, listFiles } from "@/lib/api"
import type { GroupedFileInfo } from "@/lib/types"

const ORCHESTRATION_COLLECTION = "_orchestration"
const MAX_RUNS = 80

export type OrchestrationRunRecord = Record<string, unknown> & {
  traceId: string
  createdAt?: string
  updatedAt?: string
  inboundText?: string
  sessionKey?: string
  messageId?: string
  assignedAgentId?: string
  assignedProvider?: string
  assignedModel?: string
  executionProvider?: string
  executionModel?: string
  taskClass?: string
  suggestedRoute?: string
  finalRoute?: string
  confidence?: number
  status?: string
}

export type OrchestrationStepRecord = {
  path: string
  timestamp?: string
  traceId?: string
  stage: string
  data?: Record<string, unknown>
}

export type OrchestrationPromptRecord = {
  path: string
  kind: "input" | "output"
  runId: string
  timestamp?: string
  sessionId?: string
  provider?: string
  model?: string
  systemPrompt?: string
  prompt?: string
  historyMessages?: unknown[]
  imagesCount?: number
  toolDefinitions?: Array<{
    name: string
    label?: string
    description?: string
    parameters?: Record<string, unknown>
  }>
  toolAllowlist?: string[]
  systemPromptReport?: unknown
  assistantTexts?: string[]
  lastAssistant?: unknown
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
}

export type OrchestrationRunListItem = {
  file: GroupedFileInfo
  run: OrchestrationRunRecord
}

export type OrchestrationRunDetail = {
  run: OrchestrationRunRecord | null
  steps: OrchestrationStepRecord[]
  prompts: OrchestrationPromptRecord[]
}

function isLikelyMissingCollection(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes("404") || msg.includes("not found") || msg.includes("collection")
}

function parseJsonRecord(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function compareByNewest(a?: string, b?: string) {
  const ta = a ? Date.parse(a) : Number.NaN
  const tb = b ? Date.parse(b) : Number.NaN
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if (Number.isNaN(ta)) return 1
  if (Number.isNaN(tb)) return -1
  return tb - ta
}

function compareByOldest(a?: string, b?: string) {
  return compareByNewest(b, a)
}

function sortFilesByModified(files: GroupedFileInfo[]) {
  return [...files].sort((a, b) => compareByNewest(a.modifiedAt, b.modifiedAt))
}

async function listEntries(prefix: string): Promise<GroupedFileInfo[]> {
  try {
    const files = await listFiles(ORCHESTRATION_COLLECTION, prefix)
    return sortFilesByModified(files)
  } catch (err) {
    if (isLikelyMissingCollection(err)) {
      return []
    }
    throw err
  }
}

async function listJsonFiles(prefix: string): Promise<GroupedFileInfo[]> {
  const files = await listEntries(prefix)
  return files.filter((file) => file.type !== "folder" && file.path.endsWith(".json"))
}

async function loadJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const file = await getFile(ORCHESTRATION_COLLECTION, path)
    return parseJsonRecord(file.content)
  } catch (err) {
    if (isLikelyMissingCollection(err)) {
      return null
    }
    throw err
  }
}

function parsePromptPath(path: string): { runId: string; kind: "input" | "output" } {
  const fileName = path.split("/").pop() ?? path
  const kind = fileName.endsWith("-output.json") ? "output" : "input"
  const suffix = kind === "output" ? "-output.json" : "-input.json"
  return {
    runId: fileName.slice(0, Math.max(0, fileName.length - suffix.length)),
    kind,
  }
}

export function useOrchestrationRuns() {
  return useQuery({
    queryKey: ["orchestration", "runs"],
    queryFn: async (): Promise<OrchestrationRunListItem[]> => {
      const runFiles = (await listJsonFiles("runs")).slice(0, MAX_RUNS)
      const loadRunRecords = async (files: GroupedFileInfo[]) =>
        Promise.all(
          files.map(async (file) => {
            const raw = await loadJsonFile(file.path)
            const traceId =
              typeof raw?.traceId === "string"
                ? raw.traceId
                : file.path.split("/").pop()?.replace(/\.json$/, "")
            if (!raw || !traceId) return null
            return {
              file,
              run: {
                traceId,
                ...raw,
              } as OrchestrationRunRecord,
            }
          }),
        )

      let records = await loadRunRecords(runFiles)

      // Resilience fallback: some older/broken runs persisted steps/prompts but missed the
      // final runs/<traceId>.json snapshot. Rebuild the inbox from step folders instead of
      // showing an empty state.
      if (records.filter(Boolean).length === 0) {
        const stepFolders = (await listEntries("steps"))
          .filter((file) => file.type === "folder" && file.path.startsWith("steps/"))
          .slice(0, MAX_RUNS)

        records = await Promise.all(
          stepFolders.map(async (folder) => {
            const traceId = folder.path.split("/").pop()
            if (!traceId) return null
            const raw = await loadJsonFile(`runs/${traceId}.json`)
            const fallbackRun = raw
              ? ({
                  traceId,
                  ...raw,
                } as OrchestrationRunRecord)
              : ({
                  traceId,
                  createdAt: folder.modifiedAt,
                  updatedAt: folder.modifiedAt,
                  status: "partial_trace",
                } as OrchestrationRunRecord)
            return {
              file: {
                ...folder,
                path: `runs/${traceId}.json`,
                type: "file",
              } as GroupedFileInfo,
              run: fallbackRun,
            }
          }),
        )
      }

      return records
        .filter((entry): entry is OrchestrationRunListItem => Boolean(entry))
        .sort((a, b) =>
          compareByNewest(
            (a.run.updatedAt as string | undefined) ?? (a.run.createdAt as string | undefined),
            (b.run.updatedAt as string | undefined) ?? (b.run.createdAt as string | undefined),
          ),
        )
    },
  })
}

export function useOrchestrationRunDetail(traceId: string | null) {
  return useQuery({
    queryKey: ["orchestration", "detail", traceId],
    enabled: Boolean(traceId),
    queryFn: async (): Promise<OrchestrationRunDetail> => {
      if (!traceId) {
        return { run: null, steps: [], prompts: [] }
      }

      const [runRaw, stepFiles, promptFiles] = await Promise.all([
        loadJsonFile(`runs/${traceId}.json`),
        listJsonFiles(`steps/${traceId}`),
        listJsonFiles(`prompts/${traceId}`),
      ])

      const [stepsRaw, promptsRaw] = await Promise.all([
        Promise.all(stepFiles.map((file) => loadJsonFile(file.path))),
        Promise.all(promptFiles.map((file) => loadJsonFile(file.path))),
      ])

      const steps = stepFiles
        .map((file, index) => {
          const raw = stepsRaw[index]
          if (!raw || typeof raw.stage !== "string") return null
          return {
            path: file.path,
            timestamp: typeof raw.timestamp === "string" ? raw.timestamp : file.modifiedAt,
            traceId: typeof raw.traceId === "string" ? raw.traceId : traceId,
            stage: raw.stage,
            data:
              raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
                ? (raw.data as Record<string, unknown>)
                : undefined,
          } as OrchestrationStepRecord
        })
        .filter((entry): entry is OrchestrationStepRecord => entry !== null)
        .sort((a, b) => compareByOldest(a.timestamp, b.timestamp))

      const prompts = promptFiles
        .map((file, index) => {
          const raw = promptsRaw[index]
          if (!raw) return null
          const parsedPath = parsePromptPath(file.path)
          return {
            path: file.path,
            kind: parsedPath.kind,
            runId:
              typeof raw.runId === "string" && raw.runId.trim().length > 0
                ? raw.runId
                : parsedPath.runId,
            timestamp: typeof raw.timestamp === "string" ? raw.timestamp : file.modifiedAt,
            sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
            provider: typeof raw.provider === "string" ? raw.provider : undefined,
            model: typeof raw.model === "string" ? raw.model : undefined,
            systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : undefined,
            prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
            historyMessages: Array.isArray(raw.historyMessages) ? raw.historyMessages : undefined,
            imagesCount: typeof raw.imagesCount === "number" ? raw.imagesCount : undefined,
            toolDefinitions: Array.isArray(raw.toolDefinitions)
              ? (raw.toolDefinitions as OrchestrationPromptRecord["toolDefinitions"])
              : undefined,
            toolAllowlist: Array.isArray(raw.toolAllowlist)
              ? raw.toolAllowlist.filter((entry): entry is string => typeof entry === "string")
              : undefined,
            systemPromptReport: raw.systemPromptReport,
            assistantTexts: Array.isArray(raw.assistantTexts)
              ? raw.assistantTexts.filter((entry): entry is string => typeof entry === "string")
              : undefined,
            lastAssistant: raw.lastAssistant,
            usage:
              raw.usage && typeof raw.usage === "object" && !Array.isArray(raw.usage)
                ? (raw.usage as OrchestrationPromptRecord["usage"])
                : undefined,
          } as OrchestrationPromptRecord
        })
        .filter((entry): entry is OrchestrationPromptRecord => entry !== null)
        .sort((a, b) => compareByOldest(a.timestamp, b.timestamp))

      const run = runRaw
        ? ({
            traceId,
            ...runRaw,
          } as OrchestrationRunRecord)
        : null

      return { run, steps, prompts }
    },
  })
}
