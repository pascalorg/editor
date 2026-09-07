'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { DoubleSide, Shape } from 'three'
import { XR_WAND_PANEL_LAYOUT } from './panel-layout'
import { SpatialLine, shapeLinePoints } from './spatial-line'
import { SpatialText } from './spatial-text'
import { XR_WAND_THEME } from './theme'

declare global {
  var __pascalXRHoveredTarget: string | undefined
  var __pascalXRLastPointerEvent: string | undefined
}

const { accent, accentLine, border, disabled: disabledColor, muted, panel, text } = XR_WAND_THEME
const LEFT_CHEVRON = [
  [0.012, 0.018, 0.012],
  [-0.012, 0, 0.012],
  [0.012, -0.018, 0.012],
] as [number, number, number][]
const RIGHT_CHEVRON = LEFT_CHEVRON.map(([x, y, z]) => [-x, y, z] as [number, number, number])

function roundedShape(width: number, height: number, radius = 0.018) {
  const shape = new Shape()
  const halfWidth = width / 2
  const halfHeight = height / 2
  const r = Math.min(radius, halfWidth, halfHeight)
  shape.moveTo(-halfWidth + r, -halfHeight)
  shape.lineTo(halfWidth - r, -halfHeight)
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + r)
  shape.lineTo(halfWidth, halfHeight - r)
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - r, halfHeight)
  shape.lineTo(-halfWidth + r, halfHeight)
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - r)
  shape.lineTo(-halfWidth, -halfHeight + r)
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + r, -halfHeight)
  shape.closePath()
  return shape
}

export function SpatialButton({
  children,
  color = text,
  disabled = false,
  name,
  onClick,
  position,
  selected = false,
  size,
}: {
  children?: ReactNode
  color?: string
  disabled?: boolean
  name?: string
  onClick?: () => void
  position: [number, number, number]
  selected?: boolean
  size: [number, number]
}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const hoverLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shape = useMemo(() => roundedShape(size[0], size[1]), [size])
  const points = useMemo(() => shapeLinePoints(shape), [shape])

  useEffect(
    () => () => {
      if (hoverLeaveTimer.current) clearTimeout(hoverLeaveTimer.current)
    },
    [],
  )

  return (
    <group position={position} scale={pressed && !disabled ? 0.96 : 1}>
      <mesh
        layers={EDITOR_LAYER}
        name={name}
        onClick={(event) => {
          event.stopPropagation()
          if (process.env.NODE_ENV === 'development') {
            globalThis.__pascalXRLastPointerEvent = `click:${name ?? ''}`
          }
          if (!disabled) onClick?.()
        }}
        onPointerCancel={(event) => {
          event.object.releasePointerCapture?.(event.pointerId)
          setPressed(false)
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.object.setPointerCapture?.(event.pointerId)
          if (process.env.NODE_ENV === 'development') {
            globalThis.__pascalXRLastPointerEvent = `down:${name ?? ''}`
          }
          if (!disabled) setPressed(true)
        }}
        onPointerEnter={() => {
          if (disabled) return
          if (hoverLeaveTimer.current) clearTimeout(hoverLeaveTimer.current)
          setHovered(true)
          if (process.env.NODE_ENV === 'development') globalThis.__pascalXRHoveredTarget = name
        }}
        onPointerLeave={() => {
          hoverLeaveTimer.current = setTimeout(() => setHovered(false), 75)
          setPressed(false)
          if (globalThis.__pascalXRHoveredTarget === name) {
            globalThis.__pascalXRHoveredTarget = undefined
          }
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          event.object.releasePointerCapture?.(event.pointerId)
          if (process.env.NODE_ENV === 'development') {
            globalThis.__pascalXRLastPointerEvent = `up:${name ?? ''}`
          }
          setPressed(false)
        }}
        position={[0, 0, 0.004]}
      >
        <shapeGeometry args={[shape, 4]} />
        <meshBasicMaterial
          color={selected ? accent : color}
          depthWrite={false}
          opacity={disabled ? 0.02 : selected ? 0.28 : hovered ? 0.12 : 0.06}
          side={DoubleSide}
          transparent
        />
      </mesh>
      <SpatialLine
        color={disabled ? disabledColor : selected ? accentLine : border}
        lineWidth={selected ? 2.5 : 1}
        opacity={disabled ? 0.25 : 0.85}
        points={points}
        transparent
      />
      {children}
    </group>
  )
}

