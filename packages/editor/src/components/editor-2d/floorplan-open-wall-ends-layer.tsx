'use client'

import type { OpenWallEnd } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  useOpenWallEndFocus,
  useOpenWallEnds,
  useOpenWallEndsSuppressed,
} from '../../hooks/use-open-wall-ends'
import { openWallEndKey, openWallEndLabel } from '../../lib/floorplan/open-wall-ends'
import { MEASUREMENT_DANGLING_COLOR } from '../../lib/measurements'
import useEditor from '../../store/use-editor'
import { isViewVisible, VIEW_2D } from '../../store/view-layout'
import { JoinWallsPill } from '../editor/join-walls-pill'
import { OpenWallEndsHint } from '../editor/open-wall-ends-hint'
import { useFloorplanRender } from './floorplan-render-context'
import { resolveFloorplanLabelAngle } from './renderers/floorplan-label-angle'

function sceneScreenPoint(point: [number, number]): { left: number; top: number } | null {
  const scene = document.querySelector<SVGGElement>('[data-floorplan-scene]')
  const svg = scene?.ownerSVGElement
  const ctm = scene?.getScreenCTM()
  if (!(svg && ctm)) return null
  const screen = new DOMPoint(point[0], point[1]).matrixTransform(ctm)
  return { left: screen.x, top: screen.y }
}

/**
 * Shows where walls look joined but are not, so a room can't close: a red dot
 * on each open end, a dashed line to the wall it nearly meets with what is
 * wrong ("4 cm gap"), and — while drawing — the walls that bound no room dimmed. Hover or click a
 * dot for "Join walls", which applies core's join planner as one undo step.
 *
 * On while walls or rooms are being drawn (the wall tool's variants, Divide);
 * otherwise only when a wall that bounds no room has a near miss.
 */
export const FloorplanOpenWallEndsLayer = memo(function FloorplanOpenWallEndsLayer() {
  const visible = useEditor((state) => isViewVisible(state, VIEW_2D))
  const suppressed = useOpenWallEndsSuppressed()
  return visible && !suppressed ? <ActiveOpenWallEndsLayer /> : null
})

const ActiveOpenWallEndsLayer = memo(function ActiveOpenWallEndsLayer() {
  const unit = useViewer((state) => state.unit)
  const renderContext = useFloorplanRender()
  const { drawing, drafting, ends: visibleEnds, roomlessWallIds, shown } = useOpenWallEnds()
  const focus = useOpenWallEndFocus(visibleEnds, drafting)
  const { activeEnd, activeKey } = focus

  if (!shown) return null

  const unitsPerPixel = Math.max(renderContext?.unitsPerPixel ?? 0.01, 1e-6)
  const sceneRotationDeg = renderContext?.sceneRotationDeg ?? 0
  return (
    <g data-open-wall-ends-layer="">
      {drawing && roomlessWallIds.length > 0 ? (
        <style>
          {`${roomlessWallIds
            .map(
              (id) =>
                `[data-floorplan-scene] .floorplan-registry-entry[data-node-id="${CSS.escape(id)}"]`,
            )
            .join(',')}{opacity:0.4}`}
        </style>
      ) : null}
      {visibleEnds.map((end) => {
        const key = openWallEndKey(end)
        return (
          <OpenWallEndMarker
            active={key === activeKey}
            end={end}
            interactive={!!end.candidate && !drafting}
            key={key}
            label={openWallEndLabel(end, unit)}
            onHoverEnd={focus.releaseHover}
            onHoverStart={() => focus.keepHover(key)}
            onPin={() => focus.togglePin(key)}
            sceneRotationDeg={sceneRotationDeg}
            unitsPerPixel={unitsPerPixel}
          />
        )
      })}
      {activeEnd ? (
        <FloorplanJoinWallsPill
          end={activeEnd}
          onHoverEnd={focus.releaseHover}
          onHoverStart={() => focus.keepHover(openWallEndKey(activeEnd))}
          onJoin={() => focus.join(activeEnd)}
          refusal={focus.refusal}
        />
      ) : null}
      <OpenWallEndsHint ends={visibleEnds} onShow={(end) => focus.pin(openWallEndKey(end))} />
    </g>
  )
})

