'use client'

import { type RoofType, RoofType as RoofTypeSchema, useRegistryVersion } from '@pascal-app/core'
import { useEditor, useFloorplanMode } from '@pascal-app/editor'
import { useMemo } from 'react'
import {
  activateBuildTool,
  activateModularCabinetTool,
  activatePaintMode,
  activateRoofFeatureTool,
  activateRoofType,
  activateSelectMode,
  activateTerrainSculptMode,
  collectBuildTypes,
  collectRoofFeatures,
  type RoofFeature,
  XR_MEP_ITEMS,
} from '@/lib/build-palette'
import { ROOF_TYPE_OPTIONS } from '@/lib/build-tab-state'
import { useXRWandPanelSettings } from '@/lib/xr/wand-panel-settings'
import { PanelIcon } from './panel-icon'
import { getPageWithPinnedFirst } from './panel-layout'
import { PanelHeader, SpatialButton } from './spatial-controls'
import { SpatialText } from './spatial-text'
import { XR_WAND_THEME } from './theme'

const ITEMS_PER_PAGE = 9

type PaletteEntry = {
  active: boolean
  iconSrc: string
  id: string
  label: string
  select: () => void
}

function tilePosition(index: number): [number, number, number] {
  return [-0.255 + (index % 3) * 0.255, 0.225 - Math.floor(index / 3) * 0.215, 0]
}

function PaletteTile({ entry, index }: { entry: PaletteEntry; index: number }) {
  return (
    <SpatialButton
      name={`xr-build-tool-${entry.id}`}
      onClick={entry.select}
      position={tilePosition(index)}
      selected={entry.active}
      size={[0.215, 0.19]}
    >
      <PanelIcon size={0.092} src={entry.iconSrc} />
      <SpatialText
        anchorX="center"
        anchorY="middle"
        color={XR_WAND_THEME.text}
        fontSize={entry.label.length > 12 ? 0.018 : 0.021}
        maxWidth={0.19}
        position={[0, -0.067, 0.012]}
        textAlign="center"
      >
        {entry.label}
      </SpatialText>
    </SpatialButton>
  )
}

