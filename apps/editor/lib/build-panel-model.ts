'use client'

import { RoofType as RoofTypeSchema, useRegistryVersion } from '@pascal-app/core'
import { type PanelToolOption, useEditor, useFloorplanMode } from '@pascal-app/editor'
import { useLiquidLineToolOptions } from '@pascal-app/nodes'
import type { XRWandBuildItem, XRWandBuildModel } from '@webxr/plugin'
import {
  activateBuildTool,
  activateModularCabinetTool,
  activatePaintMode,
  activateRoofFeatureTool,
  activateRoofFootprintSource,
  activateRoofType,
  activateTerrainSculptMode,
  collectBuildTypes,
  collectRoofFeatures,
  MEP_ITEMS,
  MEP_TOOL_KINDS,
  MODULAR_CABINET_ICON,
} from './build-palette'
import {
  getRoofFootprintSource,
  getRoofFootprintSources,
  ROOF_TYPE_OPTIONS,
} from './build-tab-state'

export function useBuildToolOptions(): PanelToolOption[] {
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const defaults = useEditor((state) => state.toolDefaults.roof)
  const follow = useLiquidLineToolOptions((state) => state.follow)
  const toggleFollow = useLiquidLineToolOptions((state) => state.toggleFollow)
  if (mode !== 'build') return []
  if (tool === 'liquid-line') {
    return [
      {
        id: 'liquid-line-follow',
        label: 'Follow lineset',
        value: follow ? 'on' : 'off',
        choices: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
        set: (value) => {
          if ((value === 'on') !== useLiquidLineToolOptions.getState().follow) toggleFollow()
        },
      },
    ]
  }
  const parsed = RoofTypeSchema.safeParse(defaults?.roofType)
  const roofType = parsed.success ? parsed.data : 'gable'
  const features = collectRoofFeatures()
  if (
    (tool !== 'roof' && !features.some((feature) => feature.kind === tool)) ||
    roofType === 'conical'
  )
    return []
  return [
    {
      id: 'roof-footprint-source',
      label: 'Create from',
      value: getRoofFootprintSource(roofType, defaults?.footprintSource),
      choices: getRoofFootprintSources(roofType).map((source) => ({
        ...source,
        description:
          source.value === 'room'
            ? 'Hover a room to preview its boundary, then click to place.'
            : 'Draw the roof footprint with two corner clicks.',
      })),
      set: (value) => activateRoofFootprintSource(getRoofFootprintSource(roofType, value)),
    },
  ]
}

export function useBuildPanelModel(): XRWandBuildModel {
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const defaults = useEditor((state) => state.toolDefaults.roof)
  const floorplanMode = useFloorplanMode((state) => state.mode)
  useRegistryVersion()
  const features = collectRoofFeatures()
  const roofActive =
    mode === 'build' && (tool === 'roof' || features.some((feature) => feature.kind === tool))
  const mepActive = mode === 'build' && !!tool && MEP_TOOL_KINDS.has(tool)
  const kitchenActive = mode === 'build' && tool === 'cabinet'
  const duct = mode === 'build' && (tool === 'duct-segment' || tool === 'duct-fitting')
  const pipe =
    mode === 'build' && (tool === 'pipe-segment' || tool === 'pipe-fitting' || tool === 'pipe-trap')
  const parsed = RoofTypeSchema.safeParse(defaults?.roofType)
  const roofType = parsed.success ? parsed.data : 'gable'
  const items = collectBuildTypes(floorplanMode).map(
    (type): XRWandBuildItem => ({
      id: type.id,
      label: type.label,
      icon: { src: type.iconSrc },
      active: type.mode
        ? mode === type.mode
        : type.id === 'roof'
          ? roofActive
          : type.id === 'mep'
            ? mepActive
            : type.id === 'kitchen'
              ? kitchenActive
              : mode === 'build' && tool === type.kind,
      onSelect: () => {
        if (type.mode === 'material-paint') activatePaintMode()
        else if (type.mode === 'terrain-sculpt') activateTerrainSculptMode()
        else if (type.id === 'mep') activateBuildTool('duct-segment')
        else if (type.id === 'kitchen') activateModularCabinetTool()
        else if (type.kind) activateBuildTool(type.kind)
      },
    }),
  )
  const secondaryItems: XRWandBuildItem[] = roofActive
    ? [
        ...ROOF_TYPE_OPTIONS.map((type) => ({
          id: `roof-${type.value}`,
          label: type.label,
          section: 'Roof type',
          active: tool === 'roof' && roofType === type.value,
          onSelect: () => activateRoofType(type.value),
        })),
        ...features.map((feature) => ({
          id: feature.id,
          label: feature.label,
          icon: { src: feature.iconSrc },
          section: 'Features & extensions',
          active: feature.kind === tool,
          onSelect: () => activateRoofFeatureTool(feature),
        })),
      ]
    : mepActive
      ? [
          ...MEP_ITEMS.map((item) => ({
            id: item.id,
            label: item.label,
            icon: { src: item.iconSrc },
            section: 'MEP',
            active:
              item.kind === 'duct-segment'
                ? duct
                : item.kind === 'pipe-segment'
                  ? pipe
                  : item.kind === tool,
            onSelect: () => activateBuildTool(item.kind),
          })),
          ...(duct
            ? [
                {
                  id: 'duct-fitting',
                  label: 'Add Fitting',
                  section: 'Duct',
                  icon: { src: '/icons/duct-fitting.webp' },
                  active: tool === 'duct-fitting',
                  onSelect: () =>
                    activateBuildTool(tool === 'duct-fitting' ? 'duct-segment' : 'duct-fitting'),
                },
              ]
            : []),
          ...(pipe
            ? [
                {
                  id: 'pipe-fitting',
                  label: 'Add Fitting',
                  section: 'DWV Pipe',
                  icon: { src: '/icons/duct-fitting.webp' },
                  active: tool === 'pipe-fitting',
                  onSelect: () =>
                    activateBuildTool(tool === 'pipe-fitting' ? 'pipe-segment' : 'pipe-fitting'),
                },
                {
                  id: 'pipe-trap',
                  label: 'Add Trap',
                  section: 'DWV Pipe',
                  icon: { src: '/icons/dwv-pipes.webp' },
                  active: tool === 'pipe-trap',
                  onSelect: () =>
                    activateBuildTool(tool === 'pipe-trap' ? 'pipe-segment' : 'pipe-trap'),
                },
              ]
            : []),
        ]
      : kitchenActive
        ? [
            {
              id: 'modular-cabinet',
              label: 'Modular Cabinet',
              section: 'Kitchen',
              icon: { src: MODULAR_CABINET_ICON },
              active: true,
              onSelect: activateModularCabinetTool,
            },
          ]
        : []
  const section = roofActive ? 'roof' : mepActive ? 'mep' : kitchenActive ? 'kitchen' : 'main'
  return {
    items,
    secondaryItems,
    secondaryTitle: roofActive ? 'Roof' : mepActive ? 'MEP' : 'Kitchen',
    section,
    title: 'Build',
    mark: `${items.length} tools`,
    page: 0,
    pageCount: 1,
    detailMode: mode === 'material-paint' ? 'paint' : undefined,
  }
}
