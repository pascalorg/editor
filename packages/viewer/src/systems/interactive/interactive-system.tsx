'use client'

import {
  type AnyNodeId,
  type ItemNode,
  pointInPolygon,
  sceneRegistry,
  useInteractive,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { createPortal, useFrame } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { type Object3D, Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import useViewer from '../../store/use-viewer'
import { ControlWidget } from './control-widget'

const _tempVec = new Vector3()

// ---- Parent: one overlay per interactive item inside the selected zone ----
//
// The <Html> overlays only exist while a zone is selected and the item sits
// inside it. Mounting them unconditionally is not an option: each drei <Html>
// repositions and re-sorts its DOM element on every camera-move frame, and
// with `occlude` it also raycasts the entire scene per overlay per frame. On
// large scenes (hundreds of interactive items) that starves the frame budget
// and the display/z-index churn makes the whole DOM UI flicker.
//
// The child components stay rendered (returning null) so an overlay can fade
// out before its <Html> unmounts.

export const InteractiveSystem = () => {
  const zoneId = useViewer((s) => s.selection.zoneId)
  const zonePolygon = useScene((s) => {
    if (!zoneId) return null
    const z = s.nodes[zoneId] as ZoneNode | undefined
    return z?.polygon ?? null
  })
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
        <ItemControlsOverlay key={id} nodeId={id} zonePolygon={zonePolygon} />
      ))}
    </>
  )
}

// ---- Child: polls sceneRegistry then portals controls into the item group ----

const FADE_MS = 300

const ItemControlsOverlay = ({
  nodeId,
  zonePolygon,
}: {
  nodeId: AnyNodeId
  zonePolygon: ZoneNode['polygon'] | null
}) => {
  const node = useScene((state) => state.nodes[nodeId] as ItemNode)
  const [itemObj, setItemObj] = useState<Object3D | null>(null)

  useFrame(() => {
    if (itemObj) return
    const obj = sceneRegistry.nodes.get(nodeId)
    if (obj) setItemObj(obj)
  })

  const controlValues = useInteractive(useShallow((state) => state.items[nodeId]?.controlValues))
  const setControlValue = useInteractive((state) => state.setControlValue)

  let visible = false
  if (itemObj && zonePolygon?.length) {
    itemObj.getWorldPosition(_tempVec)
    visible = pointInPolygon(_tempVec.x, _tempVec.z, zonePolygon)
  }

  // Fade in on mount and fade out before unmounting the <Html>.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (visible) {
      setMounted(true)
      // Double rAF: the overlay has to paint once at opacity 0 before the
      // opacity-1 style lands, otherwise the fade-in transition is skipped.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    const timeout = setTimeout(() => setMounted(false), FADE_MS)
    return () => clearTimeout(timeout)
  }, [visible])

  if (!(mounted && itemObj && controlValues && node?.asset.interactive)) return null

  const { controls } = node.asset.interactive
  const [, height] = node.asset.dimensions

  return createPortal(
    // eps=-1 forces drei to re-apply translate/scale every frame: its mount
    // path writes a transform without the distanceFactor scale, and with a
    // static camera the eps guard would skip the fix until the camera moves.
    <Html center distanceFactor={8} eps={-1} position={[0, height + 0.3, 0]} zIndexRange={[20, 0]}>
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
          pointerEvents: visible ? 'auto' : 'none',
          userSelect: 'none',
          opacity: shown ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
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
