'use client'

import { emitter, type GridEvent, resolveSiteGround, usePascalI18n } from '@pascal-app/core'
import { useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Mesh, MeshStandardMaterial, Object3D } from 'three'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { GardenGhost, GardenToolTarget } from '../shared/garden-draft-preview'
import { applyGhost } from '../shared/ghost-materials'
import { siteFrame } from '../shared/site-frame'
import { gridEventSiteGround } from '../shared/site-pointer-ground'
import { buildTreeGeometry, disposeTreeResources } from './geometry'
import {
  drawTreeSeed,
  ownsTreePlacement,
  placeTree,
  previewTree,
  snapTreePlacementPoint,
  treePlacementRefusal,
} from './placement'
import { treePlacementMessage } from './placement-message'
import { useTreePlacementScope } from './placement-scope'

type PlacementRefusal = { code: string; at: [number, number] }
type Point = [number, number]

function useTreePlacementInput(
  context: ReturnType<typeof useRegistryToolContext>,
  onRefusal: (refusal: PlacementRefusal | null) => void,
  onTarget: (point: Point | null) => void,
  seed: number,
) {
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  useEffect(() => {
    let groundCursor: [number, number] | null = null
    // Under the pointer's own ray, not on the active floor's plane (see `sitePointerGround`).
    const groundUnder = (event: Parameters<typeof gridEventSiteGround>[0]) => {
      const site = siteFrame(context.sceneApi, context.activeLevelId)?.site ?? null
      const ground = resolveSiteGround(site?.id, context.sceneApi.nodes())
      return gridEventSiteGround(event, camera, canvas, site, ground)
    }
    const owns = (target: EventTarget | null) =>
      ownsTreePlacement('3d', target) && !context.isCameraDragging()
    const move = (event: GridEvent) => {
      if (!owns(event.nativeEvent?.target ?? null)) return
      groundCursor = groundUnder(event)
      // The target stands where a click would plant, snapping included.
      const landing = snapTreePlacementPoint(groundCursor, event.nativeEvent?.altKey)
      onTarget(landing)
    }
    emitter.on('grid:move', move)
    const unsubscribe = subscribeFloorPlacementClicks((event) => {
      if (!owns(event.nativeEvent?.target ?? null)) return
      stopPlacementCommitPropagation(event)
      const raw: [number, number] | null = 'node' in event ? groundCursor : groundUnder(event)
      if (!raw) return
      const at = snapTreePlacementPoint(raw, event.nativeEvent?.altKey)
      const frame = siteFrame(context.sceneApi, context.activeLevelId)
      if (
        placeTree(
          context.sceneApi,
          at,
          context.selectNode,
          frame?.site.id,
          (code) => onRefusal({ code, at }),
          seed,
        )
      ) {
        // The tree stands; its ghost and target go.
        onTarget(null)
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
    })
    const stopViewWatch = useEditor.subscribe((state, before) => {
      if (visibleScene(state) !== visibleScene(before)) {
        groundCursor = null
        onRefusal(null)
        onTarget(null)
      }
    })
    return () => {
      emitter.off('grid:move', move)
      unsubscribe()
      stopViewWatch()
    }
  }, [
    context.sceneApi,
    context.activeLevelId,
    context.selectNode,
    context.isCameraDragging,
    onRefusal,
    onTarget,
    seed,
    camera,
    canvas,
  ])
}

/**
 * The tree a click would plant, as a body for the ghost: the tree's own geometry, built once,
 * with its foot at the group's origin (the tool moves it over the ground).
 */
function treeGhost(
  nodes: Parameters<typeof previewTree>[0],
  siteId: string | undefined,
  seed: number,
): Object3D | null {
  const tree = previewTree(nodes, siteId, seed)
  if (!tree) return null
  const root = buildTreeGeometry(tree)
  root.traverse((object) => {
    const mesh = object as Mesh<Mesh['geometry'], MeshStandardMaterial>
    if (!mesh.isMesh) return
    mesh.userData.leafCutoff = mesh.material.alphaTest
    mesh.position.y = 0
    mesh.castShadow = false
    mesh.receiveShadow = false
  })
  return root
}

/**
 * The editor's ghost treatment (`applyGhost`: green where the click will plant, red where it is
 * refused), on the ghost's own copies of the tree's material. The leaf cut-off follows the
 * ghost's opacity, or the translucent leaves would fall under it and the crown vanish.
 */
function tintTreeGhost(root: Object3D, refused: boolean) {
  const release = applyGhost(root, { invalid: refused, valid: !refused })
  root.traverse((object) => {
    const mesh = object as Mesh<Mesh['geometry'], MeshStandardMaterial>
    if (!mesh.isMesh || typeof mesh.userData.leafCutoff !== 'number') return
    mesh.material.alphaTest = mesh.userData.leafCutoff * mesh.material.opacity
  })
  return release
}

/** Keep the same point object while the landing point has not moved, so a still pointer redraws nothing. */
const samePoint = (next: Point | null) => (current: Point | null) =>
  current && next && current[0] === next[0] && current[1] === next[1] ? current : next

export default function TreeTool() {
  useTreePlacementScope()
  const i18n = usePascalI18n()
  const scene = useThree((state) => state.scene)
  const context = useRegistryToolContext()
  const [refusal, setRefusal] = useState<PlacementRefusal | null>(null)
  const [target, setTarget] = useState<Point | null>(null)
  const showTarget = useCallback((point: Point | null) => setTarget(samePoint(point)), [])
  // The tree a click plants is the one shown: drawn once, when the tool is taken.
  const [seed] = useState(drawTreeSeed)
  useTreePlacementInput(context, setRefusal, showTarget, seed)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const siteId = frame?.site.id
  const ground = resolveSiteGround(siteId, context.sceneApi.nodes())
  const ghost = useMemo(
    () => treeGhost(context.sceneApi.nodes(), siteId, seed),
    [context.sceneApi, siteId, seed],
  )
  useEffect(
    () => () => {
      if (ghost) disposeTreeResources(ghost)
    },
    [ghost],
  )
  // Red where the operation would refuse the tree (inside a house), green where it will stand.
  const refusedHere =
    target !== null && treePlacementRefusal(context.sceneApi.nodes(), siteId, target) !== null
  useEffect(() => (ghost ? tintTreeGhost(ghost, refusedHere) : undefined), [ghost, refusedHere])
  // ToolManager mounts under the active building; the Site-space target must not inherit it.
  return createPortal(
    <group userData={{ pascalExport: 'strip' }}>
      <GardenToolTarget at={target} ground={ground} />
      <GardenGhost at={target} ground={ground} object={ghost} />
      {refusal && (
        <Html
          position={[
            refusal.at[0],
            ground.heightAt(refusal.at[0], refusal.at[1]) + 0.2,
            refusal.at[1],
          ]}
          style={{ pointerEvents: 'none', width: 260 }}
        >
          <p className="rounded-lg bg-background p-2 text-xs text-foreground" role="status">
            {treePlacementMessage(refusal.code, i18n)}
          </p>
        </Html>
      )}
    </group>,
    scene,
  )
}
