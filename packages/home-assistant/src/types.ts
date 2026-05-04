export type SmartHomeOverlayVisibility = {
  actions: boolean
  devices: boolean
  groups: boolean
}

export const DEFAULT_SMART_HOME_OVERLAY_VISIBILITY: SmartHomeOverlayVisibility = {
  actions: true,
  devices: true,
  groups: true,
}
