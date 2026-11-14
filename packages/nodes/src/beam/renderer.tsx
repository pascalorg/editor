'use client'

import {
  BEAM_MATERIAL_LIBRARY_REFS,
  type BeamNode,
  beamTopElevation,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  createSurfaceRoleMaterial,
  resolveSlotDefaultMaterial,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import type { Group, Material } from 'three'
import { beamBox, buildBeamGeometry } from './geometry'

/** How a beam of `material` looks: its library material, or the plain surface colour when textures are off. */
export function useBeamMaterial(material: BeamNode['material']): Material {
  const shading = useViewer((state) => state.shading)
  const textures = useViewer((state) => state.textures)
  const colorPreset = useViewer((state) => state.colorPreset)
  return useMemo(
    () =>
      textures
        ? resolveSlotDefaultMaterial(BEAM_MATERIAL_LIBRARY_REFS[material], shading)
        : createSurfaceRoleMaterial('wall', colorPreset),
    [material, shading, textures, colorPreset],
  )
}

/**
 * A beam: its solid laid along the centreline in its level, the top where the beam's top resolves
 * (`beamTopElevation`: its own, else the ceiling plane over it). Reads live overrides, so a drag
 * in either view moves it at once.
 */
export default function BeamRenderer({ node: stored }: { node: BeamNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(stored.id, 'beam', ref)
  const live = useLiveNodeOverrides((state) => state.overrides.get(stored.id))
  const node = useMemo(() => (live ? ({ ...stored, ...live } as BeamNode) : stored), [stored, live])
  const handlers = useNodeEvents(node, 'beam')
  const top = useScene((state) => beamTopElevation(state.nodes, node))
  const material = useBeamMaterial(node.material)
  const placed = beamBox(node, top)
  const length = placed?.size[0] ?? 0
  const geometry = useMemo(
    () =>
      length > 0
        ? buildBeamGeometry(
            { width: node.width, depth: node.depth, plies: node.plies, material: node.material },
            length,
          )
        : null,
    [length, node.width, node.depth, node.plies, node.material],
  )
  useEffect(() => () => geometry?.dispose(), [geometry])

  return (
    <group ref={ref}>
      {placed && geometry && (
        <mesh
          castShadow
          geometry={geometry}
          material={material}
          position={placed.position}
          receiveShadow
          rotation-y={placed.rotationY}
          {...handlers}
        />
      )}
    </group>
  )
}
