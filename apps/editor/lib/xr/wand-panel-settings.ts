import { create } from 'zustand'

export const XR_WAND_PANEL_SCALE_MIN = 0.65
export const XR_WAND_PANEL_SCALE_MAX = 1.6
export const XR_WAND_PANEL_SCALE_STEP = 0.1

export type XRWandBuildSection = 'main' | 'mep' | 'roof'

type XRWandPanelSettingsState = {
  buildPage: number
  buildSection: XRWandBuildSection
  paintCategoryIndex: number
  paintPage: number
  panelScale: number
  settingsContextKey: string
  settingsPage: number
  terrainPage: number
  setBuildNavigation: (buildSection: XRWandBuildSection, buildPage: number) => void
  setPaintNavigation: (paintCategoryIndex: number, paintPage: number) => void
  setPanelScale: (panelScale: number) => void
  setSettingsNavigation: (settingsContextKey: string, settingsPage: number) => void
  setTerrainPage: (terrainPage: number) => void
}

export const useXRWandPanelSettings = create<XRWandPanelSettingsState>((set) => ({
  buildPage: 0,
  buildSection: 'main',
  paintCategoryIndex: 0,
  paintPage: 0,
  panelScale: 1,
  settingsContextKey: '',
  settingsPage: 0,
  terrainPage: 0,
  setBuildNavigation: (buildSection, buildPage) => {
    set({ buildPage: Math.max(0, Math.floor(buildPage)), buildSection })
  },
  setPaintNavigation: (paintCategoryIndex, paintPage) => {
    set({
      paintCategoryIndex: Math.max(0, Math.floor(paintCategoryIndex)),
      paintPage: Math.max(0, Math.floor(paintPage)),
    })
  },
  setPanelScale: (panelScale) => {
    if (!Number.isFinite(panelScale)) return
    set({
      panelScale: Math.min(
        XR_WAND_PANEL_SCALE_MAX,
        Math.max(XR_WAND_PANEL_SCALE_MIN, Math.round(panelScale * 100) / 100),
      ),
    })
  },
  setSettingsNavigation: (settingsContextKey, settingsPage) => {
    set({ settingsContextKey, settingsPage: Math.max(0, Math.floor(settingsPage)) })
  },
  setTerrainPage: (terrainPage) => {
    set({ terrainPage: Math.max(0, Math.floor(terrainPage)) })
  },
}))
