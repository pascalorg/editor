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
  collectBuildTypes,
  collectRoofFeatures,
  getRoofFootprintSources,
  roofTypeOptions: ROOF_TYPE_OPTIONS,
  xrMepItems: MEP_ITEMS,
}
