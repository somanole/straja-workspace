import { useMutation } from "@tanstack/react-query"
import { search, answer } from "@/lib/api"
import type { SearchRequest, AnswerRequest } from "@/lib/types"

export function useSearch() {
  return useMutation({
    mutationFn: (req: SearchRequest) => search(req),
  })
}

export function useAnswer() {
  return useMutation({
    mutationFn: (req: AnswerRequest) => answer(req),
  })
}
