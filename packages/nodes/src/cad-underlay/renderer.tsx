'use client'

import { type CadUnderlayNode, useRegistry } from '@pascal-app/core'
import {
  cadUnderlayOpacity,
  getCadUnderlay,
  loadCadUnderlay,
  resolveCadLayers,
  useCadUnderlayRevision,
} from '@pascal-app/editor'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Group, LineSegments } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'

export const CadUnderlayRenderer = ({ node }: { node: CadUnderlayNode }) => {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'cad-underlay', ref)

  // Re-reads the cache when the asset lands; the value itself is unused.
  useCadUnderlayRevision()
  const loaded = getCadUnderlay(node.url)

  useEffect(() => {
    if (!loaded) loadCadUnderlay(node.url)
  }, [loaded, node.url])

  const opacity = cadUnderlayOpacity(node)

  const lines = useMemo(() => {
    if (!loaded) return []

    return resolveCadLayers(node, loaded).map((layer) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(loaded.positionsByLayer[layer.index]!, 3),
      )

      const material = new LineBasicNodeMaterial({
        color: layer.color,
        transparent: true,
        opacity,
        // The underlay is a flat sheet sitting exactly on the level plane, so
        // it z-fights anything else drawn there (slabs, zone fills). Skipping
        // the depth write lets it read as an underlay rather than flicker.
        depthWrite: false,
      })

      const segments = new LineSegments(geometry, material)
      // Locked reference geometry: never a pick target, in either view.
      segments.raycast = () => {}
      segments.renderOrder = -1
      // The drawing can extend well past the level's own bounds, and its
      // bounding sphere is computed from a huge flat sheet — culling it per
      // frame costs more than drawing it.
      segments.frustumCulled = false
      return segments
    })
    // `node.layers` and `node.opacity` are read through the two helpers.
  }, [loaded, node, opacity])

  useEffect(
    () => () => {
      for (const line of lines) {
        line.geometry.dispose()
        ;(line.material as LineBasicNodeMaterial).dispose()
      }
    },
    [lines],
  )

  return (
    <group
      position={node.position}
      ref={ref}
      rotation={[0, node.rotation[1], 0]}
      scale={node.scale}
      visible={node.visible !== false}
    >
      {lines.map((line) => (
        <primitive key={line.uuid} object={line} />
      ))}
    </group>
  )
}

export default CadUnderlayRenderer
