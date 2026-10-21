'use client'

import {
  type AnyNode,
  type AnyNodeId,
  buildingGroundBox,
  type GroundBox,
  groundHeightAt,
  levelStackGroundBox,
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
  earthNow,
  earthTarget,
  easeAmbiance,
  eyeUnderTheGround,
  FADE_SECONDS,
  restoreSkyLights,
  setAmbianceFactor,
  setAmbianceFocus,
  setDiveGrainWeight,
  setEarthFactor,
  setGroundHoleOpen,
  stepAmbianceProgress,
} from '../../lib/underground-ambiance'
import useViewer, { groundVeiled } from '../../store/use-viewer'
import { revealMotionOff } from '../../systems/construction-reveal/construction-reveal'

/**
 * Keeps the two states the ground is the medium of. The eye above the ground, a level below
 * grade shown with the ground on Auto: a hole opens in the ground (the factor `hole`, eased).
 * The eye under the ground: the dark mode, the factor `ambiance`, eased in over a short
 * crossing and back out when the eye comes up. Neither follows the other: a veiled basement
 * seen from above has no ambiance. Mount beside `Lights`, which does.
 */
export function UndergroundAmbiance() {
  const progress = useRef<number | null>(null)
  const holeProgress = useRef<number | null>(null)
  const earthProgress = useRef<number | null>(null)
  const eye = useRef(new Vector3())
  const lastEye = useRef(new Vector3(Number.NaN, Number.NaN, Number.NaN))
  const lastNodes = useRef<Record<AnyNodeId, AnyNode> | null>(null)
  const groundY = useRef(0)
  // The box the fog keeps clear: the host's ground window box when it keeps one, else the level
  // shown (or the building) worked out here, so a host without the window still gets it.
  const focus = useRef<GroundBox | null>(null)
  const focusFrom = useRef<unknown[]>([])

  // Before `Lights` lerps the sky's lights (-1) they are given back as the theme set them, and
  // after it they are moved for the frame the pipeline (1) draws.
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
      groundY.current = groundHeightAt(site, eye.current.x, eye.current.z)
    }
    const under = eyeUnderTheGround(viewer.eyeUnderGround, eye.current.y, groundY.current)
    if (under !== viewer.eyeUnderGround) useViewer.setState({ eyeUnderGround: under })

    // The first frame takes the world as it is: a project opened below grade does not dive.
    const instant = revealMotionOff() || viewer.isExporting
    const fade = viewer.undergroundLook.transition === 'fade'
    const seconds = instant ? 0 : fade ? FADE_SECONDS : AMBIANCE_SECONDS
    setDiveGrainWeight(fade ? 0 : 1)
    const dt = Math.min(delta, 0.1)

    const target = ambianceTarget({
      eyeUnderGround: under,
      groundMode: viewer.groundMode,
      walkthroughMode: viewer.walkthroughMode,
    })
    const next = stepAmbianceProgress(progress.current ?? target, target, dt, seconds)
    progress.current = next
    const eased = easeAmbiance(next)
    setAmbianceFactor(eased)
    const active = eased > 0
    if (viewer.ambianceActive !== active) useViewer.setState({ ambianceActive: active })

    // What is seen beyond the walls turns to earth with the eye, in the walkthrough too: there it
    // is the only part of the dark mode that does (the rooms keep their light, no fog, no vignette).
    const earthWanted = earthTarget({ eyeUnderGround: under, groundMode: viewer.groundMode })
    const earthNext = stepAmbianceProgress(
      earthProgress.current ?? earthWanted,
      earthWanted,
      dt,
      seconds,
    )
    earthProgress.current = earthNext
    setEarthFactor(easeAmbiance(earthNext))

    const holeTarget = groundVeiled(viewer) ? 1 : 0
    const holeNext = stepAmbianceProgress(
      holeProgress.current ?? holeTarget,
      holeTarget,
      dt,
      instant ? 0 : AMBIANCE_SECONDS,
    )
    holeProgress.current = holeNext
    setGroundHoleOpen(easeAmbiance(holeNext))

    if (next !== target || holeNext !== holeTarget || earthNext !== earthWanted) state.invalidate()

    if (eased > 0 || earthNext > 0) {
      const { selection, hideLevelsAboveSelection, belowGrade, groundWindowBox } = viewer
      const from = [
        nodes,
        selection.levelId,
        selection.buildingId,
        hideLevelsAboveSelection,
        belowGrade,
        groundWindowBox,
      ]
      if (from.some((value, index) => value !== focusFrom.current[index])) {
        focusFrom.current = from
        // Where the world stays clear: the shown level and the ones under it (a deep level is
        // seen with the stack over it opened), else the host's window box, else the building.
        focus.current =
          (selection.levelId && (hideLevelsAboveSelection || belowGrade)
            ? levelStackGroundBox(nodes, selection.levelId)
            : null) ??
          groundWindowBox ??
          buildingGroundBox(nodes, selection.buildingId ?? null)
      }
    }
  }, -2)

  useFrame(() => {
    const amount = ambianceNow()
    if (amount > 0 || earthNow() > 0) setAmbianceFocus(focus.current, eye.current)
    applyAmbianceToSkyLights(amount)
  }, 0)

  return null
}
