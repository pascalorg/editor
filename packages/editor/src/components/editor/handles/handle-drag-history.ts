export function commitHandleDragPatch<T>({
  commit,
  patch,
  resumeHistory,
}: {
  commit: (patch: T) => void
  patch: T
  resumeHistory: () => void
}) {
  resumeHistory()
  commit(patch)
}
