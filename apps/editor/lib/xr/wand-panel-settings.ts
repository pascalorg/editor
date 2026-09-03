import { create } from 'zustand'

export const XR_WAND_PANEL_SCALE_MIN = 0.65
export const XR_WAND_PANEL_SCALE_MAX = 1.6
export const XR_WAND_PANEL_SCALE_STEP = 0.1

type XRWandPanelSettingsState = {
  panelScale: number
  setPanelScale: (panelScale: number) => void
}

export const useXRWandPanelSettings = create<XRWandPanelSettingsState>((set) => ({
  panelScale: 1,
  setPanelScale: (panelScale) => {
    if (!Number.isFinite(panelScale)) return
    set({
      panelScale: Math.min(
        XR_WAND_PANEL_SCALE_MAX,
        Math.max(XR_WAND_PANEL_SCALE_MIN, Math.round(panelScale * 100) / 100),
      ),
    })
  },
}))
