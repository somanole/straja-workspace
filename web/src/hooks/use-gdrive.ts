import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getDriveStatus,
  authorizeDrive,
  syncDrive,
  updateDriveConfig,
  disconnectDrive,
  browseDrive,
  importDriveFiles,
} from "@/lib/api"

export function useDriveStatus() {
  return useQuery({
    queryKey: ["gdrive", "status"],
    queryFn: getDriveStatus,
    staleTime: 30_000,
  })
}

export function useDriveAuthorize() {
  return useMutation({
    mutationFn: authorizeDrive,
  })
}

export function useDriveSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: syncDrive,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gdrive", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["gdrive", "status"] })
    },
  })
}

export function useDriveConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: {
      folders?: { id: string; name: string }[]
      includeSubfolders?: boolean
      pollEnabled?: boolean
      pollIntervalMinutes?: number
    }) => updateDriveConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gdrive", "status"] })
    },
  })
}

export function useDriveDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disconnectDrive,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gdrive", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}

export function useDriveBrowse(folderId?: string) {
  return useQuery({
    queryKey: ["gdrive", "browse", folderId ?? "root"],
    queryFn: () => browseDrive(folderId),
    enabled: false, // Manual fetch only
  })
}

export function useDriveImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fileIds, collection }: { fileIds: string[]; collection?: string }) =>
      importDriveFiles(fileIds, collection),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gdrive", "status"] })
      qc.invalidateQueries({ queryKey: ["status"] })
    },
  })
}
