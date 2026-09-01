'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePerfActionReceipts } from '../../lib/perf-actions'
import { usePerfStats } from '../../lib/perf-panel-store'

// Rendered OUTSIDE <Canvas> (drei <Html> wrappers carry a camera-driven
// transform, which turns position:fixed into "fixed relative to the wrapper"
// and made the old overlay drift with the camera). Portal to <body> so no
// ancestor transform/overflow can capture it.

const STORAGE_KEY = 'pascal-perf-panel'
const PANEL_WIDTH = 248

type PanelPlacement = { x: number; y: number; docked: 'left' | 'right' | null }

function loadPlacement(): PanelPlacement {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as PanelPlacement
  } catch {}
  return { x: 8, y: 8, docked: null }
}

function savePlacement(placement: PanelPlacement): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(placement))
  } catch {}
}

function fpsColor(fps: number): string {
  return fps < 30 ? '#f87171' : fps < 48 ? '#fbbf24' : '#4ade80'
}

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`
}

const label: React.CSSProperties = { color: '#8b90a0' }
const value: React.CSSProperties = { textAlign: 'right', color: '#e7e9f0' }
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: 12,
}
const section: React.CSSProperties = {
  marginTop: 6,
  paddingTop: 6,
  borderTop: '1px solid rgba(255,255,255,0.07)',
}
const clip: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const Row = ({ name, children }: { name: string; children: React.ReactNode }) => (
  <>
    <span style={label}>{name}</span>
    <span style={value}>{children}</span>
  </>
)

const ACTION_TRACK_LINES = 4
const OLDER_ACTION_LINES = 2

/**
 * Cost of the last edit gesture, from the action ledger — see lib/perf-actions.ts
 * for what counts as settled. Amber total = the action never settled (the user
 * started another one, or it blew the settle budget).
 */
const LastAction = () => {
  const [latest, ...older] = usePerfActionReceipts()
  if (!latest) return null
  return (
    <div style={section}>
      <div style={{ ...label, opacity: 0.7 }}>last action</div>
      <div style={grid}>
        <span style={{ ...value, textAlign: 'left', ...clip }}>
          {latest.detail ? `${latest.name} ${latest.detail}` : latest.name}
        </span>
        <span style={{ ...value, color: latest.outcome === 'settled' ? '#e7e9f0' : '#fbbf24' }}>
          {latest.outcome === 'settled'
            ? `${latest.totalMs.toFixed(0)}ms`
            : `${latest.totalMs.toFixed(0)}ms ${latest.outcome}`}
        </span>
      </div>
      <div style={{ ...label, ...clip }}>
        {`drag ${latest.dragMs.toFixed(0)} / settle ${latest.settleMs.toFixed(0)} (${latest.settleFrames} frames)`}
      </div>
      {latest.tracks.slice(0, ACTION_TRACK_LINES).map((track) => (
        <div key={track.name} style={grid}>
          <span style={label}>{track.name}</span>
          <span style={value}>{`${track.totalMs.toFixed(1)}ms (${track.count}×)`}</span>
        </div>
      ))}
      {older.slice(0, OLDER_ACTION_LINES).map((receipt) => (
        <div key={receipt.endedAt} style={{ ...grid, opacity: 0.55 }}>
          <span style={{ ...label, ...clip }}>{receipt.name}</span>
          <span style={value}>{`${receipt.totalMs.toFixed(0)}ms`}</span>
        </div>
      ))}
    </div>
  )
}

export const PerfPanel = () => {
  const stats = usePerfStats()
  const [placement, setPlacement] = useState<PanelPlacement>(loadPlacement)
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => savePlacement(placement), [placement])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = {
      pointerId: e.pointerId,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const el = panelRef.current
    const w = el?.offsetWidth ?? PANEL_WIDTH
    const h = el?.offsetHeight ?? 200
    setPlacement((p) => ({
      ...p,
      x: Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - w),
      y: Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - h),
    }))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null
  }, [])

  const dock = useCallback(() => {
    setPlacement((p) => ({
      ...p,
      docked: p.x + PANEL_WIDTH / 2 < window.innerWidth / 2 ? 'left' : 'right',
    }))
  }, [])

  if (typeof document === 'undefined') return null

  if (placement.docked) {
    const side = placement.docked
    return createPortal(
      <button
        data-pascal-perf-panel="docked"
        onClick={() => setPlacement((p) => ({ ...p, docked: null }))}
        style={{
          position: 'fixed',
          top: Math.min(placement.y, window.innerHeight - 40),
          [side]: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          border: '1px solid rgba(255,255,255,0.1)',
          [side === 'left' ? 'borderLeft' : 'borderRight']: 'none',
          borderRadius: side === 'left' ? '0 999px 999px 0' : '999px 0 0 999px',
          background: 'rgba(16,18,27,0.85)',
          backdropFilter: 'blur(12px)',
          color: stats ? fpsColor(stats.fps) : '#e7e9f0',
          font: '600 11px ui-monospace, SFMono-Regular, Menlo, monospace',
          cursor: 'pointer',
        }}
        type="button"
      >
        {stats ? `${stats.fps} fps` : 'perf'}
      </button>,
      document.body,
    )
  }

  return createPortal(
    <div
      data-pascal-perf-panel="open"
      ref={panelRef}
      style={{
        position: 'fixed',
        left: placement.x,
        top: placement.y,
        width: PANEL_WIDTH,
        zIndex: 1000,
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.09)',
        background: 'rgba(16,18,27,0.85)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
        color: '#e7e9f0',
        font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
        lineHeight: 1.6,
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          cursor: 'grab',
          background: 'rgba(255,255,255,0.04)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          touchAction: 'none',
        }}
      >
        <span style={{ fontWeight: 600, letterSpacing: 0.2 }}>Performance</span>
        <span style={{ marginLeft: 'auto', color: stats ? fpsColor(stats.fps) : '#8b90a0' }}>
          {stats ? `${stats.fps} fps` : '—'}
        </span>
        <button
          aria-label="Dock panel to the side"
          onClick={dock}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            border: 'none',
            borderRadius: 999,
            width: 18,
            height: 18,
            background: 'rgba(255,255,255,0.08)',
            color: '#c3c7d4',
            cursor: 'pointer',
            font: '10px ui-monospace, monospace',
            lineHeight: '18px',
            padding: 0,
          }}
          type="button"
        >
          ×
        </button>
      </div>
      {stats ? (
        <div style={{ padding: '8px 10px' }}>
          <div style={grid}>
            <Row name="frame">
              {stats.frameMs > 0
                ? `${stats.frameMs.toFixed(1)}ms cpu (max ${stats.frameMaxMs.toFixed(1)})`
                : '—'}
            </Row>
            <Row name="encode">
              {stats.encodeMs > 0
                ? `${stats.encodeMs.toFixed(1)}ms (max ${stats.encodeMaxMs.toFixed(1)})`
                : '—'}
            </Row>
            <Row name="gpu">
              {stats.gpuTracked
                ? `${stats.gpuMs.toFixed(1)}ms (max ${stats.gpuMaxMs.toFixed(1)})`
                : 'no timestamp-query'}
            </Row>
            <Row name="queue">
              {stats.queueMs > 0
                ? `${stats.queueMs.toFixed(1)}ms (max ${stats.queueMaxMs.toFixed(1)})`
                : '—'}
            </Row>
            <Row name="draw">{stats.drawCalls}</Row>
            <Row name="tri">{`${(stats.triangles / 1000).toFixed(1)}k`}</Row>
            <Row name="mem">
              {`${stats.geometries} geo  ${stats.textures} tex  ${mb(stats.gpuBytes)}`}
            </Row>
            <Row name="heap">{stats.heapBytes > 0 ? mb(stats.heapBytes) : '—'}</Row>
            <Row name="dirty">
              {stats.dirty}
              {stats.dirtyDetail ? ` (${stats.dirtyDetail})` : ''}
            </Row>
            <Row name="visible">
              {`${stats.meshes} mesh  ${stats.lines} line  ${stats.lights} light`}
            </Row>
          </div>
          <LastAction />
          {stats.tracks.length > 0 && (
            <div style={section}>
              {stats.tracks.map((t) => (
                <div key={t.name} style={grid}>
                  <span style={label}>{t.name}</span>
                  <span style={value}>
                    {`${t.totalMs.toFixed(1)}ms (${t.count}×, max ${t.maxMs.toFixed(1)})`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '8px 10px', color: '#8b90a0' }}>waiting for samples…</div>
      )}
    </div>,
    document.body,
  )
}

export default PerfPanel
