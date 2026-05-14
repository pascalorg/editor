'use client'

import { emitter, type GridEvent, SpawnNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { type Group, Vector3 } from 'three'

/**
 * Registry-driven spawn placement tool. No props — reads `activeLevelId` from
 * `useViewer` directly and broadcasts placement events through the store.
 *
 * Behavior parity with the legacy tool in
 * `@pascal-app/editor/components/tools/spawn/spawn-tool.tsx`:
 * - Grid-snap to half-meter increments on X/Z
 * - Project click position into the active level's local frame
 * - Singleton: if a spawn already exists for this level, reuse it and clean
 *   up any duplicates
 * - On commit: select the placed spawn and exit build mode
 *
 * Mounted by `ToolManager`'s registry-first dispatch (Phase 0 shim) when
 * `nodeRegistry.has('spawn')` and the active tool is 'spawn'.
 */

const roundToHalf = (value: number) => Math.round(value * 2) / 2
const worldVector = new Vector3()

function getExistingSpawnIds() {
  const nodes = useScene.getState().nodes
  return Object.values(nodes)
    .filter((node) => node.type === 'spawn')
    .map((node) => node.id)
    .sort()
}

function getLevelLocalPosition(levelId: string, event: GridEvent): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) {
    return [
      roundToHalf(event.localPosition[0]),
      event.localPosition[1],
      roundToHalf(event.localPosition[2]),
    ]
  }
  worldVector.set(event.position[0], event.position[1], event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)
  return [roundToHalf(worldVector.x), worldVector.y, roundToHalf(worldVector.z)]
}

const SpawnTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const [, setCursor] = useState<[number, number, number] | null>(null)
  const cursorRef = useRef<Group>(null)

  useEffect(() => {
    if (!activeLevelId) return

    const onGridMove = (event: GridEvent) => {
      const next: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        event.localPosition[1],
        roundToHalf(event.localPosition[2]),
      ]
      setCursor(next)
      cursorRef.current?.position.set(next[0], next[1], next[2])
    }

    const onGridClick = (event: GridEvent) => {
      const next = getLevelLocalPosition(activeLevelId, event)
      const [existingSpawnId, ...duplicates] = getExistingSpawnIds()
      let placedId: SpawnNode['id']

      if (existingSpawnId) {
        useScene.getState().updateNode(existingSpawnId, {
          parentId: activeLevelId,
          position: next,
          rotation: 0,
        })
        if (duplicates.length > 0) {
          useScene.getState().deleteNodes(duplicates)
        }
        placedId = existingSpawnId
      } else {
        const spawn = SpawnNode.parse({
          name: 'Spawn Point',
          position: next,
          rotation: 0,
        })
        useScene.getState().createNode(spawn, activeLevelId)
        placedId = spawn.id
      }

      useViewer.getState().setSelection({ selectedIds: [placedId] })
      // Note: legacy tool also emits sfx:structure-build and resets the editor
      // tool/mode. We rely on the legacy ToolManager to do the latter via the
      // build-tool exit path; this commit doesn't replicate the SFX since the
      // registry doesn't yet bridge to the editor's sfx-emitter. Phase 4's
      // command surface adds a clean path.
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  // Visible marker for the cursor — using a simple group + box. The legacy
  // tool used a CursorSphere component from @pascal-app/editor; here we keep
  // the dependency arrow flowing nodes→editor (which is allowed by the layer
  // rules) but use a minimal inline mesh to avoid the dependency entirely for
  // the spike. Phase 4 ports CursorSphere to the editor framework so node
  // tools can reuse it.
  return (
    <group ref={cursorRef}>
      <mesh position={[0, 1.1, 0]}>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial color="#60a5fa" transparent opacity={0.6} />
      </mesh>
    </group>
  )
}

export default SpawnTool
