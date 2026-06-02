'use client'

import type { DxfRawEntity } from '@pascal-app/core/importers'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// ─── Layer categorisation ─────────────────────────────────────────────────────

export type DxfCategory = 'wall' | 'door' | 'window' | 'furniture' | 'zone' | 'label' | 'other'

export const CATEGORY_CONFIG: Record<
  DxfCategory,
  { color: string; lineWidth: number; zh: string }
> = {
  wall:      { color: '#e2e8f0', lineWidth: 1.5, zh: '墙体' },
  door:      { color: '#fb923c', lineWidth: 1,   zh: '门'   },
  window:    { color: '#38bdf8', lineWidth: 1,   zh: '窗'   },
  furniture: { color: '#f472b6', lineWidth: 0.8, zh: '家具' },
  zone:      { color: '#4ade80', lineWidth: 1,   zh: '房间' },
  label:     { color: '#a78bfa', lineWidth: 0.8, zh: '标注' },
  other:     { color: '#475569', lineWidth: 0.8, zh: '其他' },
}

const RENDER_ORDER: DxfCategory[] = ['other', 'zone', 'furniture', 'window', 'door', 'wall', 'label']

export function getCategory(layer = ''): DxfCategory {
  const u = layer.toUpperCase()
  if (u.includes('WALL') || u.includes('墙')) return 'wall'
  if (u.includes('DOOR') || u.includes('门')) return 'door'
  if (u.includes('WIN') || u.includes('窗')) return 'window'
  if (u.includes('ITEM') || u.includes('FURN') || u.includes('家具')) return 'furniture'
  if (u.includes('ZONE') || u.includes('ROOM') || u.includes('房间') || u.includes('SPACE')) return 'zone'
  if (u.includes('LABEL') || u.includes('ANNO') || u.includes('DIM') || u.includes('标注')) return 'label'
  return 'other'
}

// ─── Filtering ────────────────────────────────────────────────────────────────

const NO_VISUAL = new Set(['HATCH', 'SOLID', 'VIEWPORT'])
const GEOM_TYPES = new Set(['LINE', 'LWPOLYLINE', 'CIRCLE', 'ARC'])
const TEXT_TYPES = new Set(['TEXT', 'MTEXT'])

export type FilterResult = {
  geom: DxfRawEntity[]
  text: DxfRawEntity[]
  downsampled: boolean
  layers: Map<string, DxfCategory> // layer name → category
}

export function filterForPreview(entities: DxfRawEntity[]): FilterResult {
  const layers = new Map<string, DxfCategory>()
  let geom: DxfRawEntity[] = []
  const text: DxfRawEntity[] = []

  for (const e of entities) {
    if (NO_VISUAL.has(e.type)) continue
    const layer = e.layer ?? '0'
    if (!layers.has(layer)) layers.set(layer, getCategory(layer))
    if (TEXT_TYPES.has(e.type)) {
      text.push(e)
    } else if (GEOM_TYPES.has(e.type)) {
      geom.push(e)
    }
  }

  let downsampled = false
  if (geom.length > 8_000) {
    const step = Math.ceil(geom.length / 2_000)
    geom = geom.filter((_, i) => i % step === 0)
    downsampled = true
  } else if (geom.length > 2_000) {
    const important = geom.filter(e => {
      const cat = getCategory(e.layer)
      return cat === 'wall' || cat === 'door' || cat === 'window' || cat === 'zone'
    })
    if (important.length >= 10) geom = important
  }

  return { geom, text, downsampled, layers }
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

type BBox = { minX: number; minY: number; maxX: number; maxY: number }

function computeBbox(geom: DxfRawEntity[]): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (const e of geom) {
    if (e.type === 'LINE') {
      const l = e as unknown as { start?: { x: number; y: number }; end?: { x: number; y: number } }
      if (l.start && l.end) {
        minX = Math.min(minX, l.start.x, l.end.x)
        minY = Math.min(minY, l.start.y, l.end.y)
        maxX = Math.max(maxX, l.start.x, l.end.x)
        maxY = Math.max(maxY, l.start.y, l.end.y)
      }
    } else if (e.type === 'LWPOLYLINE') {
      const p = e as unknown as { vertices?: { x: number; y: number }[] }
      for (const v of (p.vertices ?? [])) {
        if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y
        if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y
      }
    } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
      const c = e as unknown as { center?: { x: number; y: number }; radius: number }
      if (!c.center) continue
      const r = c.radius
      if (c.center.x - r < minX) minX = c.center.x - r
      if (c.center.y - r < minY) minY = c.center.y - r
      if (c.center.x + r > maxX) maxX = c.center.x + r
      if (c.center.y + r > maxY) maxY = c.center.y + r
    }
  }

  return isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

