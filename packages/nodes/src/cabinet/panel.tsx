'use client'

import type {
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
} from '@pascal-app/core'
import { CabinetModuleNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { ArrowDown, ArrowUp, Minus, Pause, Play, Plus, Trash } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cabinetModuleDefinition } from './definition'
import { CABINET_PRESETS, type CabinetPresetId } from './presets'
import {
  backAnchoredModuleZ,
  type CabinetCompartment,
  type CabinetCompartmentType,
  type CabinetCooktopCompartmentType,
  type CabinetFridgeCompartmentType,
  type CabinetHoodCompartmentType,
  COOKTOP_DEFAULT_GAS_LAYOUT,
  COOKTOP_DEFAULT_INDUCTION_LAYOUT,
  COOKTOP_STANDARD_WIDTH,
  type CooktopLayout,
  compartmentCooktopBurnersOn,
  compartmentCooktopElementCount,
  compartmentCooktopLayout,
  compartmentCooktopShowGrate,
  compartmentDoorType,
  compartmentDrawerCount,
  compartmentPullOutPantryRackStyle,
  compartmentShelfCount,
  cooktopCabinetStack,
  DISHWASHER_STANDARD_HEIGHT,
  DISHWASHER_STANDARD_WIDTH,
  FRIDGE_COLUMN_HEIGHT,
  FRIDGE_COLUMN_WIDTH,
  FRIDGE_WIDE_WIDTH,
  fridgeCabinetStack,
  hoodCompartmentHeight,
  isCooktopCompartmentType,
  isFridgeCompartmentType,
  isHoodCompartmentType,
  MICROWAVE_STANDARD_WIDTH,
  minCabinetCarcassHeightForStack,
  newCabinetCompartment,
  normalizeCabinetStack,
  type PULL_OUT_PANTRY_RACK_STYLES,
  PULL_OUT_PANTRY_STANDARD_WIDTH,
  reflowCabinetRunModules,
  replaceCabinetCompartmentStack,
  resizeCabinetCompartmentStack,
  stackForCabinet,
  TALL_CABINET_CARCASS_HEIGHT,
} from './stack'

const COMPARTMENT_TYPE_OPTIONS = [
  { value: 'shelf', label: 'Shelf' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'door', label: 'Door' },
  { value: 'oven', label: 'Oven' },
  { value: 'microwave', label: 'Micro' },
  { value: 'dishwasher', label: 'Washer' },
  { value: 'cooktop', label: 'Hob' },
  { value: 'pull-out-pantry', label: 'Pullout' },
] as const

const FRIDGE_TYPE_OPTION = { value: 'fridge', label: 'Fridge' } as const
const HOOD_TYPE_OPTION = { value: 'hood', label: 'Chimney' } as const
const COMPARTMENT_TYPE_CONTROL_OPTIONS = [...COMPARTMENT_TYPE_OPTIONS, FRIDGE_TYPE_OPTION] as const
const WALL_COMPARTMENT_TYPE_CONTROL_OPTIONS = [
  { value: 'shelf', label: 'Shelf' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'door', label: 'Door' },
  HOOD_TYPE_OPTION,
] as const

const FRIDGE_STYLE_OPTIONS = [
  { value: 'fridge-single', label: 'Single' },
  { value: 'fridge-double', label: 'Double' },
  { value: 'fridge-top-freezer', label: 'Top Freezer' },
  { value: 'fridge-bottom-freezer', label: 'Bottom Freezer' },
] as const

const COOKTOP_STYLE_OPTIONS = [
  { value: 'cooktop-gas', label: 'Gas' },
  { value: 'cooktop-induction', label: 'Induction' },
] as const

const GAS_COOKTOP_LAYOUT_OPTIONS = [
  { value: 'gas-2burner', label: '2' },
  { value: 'gas-4burner', label: '4' },
  { value: 'gas-5burner-wok', label: '5' },
  { value: 'gas-6burner', label: '6' },
] as const satisfies Array<{ value: CooktopLayout; label: string }>

const INDUCTION_COOKTOP_LAYOUT_OPTIONS = [
  { value: 'induction-2zone', label: '2' },
  { value: 'induction-4zone', label: '4' },
] as const satisfies Array<{ value: CooktopLayout; label: string }>

const PULL_OUT_PANTRY_RACK_STYLE_OPTIONS = [
  { value: 'wire', label: 'Wire' },
  { value: 'tray', label: 'Tray' },
  { value: 'glass', label: 'Glass' },
] as const satisfies Array<{ value: (typeof PULL_OUT_PANTRY_RACK_STYLES)[number]; label: string }>

const DOOR_TYPE_OPTIONS = [
  { value: 'single-left', label: 'Left' },
  { value: 'single-right', label: 'Right' },
  { value: 'double', label: 'Double' },
  { value: 'glass', label: 'Glass' },
] as const

const HANDLE_STYLE_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'knob', label: 'Knob' },
  { value: 'cutout', label: 'Cutout' },
  { value: 'hole', label: 'Hole' },
  { value: 'none', label: 'None' },
] as const

const HANDLE_POSITION_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
] as const

const FRONT_OVERLAY_OPTIONS = [
  { value: 'full', label: 'Overlay' },
  { value: 'inset', label: 'Inset' },
] as const

const CABINET_TIER_OPTIONS = [
  { value: 'base', label: 'Base Cabinet' },
  { value: 'tall', label: 'Tall Cabinet' },
] as const

type CabinetEditableNode = CabinetNodeType | CabinetModuleNodeType
const EMPTY_MODULES: CabinetModuleNodeType[] = []
const EMPTY_MODULE_IDS: AnyNodeId[] = []
const RUN_POSITION_PATCH_KEYS = new Set<keyof CabinetNodeType>(['showPlinth', 'plinthHeight'])
const RUN_DEPTH_PATCH_KEY = 'depth'
const BASE_MODULE_WIDTH = 0.6
const BASE_CARCASS_HEIGHT = 0.72
const WALL_CARCASS_HEIGHT = 0.72
const WALL_DEPTH = 0.32
const TALL_PLINTH_HEIGHT = 0.1
const TALL_CARCASS_HEIGHT = TALL_CABINET_CARCASS_HEIGHT
const TALL_DEPTH = 0.58

function runModuleBaseY(node: Pick<CabinetNodeType, 'showPlinth' | 'plinthHeight'>) {
  return node.showPlinth ? node.plinthHeight : 0
}

function totalCabinetHeight(
  node: Pick<
    CabinetEditableNode,
    'showPlinth' | 'plinthHeight' | 'carcassHeight' | 'withCountertop' | 'countertopThickness'
  >,
) {
  return (
    (node.showPlinth ? node.plinthHeight : 0) +
    node.carcassHeight +
    (node.withCountertop ? node.countertopThickness : 0)
  )
}

