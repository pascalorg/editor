'use client'

import { useXRWandPanelSettings } from '@/lib/xr/wand-panel-settings'
import { XRBuildPanel } from './build-panel'
import { XRPaintPanel } from './paint-panel'
import {
  resolveWandPanelFacePose,
  XR_WAND_PANEL_INPUT_NAME,
  XR_WAND_PANEL_LAYOUT,
} from './panel-layout'
import { XRSettingsPanel } from './settings-panel'
import { PanelFace } from './spatial-controls'

export function XRWandPanel({ handedness = 'left' }: { handedness?: XRHandedness }) {
  const panelScale = useXRWandPanelSettings((state) => state.panelScale)
  const panels = [
    <XRPaintPanel key="paint" />,
    <XRBuildPanel key="build" />,
    <XRSettingsPanel key="settings" />,
  ]

  return (
    <group
      name={XR_WAND_PANEL_INPUT_NAME}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerOver={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      pointerEventsOrder={100}
      pointerEventsType={{ deny: 'grab' }}
      scale={panelScale}
    >
      {panels.map((panel, index) => {
        const pose = resolveWandPanelFacePose(index, handedness)
        return (
          <group
            key={XR_WAND_PANEL_LAYOUT.faceAngles[index]}
            position={pose.position}
            rotation={pose.rotation}
            scale={XR_WAND_PANEL_LAYOUT.faceScale}
          >
            <PanelFace />
            {panel}
          </group>
        )
      })}
    </group>
  )
}