function OpenWallEndMarker({
  active,
  end,
  label,
  interactive,
  onHoverEnd,
  onHoverStart,
  onPin,
  sceneRotationDeg,
  unitsPerPixel: upp,
}: {
  active: boolean
  end: OpenWallEnd
  label: string | null
  interactive: boolean
  onHoverEnd: () => void
  onHoverStart: () => void
  onPin: () => void
  sceneRotationDeg: number
  unitsPerPixel: number
}) {
  const [x, z] = end.point
  const candidate = end.candidate
  const labelAnchor = candidate
    ? [(x + candidate.point[0]) / 2, (z + candidate.point[1]) / 2]
    : [x, z]
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

  return (
    <g>
      {candidate ? (
        <>
          <line
            pointerEvents="none"
            stroke={MEASUREMENT_DANGLING_COLOR}
            strokeDasharray={`${4 * upp} ${3 * upp}`}
            strokeLinecap="round"
            strokeWidth={1.5 * upp}
            x1={x}
            x2={candidate.point[0]}
            y1={z}
            y2={candidate.point[1]}
          />
          <circle
            cx={candidate.point[0]}
            cy={candidate.point[1]}
            fill="none"
            pointerEvents="none"
            r={3.5 * upp}
            stroke={MEASUREMENT_DANGLING_COLOR}
            strokeWidth={1.5 * upp}
          />
        </>
      ) : null}
      <circle
        cx={x}
        cy={z}
        fill={MEASUREMENT_DANGLING_COLOR}
        pointerEvents="none"
        r={(active ? 6.5 : 5) * upp}
        stroke="#ffffff"
        strokeWidth={1.5 * upp}
      />
      {/* Hit target larger than the dot so it is easy to catch at any zoom. */}
      <circle
        aria-label={label ?? 'Wall end not joined'}
        cx={x}
        cy={z}
        data-open-wall-end=""
        fill="transparent"
        onClick={(event) => {
          event.stopPropagation()
          onPin()
        }}
        onPointerDown={stop}
        onPointerEnter={interactive ? onHoverStart : undefined}
        onPointerLeave={interactive ? onHoverEnd : undefined}
        onPointerUp={stop}
        pointerEvents={interactive ? 'all' : 'none'}
        r={11 * upp}
        role="button"
        style={{ cursor: 'pointer' }}
      />
      {label ? (
        <OpenWallEndLabel
          point={labelAnchor as [number, number]}
          sceneRotationDeg={sceneRotationDeg}
          text={label}
          unitsPerPixel={upp}
        />
      ) : null}
    </g>
  )
}

function OpenWallEndLabel({
  point,
  sceneRotationDeg,
  text,
  unitsPerPixel: upp,
}: {
  point: [number, number]
  sceneRotationDeg: number
  text: string
  unitsPerPixel: number
}) {
  const fontSize = 10 * upp
  const padX = 6 * upp
  const width = text.length * 5.6 * upp + padX * 2
  const height = fontSize + 6 * upp
  const angle = resolveFloorplanLabelAngle(0, sceneRotationDeg, true)
  return (
    <g
      pointerEvents="none"
      transform={`translate(${point[0]} ${point[1]}) rotate(${angle}) translate(0 ${-18 * upp})`}
    >
      <rect
        fill="#ffffff"
        height={height}
        opacity={0.94}
        rx={height / 2}
        stroke={MEASUREMENT_DANGLING_COLOR}
        strokeWidth={0.75 * upp}
        width={width}
        x={-width / 2}
        y={-height / 2}
      />
      <text
        dominantBaseline="middle"
        fill={MEASUREMENT_DANGLING_COLOR}
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize={fontSize}
        fontWeight="600"
        textAnchor="middle"
      >
        {text}
      </text>
    </g>
  )
}

function FloorplanJoinWallsPill({
  end,
  onHoverEnd,
  onHoverStart,
  onJoin,
  refusal,
}: {
  end: OpenWallEnd
  onHoverEnd: () => void
  onHoverStart: () => void
  onJoin: () => void
  refusal: string | null
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Follows pan / zoom: the scene group's screen transform changes without a
  // React render, so track it per frame while the pill is up.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const next = sceneScreenPoint(end.point)
      setPosition((current) =>
        current && next && current.left === next.left && current.top === next.top ? current : next,
      )
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [end.point])

  if (!position) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-30 flex w-max flex-col items-center"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translate(-50%, calc(-100% - 40px))',
      }}
    >
      <JoinWallsPill
        onHoverEnd={onHoverEnd}
        onHoverStart={onHoverStart}
        onJoin={onJoin}
        refusal={refusal}
      />
    </div>,
    document.body,
  )
}
