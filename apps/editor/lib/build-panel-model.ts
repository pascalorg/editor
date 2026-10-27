'use client'

import {
  type AnyNodeId,
  isFenceFeatureNode,
  RoofType as RoofTypeSchema,
  usePascalI18n,
  useRegistryVersion,
  useScene,
} from '@pascal-app/core'
import { type PanelToolOption, useEditor, useFloorplanMode } from '@pascal-app/editor'
import { useLiquidLineToolOptions } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import type { XRWandBuildItem, XRWandBuildModel } from '@webxr/plugin'
import {
  activateBuildTool,
  activateFenceFeaturePlacement,
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
  const i18n = usePascalI18n()
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
        label: i18n._({ id: 'app.lib.buildPanelModel.followLineset', message: 'Follow lineset' }),
        value: follow ? 'on' : 'off',
        choices: [
          { value: 'on', label: i18n._({ id: 'app.lib.buildPanelModel.on', message: 'On' }) },
          { value: 'off', label: i18n._({ id: 'app.lib.buildPanelModel.off', message: 'Off' }) },
        ],
        set: (value) => {
          if ((value === 'on') !== useLiquidLineToolOptions.getState().follow) toggleFollow()
        },
      },
    ]
  }
  const parsed = RoofTypeSchema.safeParse(defaults?.roofType)
  const roofType = parsed.success ? parsed.data : 'gable'
  if (tool !== 'roof' || roofType === 'conical') return []
  return [
    {
      id: 'roof-footprint-source',
      label: i18n._({ id: 'app.lib.buildPanelModel.createFrom', message: 'Create from' }),
      value: getRoofFootprintSource(roofType, defaults?.footprintSource),
      choices: getRoofFootprintSources(roofType).map((source) => ({
        value: source.value,
        label: i18n._(source.label),
        description:
          source.value === 'room'
            ? i18n._({
                id: 'app.lib.buildPanelModel.hoverARoomToPreviewIts',
                message: 'Hover a room to preview its boundary, then click to place.',
              })
            : i18n._({
                id: 'app.lib.buildPanelModel.drawTheRoofFootprintWithTwo',
                message: 'Draw the roof footprint with two corner clicks.',
              }),
      })),
      set: (value) => activateRoofFootprintSource(getRoofFootprintSource(roofType, value)),
    },
  ]
}

