/**
 * The sheet stage — one sheet, live.
 *
 * The sheet is the engine's SVG, inline (its text was measured against real
 * IBM Plex metrics; an <img> cannot load that font). On top of it sits a
 * second SVG in the same viewBox — the tool layer — built from the sheet's
 * manifest (what the engine laid out, in sheet pixels):
 *
 *   site plan   drag the house on the lot (ghost + live yard readouts,
 *               commit on release → building node → A1.0 re-drawn)
 *               click a yard dimension → type the yard → house slides
 *               click a lot line → type the required yard for that side
 *   title block click → edit the project record
 *
 * Zoom/pan is the workbench's: transform on a top-left-origin wrapper,
 * zoom about the pointer, wheel factor exp(-dy·0.0016), dbl-click fit ↔ 4×.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LotEdgeMeta, Px, YardDimMeta } from './api'
import { regenerateSheets } from './run'
import { fmtFt, moveHouseBySheetInches, parseFtIn, setRequiredYard } from './site'
import { type Sheet, usePlans } from './store'

const IN = 0.0254

type Popover =
  | { kind: 'yard'; yard: YardDimMeta; at: { x: number; y: number } }
  | { kind: 'edge'; edge: LotEdgeMeta; at: { x: number; y: number } }

const YARD_NAME: Record<string, string> = { front: 'Front yard', rear: 'Rear yard', left: 'Side yard (left)', right: 'Side yard (right)', side: 'Side yard' }

function fmtIn(inches: number): string {
  return fmtFt(inches * IN)
}

export function SheetStage({ sheet, onEditProject }: { sheet: Sheet; onEditProject: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const view = useRef({ s: 1, tx: 0, ty: 0 })
  const [, bump] = useState(0)
  const rendering = usePlans((s) => s.rendering)
  const busy = rendering.includes(sheet.number)
  const vb = useMemo(() => {
    const m = (sheet.viewBox || '0 0 3456 2304').split(/\s+/).map(Number)
    return { w: m[2] || 3456, h: m[3] || 2304 }
  }, [sheet.viewBox])
  const svg = useMemo(() => sheet.svg.replace(/\swidth="[^"]*in"/, '').replace(/\sheight="[^"]*in"/, ''), [sheet.svg])
  const site = sheet.manifest?.site

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

  // fit on a NEW sheet number; a re-render of the same sheet keeps the view
  const lastNumber = useRef<string>('')
  useEffect(() => {
    if (lastNumber.current !== sheet.number) {
      lastNumber.current = sheet.number
      fit()
    }
  }, [fit, sheet.number])
  useEffect(() => {
    const h = host.current
    if (!h) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(h)
    return () => ro.disconnect()
  }, [fit])

  /* ---------------------------------------------------------- pan/zoom */
  const toSheet = (clientX: number, clientY: number): Px => {
    const r = host.current!.getBoundingClientRect()
    const v = view.current
    return { x: (clientX - r.left - v.tx) / v.s, y: (clientY - r.top - v.ty) / v.s }
  }
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const r = host.current!.getBoundingClientRect()
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016))
  }
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    if ((e.target as HTMLElement).closest('[data-tool]')) return
    setPop(null)
    pan.current = { x: e.clientX, y: e.clientY, tx: view.current.tx, ty: view.current.ty }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = pan.current
    if (!d) return
    view.current = { ...view.current, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }
    apply()
  }
  const onUp = () => {
    pan.current = null
  }
  const onDbl = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-tool]')) return
    const r = host.current!.getBoundingClientRect()
    if (view.current.s < 3.5) zoomAt(e.clientX - r.left, e.clientY - r.top, 4 / view.current.s)
    else fit()
  }

  /* -------------------------------------------------------- house drag */
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const dragRef = useRef<{ x0: number; y0: number; id: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [pop, setPop] = useState<Popover | null>(null)
  const [popText, setPopText] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const commit = async (fn: () => void) => {
    setErr(null)
    fn()
    const msg = await regenerateSheets([sheet.number])
    if (msg) setErr(msg)
  }

  const houseDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !site) return
    e.stopPropagation()
    setPop(null)
    const p = toSheet(e.clientX, e.clientY)
    dragRef.current = { x0: p.x, y0: p.y, id: e.pointerId }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setDrag({ dx: 0, dy: 0 })
  }
  const houseMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || !site) return
    const p = toSheet(e.clientX, e.clientY)
    let dx = p.x - d.x0
    let dy = p.y - d.y0
    // snap 6" like PlanCrafters (Shift = 1")
    const snapIn = e.shiftKey ? 1 : 6
    const snapPx = snapIn * site.xform.pxPerIn
    dx = Math.round(dx / snapPx) * snapPx
    dy = Math.round(dy / snapPx) * snapPx
    setDrag({ dx, dy })
  }
  const houseUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || !site || !drag) return
    e.stopPropagation()
    const { dx, dy } = drag
    setDrag(null)
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    void commit(() => moveHouseBySheetInches(dx / site.xform.pxPerIn, dy / site.xform.pxPerIn))
  }

  const yardNow = (y: YardDimMeta): number => {
    if (!drag || !site) return y.lenIn
    const dIn = { x: drag.dx / site.xform.pxPerIn, y: drag.dy / site.xform.pxPerIn }
    return y.lenIn - (dIn.x * y.dir.x + dIn.y * y.dir.y)
  }

  const openYard = (y: YardDimMeta, e: React.MouseEvent) => {
    e.stopPropagation()
    setPop({ kind: 'yard', yard: y, at: { x: e.clientX, y: e.clientY } })
    setPopText(fmtIn(y.lenIn))
  }
  const openEdge = (ed: LotEdgeMeta, e: React.MouseEvent) => {
    e.stopPropagation()
    setPop({ kind: 'edge', edge: ed, at: { x: e.clientX, y: e.clientY } })
    setPopText(ed.distIn > 0 ? fmtIn(ed.distIn) : '')
  }
  const submitPop = () => {
    if (!pop || !site) return
    setHover(null)
    if (pop.kind === 'yard') {
      const target = parseFtIn(popText)
      if (target === null) return setErr(`Could not read "${popText}" — try 20'-6" or 20.5`)
      const delta = target - pop.yard.lenIn
      const y = pop.yard
      setPop(null)
      void commit(() => moveHouseBySheetInches(y.dir.x * delta, y.dir.y * delta))
    } else {
      const inches = popText.trim() === '' ? null : parseFtIn(popText)
      if (popText.trim() !== '' && inches === null) return setErr(`Could not read "${popText}" — try 20 or 20'-6"`)
      const ed = pop.edge
      setPop(null)
      void commit(() => setRequiredYard(ed.kind, inches === null ? undefined : inches * IN))
    }
  }

  /* -------------------------------------------------------- title block */
  const [tb, setTb] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  useEffect(() => {
    const p = page.current
    if (!p) return
    const g = p.querySelector('[data-layer="pascal-title-block"]') as SVGGraphicsElement | null
    try {
      const b = g?.getBBox()
      setTb(b && b.width > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null)
    } catch {
      setTb(null)
    }
  }, [svg])

  const s = view.current.s || 1
  const hit = 14 / s // screen-constant hit radius, in sheet px
  const pts = (arr: Px[]) => arr.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="relative flex-1 overflow-hidden bg-muted/40" ref={host} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDbl} style={{ cursor: 'grab', touchAction: 'none' }}>
      <div ref={page} className="absolute top-0 left-0 bg-white shadow-2xl transition-opacity" style={{ width: vb.w, height: vb.h, transformOrigin: '0 0', willChange: 'transform', opacity: busy ? 0.55 : 1 }}>
        {/* the sheet */}
        {/* eslint-disable-next-line react/no-danger */}
        <div dangerouslySetInnerHTML={{ __html: svg }} />
        {/* the tool layer */}
        <svg className="absolute top-0 left-0" width={vb.w} height={vb.h} viewBox={`0 0 ${vb.w} ${vb.h}`} style={{ pointerEvents: 'none', overflow: 'visible' }}>
          {site && site.footprint.length >= 3 && (
            <g data-tool="site">
              {/* lot lines: click to set that side's required yard */}
              {site.edges.map((ed, i) => (
                <line
                  key={`e${i}`}
                  x1={ed.a.x} y1={ed.a.y} x2={ed.b.x} y2={ed.b.y}
                  stroke={hover === `e${i}` ? 'rgba(59,130,246,.9)' : 'rgba(59,130,246,0)'}
                  strokeWidth={hover === `e${i}` ? 3 / s : 12 / s}
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onPointerEnter={() => setHover(`e${i}`)} onPointerLeave={() => setHover(null)}
                  onClick={(e) => openEdge(ed, e)}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ))}
              {/* the house: drag it */}
              <polygon
                points={pts(site.footprint)}
                fill={drag ? 'rgba(59,130,246,.08)' : hover === 'house' ? 'rgba(59,130,246,.10)' : 'rgba(59,130,246,0.001)'}
                stroke={hover === 'house' && !drag ? 'rgba(59,130,246,.8)' : 'none'}
                strokeWidth={2 / s}
                style={{ pointerEvents: 'all', cursor: drag ? 'grabbing' : 'move' }}
                onPointerEnter={() => setHover('house')} onPointerLeave={() => setHover(null)}
                onPointerDown={houseDown} onPointerMove={houseMove} onPointerUp={houseUp} onPointerCancel={houseUp}
              />
              {drag && (
                <g transform={`translate(${drag.dx} ${drag.dy})`}>
                  <polygon points={pts(site.footprint)} fill="rgba(59,130,246,.15)" stroke="#3b82f6" strokeWidth={3 / s} strokeDasharray={`${10 / s} ${6 / s}`} />
                </g>
              )}
              {/* yard dimensions: click to type */}
              {site.yards.map((y) => {
                const len = yardNow(y)
                const req = site.setbacks ? (y.side === 'front' ? site.setbacks.front : y.side === 'rear' ? site.setbacks.rear : (site.setbacks[y.side] ?? site.setbacks.side)) : undefined
                const short = req !== undefined && len < req - 0.5
                const key = `y${y.side}`
                return (
                  <g key={key} data-tool="yard" style={{ pointerEvents: 'all', cursor: 'pointer' }} onPointerEnter={() => setHover(key)} onPointerLeave={() => setHover(null)} onClick={(e) => openYard(y, e)} onPointerDown={(e) => e.stopPropagation()}>
                    <circle cx={y.mid.x} cy={y.mid.y} r={hit} fill={hover === key || drag ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,0.001)'} stroke={short ? '#dc2626' : '#3b82f6'} strokeWidth={hover === key || drag ? 2 / s : 0} />
                    {(hover === key || drag) && (
                      <text x={y.mid.x} y={y.mid.y + 4 / s} textAnchor="middle" fontSize={12 / s} fontFamily="IBM Plex Mono, ui-monospace, monospace" fontWeight={600} fill={short ? '#dc2626' : '#1d4ed8'}>
                        {fmtIn(len)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )}
          {tb && (
            <rect data-tool="titleblock" x={tb.x} y={tb.y} width={tb.w} height={tb.h} fill={hover === 'tb' ? 'rgba(59,130,246,.06)' : 'rgba(0,0,0,0.001)'} stroke={hover === 'tb' ? 'rgba(59,130,246,.8)' : 'none'} strokeWidth={2 / s} style={{ pointerEvents: 'all', cursor: 'text' }} onPointerEnter={() => setHover('tb')} onPointerLeave={() => setHover(null)} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onEditProject() }} />
          )}
        </svg>
      </div>

      {/* hints */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1">
        {site && site.footprint.length >= 3 && (
          <div className="rounded-md border border-border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground">
            {drag ? 'release to place · Shift for 1" steps' : hover === 'house' ? 'drag the house on the lot' : hover?.startsWith('y') ? 'click to type this yard' : hover?.startsWith('e') ? 'click to set the required yard on this lot line' : 'drag the house · click a yard dimension · click a lot line'}
          </div>
        )}
        {hover === 'tb' && <div className="rounded-md border border-border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground">click to edit the project record</div>}
        {busy && <div className="rounded-md border border-border bg-background/90 px-2 py-1 text-[11px] text-foreground">drawing {sheet.number}…</div>}
        {err && <div className="rounded-md border border-destructive/40 bg-background/95 px-2 py-1 text-[11px] text-destructive">{err}</div>}
      </div>
      <div className="pointer-events-none absolute right-3 bottom-3 rounded-md border border-border bg-background/90 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        {Math.round(s * 100)}% · wheel zoom · drag pan · dbl-click fit
      </div>

      {/* popover */}
      {pop && (
        <div className="fixed z-[80] w-64 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl" style={{ left: Math.min(pop.at.x + 12, window.innerWidth - 272), top: Math.min(pop.at.y + 12, window.innerHeight - 140) }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="mb-1 font-medium text-xs">{pop.kind === 'yard' ? YARD_NAME[pop.yard.side] : `Required ${YARD_NAME[pop.edge.kind]?.toLowerCase() ?? pop.edge.kind}`}</div>
          <div className="mb-2 text-[11px] text-muted-foreground">{pop.kind === 'yard' ? `now ${fmtIn(pop.yard.lenIn)} — type the yard you want and the house slides` : `now ${pop.edge.distIn > 0 ? fmtIn(pop.edge.distIn) : 'not set'} — leave empty to clear`}</div>
          <form onSubmit={(e) => { e.preventDefault(); submitPop() }} className="flex gap-1.5">
            <input autoFocus className="w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono text-xs text-foreground" value={popText} onChange={(e) => setPopText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setPop(null) }} placeholder={`20'-0"`} />
            <button type="submit" className="rounded-md bg-primary px-2.5 py-1 text-primary-foreground text-xs">Set</button>
          </form>
        </div>
      )}
    </div>
  )
}
