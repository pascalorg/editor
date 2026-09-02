/**
 * The Plans overlay — the construction set, inside the editor.
 *
 * Full-bleed over the editor (z above the palette), Pascal theme tokens
 * throughout so it reads as the editor's own surface in light or dark.
 * Left: the run narration + sheet index. Centre: one sheet, INLINE SVG
 * (never <img> — the sheets @import IBM Plex and their text was measured
 * against real Plex metrics; an <img> cannot load that font). Zoom/pan is
 * the workbench's: transform on a top-left-origin wrapper, zoom about the
 * pointer, wheel factor exp(-dy·0.0016), dblclick fit ↔ 4×.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { generatePlans } from './run'
import { type Sheet, type StageLog, usePlans } from './store'

const PLEX = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap'

function ensureFonts() {
  if (document.getElementById('pascal-plans-plex')) return
  const l = document.createElement('link')
  l.id = 'pascal-plans-plex'
  l.rel = 'stylesheet'
  l.href = PLEX
  document.head.appendChild(l)
}

/* ---------------------------------------------------------------- viewer */

function SheetViewer({ sheet }: { sheet: Sheet }) {
  const host = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const view = useRef({ s: 1, tx: 0, ty: 0 })
  const [, bump] = useState(0)
  const vb = useMemo(() => {
    const m = (sheet.viewBox || '0 0 3456 2304').split(/\s+/).map(Number)
    return { w: m[2] || 3456, h: m[3] || 2304 }
  }, [sheet.viewBox])
  // strip physical size so the page sizes from the viewBox in CSS px
  const svg = useMemo(() => sheet.svg.replace(/\swidth="[^"]*in"/, '').replace(/\sheight="[^"]*in"/, ''), [sheet.svg])

  const apply = useCallback(() => {
    const p = page.current
    if (!p) return
    const v = view.current
    p.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`
    bump((n) => n + 1)
  }, [])
  const fit = useCallback(() => {
    const h = host.current
    if (!h) return
    const pad = 24
    const s = Math.min((h.clientWidth - pad * 2) / vb.w, (h.clientHeight - pad * 2) / vb.h)
    view.current = { s, tx: (h.clientWidth - vb.w * s) / 2, ty: (h.clientHeight - vb.h * s) / 2 }
    apply()
  }, [apply, vb.h, vb.w])
  const zoomAt = useCallback((px: number, py: number, k: number) => {
    const v = view.current
    const s2 = Math.max(0.02, Math.min(40, v.s * k))
    const kk = s2 / v.s
    view.current = { s: s2, tx: px - (px - v.tx) * kk, ty: py - (py - v.ty) * kk }
    apply()
  }, [apply])

  useEffect(() => { fit() }, [fit, sheet.id])
  useEffect(() => {
    const h = host.current
    if (!h) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(h)
    return () => ro.disconnect()
  }, [fit])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const r = host.current!.getBoundingClientRect()
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016))
  }
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; id: number } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    drag.current = { x: e.clientX, y: e.clientY, tx: view.current.tx, ty: view.current.ty, id: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    view.current = { ...view.current, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }
    apply()
  }
  const onUp = () => { drag.current = null }
  const onDbl = (e: React.MouseEvent) => {
    const r = host.current!.getBoundingClientRect()
    if (view.current.s < 3.5) zoomAt(e.clientX - r.left, e.clientY - r.top, 4 / view.current.s)
    else fit()
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-muted/40" ref={host} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDbl} style={{ cursor: 'grab', touchAction: 'none' }}>
      <div
        ref={page}
        className="absolute top-0 left-0 bg-white shadow-2xl"
        style={{ width: vb.w, height: vb.h, transformOrigin: '0 0', willChange: 'transform' }}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="pointer-events-none absolute right-3 bottom-3 rounded-md border border-border bg-background/90 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        {Math.round(view.current.s * 100)}% · wheel zoom · drag pan · dbl-click fit
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- stage log */

const DOT: Record<StageLog['status'], string> = {
  pending: 'bg-muted-foreground/30',
  running: 'bg-primary animate-pulse',
  ok: 'bg-emerald-500',
  skipped: 'bg-muted-foreground/60',
  failed: 'bg-destructive',
}

function Stages({ stages }: { stages: StageLog[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {stages.map((s) => (
        <li key={s.id} className="text-xs">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[s.status]}`} />
            <span className={s.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}>{s.label}</span>
            {s.ms !== undefined && <span className="ml-auto font-mono text-[10px] text-muted-foreground">{s.ms} ms</span>}
          </div>
          {s.detail && <div className="pl-4 text-muted-foreground">{s.detail}</div>}
          {s.lines?.map((l, i) => (
            <div key={i} className={`pl-4 ${/^(✗|skipped|draft)/.test(l) ? 'text-amber-500' : 'text-muted-foreground/80'}`}>{l}</div>
          ))}
        </li>
      ))}
    </ol>
  )
}

