'use client'

import {
  HomeAssistantInteractiveSystem,
  type HomeAssistantDeviceActionDispatch,
} from './home-assistant-interactive-system'
import { HomeAssistantPairingSystem } from './home-assistant-pairing-system'
import { HomeAssistantPlacementGroundSystem } from './home-assistant-placement-ground-system'

export function HomeAssistantEditorSystems({
  firstPerson = false,
  onDeviceAction,
}: {
  firstPerson?: boolean
  onDeviceAction: (payload: HomeAssistantDeviceActionDispatch) => void
}) {
  return (
    <>
      {!firstPerson && <HomeAssistantPlacementGroundSystem />}
      {!firstPerson && <HomeAssistantPairingSystem />}
      <HomeAssistantInteractiveSystem onHomeAssistantDeviceAction={onDeviceAction} />
    </>
  )
}