export function PanelFace() {
  const shape = useMemo(
    () =>
      roundedShape(
        XR_WAND_PANEL_LAYOUT.faceWidth,
        XR_WAND_PANEL_LAYOUT.faceHeight,
        XR_WAND_PANEL_LAYOUT.faceCornerRadius,
      ),
    [],
  )
  const points = useMemo(() => shapeLinePoints(shape), [shape])
  return (
    <>
      <mesh layers={EDITOR_LAYER} position={[0, 0, -0.012]}>
        <shapeGeometry args={[shape, 8]} />
        <meshBasicMaterial color={panel} depthWrite opacity={1} />
      </mesh>
      <SpatialLine color={border} lineWidth={1.4} opacity={0.9} points={points} />
    </>
  )
}

export function PanelHeader({
  mark,
  onDelete,
  title,
}: {
  mark?: string
  onDelete?: () => void
  title: string
}) {
  return (
    <>
      <SpatialText
        anchorX="left"
        anchorY="middle"
        color={text}
        fontSize={0.052}
        position={[-0.35, 0.45, 0.012]}
      >
        {title}
      </SpatialText>
      {mark && (
        <SpatialText
          anchorX="right"
          anchorY="middle"
          color={muted}
          fontSize={0.024}
          position={[onDelete ? 0.08 : 0.35, 0.45, 0.012]}
        >
          {mark}
        </SpatialText>
      )}
      {onDelete && (
        <SpatialButton
          color="#7f1d1d"
          name="xr-setting-delete"
          onClick={onDelete}
          position={[0.29, 0.45, 0]}
          size={[0.14, 0.06]}
        >
          <SpatialText
            anchorX="center"
            anchorY="middle"
            color="#fecaca"
            fontSize={0.017}
            position={[0, 0, 0.012]}
          >
            Delete
          </SpatialText>
        </SpatialButton>
      )}
      <SpatialLine
        color={border}
        opacity={0.7}
        lineWidth={1}
        points={[
          [-0.36, 0.405, 0.01],
          [0.36, 0.405, 0.01],
        ]}
      />
    </>
  )
}

export function PanelHint({
  children,
  position = [0, -0.37, 0.012],
}: {
  children: ReactNode
  position?: [number, number, number]
}) {
  return (
    <SpatialText
      anchorX="center"
      anchorY="middle"
      color={muted}
      fontSize={0.021}
      maxWidth={0.64}
      position={position}
      textAlign="center"
    >
      {children}
    </SpatialText>
  )
}

export function PageArrows({
  name,
  onChange,
  page,
  pageCount,
}: {
  name: string
  onChange: (page: number) => void
  page: number
  pageCount: number
}) {
  return (
    <group position={[0, -0.455, 0]}>
      <SpatialButton
        disabled={page === 0}
        name={`${name}-previous-page`}
        onClick={() => onChange(page - 1)}
        position={[-0.27, 0, 0]}
        size={[0.1, 0.065]}
      >
        <SpatialLine
          color={page === 0 ? disabledColor : text}
          lineWidth={1.5}
          points={LEFT_CHEVRON}
        />
      </SpatialButton>
      <SpatialText
        anchorX="center"
        anchorY="middle"
        color={text}
        fontSize={0.022}
        position={[0, 0, 0.012]}
      >
        {page + 1} / {pageCount}
      </SpatialText>
      <SpatialButton
        disabled={page >= pageCount - 1}
        name={`${name}-next-page`}
        onClick={() => onChange(page + 1)}
        position={[0.27, 0, 0]}
        size={[0.1, 0.065]}
      >
        <SpatialLine
          color={page >= pageCount - 1 ? disabledColor : text}
          lineWidth={1.5}
          points={RIGHT_CHEVRON}
        />
      </SpatialButton>
    </group>
  )
}