function wallBottomHeightForTallAlignment() {
  return (
    totalCabinetHeight({
      showPlinth: true,
      plinthHeight: TALL_PLINTH_HEIGHT,
      carcassHeight: TALL_CARCASS_HEIGHT,
      withCountertop: false,
      countertopThickness: 0,
    }) - WALL_CARCASS_HEIGHT
  )
}

function moduleSummary(module: CabinetModuleNodeType) {
  if ((module.cabinetType ?? 'base') === 'tall') return 'Tall cabinet'
  const stack = stackForCabinet(module)
  if (stack.length === 0) return 'Empty'
  if (stack.length === 1) return stack[0]!.type
  return `${stack.length} compartments`
}

/** Local Z offset that makes a shallower wall cabinet's back flush with its deeper base. */
function backAlignZ(baseDepth: number, wallDepth: number) {
  return -(baseDepth - wallDepth) / 2
}

function wallChildOf(
  module: CabinetModuleNodeType,
  nodes: Record<string, CabinetEditableNode | undefined>,
): CabinetModuleNodeType | undefined {
  for (const childId of module.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (child?.type === 'cabinet-module') return child
  }
  return undefined
}

function stackForTallModule() {
  return [{ ...newCabinetCompartment('door'), shelfCount: 3 }]
}

function resolveCabinetType(
  module: CabinetModuleNodeType,
  parentRun?: CabinetNodeType,
): 'base' | 'tall' {
  if (module.cabinetType) return module.cabinetType
  return parentRun?.runTier === 'tall' ? 'tall' : 'base'
}

function bumpCabinetRunsLayoutRevisionOnLevel(
  scene: ReturnType<typeof useScene.getState>,
  levelId: AnyNodeId,
) {
  for (const candidate of Object.values(scene.nodes)) {
    if (candidate.type === 'cabinet' && candidate.parentId === levelId) {
      const metadata = cabinetMetadataRecord(candidate.metadata)
      const currentRevision =
        typeof metadata.cabinetLayoutRevision === 'number' ? metadata.cabinetLayoutRevision : 0
      scene.updateNode(candidate.id as AnyNodeId, {
        metadata: {
          ...metadata,
          cabinetLayoutRevision: currentRevision + 1,
        },
      })
    }
  }
}

function bumpCabinetRunLayoutRevision(
  scene: ReturnType<typeof useScene.getState>,
  run: CabinetNodeType,
) {
  const metadata = cabinetMetadataRecord(run.metadata)
  const currentRevision =
    typeof metadata.cabinetLayoutRevision === 'number' ? metadata.cabinetLayoutRevision : 0
  scene.updateNode(run.id as AnyNodeId, {
    metadata: {
      ...metadata,
      cabinetLayoutRevision: currentRevision + 1,
    },
  })
  if (run.parentId) {
    bumpCabinetRunsLayoutRevisionOnLevel(scene, run.parentId as AnyNodeId)
  }
}

const ICON_BUTTON_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/40 bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#343437] hover:text-foreground disabled:opacity-30 disabled:hover:bg-[#2C2C2E] disabled:hover:text-muted-foreground'

const STEPPER_BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#343437] hover:text-foreground'

const PRESET_BUTTON_CLASS =
  'flex h-9 items-center justify-center rounded-md border border-border/40 bg-[#252527] px-3 py-2 text-center text-xs font-medium text-foreground transition-colors hover:border-border/70 hover:bg-[#303033]'

