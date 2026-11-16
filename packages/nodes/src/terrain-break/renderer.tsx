'use client'

import {
  type AnyNodeId,
  type Ring,
  type TerrainBreakNode,
  type TerrainField,
  terrainPreviewField,
  useLiveTerrain,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { type BufferAttribute, type BufferGeometry, Group } from 'three'
import { setSolidGroundMask } from '../site/ground-hole'
import type { TerrainMeshBuffers } from '../site/terrain-geometry'
import {
  type TerrainGroundPresentation,
  terrainBufferGeometry,
  useTerrainGround,
} from '../site/terrain-ground-surface'
import { buildTerrainBreakMesh, terrainBreakSources, updateTerrainBreakMesh } from './geometry'
import { terrainBreakMaterial } from './material'

type Target = {
  key: string
  buffers: TerrainMeshBuffers
  geometry: BufferGeometry
  grid: TerrainField
  holes: Ring[]
}

function refreshTarget(target: Target, node: TerrainBreakNode, field: TerrainField, polygon: Ring) {
  updateTerrainBreakMesh(target.buffers, field)
  const positions = target.buffers.positions
  let crossing = false
  for (let i = 0; i < positions.length; i += 12) {
    const a = (positions[i + 1] ?? 0) - (positions[i + 7] ?? 0)
    const b = (positions[i + 4] ?? 0) - (positions[i + 10] ?? 0)
    if (a * b < -1e-8) crossing = true
  }
  if (crossing) {
    target.buffers = buildTerrainBreakMesh(node, field, [target.grid], target.holes, polygon)
    const replacement = terrainBufferGeometry(target.buffers)
    target.geometry.dispose()
    for (const name of ['position', 'normal', 'uv'])
      target.geometry.setAttribute(name, replacement.getAttribute(name))
    target.geometry.setIndex(replacement.index)
    replacement.dispose()
  }
  for (const name of ['position', 'normal']) {
    const attribute = target.geometry.getAttribute(name) as BufferAttribute
    attribute.needsUpdate = true
  }
  if (target.geometry.index) target.geometry.index.needsUpdate = true
  target.geometry.computeBoundingSphere()
}

function useLiveBreakTargets(
  node: TerrainBreakNode,
  ground: TerrainGroundPresentation | null,
  targets: Target[],
) {
  useEffect(() => {
    if (!ground) return
    const polygon: Ring = ground.polygon.map(([x, z]) => [x, z])
    const refresh = () => {
      const live = useLiveTerrain.getState().fieldOf(ground.siteId)
      const field = live ? terrainPreviewField(live, ground.field) : ground.field
      for (const target of targets) refreshTarget(target, node, field, polygon)
    }
    refresh()
    return useLiveTerrain.subscribe(refresh)
  }, [node, ground?.siteId, ground?.field, ground?.polygon, targets])
}

export default function TerrainBreakRenderer({ node }: { node: TerrainBreakNode }) {
  const root = useMemo(() => new Group(), [])
  const ref = useRef(root)
  useRegistry(node.id, 'terrain-break', ref)
  const handlers = useNodeEvents(node, 'terrain-break')
  const ground = useTerrainGround()
  const parent = useScene((state) =>
    node.parentId ? state.nodes[node.parentId as AnyNodeId] : undefined,
  )
  const sources = useMemo(() => {
    if (parent?.type !== 'site' || !ground) return []
    const nodes = Object.fromEntries([parent, ...ground.tiles].map((entry) => [entry.id, entry]))
    return terrainBreakSources(parent, nodes)
  }, [parent, ground?.tiles])
  const targets = useMemo(() => {
    if (!ground) return []
    return sources.flatMap(({ key, grid, holes }) => {
      const buffers = buildTerrainBreakMesh(
        node,
        ground.field,
        [grid],
        [...ground.holes, ...holes],
        ground.polygon.map(([x, z]) => [x, z]),
      )
      if (!buffers.indices.length) return []
      return [
        {
          key,
          buffers,
          geometry: terrainBufferGeometry(buffers),
          grid,
          holes: [...ground.holes, ...holes],
        },
      ]
    })
  }, [node, ground?.field, ground?.holes, ground?.polygon, sources])
  useEffect(
    () => () => {
      for (const target of targets) target.geometry.dispose()
    },
    [targets],
  )
  // The hole's mask is in the material from the moment the scene has a level below grade, once.
  const hasBasement = useViewer((state) => state.hasLevelBelowGrade)
  // A break's face is the ground's own: with the earth implied under the ground it goes with it.
  const impliedBelow = useViewer((state) => state.undergroundLook.ground === 'implied')
  const material = useMemo(() => {
    const result = terrainBreakMaterial(node.kind)
    setSolidGroundMask(result, hasBasement, impliedBelow)
    return result
  }, [node.kind, hasBasement, impliedBelow])
  useEffect(() => () => material.dispose(), [material])
  useLiveBreakTargets(node, ground, targets)
  return (
    <primitive object={root} ref={ref} visible={node.visible !== false} {...handlers}>
      {targets.map(({ key, geometry }) => (
        <mesh castShadow geometry={geometry} key={key} material={material} receiveShadow />
      ))}
    </primitive>
  )
}
