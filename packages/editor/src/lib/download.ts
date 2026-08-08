/**
 * Hand a generated file to the browser.
 *
 * Extracted from the model exporter because the formwork takeoff needs the same
 * four lines and a second copy is a second place for the missing `revokeObjectURL`
 * to be reintroduced.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** The same, for a file that is text — a CSV, a schedule, a report. */
export function downloadText(text: string, filename: string, type = 'text/csv;charset=utf-8') {
  downloadBlob(new Blob([text], { type }), filename)
}
