'use client'

import {
  type AnyNode,
  type AnyNodeId,
  groundHeightAt,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Vector3 } from 'three'
import {
  AMBIANCE_SECONDS,
  ambianceNow,
  ambianceTarget,
  applyAmbianceToSkyLights,
  easeAmbiance,
  eyeUnderTheGround,
  restoreSkyLights,
  setAmbianceFactor,
  setAmbianceFocus,
  stepAmbianceProgress,
} from '../../lib/underground-ambiance'
import useViewer, { groundVeiled } from '../../store/use-viewer'
import { revealMotionOff } from '../../systems/construction-reveal/construction-reveal'

/**
 * Keeps the world's turn to earth: while the shown level lies below grade, or the eye lies under
 * the ground, the factor eases to 1 over a short crossing and back to 0 when it ends. It reads
 * the flag the host keeps (`belowGrade`, `groundMode`) and the camera, and writes the factor the
 * pipeline, the lights and the veil wear. Mount beside `Lights`.
 */
export function UndergroundAmbiance() {
  const progress = useRef<number | null>(null)
  const eye = useRef(new Vector3())
  const lastEye = useRef(new Vector3(Number.NaN, Number.NaN, Number.NaN))
  const lastNodes = useRef<Record<AnyNodeId, AnyNode> | null>(null)
  const groundY = useRef(0)

  // Before `Lights` lerps the sky's lights (-1) they are given back as the theme set them, and
  // after it they are brought down for the frame the pipeline (1) draws.
  useFrame((state, delta) => {
    restoreSkyLights()
    const viewer = useViewer.getState()
    state.camera.getWorldPosition(eye.current)

    const { nodes } = useScene.getState()
    if (!eye.current.equals(lastEye.current) || nodes !== lastNodes.current) {
      lastEye.current.copy(eye.current)
      lastNodes.current = nodes
      const siteId = sceneRegistry.byType.site?.values().next().value as AnyNodeId | undefined
      const site = siteId ? nodes[siteId] : null
      groundY.current = groundHeightAt(site, nodes, eye.current.x, eye.current.z)
    }
    const under = eyeUnderTheGround(viewer.eyeUnderGround, eye.current.y, groundY.current)
    if (under !== viewer.eyeUnderGround) useViewer.setState({ eyeUnderGround: under })

    const target = ambianceTarget({
      groundVeiled: groundVeiled(viewer),
      eyeUnderGround: under,
      groundMode: viewer.groundMode,
    })
    // The first frame takes the world as it is: a project opened below grade does not dive.
    const from = progress.current ?? target
    const instant = revealMotionOff() || viewer.isExporting
    const next = stepAmbianceProgress(
      from,
      target,
      Math.min(delta, 0.1),
      instant ? 0 : AMBIANCE_SECONDS,
    )
    progress.current = next
    const eased = easeAmbiance(next)
    setAmbianceFactor(eased)
    const active = eased > 0
    if (viewer.ambianceActive !== active) useViewer.setState({ ambianceActive: active })
    if (next !== target) state.invalidate()
  }, -2)

  useFrame(() => {
    const amount = ambianceNow()
    if (amount <= 0) return
    setAmbianceFocus(useViewer.getState().groundWindowBox, eye.current)
    applyAmbianceToSkyLights(amount)
  }, 0)

  return null
}
