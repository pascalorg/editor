import { sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { type Group, MathUtils, type Mesh } from 'three'
import type { MeshBasicNodeMaterial } from 'three/webgpu'
import useViewer from '../../store/use-viewer'

const TRANSITION_DURATION = 400 // ms
const EXIT_DEBOUNCE_MS = 50 // ignore rapid exit→re-enter within this window

export const ZoneSystem = () => {
  const lastHighlightedZoneRef = useRef<string | null>(null)
  const lastChangeTimeRef = useRef(0)
  const isTransitioningRef = useRef(false)
  // Debounce exit-to-null: track the raw pending value and when it last changed
  const pendingZoneRef = useRef<string | null>(null)
  const pendingZoneSinceRef = useRef(0)

  useFrame(({ clock }, delta) => {
    const hoveredId = useViewer.getState().hoveredId
    let rawZone: string | null = null

    if (hoveredId) {
      const hoveredNode = useScene.getState().nodes[hoveredId]
      if (hoveredNode?.type === 'zone') {
        rawZone = hoveredId
      }
    }

    // Update pending zone when the raw value changes
    if (rawZone !== pendingZoneRef.current) {
      pendingZoneRef.current = rawZone
      pendingZoneSinceRef.current = clock.elapsedTime * 1000
    }

    // Apply non-null immediately; debounce null to filter out brief exits
    const age = clock.elapsedTime * 1000 - pendingZoneSinceRef.current
    const highlightedZone =
      rawZone !== null ? rawZone : age >= EXIT_DEBOUNCE_MS ? null : lastHighlightedZoneRef.current

    // Detect stable zone change
    if (highlightedZone !== lastHighlightedZoneRef.current) {
      // Fade out previous zone label-pin
      if (lastHighlightedZoneRef.current) {
        const prevLabel = document.getElementById(`${lastHighlightedZoneRef.current}-label`)
        const pin = prevLabel?.querySelector('.label-pin') as HTMLElement | null
        if (pin) pin.style.opacity = '0'
      }
      // Fade in new zone label-pin
      if (highlightedZone) {
        const label = document.getElementById(`${highlightedZone}-label`)
        const pin = label?.querySelector('.label-pin') as HTMLElement | null
        if (pin) pin.style.opacity = '1'
      }

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
