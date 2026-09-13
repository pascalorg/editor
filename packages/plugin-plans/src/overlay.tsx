/**
 * The Plans overlay — the construction set, inside the editor.
 *
 * Full-bleed over the editor, Pascal theme tokens throughout. Left: the
 * rail (project, sheets, tools). Centre: the sheet stage with live tools.
 */
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { summarize } from './project'
import { ProjectEditor, Rail, useProjectRecord } from './rail'
import { SheetStage } from './stage'
import { type Sheet, usePlans } from './store'

const PLEX = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap'

function ensureFonts() {
  if (document.getElementById('pascal-plans-plex')) return
  const l = document.createElement('link')
  l.id = 'pascal-plans-plex'
  l.rel = 'stylesheet'
  l.href = PLEX
  document.head.appendChild(l)
}

export function printSet(sheets: Sheet[]) {
  const w = window.open('', '_blank')
  if (!w) return
  const pages = sheets
    .map((s) => {
      const vb = (s.viewBox || '0 0 3456 2304').split(/\s+/).map(Number)
      const landscape = (vb[2] || 1) >= (vb[3] || 1)
      const inW = vb[2] === 1632 ? 17 : 36
      const inH = vb[2] === 1632 ? 11 : 24
      const svg = s.svg.replace(/<svg\b([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${landscape ? inW : inH}in" height="${landscape ? inH : inW}in">`)
      return `<section class="page">${svg}</section>`
    })
    .join('\n')
  w.document.write(`<!doctype html><html><head><title>Plan set</title>
<link rel="stylesheet" href="${PLEX}">
<style>@page{size:36in 24in;margin:0}body{margin:0}.page{page-break-after:always;width:36in;height:24in;overflow:hidden}svg{display:block}</style>
</head><body>${pages}<script>document.fonts.ready.then(()=>setTimeout(()=>window.print(),300))</script></body></html>`)
  w.document.close()
}

export function PlansOverlay() {
  const S = usePlans()
  const rec = useProjectRecord()
  const sum = summarize(rec)
  useEffect(() => { ensureFonts() }, [])
  useEffect(() => {
    if (!S.open) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Escape') {
        if (S.editingProject) S.setEditingProject(false)
        else S.setOpen(false)
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') S.setCurrent(S.current + 1)
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') S.setCurrent(S.current - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [S])
  if (!S.open) return null
  const sheet = S.sheets[S.current]
  const running = S.run === 'running'
  const stage = S.stages.find((s) => s.status === 'running')

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground" style={{ fontFamily: 'var(--font-sans, ui-sans-serif, system-ui)' }}>
      <div className={`h-0.5 w-full ${running || S.rendering.length ? 'bg-primary/30' : 'bg-transparent'}`}>
        {(running || S.rendering.length > 0) && <div className="h-full w-1/3 animate-[plans-slide_1.2s_ease-in-out_infinite] bg-primary" />}
      </div>
      <style>{`@keyframes plans-slide{0%{margin-left:0}50%{margin-left:66%}100%{margin-left:0}}`}</style>

      <header className="flex items-center gap-3 border-border border-b px-4 py-2">
        <span className="font-semibold text-sm">Plans</span>
        <span className="truncate text-muted-foreground text-xs">
          {sum.name && <span className="text-foreground">{sum.name}</span>}
          {sum.name && sum.address && ' · '}
          {sum.address}
        </span>
        <span className="ml-auto truncate text-muted-foreground text-xs">
          {running && (stage ? `${stage.label}…` : 'generating…')}
          {!running && S.rendering.length > 0 && `drawing ${S.rendering.join(', ')}…`}
          {!running && S.rendering.length === 0 && S.run === 'done' && sheet && `${sheet.number} ${sheet.title}`}
        </span>
        <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => S.setOpen(false)} title="Close (Esc)">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {S.editingProject ? (
          <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden border-border border-r bg-card">
            <ProjectEditor onClose={() => S.setEditingProject(false)} />
          </aside>
        ) : (
          <Rail onEditProject={() => S.setEditingProject(true)} onPrint={() => printSet(S.sheets)} />
        )}

        <div className="relative flex min-w-0 flex-1 flex-col">
          {sheet ? (
            <SheetStage key={sheet.number} sheet={sheet} onEditProject={() => S.setEditingProject(true)} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
              {running ? (
                <>
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <div>{stage ? stage.label : 'Starting'}…</div>
                </>
              ) : S.run === 'failed' ? (
                <div className="max-w-md text-center">{S.error}</div>
              ) : (
                <div className="max-w-md text-center">No set yet. Add the project details on the left, then Generate plans.</div>
              )}
            </div>
          )}
          {S.showWarnings && S.warnings.length > 0 && (
            <div className="absolute right-0 bottom-0 left-0 max-h-56 overflow-y-auto border-border border-t bg-card/95 p-3 text-xs backdrop-blur">
              <div className="mb-1 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Notes from the engine</div>
              <ol className="space-y-1">
                {S.warnings.map((w, i) => (
                  <li key={i} className="text-foreground/90">{w}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>

      {sheet && (
        <footer className="flex items-center gap-3 border-border border-t px-4 py-1.5 text-xs">
          <button type="button" className="rounded-md border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-40" disabled={S.current === 0} onClick={() => S.setCurrent(S.current - 1)}>‹</button>
          <span className="font-mono text-muted-foreground">{S.current + 1} / {S.sheets.length}</span>
          <button type="button" className="rounded-md border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-40" disabled={S.current >= S.sheets.length - 1} onClick={() => S.setCurrent(S.current + 1)}>›</button>
          <span className="font-medium">{sheet.number} {sheet.title}</span>
          {sheet.manifest?.site && sheet.manifest.site.footprint.length >= 3 && <span className="text-muted-foreground">· drag the house, click a yard dimension or a lot line</span>}
          <span className="ml-auto text-muted-foreground">← → to page · Esc to close</span>
        </footer>
      )}
    </div>
  )
}

let root: Root | null = null
export function mountPlansOverlay() {
  if (typeof document === 'undefined' || root) return
  const el = document.createElement('div')
  el.id = 'pascal-plans-overlay'
  document.body.appendChild(el)
  root = createRoot(el)
  root.render(<PlansOverlay />)
}
