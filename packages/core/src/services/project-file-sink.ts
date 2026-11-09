export type ProjectFileSink = (file: { blob: Blob; name: string }) => Promise<void>

let sink: ProjectFileSink | null = null

/** A host can retain user-requested exports in the project's file catalog. */
export function setProjectFileSink(next: ProjectFileSink): () => void {
  sink = next
  return () => {
    if (sink === next) sink = null
  }
}

/** Capture before an asynchronous export starts so navigation cannot change its destination. */
export function getProjectFileSink(): ProjectFileSink | null {
  return sink
}
