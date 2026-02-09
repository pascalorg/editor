import { sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { type Group, MathUtils, type Mesh } from 'three'
import type { MeshBasicNodeMaterial } from 'three/webgpu'
import useViewer from '../../store/use-viewer'

const TRANSITION_DURATION = 400 // ms

export const ZoneSystem = () => {
  const lastHighlightedZoneRef = useRef<string | null>(null)
  const lastChangeTimeRef = useRef(0)
  const isTransitioningRef = useRef(false)

  useFrame(({clock}, delta) => {
    const hoveredId = useViewer.getState().hoveredId
    let highlightedZone: string | null = null

    if (hoveredId) {
      const hoveredNode = useScene.getState().nodes[hoveredId]
      if (hoveredNode?.type === 'zone') {
        highlightedZone = hoveredId
      }
    }

    // Detect zone change
    if (highlightedZone !== lastHighlightedZoneRef.current) {
      lastHighlightedZoneRef.current = highlightedZone
      lastChangeTimeRef.current = clock.elapsedTime * 1000
      isTransitioningRef.current = true
    }

    // Skip frame if not transitioning
    if (!isTransitioningRef.current) return

    const elapsed = clock.elapsedTime * 1000 - lastChangeTimeRef.current

    // Stop transitioning after duration
    if (elapsed >= TRANSITION_DURATION) {
      isTransitioningRef.current = false
    }

    // Lerp speed: complete transition in ~400ms
    const lerpSpeed = 10 * delta

    sceneRegistry.byType.zone.forEach((zoneId) => {
      const zone = sceneRegistry.nodes.get(zoneId)
      if (!zone) return

      const isHighlighted = zoneId === highlightedZone
      const targetOpacity = isHighlighted ? 1 : 0

      const walls = (zone as Group).getObjectByName('walls') as Mesh | undefined
      if (walls) {
        const material = walls.material as MeshBasicNodeMaterial
        const currentOpacity = material.userData.uOpacity.value
        material.userData.uOpacity.value = MathUtils.lerp(currentOpacity, targetOpacity, lerpSpeed)
      }

      const floor = (zone as Group).getObjectByName('floor') as Mesh | undefined
      if (floor) {
        const material = floor.material as MeshBasicNodeMaterial
        const currentOpacity = material.userData.uOpacity.value
        material.userData.uOpacity.value = MathUtils.lerp(currentOpacity, targetOpacity, lerpSpeed)
      }
    })
  })

  return null
}
