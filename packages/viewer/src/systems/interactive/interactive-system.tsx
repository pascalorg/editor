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
import { evaluateRecipe, type ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { Html } from '@react-three/drei'
import { createPortal, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { type Object3D, Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import useViewer from '../../store/use-viewer'
import { ControlWidget } from './control-widget'
import { type ControlDescriptor, proceduralControlDescriptors } from './procedural-controls'

const _tempVec = new Vector3()

// ---- Parent: overlays for selected interactive items and the selected zone ----
//
// Mounting <Html> overlays unconditionally is not an option: each drei <Html>
// repositions and re-sorts its DOM element on every camera-move frame, and
// with `occlude` it also raycasts the entire scene per overlay per frame. On
// large scenes (hundreds of interactive items) that starves the frame budget
// and the display/z-index churn makes the whole DOM UI flicker.
//
export const InteractiveSystem = () => {
  const zoneId = useViewer((s) => s.selection.zoneId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const zonePolygon = useScene((s) => {
    if (!zoneId) return null
    const z = s.nodes[zoneId] as ZoneNode | undefined
    return z?.polygon ?? null
  })
  const interactiveNodeIds = useScene(
    useShallow((state) =>
      Object.values(state.nodes)
        .filter(
          (n): n is ItemNode | ProceduralItemNode =>
            (n.type === 'item' && n.asset.interactive != null) ||
            (n.type === 'procedural-item' &&
              n.recipe.parts.some((part) => part.motion || part.light)),
        )
        .map((n) => n.id),
    ),
  )

  return (
    <>
      {interactiveNodeIds
        .filter((id) => zonePolygon?.length || selectedIds.includes(id))
        .map((id) => (
          <ItemControlsOverlay
            isSelected={selectedIds.includes(id)}
            key={id}
            nodeId={id}
            zonePolygon={zonePolygon}
          />
        ))}
    </>
  )
}

// ---- Child: polls sceneRegistry then portals controls into the item group ----

const FADE_MS = 300

const ItemControlsOverlay = ({
  nodeId,
  zonePolygon,
  isSelected,
}: {
  nodeId: AnyNodeId
  zonePolygon: ZoneNode['polygon'] | null
  isSelected: boolean
}) => {
  const node = useScene((state) => state.nodes[nodeId] as ItemNode | ProceduralItemNode)
  const [itemObj, setItemObj] = useState<Object3D | null>(null)

  useFrame(() => {
    if (itemObj) return
    const obj = sceneRegistry.nodes.get(nodeId)
    if (obj) setItemObj(obj)
  })

  const controlValues = useInteractive(useShallow((state) => state.items[nodeId]?.controlValues))
  const proceduralState = useInteractive((state) => state.procedural[nodeId])
  const lampDefault = useInteractive((state) => state.lampDefault)
  const setControlValue = useInteractive((state) => state.setControlValue)
  const togglePart = useInteractive((state) => state.toggleProceduralPart)
  const toggleLights = useInteractive((state) => state.toggleProceduralLights)
  const proceduralHeight = useMemo(
    () =>
      node?.type === 'procedural-item'
        ? evaluateRecipe(node.recipe, node.parameters).max[1]
        : 0,
    [
      node?.type === 'procedural-item' ? node.recipe : null,
      node?.type === 'procedural-item' ? node.parameters : null,
    ],
  )

  let descriptors: ControlDescriptor[] = []
  let height = 0
  if (node?.type === 'item' && node.asset.interactive && controlValues) {
    descriptors = node.asset.interactive.controls.map((control, i) => ({
      key: String(i),
      control,
      value: controlValues[i] ?? false,
      onChange: (value) => setControlValue(nodeId, i, value),
    }))
    height = node.asset.dimensions[1]
  } else if (node?.type === 'procedural-item') {
    descriptors = proceduralControlDescriptors(
      node.recipe.parts,
      proceduralState,
      (partId) => togglePart(nodeId, partId),
      () => toggleLights(nodeId),
      lampDefault,
    )
    height = proceduralHeight
  }

  let visible = isSelected
  if (itemObj && zonePolygon?.length) {
    itemObj.getWorldPosition(_tempVec)
    visible = visible || pointInPolygon(_tempVec.x, _tempVec.z, zonePolygon)
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

  if (!(mounted && itemObj && descriptors.length)) return null

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
        {descriptors.map((descriptor) => (
          <ControlWidget
            control={descriptor.control}
            key={descriptor.key}
            onChange={descriptor.onChange}
            value={descriptor.value}
          />
        ))}
      </div>
    </Html>,
    itemObj,
  )
}