export function useBuildPanelModel(): XRWandBuildModel {
  const i18n = usePascalI18n()
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const selectedFence = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : undefined
    const host =
      isFenceFeatureNode(node) && node.parentId ? state.nodes[node.parentId as AnyNodeId] : node
    return host?.type === 'fence' ? host : undefined
  })
  const defaults = useEditor((state) => state.toolDefaults.roof)
  const floorplanMode = useFloorplanMode((state) => state.mode)
  useRegistryVersion()
  const features = collectRoofFeatures()
  const roofActive =
    mode === 'build' && (tool === 'roof' || features.some((feature) => feature.kind === tool))
  const mepActive = mode === 'build' && !!tool && MEP_TOOL_KINDS.has(tool)
  const fenceActive = !!selectedFence || (mode === 'build' && tool === 'fence')
  const kitchenActive = mode === 'build' && tool === 'cabinet'
  const duct = mode === 'build' && (tool === 'duct-segment' || tool === 'duct-fitting')
  const pipe =
    mode === 'build' && (tool === 'pipe-segment' || tool === 'pipe-fitting' || tool === 'pipe-trap')
  const parsed = RoofTypeSchema.safeParse(defaults?.roofType)
  const roofType = parsed.success ? parsed.data : 'gable'
  const buildItems = collectBuildTypes(floorplanMode).map(
    (type): XRWandBuildItem => ({
      id: type.id,
      label: i18n._(type.label),
      icon: { src: type.iconSrc },
      active: type.mode
        ? mode === type.mode
        : type.id === 'roof'
          ? roofActive
          : type.id === 'fence' && selectedFence
            ? true
            : type.id === 'mep'
              ? mepActive
              : type.id === 'kitchen'
                ? kitchenActive
                : mode === 'build' && tool === type.kind,
      onSelect: () => {
        if (type.id === 'fence' && selectedFence) return
        if (type.mode === 'terrain-sculpt') activateTerrainSculptMode()
        else if (type.id === 'mep') activateBuildTool('duct-segment')
        else if (type.id === 'kitchen') activateModularCabinetTool()
        else if (type.kind) activateBuildTool(type.kind)
      },
    }),
  )
  // Painting has its own rail panel on desktop; the wand has no rail, so it stays a Build item here.
  const items: XRWandBuildItem[] = [
    ...buildItems,
    {
      id: 'painting',
      label: i18n._({ id: 'app.lib.buildPanelModel.painting', message: 'Painting' }),
      icon: { src: '/icons/paint.webp' },
      active: mode === 'material-paint',
      onSelect: activatePaintMode,
    },
  ]
  const secondaryItems: XRWandBuildItem[] = roofActive
    ? [
        ...ROOF_TYPE_OPTIONS.map((type) => ({
          id: `roof-${type.value}`,
          label: i18n._(type.label),
          section: i18n._({ id: 'app.lib.buildPanelModel.roofType', message: 'Roof type' }),
          active: tool === 'roof' && roofType === type.value,
          onSelect: () => activateRoofType(type.value),
        })),
        ...features.map((feature) => ({
          id: feature.id,
          label: i18n._(feature.label),
          icon: { src: feature.iconSrc },
          section: i18n._({
            id: 'app.lib.buildPanelModel.featuresExtensions',
            message: 'Features & extensions',
          }),
          active: feature.kind === tool,
          onSelect: () => activateRoofFeatureTool(feature),
        })),
      ]
    : fenceActive
      ? [
          ...(['gate', 'opening'] as const).map((kind) => ({
            id: `fence-add-${kind}`,
            label:
              kind === 'gate'
                ? i18n._({ id: 'app.lib.buildPanelModel.addGate', message: 'Add Gate' })
                : i18n._({
                    id: 'app.lib.buildPanelModel.addOpenPassage',
                    message: 'Add Open Passage',
                  }),
            section: i18n._({
              id: 'app.lib.buildPanelModel.gatesOpenings',
              message: 'Gates & openings',
            }),
            active: false,
            onSelect: () => {
              activateFenceFeaturePlacement(kind)
            },
          })),
        ]
      : mepActive
        ? [
            ...MEP_ITEMS.map((item) => ({
              id: item.id,
              label: i18n._(item.label),
              icon: { src: item.iconSrc },
              section: i18n._({ id: 'app.lib.buildPanelModel.mep', message: 'MEP' }),
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
                    label: i18n._({
                      id: 'app.lib.buildPanelModel.addFitting',
                      message: 'Add Fitting',
                    }),
                    section: i18n._({ id: 'app.lib.buildPanelModel.duct', message: 'Duct' }),
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
                    label: i18n._({
                      id: 'app.lib.buildPanelModel.addFitting',
                      message: 'Add Fitting',
                    }),
                    section: i18n._({ id: 'app.lib.buildPanelModel.dwvPipe', message: 'DWV Pipe' }),
                    icon: { src: '/icons/duct-fitting.webp' },
                    active: tool === 'pipe-fitting',
                    onSelect: () =>
                      activateBuildTool(tool === 'pipe-fitting' ? 'pipe-segment' : 'pipe-fitting'),
                  },
                  {
                    id: 'pipe-trap',
                    label: i18n._({ id: 'app.lib.buildPanelModel.addTrap', message: 'Add Trap' }),
                    section: i18n._({ id: 'app.lib.buildPanelModel.dwvPipe', message: 'DWV Pipe' }),
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
                label: i18n._({
                  id: 'app.lib.buildPanelModel.modularCabinet',
                  message: 'Modular Cabinet',
                }),
                section: i18n._({ id: 'app.lib.buildPanelModel.kitchen', message: 'Kitchen' }),
                icon: { src: MODULAR_CABINET_ICON },
                active: true,
                onSelect: activateModularCabinetTool,
              },
            ]
          : []
  const section = roofActive
    ? 'roof'
    : fenceActive
      ? 'fence'
      : mepActive
        ? 'mep'
        : kitchenActive
          ? 'kitchen'
          : 'main'
  return {
    items,
    secondaryItems,
    secondaryTitle: roofActive
      ? i18n._({ id: 'app.lib.buildPanelModel.roof', message: 'Roof' })
      : fenceActive
        ? i18n._({ id: 'app.lib.buildPanelModel.fence', message: 'Fence' })
        : mepActive
          ? i18n._({ id: 'app.lib.buildPanelModel.mep', message: 'MEP' })
          : i18n._({ id: 'app.lib.buildPanelModel.kitchen', message: 'Kitchen' }),
    section,
    title: i18n._({ id: 'app.lib.buildPanelModel.build', message: 'Build' }),
    mark: i18n._({
      id: 'app.lib.buildPanelModel.toolCount',
      message: '{count, plural, one {# tool} other {# tools}}',
      values: { count: items.length },
    }),
    page: 0,
    pageCount: 1,
    detailMode: mode === 'material-paint' ? 'paint' : undefined,
  }
}
