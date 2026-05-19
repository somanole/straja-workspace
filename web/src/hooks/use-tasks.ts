import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  listTasks,
  createTask,
  getTaskDetail,
  updateTask,
  deleteTask,
  stopTask,
  sendTaskMessage,
} from "@/lib/api"
import type { CreateTaskRequest } from "@/lib/task-types"

export function useTasksList() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: listTasks,
    refetchInterval: 5000,
  })
}

export function useTaskDetail(id: string | null, shouldPoll = false) {
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: () => getTaskDetail(id!),
    enabled: !!id,
    refetchInterval: shouldPoll ? 3000 : false,
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateTaskRequest) => createTask(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] })
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; patch: Parameters<typeof updateTask>[1] }) =>
      updateTask(vars.id, vars.patch),
    onSuccess: (data, vars) => {
      qc.setQueryData<{ tasks: Array<Record<string, unknown>> } | undefined>(["tasks"], (current) => {
        if (!current) return current
        return {
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === vars.id
              ? {
                  ...task,
                  ...data.task,
                }
              : task,
          ),
        }
      })
      qc.setQueryData<Record<string, unknown> | undefined>(["tasks", vars.id], (current) => {
        if (!current) return current
        return {
          ...current,
          meta: data.task,
        }
      })
      qc.invalidateQueries({ queryKey: ["tasks"] })
      qc.invalidateQueries({ queryKey: ["tasks", vars.id] })
    },
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["tasks"] })
      await qc.cancelQueries({ queryKey: ["tasks", id] })

      const previousList = qc.getQueryData<{ tasks: Array<{ id: string }> }>(["tasks"])
      const previousDetail = qc.getQueryData(["tasks", id])

      qc.setQueryData<{ tasks: Array<{ id: string }> } | undefined>(["tasks"], (current) => {
        if (!current) return current
        return {
          ...current,
          tasks: current.tasks.filter((task) => task.id !== id),
        }
      })
      qc.removeQueries({ queryKey: ["tasks", id], exact: true })

      return { previousList, previousDetail, id }
    },
    onError: (_err, id, context) => {
      if (context?.previousList) {
        qc.setQueryData(["tasks"], context.previousList)
      }
      if (context?.previousDetail) {
        qc.setQueryData(["tasks", id], context.previousDetail)
      }
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: ["tasks"] })
      qc.removeQueries({ queryKey: ["tasks", id], exact: true })
    },
  })
}

export function useStopTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => stopTask(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["tasks"] })
      qc.invalidateQueries({ queryKey: ["tasks", id] })
    },
  })
}

export function useSendTaskMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; message: string }) =>
      sendTaskMessage(vars.id, vars.message),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["tasks", vars.id] })
    },
  })
}