/* --------------------------------------------------------------- overlay */

function printSet(sheets: Sheet[]) {
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
  useEffect(() => { ensureFonts() }, [])
  useEffect(() => {
    if (!S.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') S.setOpen(false)
      if (e.key === 'ArrowRight' || e.key === 'PageDown') S.setCurrent(S.current + 1)
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') S.setCurrent(S.current - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [S])
  if (!S.open) return null
  const sheet = S.sheets[S.current]
  const elapsed = S.startedAt ? ((S.finishedAt ?? Date.now()) - S.startedAt) / 1000 : 0

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground" style={{ fontFamily: 'var(--font-sans, ui-sans-serif, system-ui)' }}>
      {/* header */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <span className="font-semibold text-sm">Plans</span>
        <span className="text-muted-foreground text-xs">
          {S.run === 'running' && 'generating…'}
          {S.run === 'done' && `${S.sheets.length} sheets · ${elapsed.toFixed(1)} s`}
          {S.run === 'failed' && <span className="text-destructive">failed — {S.error}</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            API
            <input className="w-44 rounded-md border border-input bg-transparent px-2 py-1 font-mono text-[11px] text-foreground" value={S.apiBase} onChange={(e) => S.setApiBase(e.target.value)} />
          </label>
          <button type="button" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50" disabled={S.run === 'running'} onClick={() => void generatePlans()}>
            {S.run === 'running' ? 'Generating…' : 'Regenerate'}
          </button>
          <button type="button" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50" disabled={!S.sheets.length} onClick={() => printSet(S.sheets)}>
            Print / PDF
          </button>
          <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-xs" onClick={() => S.setOpen(false)}>
            Close
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left rail */}
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-card p-3">
          <section>
            <h3 className="mb-2 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Run</h3>
            <Stages stages={S.stages} />
          </section>
          {S.snapshot && (
            <section>
              <h3 className="mb-2 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Cover view</h3>
              <img alt="3D snapshot for the cover" src={S.snapshot} className="w-full rounded-md border border-border" />
            </section>
          )}
          {S.sheets.length > 0 && (
            <section>
              <h3 className="mb-2 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Sheets</h3>
              <ol className="flex flex-col gap-0.5">
                {S.sheets.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => S.setCurrent(i)} className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs ${i === S.current ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}`}>
                      <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">{s.number ?? i + 1}</span>
                      <span className="truncate">{s.title}</span>
                    </button>
                  </li>
                ))}
                {S.skipped.map((k) => (
                  <li key={k.id} className="px-2 py-1 text-[11px] text-amber-500">not shipped — {k.id}: {k.reason}</li>
                ))}
              </ol>
            </section>
          )}
        </aside>

        {/* stage */}
        {sheet ? (
          <SheetViewer key={sheet.id} sheet={sheet} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            {S.run === 'running' ? 'Rendering the set…' : S.run === 'failed' ? 'No sheets — see the run log.' : 'No set yet.'}
          </div>
        )}
      </div>

      {/* footer: current sheet + warnings */}
      {sheet && (
        <footer className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-xs">
          <button type="button" className="rounded-md border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-40" disabled={S.current === 0} onClick={() => S.setCurrent(S.current - 1)}>‹</button>
          <span className="font-mono text-muted-foreground">{S.current + 1} / {S.sheets.length}</span>
          <button type="button" className="rounded-md border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-40" disabled={S.current >= S.sheets.length - 1} onClick={() => S.setCurrent(S.current + 1)}>›</button>
          <span className="font-medium">{sheet.number} {sheet.title}</span>
          {S.warnings.length > 0 && <span className="ml-auto truncate text-amber-500">{S.warnings.length} warning{S.warnings.length === 1 ? '' : 's'} — {S.warnings[0]}</span>}
        </footer>
      )}
    </div>
  )
}

/* --------------------------------------------------- self-mounted root */

let root: Root | null = null
export function mountPlansOverlay() {
  if (typeof document === 'undefined' || root) return
  const el = document.createElement('div')
  el.id = 'pascal-plans-overlay'
  document.body.appendChild(el)
  root = createRoot(el)
  root.render(<PlansOverlay />)
}
