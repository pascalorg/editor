export function commitHandleDragPatch<T>({
  commit,
  patch,
  resumeHistory,
  runAsSingleHistoryStep,
}: {
  commit: (patch: T) => void
  patch: T
  resumeHistory: () => void
  runAsSingleHistoryStep: (run: () => void) => void
}) {
  resumeHistory()
  runAsSingleHistoryStep(() => commit(patch))
}
