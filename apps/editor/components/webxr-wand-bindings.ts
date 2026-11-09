'use client'

import { useEditor } from '@pascal-app/editor'
import type { PascalXRWandBindings } from '@webxr/plugin/pascal-editor'
import {
  activateBuildTool,
  activateModularCabinetTool,
  activatePaintMode,
  activateRoofFeatureTool,
  activateRoofFootprintSource,
  activateRoofType,
  activateSelectMode,
  activateTerrainSculptMode,
  collectBuildTypes,
  collectRoofFeatures,
  MEP_ITEMS,
} from '@/lib/build-palette'
import { useBuildPanelModel, useBuildToolOptions } from '@/lib/build-panel-model'
import { getRoofFootprintSources, ROOF_TYPE_OPTIONS } from '@/lib/build-tab-state'

// The XR plugin takes plain labels and renders them itself, so it receives the English source.
const english = <T extends { label: { message?: string; id: string } }>(
  entry: T,
): Omit<T, 'label'> & { label: string } => ({
  ...entry,
  label: entry.label.message ?? entry.label.id,
})

export const webXRWandBindings: PascalXRWandBindings = {
  useBuildPalette: useBuildPanelModel,
  useToolOptions: useBuildToolOptions,
  activateBuildTool,
  activateModularCabinetTool,
  activatePaintMode,
  activateRoofFeatureTool,
  activateRoofFootprintSource,
  activateRoofType,
  activateSelectMode: () => {
    activateSelectMode()
    useEditor.getState().setTool(null)
  },
  activateTerrainSculptMode,
  collectBuildTypes: (floorplanMode) => collectBuildTypes(floorplanMode).map(english),
  collectRoofFeatures: () => collectRoofFeatures().map(english),
  getRoofFootprintSources: (roofType) =>
    getRoofFootprintSources(roofType).map((source) => ({
      value: source.value,
      label: source.label.message,
    })),
  roofTypeOptions: ROOF_TYPE_OPTIONS.map(english),
  xrMepItems: MEP_ITEMS.map(english),
}
