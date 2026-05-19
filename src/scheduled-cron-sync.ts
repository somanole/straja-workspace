type MaybeError = unknown;

export function isMissingCronJobError(err: MaybeError): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /cron job .*not found|job .*not found|not found|missing/i.test(message);
}

export function isRetryableScheduleReconcileError(err: MaybeError): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /423\s+Locked|ECONNREFUSED|fetch failed|socket hang up|EPIPE|ETIMEDOUT|ECONNRESET|network error|502|503|504|timed out/i
    .test(message);
}

export async function upsertScheduledCronJob<T>(params: {
  existingCronJobId?: string;
  update: (id: string) => Promise<T>;
  add: () => Promise<T>;
}): Promise<T> {
  if (!params.existingCronJobId) {
    return await params.add();
  }
  try {
    return await params.update(params.existingCronJobId);
  } catch (err) {
    if (!isMissingCronJobError(err)) {
      throw err;
    }
    return await params.add();
  }
}

export async function reconcileScheduledEntries<TTask, TFlow>(params: {
  tasks: TTask[];
  flows: TFlow[];
  hasActiveTaskSchedule: (task: TTask) => boolean;
  hasActiveFlowSchedule: (flow: TFlow) => boolean;
  syncTask: (task: TTask) => Promise<{ item: TTask; changed: boolean }>;
  syncFlow: (flow: TFlow) => Promise<{ item: TFlow; changed: boolean }>;
  persistTask: (task: TTask) => Promise<void>;
  persistFlow: (flow: TFlow) => Promise<void>;
  isRetryableError?: (err: unknown) => boolean;
}): Promise<{
  tasksAttempted: number;
  flowsAttempted: number;
  tasksUpdated: number;
  flowsUpdated: number;
  retryableFailures: number;
  nonRetryableFailures: number;
}> {
  const isRetryable = params.isRetryableError ?? isRetryableScheduleReconcileError;
  let tasksAttempted = 0;
  let flowsAttempted = 0;
  let tasksUpdated = 0;
  let flowsUpdated = 0;
  let retryableFailures = 0;
  let nonRetryableFailures = 0;

  for (const task of params.tasks) {
    if (!params.hasActiveTaskSchedule(task)) {
      continue;
    }
    tasksAttempted++;
    try {
      const result = await params.syncTask(task);
      if (result.changed) {
        await params.persistTask(result.item);
        tasksUpdated++;
      }
    } catch (err) {
      if (isRetryable(err)) {
        retryableFailures++;
      } else {
        nonRetryableFailures++;
      }
    }
  }

  for (const flow of params.flows) {
    if (!params.hasActiveFlowSchedule(flow)) {
      continue;
    }
    flowsAttempted++;
    try {
      const result = await params.syncFlow(flow);
      if (result.changed) {
        await params.persistFlow(result.item);
        flowsUpdated++;
      }
    } catch (err) {
      if (isRetryable(err)) {
        retryableFailures++;
      } else {
        nonRetryableFailures++;
      }
    }
  }

  return {
    tasksAttempted,
    flowsAttempted,
    tasksUpdated,
    flowsUpdated,
    retryableFailures,
    nonRetryableFailures,
  };
}
