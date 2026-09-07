'use client'

import { useXRInputSourceStateContext, XRSpace } from '@react-three/xr'
import { XR_WAND_PANEL_LAYOUT } from './panel-layout'
import { XRWandPanel } from './wand-panel'

export function XRWandInputOverlay({ type }: { type: 'controller' | 'hand' }) {
  const state = useXRInputSourceStateContext(type)
  const handedness = state.inputSource.handedness
  if (handedness !== 'left') return null

  if (type === 'controller') {
    return (
      <XRSpace space="grip-space">
        <group
          position={[0, 0, XR_WAND_PANEL_LAYOUT.attachment.gripAxisOffset]}
          scale={XR_WAND_PANEL_LAYOUT.attachment.gripScale}
        >
          <XRWandPanel handedness={handedness} />
        </group>
      </XRSpace>
    )
  }

  return (
    <XRSpace space={XR_WAND_PANEL_LAYOUT.attachment.handSpace}>
      <group
        position={XR_WAND_PANEL_LAYOUT.attachment.handPosition}
        rotation={XR_WAND_PANEL_LAYOUT.attachment.handRotation}
        scale={XR_WAND_PANEL_LAYOUT.attachment.handScale}
      >
        <XRWandPanel handedness={handedness} />
      </group>
    </XRSpace>
  )
}