function Stepper({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/30 bg-black/10 px-2 py-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <button
          className={STEPPER_BUTTON_CLASS}
          onClick={() => onChange(Math.max(min, value - 1))}
          type="button"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-7 text-center text-xs font-medium tabular-nums text-foreground">
          {value}
        </span>
        <button
          className={STEPPER_BUTTON_CLASS}
          onClick={() => onChange(Math.min(max, value + 1))}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function CompartmentTypeControl({
  value,
  onChange,
  includeHood = false,
  wallCabinet = false,
}: {
  value: CabinetCompartmentType | 'fridge' | 'hood' | 'cooktop'
  onChange: (value: CabinetCompartmentType | 'fridge' | 'hood' | 'cooktop') => void
  includeHood?: boolean
  wallCabinet?: boolean
}) {
  const options = wallCabinet
    ? WALL_COMPARTMENT_TYPE_CONTROL_OPTIONS
    : includeHood
      ? [...COMPARTMENT_TYPE_CONTROL_OPTIONS, HOOD_TYPE_OPTION]
      : COMPARTMENT_TYPE_CONTROL_OPTIONS
  return (
    <div className="grid w-full grid-cols-3 gap-1 rounded-lg border border-border/50 bg-[#2C2C2E] p-[3px]">
      {options.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            className={[
              'flex h-8 items-center justify-center rounded-md text-xs font-medium transition-all duration-200',
              isSelected
                ? 'bg-[#3e3e3e] text-foreground shadow-sm ring-1 ring-border/50'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
            ].join(' ')}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function cabinetMetadataRecord(metadata: CabinetEditableNode['metadata']): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

function reflowRunModules({
  modules,
  parentRun,
  patch,
  scene,
  selected,
}: {
  modules: CabinetModuleNodeType[]
  parentRun: CabinetNodeType
  patch: Partial<CabinetModuleNodeType>
  scene: ReturnType<typeof useScene.getState>
  selected: CabinetModuleNodeType
}) {
  const reflowed = reflowCabinetRunModules(modules, selected.id, patch.width ?? selected.width)
  if (reflowed.length === 0) return

  const reflowById = new Map(reflowed.map((entry) => [entry.id, entry]))
  for (const module of [...modules].sort((a, b) => a.position[0] - b.position[0])) {
    const reflow = reflowById.get(module.id)
    if (!reflow) continue
    const isSelected = module.id === selected.id
    const nextPatch: Partial<CabinetModuleNodeType> = isSelected ? { ...patch } : {}
    const nextPosition: CabinetModuleNodeType['position'] = [
      reflow.position[0],
      isSelected && patch.position ? patch.position[1] : reflow.position[1],
      isSelected && typeof patch.depth === 'number'
        ? backAnchoredModuleZ(module.position[2], module.depth, patch.depth)
        : reflow.position[2],
    ]

    if (isSelected) {
      const cabinetType = patch.cabinetType ?? module.cabinetType
      if (cabinetType === 'base') {
        nextPatch.depth = patch.depth ?? parentRun.depth
        nextPatch.carcassHeight = patch.carcassHeight ?? parentRun.carcassHeight
        nextPatch.plinthHeight = patch.plinthHeight ?? parentRun.plinthHeight
        nextPatch.toeKickDepth = patch.toeKickDepth ?? parentRun.toeKickDepth
        nextPatch.countertopThickness = patch.countertopThickness ?? 0
        nextPatch.countertopOverhang = patch.countertopOverhang ?? parentRun.countertopOverhang
      }
    }

    nextPatch.position = nextPosition
    scene.updateNode(module.id as AnyNodeId, nextPatch)

    const wallChild = wallChildOf(
      module,
      scene.nodes as Record<string, CabinetEditableNode | undefined>,
    )
    if (wallChild) {
      scene.updateNode(wallChild.id as AnyNodeId, {
        position: [
          0,
          wallChild.position[1],
          backAlignZ(nextPatch.depth ?? module.depth, wallChild.depth),
        ],
        width: reflow.width,
      })
      scene.dirtyNodes.add(module.id as AnyNodeId)
    }
  }

  bumpCabinetRunLayoutRevision(scene, parentRun)
}

function CompartmentCard({
  compartment,
  index,
  displayIndex,
  total,
  carcassHeight,
  resolvedHeight,
  width,
  onReplace,
  onResizeHeight,
  onRemove,
  onMove,
  allowHood = false,
  wallCabinet = false,
}: {
  compartment: CabinetCompartment
  index: number
  displayIndex: number
  total: number
  carcassHeight: number
  resolvedHeight: number
  width: number
  onReplace: (next: CabinetCompartment) => void
  onResizeHeight: (height: number) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
  allowHood?: boolean
  wallCabinet?: boolean
}) {
  const type = compartment.type as CabinetCompartmentType
  const isFridge = isFridgeCompartmentType(type)
  const isHood = isHoodCompartmentType(type)
  const isCooktop = isCooktopCompartmentType(type)
  return (
    <div className="rounded-lg border border-border/40 bg-[#252527] p-2">
      <div className="flex items-center justify-between pb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {displayIndex === 0
            ? 'Top'
            : displayIndex === total - 1
              ? 'Bottom'
              : `#${total - displayIndex}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            className={ICON_BUTTON_CLASS}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            type="button"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            className={ICON_BUTTON_CLASS}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            type="button"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-500/20 bg-red-500/8 text-red-300 transition-colors hover:bg-red-500/15 hover:text-red-200 disabled:opacity-30 disabled:hover:bg-red-500/8"
            disabled={total <= 1}
            onClick={onRemove}
            type="button"
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="pb-2">
        <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Type
        </div>
        <CompartmentTypeControl
          includeHood={allowHood || isHood}
          wallCabinet={wallCabinet}
          onChange={(value) => {
            const nextType: CabinetCompartmentType =
              value === 'fridge'
                ? 'fridge-single'
                : value === 'hood'
                  ? 'hood-pyramid'
                  : value === 'cooktop'
                    ? 'cooktop-gas'
                    : (value as CabinetCompartmentType)
            onReplace({
              ...newCabinetCompartment(nextType),
              id: compartment.id,
            })
          }}
          value={isFridge ? 'fridge' : isHood ? 'hood' : isCooktop ? 'cooktop' : type}
        />
      </div>

      {!isHood && !isCooktop && (
        <div className="pb-2">
          <SliderControl
            label="Height"
            max={carcassHeight}
            min={0.1}
            onChange={onResizeHeight}
            precision={2}
            step={0.01}
            unit="m"
            value={resolvedHeight}
          />
        </div>
      )}

      {type === 'shelf' && (
        <Stepper
          label="Shelves"
          max={8}
          min={0}
          onChange={(value) => onReplace({ ...compartment, shelfCount: value })}
          value={compartmentShelfCount(compartment)}
        />
      )}

      {type === 'drawer' && (
        <Stepper
          label="Drawers"
          max={6}
          min={1}
          onChange={(value) => onReplace({ ...compartment, drawerCount: value })}
          value={compartmentDrawerCount(compartment)}
        />
      )}

      {type === 'door' && (
        <div className="space-y-2">
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Style
            </div>
            <SegmentedControl
              onChange={(value) => onReplace({ ...compartment, doorType: value })}
              options={DOOR_TYPE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={compartmentDoorType(compartment, width)}
            />
          </div>
          <Stepper
            label="Shelves inside"
            max={8}
            min={0}
            onChange={(value) => onReplace({ ...compartment, shelfCount: value })}
            value={compartmentShelfCount(compartment)}
          />
        </div>
      )}

      {isFridge && (
        <div>
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Style
          </div>
          <SegmentedControl
            onChange={(value) =>
              onReplace({
                ...compartment,
                type: value as CabinetFridgeCompartmentType,
                height: compartment.height ?? FRIDGE_COLUMN_HEIGHT,
              })
            }
            options={FRIDGE_STYLE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={type}
          />
        </div>
      )}

      {isHood && (
        <div className="rounded-lg border border-border/30 bg-black/10 px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
          Chimney
        </div>
      )}

      {isCooktop && (
        <div className="space-y-2">
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Surface
          </div>
          <SegmentedControl
            onChange={(value) =>
              onReplace({
                ...compartment,
                type: value as CabinetCooktopCompartmentType,
                cooktopLayout:
                  value === 'cooktop-gas'
                    ? COOKTOP_DEFAULT_GAS_LAYOUT
                    : COOKTOP_DEFAULT_INDUCTION_LAYOUT,
                height: compartment.height ?? 0.08,
                cooktopBurnersOn: compartment.cooktopBurnersOn ?? false,
                cooktopShowGrate: compartment.cooktopShowGrate ?? true,
              })
            }
            options={COOKTOP_STYLE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={type}
          />
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Layout
            </div>
            <SegmentedControl
              onChange={(value) =>
                onReplace({
                  ...compartment,
                  cooktopLayout: value,
                })
              }
              options={(type === 'cooktop-gas'
                ? GAS_COOKTOP_LAYOUT_OPTIONS
                : INDUCTION_COOKTOP_LAYOUT_OPTIONS
              ).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={compartmentCooktopLayout(compartment, type as CabinetCooktopCompartmentType)}
            />
          </div>
          <ToggleControl
            checked={compartmentCooktopBurnersOn(compartment)}
            label="Burners on"
            onChange={(checked) => {
              const count = compartmentCooktopElementCount(
                compartment,
                type as CabinetCooktopCompartmentType,
              )
              onReplace({
                ...compartment,
                cooktopBurnersOn: checked,
                cooktopActiveBurners: checked
                  ? Array.from({ length: count }, (_, index) => index)
                  : [],
                cooktopKnobProgress: Array.from({ length: count }, () => (checked ? 1 : 0)),
              })
            }}
          />
          {type === 'cooktop-gas' && (
            <ToggleControl
              checked={compartmentCooktopShowGrate(compartment)}
              label="Top grate"
              onChange={(checked) => onReplace({ ...compartment, cooktopShowGrate: checked })}
            />
          )}
        </div>
      )}

      {type === 'pull-out-pantry' && (
        <div className="space-y-2">
          <Stepper
            label="Baskets"
            max={8}
            min={2}
            onChange={(value) => onReplace({ ...compartment, shelfCount: value })}
            value={compartmentShelfCount(compartment)}
          />
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Rack
            </div>
            <SegmentedControl
              onChange={(value) => onReplace({ ...compartment, pantryRackStyle: value })}
              options={PULL_OUT_PANTRY_RACK_STYLE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={compartmentPullOutPantryRackStyle(compartment)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function CabinetRunPanel({
  node,
  modules,
  onClose,
}: {
  node: CabinetNodeType
  modules: CabinetModuleNodeType[]
  onClose: () => void
}) {
  const setSelection = useViewer((s) => s.setSelection)
  const sortedModules = useMemo(
    () => [...modules].sort((a, b) => a.position[0] - b.position[0]),
    [modules],
  )

  const updateRun = useCallback(
    (patch: Partial<CabinetNodeType>) => {
      const scene = useScene.getState()
      const nextPatch = { ...patch }
      if (typeof nextPatch.carcassHeight === 'number') {
        const minModuleHeight = Math.max(
          0.4,
          ...modules.map((module) => minCabinetCarcassHeightForStack(module)),
        )
        nextPatch.carcassHeight = Math.max(nextPatch.carcassHeight, minModuleHeight)
      }
      const nextNode = { ...node, ...nextPatch }
      scene.updateNode(node.id, nextPatch)

      const shouldSyncDepth = RUN_DEPTH_PATCH_KEY in nextPatch
      const shouldSyncHeight = 'carcassHeight' in nextPatch
      const shouldSyncPosition = Object.keys(nextPatch).some((key) =>
        RUN_POSITION_PATCH_KEYS.has(key as keyof CabinetNodeType),
      )
      if (!shouldSyncDepth && !shouldSyncHeight && !shouldSyncPosition) return

      for (const module of modules) {
        const modulePatch: Partial<CabinetModuleNodeType> = {}
        if (shouldSyncDepth) {
          modulePatch.depth = nextNode.depth
        }
        if (shouldSyncHeight) {
          modulePatch.carcassHeight = Math.max(
            nextNode.carcassHeight,
            minCabinetCarcassHeightForStack(module),
          )
        }
        if (shouldSyncPosition) {
          modulePatch.position = [module.position[0], runModuleBaseY(nextNode), module.position[2]]
        }
        scene.updateNode(module.id, modulePatch)
      }
    },
    [modules, node],
  )

  const addModule = useCallback(
    (side: 'left' | 'right') => {
      const defaults = cabinetModuleDefinition.defaults()
      const width = defaults.width
      const leftEdge =
        modules.length > 0
          ? Math.min(...modules.map((module) => module.position[0] - module.width / 2))
          : 0
      const rightEdge =
        modules.length > 0
          ? Math.max(...modules.map((module) => module.position[0] + module.width / 2))
          : 0
      const x = side === 'left' ? leftEdge - width / 2 : rightEdge + width / 2
      const module = CabinetModuleNode.parse({
        ...defaults,
        name: `Base Cabinet ${modules.length + 1}`,
        parentId: node.id,
        position: [x, runModuleBaseY(node), 0],
        depth: node.depth,
        carcassHeight: node.carcassHeight,
        plinthHeight: node.plinthHeight,
        toeKickDepth: node.toeKickDepth,
        countertopThickness: node.countertopThickness,
        countertopOverhang: node.countertopOverhang,
      })
      const scene = useScene.getState()
      scene.createNode(module, node.id as AnyNodeId)
      scene.dirtyNodes.add(node.id as AnyNodeId)
      bumpCabinetRunLayoutRevision(scene, node)
      setSelection({ selectedIds: [module.id] })
    },
    [modules, node, setSelection],
  )

  const deleteModule = useCallback(
    (module: CabinetModuleNodeType) => {
      useScene.getState().deleteNode(module.id as AnyNodeId)
      useScene.getState().dirtyNodes.add(node.id as AnyNodeId)
      setSelection({ selectedIds: [node.id] })
    },
    [node.id, setSelection],
  )

  return (
    <PanelWrapper
      icon="/icons/furniture.webp"
      onClose={onClose}
      title={node.name || 'Modular Cabinet'}
      width={320}
    >
      <PanelSection title="Modules">
        <div className="flex flex-col gap-2 px-1 pb-2">
          {sortedModules.map((module, index) => (
            <div
              className="flex items-center justify-between rounded-lg border border-border/40 bg-[#252527] px-2 py-2"
              key={module.id}
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => setSelection({ selectedIds: [module.id] })}
                type="button"
              >
                <div className="truncate text-xs font-medium text-foreground">
                  {module.name || `Module ${index + 1}`}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {moduleSummary(module)}
                </div>
              </button>
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-500/20 bg-red-500/8 text-red-300 transition-colors hover:bg-red-500/15 hover:text-red-200 disabled:opacity-30"
                disabled={modules.length <= 1}
                onClick={() => deleteModule(module)}
                type="button"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="px-1 pb-1">
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              icon={<Plus className="h-4 w-4" />}
              label="Add left"
              onClick={() => addModule('left')}
            />
            <ActionButton
              icon={<Plus className="h-4 w-4" />}
              label="Add right"
              onClick={() => addModule('right')}
            />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Shared Plinth & Countertop">
        <div className="space-y-2 px-1 pb-2">
          <SliderControl
            label="Depth"
            max={1.2}
            min={0.3}
            onChange={(value) => updateRun({ depth: value })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.depth}
          />
          <SliderControl
            label="Carcass height"
            max={node.runTier === 'tall' ? 2.4 : 1.4}
            min={Math.max(0.4, ...modules.map((module) => minCabinetCarcassHeightForStack(module)))}
            onChange={(value) => updateRun({ carcassHeight: value })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.carcassHeight}
          />
          <ToggleControl
            checked={node.showPlinth}
            label="Show plinth"
            onChange={(checked) => updateRun({ showPlinth: checked })}
          />
          {node.showPlinth && (
            <SliderControl
              label="Plinth height"
              max={0.3}
              min={0.02}
              onChange={(value) => updateRun({ plinthHeight: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.plinthHeight}
            />
          )}
          <ToggleControl
            checked={node.withCountertop}
            label="Show countertop"
            onChange={(checked) => updateRun({ withCountertop: checked })}
          />
          {node.withCountertop && (
            <>
              <SliderControl
                label="Countertop height"
                max={0.08}
                min={0.005}
                onChange={(value) => updateRun({ countertopThickness: value })}
                precision={3}
                step={0.005}
                unit="m"
                value={node.countertopThickness}
              />
              <SliderControl
                label="Countertop depth"
                max={0.12}
                min={0}
                onChange={(value) => updateRun({ countertopOverhang: value })}
                precision={2}
                step={0.005}
                unit="m"
                value={node.countertopOverhang}
              />
            </>
          )}
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}

export default function CabinetPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const setCabinetHostDragArmedId = useEditor((s) => s.setCabinetHostDragArmedId)
  const animationFrameRef = useRef<number | null>(null)
  const animationTargetRef = useRef<0 | 1 | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNodeId] as CabinetEditableNode | undefined) : undefined,
  )
  const parentRun = useScene((s) => {
    if (!selectedId) return undefined
    const selected = s.nodes[selectedId as AnyNodeId]
    if (selected?.type !== 'cabinet-module' || !selected.parentId) return undefined
    const parent = s.nodes[selected.parentId as AnyNodeId] as CabinetEditableNode | undefined
    return parent?.type === 'cabinet' ? parent : undefined
  })
  const moduleIds = useScene((s) => {
    if (!selectedId) return EMPTY_MODULE_IDS
    const selected = s.nodes[selectedId as AnyNodeId] as CabinetEditableNode | undefined
    const parent =
      selected?.type === 'cabinet'
        ? selected
        : selected?.type === 'cabinet-module' && selected.parentId
          ? (s.nodes[selected.parentId as AnyNodeId] as CabinetNodeType | undefined)
          : undefined
    if (parent?.type !== 'cabinet') return EMPTY_MODULE_IDS
    return (parent.children ?? EMPTY_MODULE_IDS) as AnyNodeId[]
  })
  const nodes = useScene((s) => s.nodes)
  const modules = useMemo(
    () =>
      moduleIds.length === 0
        ? EMPTY_MODULES
        : moduleIds
            .map((id) => nodes[id as AnyNodeId] as CabinetModuleNodeType | undefined)
            .filter((child): child is CabinetModuleNodeType => child?.type === 'cabinet-module'),
    [moduleIds, nodes],
  )

  const updateNode = useCallback(
    (patch: Partial<CabinetEditableNode>) => {
      if (!selectedId) return
      const scene = useScene.getState()
      const liveBeforeUpdate = scene.nodes[selectedId as AnyNodeId] as
        | CabinetEditableNode
        | undefined
      const nextPatch = { ...patch }
      if (
        liveBeforeUpdate?.type === 'cabinet-module' &&
        typeof nextPatch.carcassHeight === 'number'
      ) {
        nextPatch.carcassHeight = Math.max(
          nextPatch.carcassHeight,
          minCabinetCarcassHeightForStack(liveBeforeUpdate),
        )
      }
      if (
        liveBeforeUpdate?.type === 'cabinet-module' &&
        liveBeforeUpdate.parentId &&
        parentRun?.type === 'cabinet' &&
        'width' in nextPatch &&
        typeof nextPatch.width === 'number'
      ) {
        reflowRunModules({
          modules,
          parentRun,
          patch: nextPatch as Partial<CabinetModuleNodeType>,
          scene,
          selected: liveBeforeUpdate,
        })
        return
      }
      if (
        liveBeforeUpdate?.type === 'cabinet-module' &&
        liveBeforeUpdate.parentId &&
        parentRun?.type === 'cabinet' &&
        typeof nextPatch.depth === 'number'
      ) {
        const patchPosition = nextPatch.position as CabinetModuleNodeType['position'] | undefined
        nextPatch.position = [
          patchPosition?.[0] ?? liveBeforeUpdate.position[0],
          patchPosition?.[1] ?? liveBeforeUpdate.position[1],
          backAnchoredModuleZ(
            liveBeforeUpdate.position[2],
            liveBeforeUpdate.depth,
            nextPatch.depth,
          ),
        ]
      }
      scene.updateNode(selectedId as AnyNodeId, nextPatch)
      const liveNode = scene.nodes[selectedId as AnyNodeId] as CabinetEditableNode | undefined
      if (liveNode?.type === 'cabinet-module' && liveNode.parentId) {
        scene.dirtyNodes.add(liveNode.parentId as AnyNodeId)
        const parent = scene.nodes[liveNode.parentId as AnyNodeId] as
          | CabinetEditableNode
          | undefined
        const affectsRunLayout =
          'stack' in nextPatch ||
          'carcassHeight' in nextPatch ||
          'cabinetType' in nextPatch ||
          'position' in nextPatch ||
          'depth' in nextPatch ||
          'width' in nextPatch
        if (parent?.type === 'cabinet' && affectsRunLayout) {
          bumpCabinetRunLayoutRevision(scene, parent)
        }
      }
      // Keep a nested wall cabinet's back flush with its base when the base depth changes.
      if ('depth' in nextPatch && liveNode?.type === 'cabinet-module') {
        const wallChild = wallChildOf(
          liveNode,
          scene.nodes as Record<string, CabinetEditableNode | undefined>,
        )
        if (wallChild) {
          scene.updateNode(wallChild.id as AnyNodeId, {
            position: [
              wallChild.position[0],
              wallChild.position[1],
              backAlignZ(liveNode.depth, wallChild.depth),
            ],
          })
          scene.dirtyNodes.add(liveNode.id as AnyNodeId)
        }
      }
    },
    [modules, parentRun, selectedId],
  )

  const close = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const backToRun = useCallback(() => {
    if (node?.type === 'cabinet-module' && node.parentId) {
      setCabinetHostDragArmedId(node.parentId as AnyNodeId)
      setSelection({ selectedIds: [node.parentId] })
    }
  }, [node, setCabinetHostDragArmedId, setSelection])

  const stopAnimation = useCallback(() => {
    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    animationTargetRef.current = null
    setIsAnimating(false)
  }, [])

  const animateOperationState = useCallback(
    (target: 0 | 1) => {
      if (!selectedId) return
      if (animationFrameRef.current != null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      const liveNode = useScene.getState().nodes[selectedId as AnyNodeId]
      if (liveNode?.type !== 'cabinet' && liveNode?.type !== 'cabinet-module') return

      const start = liveNode.operationState ?? 0
      if (Math.abs(start - target) < 1e-4) {
        updateNode({ operationState: target })
        animationTargetRef.current = null
        setIsAnimating(false)
        return
      }

      animationTargetRef.current = target
      setIsAnimating(true)
      const startTime = window.performance.now()
      const hasFridge = stackForCabinet(liveNode).some((compartment) =>
        isFridgeCompartmentType(compartment.type),
      )
      const duration = hasFridge ? 450 : 320

      const step = (time: number) => {
        const t = Math.min(1, (time - startTime) / duration)
        const eased = 1 - (1 - t) ** 3
        const nextValue = start + (target - start) * eased
        updateNode({ operationState: nextValue })

        if (t < 1) {
          animationFrameRef.current = window.requestAnimationFrame(step)
          return
        }

        updateNode({ operationState: target })
        animationFrameRef.current = null
        animationTargetRef.current = null
        setIsAnimating(false)
      }

      animationFrameRef.current = window.requestAnimationFrame(step)
    },
    [selectedId, updateNode],
  )

  useEffect(() => () => stopAnimation(), [stopAnimation])

  if (!node || (node.type !== 'cabinet' && node.type !== 'cabinet-module')) return null

  const stack = stackForCabinet(node)
  const isHoodOnlyNode =
    stack.length > 0 && stack.every((compartment) => isHoodCompartmentType(compartment.type))
  const normalized = normalizeCabinetStack(node)
  const rowHeights = new Map(normalized.map((row) => [row.index, row.height]))
  const rows = stack.map((compartment, index) => ({ compartment, index })).reverse()

  const commitStack = (
    next: CabinetCompartment[],
    extraPatch: Partial<CabinetModuleNodeType> = {},
  ) => {
    const patch = { ...extraPatch, stack: next }
    const minCarcassHeight = minCabinetCarcassHeightForStack({ ...node, stack: next })
    const targetCarcassHeight = patch.carcassHeight ?? node.carcassHeight
    if (targetCarcassHeight < minCarcassHeight) patch.carcassHeight = minCarcassHeight
    if (node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && patch.width) {
      reflowRunModules({
        modules,
        parentRun,
        patch,
        scene: useScene.getState(),
        selected: node,
      })
      return
    }
    updateNode(patch)
  }
  const replaceAt = (index: number, next: CabinetCompartment) => {
    const current = stack[index]
    const leavingFridge = current ? isFridgeCompartmentType(current.type) : false
    const enteringFridge = isFridgeCompartmentType(next.type)
    const enteringCooktop = isCooktopCompartmentType(next.type)
    const leavingPullOutPantry = current?.type === 'pull-out-pantry'
    const enteringPullOutPantry = next.type === 'pull-out-pantry'
    const leavingHood = current ? isHoodCompartmentType(current.type) : false
    const enteringHood = isHoodCompartmentType(next.type)
    const enteringSingleDishwasher = next.type === 'dishwasher' && stack.length === 1
    const hoodModulePatch: Partial<CabinetModuleNodeType> = enteringHood
      ? {
          carcassHeight: Math.max(
            0.4,
            hoodCompartmentHeight(next.type as CabinetHoodCompartmentType),
          ),
          countertopThickness: 0,
          countertopOverhang: 0,
          showPlinth: false,
          withCountertop: false,
        }
      : leavingHood
        ? { carcassHeight: WALL_CARCASS_HEIGHT }
        : {}
    const tallApplianceModulePatch: Partial<CabinetModuleNodeType> =
      enteringFridge || enteringPullOutPantry
        ? {
            cabinetType: 'tall',
            width: enteringPullOutPantry
              ? PULL_OUT_PANTRY_STANDARD_WIDTH
              : next.type === 'fridge-double'
                ? FRIDGE_WIDE_WIDTH
                : FRIDGE_COLUMN_WIDTH,
            depth: parentRun?.depth ?? 0.58,
            carcassHeight: TALL_CARCASS_HEIGHT,
            plinthHeight: 0.1,
            toeKickDepth: 0.075,
            countertopThickness: 0,
            countertopOverhang: parentRun?.countertopOverhang ?? 0.02,
            showPlinth: false,
            withCountertop: false,
          }
        : {}
    const standardModulePatch: Partial<CabinetModuleNodeType> =
      (leavingFridge || leavingPullOutPantry) && !enteringFridge && !enteringPullOutPantry
        ? {
            cabinetType: 'base',
            width:
              next.type === 'microwave'
                ? MICROWAVE_STANDARD_WIDTH
                : next.type === 'dishwasher'
                  ? DISHWASHER_STANDARD_WIDTH
                  : enteringCooktop
                    ? COOKTOP_STANDARD_WIDTH
                    : BASE_MODULE_WIDTH,
            depth: parentRun?.depth ?? 0.58,
            carcassHeight: parentRun?.carcassHeight ?? BASE_CARCASS_HEIGHT,
            plinthHeight: parentRun?.plinthHeight ?? 0.1,
            toeKickDepth: parentRun?.toeKickDepth ?? 0.075,
            countertopThickness: 0,
            countertopOverhang: parentRun?.countertopOverhang ?? 0.02,
            showPlinth: false,
            withCountertop: false,
          }
        : {}
    const dishwasherModulePatch: Partial<CabinetModuleNodeType> = enteringSingleDishwasher
      ? {
          cabinetType: 'base',
          width: DISHWASHER_STANDARD_WIDTH,
          depth: parentRun?.depth ?? 0.58,
          carcassHeight: DISHWASHER_STANDARD_HEIGHT,
          plinthHeight: parentRun?.plinthHeight ?? 0.1,
          toeKickDepth: parentRun?.toeKickDepth ?? 0.075,
          countertopThickness: 0,
          countertopOverhang: parentRun?.countertopOverhang ?? 0.02,
          showPlinth: false,
          withCountertop: false,
        }
      : {}

    commitStack(
      enteringFridge
        ? fridgeCabinetStack(next.type as CabinetFridgeCompartmentType)
        : enteringCooktop && stack.length === 1
          ? cooktopCabinetStack(next.type as CabinetCooktopCompartmentType)
          : enteringPullOutPantry
            ? [{ ...next, height: TALL_CARCASS_HEIGHT }]
            : enteringHood
              ? [next]
              : replaceCabinetCompartmentStack(
                  node,
                  index,
                  next,
                  node.type === 'cabinet-module' && resolveCabinetType(node, parentRun) === 'base'
                    ? 'drawer'
                    : 'door',
                ),
      {
        ...tallApplianceModulePatch,
        ...standardModulePatch,
        ...dishwasherModulePatch,
        ...hoodModulePatch,
        ...(next.type === 'microwave' ? { width: MICROWAVE_STANDARD_WIDTH } : {}),
        ...(next.type === 'dishwasher' ? { width: DISHWASHER_STANDARD_WIDTH } : {}),
        ...(enteringCooktop ? { width: COOKTOP_STANDARD_WIDTH } : {}),
        ...(enteringPullOutPantry ? { width: PULL_OUT_PANTRY_STANDARD_WIDTH } : {}),
        ...(isFridgeCompartmentType(next.type) && next.type !== 'fridge-double'
          ? { width: FRIDGE_COLUMN_WIDTH }
          : {}),
        ...(next.type === 'fridge-double' ? { width: FRIDGE_WIDE_WIDTH } : {}),
      },
    )
  }
  const resizeAt = (index: number, height: number) =>
    commitStack(resizeCabinetCompartmentStack(node, index, height))
  const removeAt = (index: number) => commitStack(stack.filter((_, i) => i !== index))
  const addCompartment = () => commitStack([...stack, newCabinetCompartment('shelf')])
  const moveCompartment = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= stack.length) return
    const next = stack.slice()
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    commitStack(next)
  }

  const addWallChildAbove = (kind: 'cabinet' | 'hood') => {
    if (
      node?.type !== 'cabinet-module' ||
      parentRun?.type !== 'cabinet' ||
      resolveCabinetType(node, parentRun) !== 'base'
    )
      return
    if (wallChildOf(node, nodes as Record<string, CabinetEditableNode | undefined>)) return

    const isHoodChild = kind === 'hood'
    const carcassHeight = isHoodChild
      ? Math.max(0.4, hoodCompartmentHeight('hood-pyramid'))
      : WALL_CARCASS_HEIGHT
    const wall = CabinetModuleNode.parse({
      ...cabinetModuleDefinition.defaults(),
      name: isHoodChild ? 'Chimney' : 'Wall Cabinet',
      parentId: node.id,
      // Keep the wall cabinet top aligned with the default tall cabinet top.
      position: [
        0,
        wallBottomHeightForTallAlignment() - node.position[1],
        backAlignZ(node.depth, WALL_DEPTH),
      ],
      width: node.width,
      depth: WALL_DEPTH,
      carcassHeight,
      plinthHeight: 0,
      toeKickDepth: 0,
      countertopThickness: 0,
      countertopOverhang: 0,
      showPlinth: false,
      withCountertop: false,
      stack: isHoodChild
        ? [newCabinetCompartment('hood-pyramid')]
        : [{ ...newCabinetCompartment('door'), shelfCount: 1 }],
    })
    useScene.getState().createNode(wall, node.id as AnyNodeId)
    useScene.getState().dirtyNodes.add(node.id as AnyNodeId)
    setSelection({ selectedIds: [wall.id] })
  }

  const addWallCabinetAbove = () => addWallChildAbove('cabinet')
  const addHoodAbove = () => addWallChildAbove('hood')

  const removeWallCabinet = () => {
    if (node?.type !== 'cabinet-module') return
    const wall = wallChildOf(node, nodes as Record<string, CabinetEditableNode | undefined>)
    if (!wall) return
    useScene.getState().deleteNode(wall.id as AnyNodeId)
    useScene.getState().dirtyNodes.add(node.id as AnyNodeId)
    setSelection({ selectedIds: [node.id] })
  }

  const switchCabinetToTall = () => {
    if (
      node?.type !== 'cabinet-module' ||
      parentRun?.type !== 'cabinet' ||
      resolveCabinetType(node, parentRun) !== 'base'
    )
      return
    const scene = useScene.getState()
    const wallChild = wallChildOf(
      node,
      scene.nodes as Record<string, CabinetEditableNode | undefined>,
    )
    if (wallChild) {
      scene.deleteNode(wallChild.id as AnyNodeId)
    }
    scene.updateNode(node.id as AnyNodeId, {
      name: 'Tall Cabinet',
      cabinetType: 'tall',
      depth: TALL_DEPTH,
      position: [
        node.position[0],
        runModuleBaseY(parentRun),
        backAnchoredModuleZ(node.position[2], node.depth, TALL_DEPTH),
      ],
      carcassHeight: TALL_CARCASS_HEIGHT,
      plinthHeight: TALL_PLINTH_HEIGHT,
      toeKickDepth: 0.075,
      showPlinth: false,
      countertopThickness: 0,
      countertopOverhang: parentRun.countertopOverhang,
      withCountertop: false,
      stack: stackForTallModule(),
    })
    scene.dirtyNodes.add(parentRun.id as AnyNodeId)
    if (parentRun.parentId) {
      bumpCabinetRunsLayoutRevisionOnLevel(scene, parentRun.parentId as AnyNodeId)
    }
    setSelection({ selectedIds: [node.id] })
  }

  const switchTallToBase = () => {
    if (
      node?.type !== 'cabinet-module' ||
      parentRun?.type !== 'cabinet' ||
      resolveCabinetType(node, parentRun) !== 'tall'
    )
      return
    const scene = useScene.getState()
    scene.updateNode(node.id as AnyNodeId, {
      name: 'Base Cabinet',
      cabinetType: 'base',
      depth: parentRun.depth,
      position: [
        node.position[0],
        runModuleBaseY(parentRun),
        backAnchoredModuleZ(node.position[2], node.depth, parentRun.depth),
      ],
      carcassHeight: parentRun.carcassHeight,
      plinthHeight: parentRun.plinthHeight,
      toeKickDepth: parentRun.toeKickDepth,
      showPlinth: false,
      countertopThickness: 0,
      countertopOverhang: parentRun.countertopOverhang,
      withCountertop: false,
      stack: [{ ...newCabinetCompartment('door'), shelfCount: 1 }],
    })
    scene.dirtyNodes.add(parentRun.id as AnyNodeId)
    if (parentRun.parentId) {
      bumpCabinetRunsLayoutRevisionOnLevel(scene, parentRun.parentId as AnyNodeId)
    }
    setSelection({ selectedIds: [node.id] })
  }

  const hasWallCabinet =
    node?.type === 'cabinet-module'
      ? Boolean(wallChildOf(node, nodes as Record<string, CabinetEditableNode | undefined>))
      : false

  const isWallChildModule =
    node?.type === 'cabinet-module' &&
    node.parentId != null &&
    nodes[node.parentId as AnyNodeId]?.type === 'cabinet-module'

  const applyPreset = (presetId: CabinetPresetId) => {
    if (node?.type !== 'cabinet-module') return
    const scene = useScene.getState()
    const preset = CABINET_PRESETS.find((entry) => entry.id === presetId)
    if (!preset) return

    const patch = preset.createPatch(parentRun)
    const wallChild = wallChildOf(
      node,
      scene.nodes as Record<string, CabinetEditableNode | undefined>,
    )
    if (wallChild && patch.cabinetType === 'tall') {
      scene.deleteNode(wallChild.id as AnyNodeId)
    }

    const nextPatch: Partial<CabinetModuleNodeType> = {
      ...patch,
      position: [
        node.position[0],
        parentRun?.type === 'cabinet' ? runModuleBaseY(parentRun) : node.position[1],
        typeof patch.depth === 'number'
          ? backAnchoredModuleZ(node.position[2], node.depth, patch.depth)
          : node.position[2],
      ],
    }

    if (parentRun?.type === 'cabinet') {
      reflowRunModules({
        modules,
        parentRun,
        patch: nextPatch,
        scene,
        selected: node,
      })
    } else {
      scene.updateNode(node.id as AnyNodeId, nextPatch)
    }
    setSelection({ selectedIds: [node.id] })
  }

  if (node.type === 'cabinet' && modules.length > 0) {
    return <CabinetRunPanel modules={modules} node={node} onClose={close} />
  }

  return (
    <PanelWrapper
      icon="/icons/furniture.webp"
      onBack={node.type === 'cabinet-module' ? backToRun : undefined}
      onClose={close}
      title={node.name || 'Modular Cabinet'}
      width={320}
    >
      {node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && (
        <PanelSection title="Presets">
          <div className="grid grid-cols-2 gap-2 px-1 pb-2">
            {CABINET_PRESETS.map((preset) => (
              <button
                className={PRESET_BUTTON_CLASS}
                key={preset.id}
                onClick={() => applyPreset(preset.id)}
                type="button"
              >
                <span className="truncate">{preset.label}</span>
              </button>
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={3}
          min={0.3}
          onChange={(value) => updateNode({ width: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.width}
        />
        {!isHoodOnlyNode && (
          <>
            <SliderControl
              label="Depth"
              max={1.2}
              min={0.3}
              onChange={(value) => updateNode({ depth: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.depth}
            />
            <SliderControl
              label="Carcass height"
              max={
                node.type === 'cabinet-module' && resolveCabinetType(node, parentRun) === 'tall'
                  ? 2.4
                  : 1.4
              }
              min={
                node.type === 'cabinet-module'
                  ? Math.max(0.4, minCabinetCarcassHeightForStack(node))
                  : 0.4
              }
              onChange={(value) => updateNode({ carcassHeight: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.carcassHeight}
            />
          </>
        )}
      </PanelSection>

      {node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && !isHoodOnlyNode && (
        <PanelSection title="Cabinet Type">
          <div className="space-y-2 px-1 pb-2">
            <SegmentedControl
              onChange={(value) => {
                if (value === 'tall') {
                  switchCabinetToTall()
                  return
                }
                switchTallToBase()
              }}
              options={CABINET_TIER_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={resolveCabinetType(node, parentRun)}
            />
            {resolveCabinetType(node, parentRun) === 'base' &&
              (hasWallCabinet ? (
                <ActionButton label="Remove wall cabinet" onClick={removeWallCabinet} />
              ) : (
                <>
                  <ActionButton label="Add wall cabinet" onClick={addWallCabinetAbove} />
                  <ActionButton label="Add chimney" onClick={addHoodAbove} />
                </>
              ))}
          </div>
        </PanelSection>
      )}

      {!isHoodOnlyNode && (
        <PanelSection title="Open Animation">
          <div className="flex items-center gap-2 px-1">
            <div className="min-w-0 flex-1">
              <SliderControl
                label="Open"
                max={100}
                min={0}
                onChange={(value) => {
                  if (isAnimating) stopAnimation()
                  updateNode({ operationState: value / 100 })
                }}
                step={1}
                unit="%"
                value={Math.round((node.operationState ?? 0) * 100)}
              />
            </div>
            <button
              aria-label={
                isAnimating
                  ? 'Stop animation'
                  : (node.operationState ?? 0) >= 0.99
                    ? 'Close cabinet'
                    : 'Open cabinet'
              }
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border/40 bg-[#2C2C2E] px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-[#3e3e3e]"
              onClick={() => {
                if (isAnimating) {
                  stopAnimation()
                  return
                }
                animateOperationState((node.operationState ?? 0) >= 0.99 ? 0 : 1)
              }}
              title={
                isAnimating
                  ? 'Stop animation'
                  : (node.operationState ?? 0) >= 0.99
                    ? 'Close cabinet'
                    : 'Play animation'
              }
              type="button"
            >
              {isAnimating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>
                {isAnimating ? 'Stop' : (node.operationState ?? 0) >= 0.99 ? 'Close' : 'Play'}
              </span>
            </button>
          </div>
        </PanelSection>
      )}

      <PanelSection title="Compartments">
        <div className="flex flex-col gap-2 px-1 pb-2">
          {rows.map(({ compartment, index }, displayIndex) => (
            <CompartmentCard
              allowHood={isWallChildModule}
              wallCabinet={isWallChildModule}
              compartment={compartment}
              carcassHeight={node.carcassHeight}
              displayIndex={displayIndex}
              index={index}
              key={compartment.id}
              onMove={(delta) => moveCompartment(index, delta)}
              onRemove={() => removeAt(index)}
              onReplace={(next) => replaceAt(index, next)}
              onResizeHeight={(height) => resizeAt(index, height)}
              resolvedHeight={
                rowHeights.get(index) ?? node.carcassHeight / Math.max(stack.length, 1)
              }
              total={rows.length}
              width={node.width}
            />
          ))}
        </div>
        <div className="px-1 pb-1">
          <ActionButton
            icon={<Plus className="h-4 w-4" />}
            label="Add compartment"
            onClick={addCompartment}
          />
        </div>
      </PanelSection>

      {!isHoodOnlyNode && (
        <>
          <PanelSection title="Fronts">
            <div className="space-y-2 px-1 pb-2">
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Mounting
                </div>
                <SegmentedControl
                  onChange={(value) =>
                    updateNode({ frontOverlay: value as CabinetNodeType['frontOverlay'] })
                  }
                  options={FRONT_OVERLAY_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  value={node.frontOverlay ?? 'full'}
                />
              </div>
            </div>
          </PanelSection>

          <PanelSection title="Handles">
            <div className="space-y-2 px-1 pb-2">
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Style
                </div>
                <SegmentedControl
                  onChange={(value) =>
                    updateNode({ handleStyle: value as CabinetNodeType['handleStyle'] })
                  }
                  options={HANDLE_STYLE_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  value={node.handleStyle}
                />
              </div>
              {(node.handleStyle === 'bar' || node.handleStyle === 'knob') && (
                <div>
                  <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Position
                  </div>
                  <SegmentedControl
                    onChange={(value) =>
                      updateNode({ handlePosition: value as CabinetNodeType['handlePosition'] })
                    }
                    options={HANDLE_POSITION_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    value={node.handlePosition ?? 'auto'}
                  />
                </div>
              )}
            </div>
          </PanelSection>
        </>
      )}
    </PanelWrapper>
  )
}
