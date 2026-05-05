'use client'

import { HomeAssistantPanel as HomeAssistantPanelView } from '@pascal-app/home-assistant/editor'
import useEditor from '../../../store/use-editor'

export function HomeAssistantPanel() {
  const smartHomeOverlayVisibility = useEditor((state) => state.smartHomeOverlayVisibility)
  const setSmartHomeOverlaySectionVisible = useEditor(
    (state) => state.setSmartHomeOverlaySectionVisible,
  )
  const homeAssistantPairingResourceId = useEditor(
    (state) => state.homeAssistantPairingResourceId,
  )
  const homeAssistantPairingTargetItemId = useEditor(
    (state) => state.homeAssistantPairingTargetItemId,
  )
  const setHomeAssistantPairingResourceId = useEditor(
    (state) => state.setHomeAssistantPairingResourceId,
  )
  const setHomeAssistantPairingTargetItemId = useEditor(
    (state) => state.setHomeAssistantPairingTargetItemId,
  )
  const isSmartHomePanelOpen = useEditor((state) => state.isSmartHomePanelOpen)
  const setSmartHomePanelOpen = useEditor((state) => state.setSmartHomePanelOpen)

  return (
    <HomeAssistantPanelView
      homeAssistantPairingResourceId={homeAssistantPairingResourceId}
      homeAssistantPairingTargetItemId={homeAssistantPairingTargetItemId}
      isSmartHomePanelOpen={isSmartHomePanelOpen}
      setHomeAssistantPairingResourceId={setHomeAssistantPairingResourceId}
      setHomeAssistantPairingTargetItemId={setHomeAssistantPairingTargetItemId}
      setSmartHomeOverlaySectionVisible={setSmartHomeOverlaySectionVisible}
      setSmartHomePanelOpen={setSmartHomePanelOpen}
      smartHomeOverlayVisibility={smartHomeOverlayVisibility}
    />
  )
}
