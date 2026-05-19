import { describe, expect, it, vi } from "vitest";

import {
  isRetryableScheduleReconcileError,
  reconcileScheduledEntries,
  upsertScheduledCronJob,
} from "../src/scheduled-cron-sync.js";

describe("scheduled-cron-sync", () => {
  it("falls back to cron.add when cron.update targets a missing job", async () => {
    const update = vi.fn(async () => {
      throw new Error("cron job not found");
    });
    const add = vi.fn(async () => ({ id: "new-job-id" }));

    const result = await upsertScheduledCronJob({
      existingCronJobId: "old-job-id",
      update,
      add,
    });

    expect(update).toHaveBeenCalledWith("old-job-id");
    expect(add).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "new-job-id" });
  });

  it("keeps retryable reconcile failures separate from permanent ones", async () => {
    const persistTask = vi.fn(async () => {});
    const persistFlow = vi.fn(async () => {});

    const result = await reconcileScheduledEntries({
      tasks: [
        { id: "task-ok", schedule: { mode: "every", everyMinutes: 2, cronJobId: "old-task" } },
        { id: "task-retry", schedule: { mode: "every", everyMinutes: 2 } },
      ],
      flows: [
        { id: "flow-bad", schedule: { mode: "every", everyMinutes: 5 } },
      ],
      hasActiveTaskSchedule: (task) => task.schedule.mode !== "off",
      hasActiveFlowSchedule: (flow) => flow.schedule.mode !== "off",
      syncTask: async (task) => {
        if (task.id === "task-retry") {
          throw new Error("Vault cron store load failed: 423 Locked");
        }
        return {
          item: {
            ...task,
            schedule: {
              ...task.schedule,
              cronJobId: "re-added-task",
            },
          },
          changed: true,
        };
      },
      syncFlow: async () => {
        throw new Error("Scheduled flows require a valid enabled agent");
      },
      persistTask,
      persistFlow,
      isRetryableError: isRetryableScheduleReconcileError,
    });

    expect(result).toEqual({
      tasksAttempted: 2,
      flowsAttempted: 1,
      tasksUpdated: 1,
      flowsUpdated: 0,
      retryableFailures: 1,
      nonRetryableFailures: 1,
    });
    expect(persistTask).toHaveBeenCalledOnce();
    expect(persistFlow).not.toHaveBeenCalled();
  });
});