function cleanMText(t: string): string {
  return t
    .replace(/\\[A-Za-z][^;]*;/g, '') // \fFont;, \H2.5;, \C1; etc.
    .replace(/\\[PpNn]/g, ' ')         // paragraph / new paragraph
    .replace(/\\~/g, ' ')              // non-breaking space
    .replace(/\\\\/g, '\\')            // escaped backslash
    .replace(/[{}]/g, '')              // grouping braces
    .trim()
}

// ─── Canvas renderer ──────────────────────────────────────────────────────────

export function renderEntities(
  canvas: HTMLCanvasElement,
  geom: DxfRawEntity[],
  text: DxfRawEntity[],
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const bbox = computeBbox(geom)
  if (!bbox) { ctx.clearRect(0, 0, canvas.width, canvas.height); return }

  const W = canvas.width, H = canvas.height
  const PAD = 20
  const scaleX = (W - PAD * 2) / (bbox.maxX - bbox.minX || 1)
  const scaleY = (H - PAD * 2) / (bbox.maxY - bbox.minY || 1)
  const scale = Math.min(scaleX, scaleY)

  const drawW = (bbox.maxX - bbox.minX) * scale
  const drawH = (bbox.maxY - bbox.minY) * scale
  const ox = PAD + (W - PAD * 2 - drawW) / 2
  const oy = PAD + (H - PAD * 2 - drawH) / 2

  const tx = (x: number) => ox + (x - bbox.minX) * scale
  const ty = (y: number) => H - (oy + (y - bbox.minY) * scale) // Y-flip: DXF Y-up → canvas Y-down

  ctx.clearRect(0, 0, W, H)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Group geometric entities by category
  const groups = new Map<DxfCategory, DxfRawEntity[]>()
  for (const cat of RENDER_ORDER) groups.set(cat, [])
  for (const e of geom) groups.get(getCategory(e.layer))!.push(e)

  // Draw geometry in render order (walls last = on top)
  for (const cat of RENDER_ORDER) {
    if (cat === 'label') continue // label geometry is always just text, handled below
    const batch = groups.get(cat)!
    if (batch.length === 0) continue
    const { color, lineWidth } = CATEGORY_CONFIG[cat]
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth

    // LINE
    const lines = batch.filter(e => e.type === 'LINE')
    if (lines.length > 0) {
      ctx.beginPath()
      for (const e of lines) {
        const l = e as unknown as { start?: { x: number; y: number }; end?: { x: number; y: number } }
        if (!l.start || !l.end) continue
        ctx.moveTo(tx(l.start.x), ty(l.start.y))
        ctx.lineTo(tx(l.end.x), ty(l.end.y))
      }
      ctx.stroke()
    }

    // LWPOLYLINE
    for (const e of batch.filter(f => f.type === 'LWPOLYLINE')) {
      const p = e as unknown as { vertices?: { x: number; y: number }[]; shape?: boolean; closed?: boolean }
      if (!p.vertices || p.vertices.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(tx(p.vertices[0]!.x), ty(p.vertices[0]!.y))
      for (let i = 1; i < p.vertices.length; i++) {
        ctx.lineTo(tx(p.vertices[i]!.x), ty(p.vertices[i]!.y))
      }
      if (p.shape || p.closed) ctx.closePath()
      ctx.stroke()
    }

    // CIRCLE
    const circles = batch.filter(e => e.type === 'CIRCLE')
    if (circles.length > 0) {
      ctx.beginPath()
      for (const e of circles) {
        const ci = e as unknown as { center?: { x: number; y: number }; radius: number }
        if (!ci.center) continue
        const cx = tx(ci.center.x), cy = ty(ci.center.y), r = ci.radius * scale
        ctx.moveTo(cx + r, cy)
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
      }
      ctx.stroke()
    }

    // ARC
    for (const e of batch.filter(f => f.type === 'ARC')) {
      const a = e as unknown as { center?: { x: number; y: number }; radius: number; startAngle: number; endAngle: number }
      if (!a.center) continue
      const cx = tx(a.center.x), cy = ty(a.center.y), r = a.radius * scale
      if (r < 0.5) continue
      // DXF angles are CCW from +X in Y-up space; after Y-flip they become CW.
      ctx.beginPath()
      ctx.arc(cx, cy, r, -(a.startAngle * Math.PI) / 180, -(a.endAngle * Math.PI) / 180, false)
      ctx.stroke()
    }
  }

  // Draw text labels on top of all geometry
  for (const e of text) {
    const { color } = CATEGORY_CONFIG[getCategory(e.layer)]
    ctx.fillStyle = color

    if (e.type === 'TEXT') {
      const t = e as unknown as {
        text?: string
        startPoint?: { x: number; y: number }
        textHeight?: number
        rotation?: number
      }
      if (!t.text || !t.startPoint) continue
      const fontSize = Math.max(7, Math.min((t.textHeight ?? 0.3) * scale, 12))
      ctx.save()
      ctx.font = `${fontSize}px sans-serif`
      ctx.translate(tx(t.startPoint.x), ty(t.startPoint.y))
      if (t.rotation) ctx.rotate((-t.rotation * Math.PI) / 180)
      ctx.fillText(t.text, 0, 0)
      ctx.restore()
    } else if (e.type === 'MTEXT') {
      const t = e as unknown as {
        text?: string
        position?: { x: number; y: number }
        height?: number
        rotation?: number
      }
      if (!t.text || !t.position) continue
      const fontSize = Math.max(7, Math.min((t.height ?? 0.3) * scale, 12))
      ctx.save()
      ctx.font = `${fontSize}px sans-serif`
      ctx.translate(tx(t.position.x), ty(t.position.y))
      if (t.rotation) ctx.rotate((-t.rotation * Math.PI) / 180)
      ctx.fillText(cleanMText(t.text), 0, 0)
      ctx.restore()
    }
  }
}

// ─── Screenshot utility ────────────────────────────────────────────────────────

export function screenshotCanvas(source: HTMLCanvasElement): string {
  const off = document.createElement('canvas')
  off.width = 1024
  off.height = 1024
  const ctx = off.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 1024, 1024)
  ctx.drawImage(source, 0, 0, 1024, 1024)
  return off.toDataURL('image/png')
}

