'use client'

import {
  type AnyNodeId,
  type Control,
  type ControlValue,
  type ItemNode,
  pointInPolygon,
  sceneRegistry,
  useInteractive,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { createPortal, useFrame } from '@react-three/fiber'
import { useState } from 'react'
import { type Object3D, Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import useViewer from '../../store/use-viewer'

const _tempVec = new Vector3()

// ---- Parent: one overlay per interactive item ----

export const InteractiveSystem = () => {
  const interactiveNodeIds = useScene(
    useShallow((state) =>
      Object.values(state.nodes)
        .filter((n): n is ItemNode => n.type === 'item' && n.asset.interactive != null)
        .map((n) => n.id),
    ),
  )

  return (
    <>
      {interactiveNodeIds.map((id) => (
        <ItemControlsOverlay key={id} nodeId={id} />
      ))}
    </>
  )
}

// ---- Child: polls sceneRegistry then portals controls into the item group ----

const ItemControlsOverlay = ({ nodeId }: { nodeId: AnyNodeId }) => {
  const node = useScene((state) => state.nodes[nodeId] as ItemNode)
  const [itemObj, setItemObj] = useState<Object3D | null>(null)

  useFrame(() => {
    if (itemObj) return
    const obj = sceneRegistry.nodes.get(nodeId)
    if (obj) setItemObj(obj)
  })

  const controlValues = useInteractive(useShallow((state) => state.items[nodeId]?.controlValues))
  const setControlValue = useInteractive((state) => state.setControlValue)

  const zoneId = useViewer((s) => s.selection.zoneId)
  const zonePolygon = useScene((s) => {
    if (!zoneId) return null
    const z = s.nodes[zoneId] as ZoneNode | undefined
    return z?.polygon ?? null
  })

  if (!(itemObj && controlValues && node?.asset.interactive)) return null

  const { controls } = node.asset.interactive
  const [, height] = node.asset.dimensions

  let opacity = 0
  let pointerEvents: 'auto' | 'none' = 'none'
  if (zoneId && zonePolygon?.length) {
    itemObj.getWorldPosition(_tempVec)
    const inside = pointInPolygon(_tempVec.x, _tempVec.z, zonePolygon)
    opacity = inside ? 1 : 0.1
    pointerEvents = inside ? 'auto' : 'none'
  }

  return createPortal(
    <Html center distanceFactor={8} occlude position={[0, height + 0.3, 0]} zIndexRange={[20, 0]}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          borderRadius: 8,
          padding: '8px 12px',
          minWidth: 120,
          pointerEvents,
          userSelect: 'none',
          opacity,
          transition: 'opacity 0.3s ease',
        }}
      >
        {controls.map((control, i) => (
          <ControlWidget
            control={control}
            key={i}
            onChange={(v) => setControlValue(nodeId, i, v)}
            value={controlValues[i] ?? false}
          />
        ))}
      </div>
    </Html>,
    itemObj,
  )
}

// ---- Control widgets ----

const ControlWidget = ({
  control,
  value,
  onChange,
}: {
  control: Control
  value: ControlValue
  onChange: (v: ControlValue) => void
}) => {
  const labelStyle: React.CSSProperties = {
    color: 'white',
    fontSize: 11,
    fontFamily: 'monospace',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  }

  if (control.kind === 'toggle') {
    return (
      <button
        onClick={() => onChange(!value)}
        style={{
          background: value ? '#4ade80' : '#374151',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          padding: '4px 8px',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'monospace',
          transition: 'background 0.2s',
        }}
      >
        {control.label ?? (value ? 'On' : 'Off')}
      </button>
    )
  }

  if (control.kind === 'slider') {
    return (
      <label style={labelStyle}>
        <span>
          {control.label}: {value}
          {control.unit ? ` ${control.unit}` : ''}
        </span>
        <input
          max={control.max}
          min={control.min}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          step={control.step}
          type="range"
          value={value as number}
        />
      </label>
    )
  }

  if (control.kind === 'temperature') {
    return (
      <label style={labelStyle}>
        <span>
          {control.label}: {value}°{control.unit}
        </span>
        <input
          max={control.max}
          min={control.min}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          step={1}
          type="range"
          value={value as number}
        />
      </label>
    )
  }

  return null
}