export function XRBuildPanel() {
  const section = useXRWandPanelSettings((state) => state.buildSection)
  const page = useXRWandPanelSettings((state) => state.buildPage)
  const setBuildNavigation = useXRWandPanelSettings((state) => state.setBuildNavigation)
  const mode = useEditor((state) => state.mode)
  const activeTool = useEditor((state) => state.tool)
  const roofDefaults = useEditor((state) => state.toolDefaults.roof)
  const floorplanMode = useFloorplanMode((state) => state.mode)
  const registryVersion = useRegistryVersion()
  const buildTypes = useMemo(() => {
    void registryVersion
    return collectBuildTypes(floorplanMode)
  }, [floorplanMode, registryVersion])
  const roofFeatures = useMemo(() => {
    void registryVersion
    return collectRoofFeatures()
  }, [registryVersion])
  const parsedRoofType = RoofTypeSchema.safeParse(roofDefaults?.roofType)
  const activeRoofType = parsedRoofType.success ? parsedRoofType.data : 'gable'

  const entries = useMemo<PaletteEntry[]>(() => {
    const selectEntry: PaletteEntry = {
      active: mode === 'select',
      iconSrc: '/icons/select.webp',
      id: 'select',
      label: 'Select',
      select: activateSelectMode,
    }

    if (section === 'mep') {
      return [
        selectEntry,
        ...XR_MEP_ITEMS.map((item) => ({
          active: mode === 'build' && activeTool === item.kind,
          iconSrc: item.iconSrc,
          id: item.id,
          label: item.label,
          select: () => activateBuildTool(item.kind),
        })),
      ]
    }

    if (section === 'roof') {
      const roofTypes: PaletteEntry[] = ROOF_TYPE_OPTIONS.map((option) => ({
        active: mode === 'build' && activeTool === 'roof' && activeRoofType === option.value,
        iconSrc: '/icons/roof.webp',
        id: `roof-${option.value}`,
        label: option.label,
        select: () => activateRoofType(option.value as RoofType),
      }))
      return [
        selectEntry,
        ...roofTypes,
        ...roofFeatures.map((feature: RoofFeature) => ({
          active: mode === 'build' && activeTool === feature.kind,
          iconSrc: feature.iconSrc,
          id: feature.id,
          label: feature.label,
          select: () => activateRoofFeatureTool(feature),
        })),
      ]
    }

    return [
      selectEntry,
      ...buildTypes.map((type) => {
        const isMepTool =
          !!activeTool &&
          (activeTool.includes('duct') ||
            activeTool.includes('pipe') ||
            activeTool === 'lineset' ||
            activeTool === 'liquid-line' ||
            activeTool === 'hvac-equipment')
        const active = type.mode
          ? mode === type.mode
          : type.id === 'kitchen'
            ? mode === 'build' && activeTool === 'cabinet'
            : type.id === 'mep'
              ? mode === 'build' && isMepTool
              : mode === 'build' && activeTool === type.kind
        return {
          active,
          iconSrc: type.iconSrc,
          id: type.id,
          label: type.label,
          select: () => {
            if (type.id === 'mep') {
              activateBuildTool('duct-segment')
              setBuildNavigation('mep', 0)
            } else if (type.id === 'roof') {
              activateBuildTool('roof')
              setBuildNavigation('roof', 0)
            } else if (type.id === 'kitchen') {
              activateModularCabinetTool()
            } else if (type.mode === 'material-paint') {
              activatePaintMode()
            } else if (type.mode === 'terrain-sculpt') {
              activateTerrainSculptMode()
            } else if (type.kind) {
              activateBuildTool(type.kind)
            }
          },
        }
      }),
    ]
  }, [activeRoofType, activeTool, buildTypes, mode, roofFeatures, section, setBuildNavigation])

  const current = getPageWithPinnedFirst(entries, page, ITEMS_PER_PAGE)
  const title = section === 'main' ? 'Build' : section === 'mep' ? 'MEP' : 'Roof'

  return (
    <group name="xr-wand-build-panel">
      <PanelHeader mark={`${entries.length} tools`} title={title} />
      {section !== 'main' && (
        <SpatialButton
          name={`xr-build-${section}-back`}
          onClick={() => {
            setBuildNavigation('main', 0)
          }}
          position={[-0.3, 0.35, 0]}
          size={[0.12, 0.055]}
        >
          <SpatialText
            anchorX="center"
            anchorY="middle"
            color={XR_WAND_THEME.text}
            fontSize={0.019}
            position={[0, 0, 0.012]}
          >
            Back
          </SpatialText>
        </SpatialButton>
      )}
      {current.items.map((entry, index) => (
        <PaletteTile entry={entry} index={index} key={entry.id} />
      ))}
      {current.pageCount > 1 && (
        <group position={[0.23, 0.35, 0]}>
          <SpatialButton
            disabled={current.currentPage === 0}
            name={`xr-build-${section}-previous-page`}
            onClick={() => setBuildNavigation(section, current.currentPage - 1)}
            position={[-0.07, 0, 0]}
            size={[0.055, 0.055]}
          >
            <SpatialText
              anchorX="center"
              anchorY="middle"
              color={XR_WAND_THEME.text}
              fontSize={0.026}
              position={[0, 0, 0.012]}
            >
              ‹
            </SpatialText>
          </SpatialButton>
          <SpatialText
            anchorX="center"
            anchorY="middle"
            color={XR_WAND_THEME.text}
            fontSize={0.018}
            position={[0, 0, 0.012]}
          >
            {current.currentPage + 1}/{current.pageCount}
          </SpatialText>
          <SpatialButton
            disabled={current.currentPage >= current.pageCount - 1}
            name={`xr-build-${section}-next-page`}
            onClick={() => setBuildNavigation(section, current.currentPage + 1)}
            position={[0.07, 0, 0]}
            size={[0.055, 0.055]}
          >
            <SpatialText
              anchorX="center"
              anchorY="middle"
              color={XR_WAND_THEME.text}
              fontSize={0.026}
              position={[0, 0, 0.012]}
            >
              ›
            </SpatialText>
          </SpatialButton>
        </group>
      )}
    </group>
  )
}