export function SettingStepper({
  label,
  max,
  min,
  name,
  onChange,
  step,
  unit,
  value,
}: {
  label: string
  max: number
  min: number
  name: string
  onChange: (value: number) => void
  step: number
  unit?: string
  value: number
}) {
  return (
    <group>
      <SpatialText
        anchorX="left"
        anchorY="middle"
        color={text}
        fontSize={0.025}
        maxWidth={0.3}
        position={[-0.35, 0, 0.012]}
      >
        {label}
      </SpatialText>
      <SpatialButton
        name={`${name}-decrement`}
        onClick={() => onChange(Math.max(min, value - step))}
        position={[0.1, 0, 0]}
        size={[0.085, 0.07]}
      >
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={text}
          fontSize={0.035}
          position={[0, 0, 0.012]}
        >
          −
        </SpatialText>
      </SpatialButton>
      <SpatialText
        anchorX="center"
        anchorY="middle"
        color={text}
        fontSize={0.023}
        position={[0.22, 0, 0.012]}
      >
        {Number(value.toFixed(3))}
        {unit ? ` ${unit}` : ''}
      </SpatialText>
      <SpatialButton
        name={`${name}-increment`}
        onClick={() => onChange(Math.min(max, value + step))}
        position={[0.34, 0, 0]}
        size={[0.085, 0.07]}
      >
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={text}
          fontSize={0.035}
          position={[0, 0, 0.012]}
        >
          +
        </SpatialText>
      </SpatialButton>
    </group>
  )
}

export function SettingChoice({
  label,
  name,
  onClick,
  value,
}: {
  label: string
  name: string
  onClick?: () => void
  value: string
}) {
  return (
    <group>
      <SpatialText
        anchorX="left"
        anchorY="middle"
        color={text}
        fontSize={0.025}
        maxWidth={0.3}
        position={[-0.35, 0, 0.012]}
      >
        {label}
      </SpatialText>
      <SpatialButton
        disabled={!onClick}
        name={name}
        onClick={onClick}
        position={[0.22, 0, 0]}
        size={[0.31, 0.07]}
      >
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={onClick ? text : muted}
          fontSize={0.021}
          maxWidth={0.28}
          position={[0, 0, 0.012]}
        >
          {value}
        </SpatialText>
      </SpatialButton>
    </group>
  )
}

export function SettingCycle({
  label,
  name,
  next,
  previous,
  value,
}: {
  label: string
  name: string
  next: () => void
  previous: () => void
  value: string
}) {
  return (
    <group>
      <SpatialText
        anchorX="left"
        anchorY="middle"
        color={text}
        fontSize={0.025}
        maxWidth={0.25}
        position={[-0.35, 0, 0.012]}
      >
        {label}
      </SpatialText>
      <SpatialButton
        name={`${name}-previous`}
        onClick={previous}
        position={[0.05, 0, 0]}
        size={[0.07, 0.07]}
      >
        <SpatialLine color={text} lineWidth={1.5} points={LEFT_CHEVRON} />
      </SpatialButton>
      <SpatialText
        anchorX="center"
        anchorY="middle"
        color={text}
        fontSize={0.019}
        maxWidth={0.21}
        position={[0.22, 0, 0.012]}
      >
        {value}
      </SpatialText>
      <SpatialButton
        name={`${name}-next`}
        onClick={next}
        position={[0.39, 0, 0]}
        size={[0.07, 0.07]}
      >
        <SpatialLine color={text} lineWidth={1.5} points={RIGHT_CHEVRON} />
      </SpatialButton>
    </group>
  )
}