// ─── Category badges (right side of canvas) ──────────────────────────────────

function CategoryBadges({ present }: { present: Set<DxfCategory> }) {
  const cats = (Object.keys(CATEGORY_CONFIG) as DxfCategory[]).filter(
    c => present.has(c) && c !== 'other',
  )
  if (cats.length === 0) return null
  return (
    <div className="pointer-events-none absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
      {cats.map(cat => (
        <span
          key={cat}
          className="rounded border px-1 py-0.5 text-[9px] leading-none"
          style={{
            borderColor: `${CATEGORY_CONFIG[cat].color}50`,
            color: CATEGORY_CONFIG[cat].color,
            background: `${CATEGORY_CONFIG[cat].color}10`,
          }}
        >
          {CATEGORY_CONFIG[cat].zh}
        </span>
      ))}
    </div>
  )
}

// ─── Layer list (below canvas, non-overlapping) ───────────────────────────────

function LayerList({ layers }: { layers: Map<string, DxfCategory> }) {
  if (layers.size === 0) return null
  const entries = [...layers.entries()]
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 border-border/30 border-t px-2 py-1.5">
      {entries.map(([name, cat]) => (
        <div key={name} className="flex items-center gap-1">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: CATEGORY_CONFIG[cat].color }}
          />
          <span className="truncate text-[9px] text-muted-foreground/70" title={name}>
            {name}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface DxfPreviewProps {
  entities: DxfRawEntity[]
  className?: string
  onRenderComplete?: () => void
}

export const DxfPreview = forwardRef<HTMLCanvasElement, DxfPreviewProps>(
  function DxfPreview({ entities, className, onRenderComplete }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    useImperativeHandle(ref, () => canvasRef.current!, [])

    const [downsampled, setDownsampled] = useState(false)
    const [entityCount, setEntityCount] = useState(0)
    const [layers, setLayers] = useState<Map<string, DxfCategory>>(new Map())
    const [presentCategories, setPresentCategories] = useState<Set<DxfCategory>>(new Set())

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      if (entities.length === 0) {
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
        setDownsampled(false)
        setEntityCount(0)
        setLayers(new Map())
        setPresentCategories(new Set())
        return
      }

      const { geom, text, downsampled: ds, layers: lmap } = filterForPreview(entities)
      setDownsampled(ds)
      setEntityCount(geom.length + text.length)
      setLayers(lmap)

      const cats = new Set<DxfCategory>([...lmap.values()])
      setPresentCategories(cats)

      renderEntities(canvas, geom, text)
      onRenderComplete?.()
    }, [entities, onRenderComplete])

    return (
      <div className={cn('rounded-lg border border-border/40 bg-muted/20', className)}>
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="h-72 w-full"
            height={288}
            width={560}
          />
          <CategoryBadges present={presentCategories} />
          {downsampled && (
            <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm">
              已降采样 ({entityCount.toLocaleString()} 实体)
            </span>
          )}
        </div>
        <LayerList layers={layers} />
      </div>
    )
  },
)
