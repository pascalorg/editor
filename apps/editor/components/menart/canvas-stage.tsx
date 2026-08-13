'use client'

import { CANVAS_ROOM, CANVAS_WALL } from './scene-data'
import type { ViewMode } from './types'

/** Plan footprint in px. Every wall strip below is placed inside this box. */
const PLAN_W = 360
const PLAN_H = 250
const WALL_T = 16

// Masonry tones, not theme tokens: the plan reads as a physical model sitting
// on the canvas, so it keeps the same colours in both themes.
const SLAB = '#d8d2c4'
const WALL = '#efece4'
const WALL_SHADE = '#c4bba6'
const GLAZING = '#cdd8df'

const GRID_IMAGE =
  'linear-gradient(var(--rule) 1px, transparent 1px), linear-gradient(90deg, var(--rule) 1px, transparent 1px)'

function FloorPlan() {
  return (
    <div
      className="relative shadow-[0_40px_80px_rgba(0,0,0,0.45)]"
      style={{ background: SLAB, height: PLAN_H, width: PLAN_W }}
    >
      <div
        className="absolute top-0 left-0"
        style={{ background: WALL, height: WALL_T, width: PLAN_W }}
      />
      <div
        className="absolute bottom-0 left-0"
        style={{ background: WALL, height: WALL_T, width: PLAN_W }}
      />
      <div
        className="absolute top-0 left-0"
        style={{ background: WALL, height: PLAN_H, width: WALL_T }}
      />
      <div
        className="absolute top-0 right-0"
        style={{ background: WALL_SHADE, height: PLAN_H, width: WALL_T }}
      />
      <div
        className="absolute top-0"
        style={{ background: WALL, height: PLAN_H, left: 158, width: WALL_T }}
      />
      {/* Doorway punched through the party wall — the slab tone reads as the gap. */}
      <div
        className="absolute"
        style={{ background: SLAB, height: 58, left: 158, top: 100, width: WALL_T }}
      />
      <div
        className="absolute top-0"
        style={{ background: GLAZING, height: WALL_T, left: 46, width: 76 }}
      />
      <div
        className="absolute bottom-0"
        style={{ background: GLAZING, height: WALL_T, left: 236, width: 76 }}
      />
      {/* The selected run — the wall the dimension pill is measuring. */}
      <div
        className="absolute top-0 left-0 bg-[var(--accent)] shadow-[0_0_0_2px_rgba(236,48,19,0.35)]"
        style={{ height: 110, width: WALL_T }}
      />
    </div>
  )
}

function DimensionPill() {
  return (
    <div className="flex items-center gap-2 border-2 border-[var(--accent)] bg-[var(--ground)] px-2.5 py-1">
      <span className="mn-mono font-semibold text-[13px] text-[var(--ink)] tracking-[0.02em]">
        {CANVAS_WALL.length}
      </span>
      <span className="h-3 w-[2px] bg-[var(--rule-strong)]" />
      <span className="mn-mono text-[11px] text-[var(--muted)]">{CANVAS_WALL.thickness}</span>
    </div>
  )
}

function RoomLabel() {
  return (
    <div className="flex items-center gap-1.5 border border-[var(--rule-strong)] bg-[var(--ground)] px-2 py-0.5">
      <span className="mn-mono whitespace-nowrap text-[11px] text-[var(--muted)]">
        {CANVAS_ROOM.label} · {CANVAS_ROOM.area}
      </span>
    </div>
  )
}

interface CanvasPaneProps {
  mode: '3d' | '2d'
  /** Camera yaw in degrees, applied on top of the plan's default isometry. */
  spin: number
  showDimension: boolean
}

function CanvasPane({ mode, spin, showDimension }: CanvasPaneProps) {
  if (mode === '2d') {
    return (
      <div className="relative h-full min-w-0 flex-1 overflow-hidden bg-[var(--canvas)]">
        <div
          className="absolute inset-0 opacity-50"
          style={{ backgroundImage: GRID_IMAGE, backgroundSize: '38px 38px' }}
        />
        <div
          className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2"
          style={{ height: PLAN_H, width: PLAN_W }}
        >
          <FloorPlan />
          {showDimension && (
            <div className="-translate-y-1/2 absolute top-[55px] left-6">
              <DimensionPill />
            </div>
          )}
          <div
            className="-translate-x-1/2 -translate-y-1/2 absolute"
            style={{ left: 87, top: 125 }}
          >
            <RoomLabel />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full min-w-0 flex-1 overflow-hidden bg-[var(--canvas)]">
      <div
        className="absolute right-[-25%] bottom-0 left-[-25%] h-[64%] opacity-50"
        style={{
          backgroundImage: GRID_IMAGE,
          backgroundSize: '72px 38px',
          transform: 'perspective(560px) rotateX(64deg)',
          transformOrigin: 'bottom center',
        }}
      />
      <div
        className="absolute top-[52%] left-1/2"
        style={{
          transform: `translate(-50%, -50%) rotateX(58deg) rotateZ(${spin - 45}deg)`,
          transition: 'transform 320ms ease',
        }}
      >
        <FloorPlan />
      </div>
      {showDimension && (
        <div className="absolute top-[44%] left-[46%]">
          <DimensionPill />
        </div>
      )}
      <div className="absolute top-[64%] left-[38%]">
        <RoomLabel />
      </div>
    </div>
  )
}

export interface CanvasStageProps {
  viewMode: ViewMode
  spin: number
  showDimension: boolean
}

export function CanvasStage({ viewMode, spin, showDimension }: CanvasStageProps) {
  return (
    <div className="absolute inset-0 flex">
      {viewMode === 'split' ? (
        <>
          <CanvasPane mode="3d" showDimension={showDimension} spin={spin} />
          <div className="w-[2px] flex-shrink-0 bg-[var(--rule-strong)]" />
          <CanvasPane mode="2d" showDimension={showDimension} spin={spin} />
        </>
      ) : (
        <CanvasPane mode={viewMode} showDimension={showDimension} spin={spin} />
      )}
    </div>
  )
}
