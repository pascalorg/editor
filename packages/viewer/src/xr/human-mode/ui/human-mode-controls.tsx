'use client'

import type { RefObject } from 'react'
import type { Object3D } from 'three'
import { ControllerLocomotion } from '../input/controller-locomotion'
import { HumanCollisionRig } from '../input/human-collision-rig'
import { ComfortVignette } from './comfort-vignette'
import { HandLocomotionZone } from './hand-locomotion-zone'

export function HumanModeControls({ sceneRootRef }: { sceneRootRef: RefObject<Object3D | null> }) {
  return (
    <group name="human-mode-controls">
      <ControllerLocomotion />
      <HumanCollisionRig sceneRootRef={sceneRootRef} />
      <ComfortVignette />
      <HandLocomotionZone />
    </group>
  )
}
