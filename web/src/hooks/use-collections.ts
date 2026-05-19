import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  createCollection,
  createEmptyCollection,
  createFolder,
  updateCollection,
  deleteCollection,
  addFiles,
  deleteFiles,
  deleteFolder,
  createNote,
  updateNote,
} from "@/lib/api"

export function useCreateCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { path: string; name: string; pattern?: string }) =>
      createCollection(vars.path, vars.name, vars.pattern),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}

export function useCreateEmptyCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => createEmptyCollection(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}

export function useCreateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { collection: string; path: string }) =>
      createFolder(vars.collection, vars.path),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["collections", vars.collection, "files"] })
    },
  })
}

export function useUpdateCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => updateCollection(name),
    onSuccess: (_data, name) => {
      qc.invalidateQueries({ queryKey: ["status"] })
      qc.invalidateQueries({ queryKey: ["collections", name] })
    },
  })
}

export function useDeleteCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => deleteCollection(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}

export function useAddFiles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { collection: string; paths: string[] }) =>
      addFiles(vars.collection, vars.paths),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["status"] })
      qc.invalidateQueries({ queryKey: ["collections", vars.collection] })
    },
  })
}

export function useDeleteFiles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { collection: string; paths: string[] }) =>
      deleteFiles(vars.collection, vars.paths),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["status"] })
      qc.invalidateQueries({ queryKey: ["collections", vars.collection] })
    },
  })
}

export function useDeleteFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { collection: string; prefix: string }) =>
      deleteFolder(vars.collection, vars.prefix),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["status"] })
      qc.invalidateQueries({ queryKey: ["collections", vars.collection] })
    },
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { title: string; content: string; collection?: string; prefix?: string }) =>
      createNote(vars.title, vars.content, vars.collection, vars.prefix),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["status"] })
      const target = vars.collection || "_notes"
      qc.invalidateQueries({ queryKey: ["collections", target, "files"] })
    },
  })
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { collection: string; path: string; title: string; content: string }) =>
      updateNote(vars.collection, vars.path, vars.title, vars.content),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["collections", vars.collection, "files"] })
      qc.invalidateQueries({ queryKey: ["collections", vars.collection] })
    },
  })
}
