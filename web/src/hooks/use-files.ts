import { useQuery } from "@tanstack/react-query"
import { listFiles, getFile, listFileIndexEntries } from "@/lib/api"

export function useFileList(collection: string | null, prefix?: string) {
  return useQuery({
    queryKey: ["collections", collection, "files", prefix ?? ""],
    queryFn: () => listFiles(collection!, prefix),
    enabled: !!collection,
  })
}

export function useFileContent(collection: string | null, path: string | null) {
  return useQuery({
    queryKey: ["collections", collection, "files", path],
    queryFn: () => getFile(collection!, path!),
    enabled: !!collection && !!path,
  })
}

export function useFileIndexEntries(collection: string | null, path: string | null) {
  return useQuery({
    queryKey: ["collections", collection, "files", path, "index"],
    queryFn: () => listFileIndexEntries(collection!, path!),
    enabled: !!collection && !!path,
  })
}
