import type { HomeAssistantDeviceActionDispatch } from './home-assistant-interactive-system'

export function dispatchHomeAssistantEditorDeviceAction(payload: HomeAssistantDeviceActionDispatch) {
  void fetch('/api/home-assistant/device-action', {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  }).catch(() => {})
}
