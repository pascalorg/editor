'use client'

import { SegmentedControl, SliderControl, ToggleControl } from '@pascal-app/editor'
import { ArrowDown, ArrowUp, Minus, Plus, Trash } from 'lucide-react'
import {
  type CabinetCompartment,
  type CabinetCompartmentType,
  type CabinetCooktopCompartmentType,
  type CabinetFridgeCompartmentType,
  COOKTOP_DEFAULT_GAS_LAYOUT,
  COOKTOP_DEFAULT_INDUCTION_LAYOUT,
  type CooktopLayout,
  compartmentCooktopBurnersOn,
  compartmentCooktopElementCount,
  compartmentCooktopLayout,
  compartmentCooktopShowGrate,
  compartmentDoorType,
  compartmentDrawerCount,
  compartmentPullOutPantryRackStyle,
  compartmentShelfCount,
  compartmentSinkLayout,
  FRIDGE_COLUMN_HEIGHT,
  isCooktopCompartmentType,
  isFridgeCompartmentType,
  isHoodCompartmentType,
  newCabinetCompartment,
  type PULL_OUT_PANTRY_RACK_STYLES,
  patchCompartment,
  type SinkLayout,
} from './stack'

const COMPARTMENT_TYPE_OPTIONS = [
  { value: 'shelf', label: 'Shelf' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'door', label: 'Door' },
  { value: 'oven', label: 'Oven' },
  { value: 'microwave', label: 'Micro' },
  { value: 'dishwasher', label: 'Washer' },
  { value: 'cooktop', label: 'Hob' },
  { value: 'sink', label: 'Sink' },
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

const SINK_LAYOUT_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
  { value: 'double-offset', label: '60/40' },
] as const satisfies Array<{ value: SinkLayout; label: string }>

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

const ICON_BUTTON_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/40 bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#343437] hover:text-foreground disabled:opacity-30 disabled:hover:bg-[#2C2C2E] disabled:hover:text-muted-foreground'

const STEPPER_BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#343437] hover:text-foreground'

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

export function CompartmentCard({
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

      {!isHood && !isCooktop && type !== 'sink' && (
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
          onChange={(value) => onReplace(patchCompartment(compartment, { shelfCount: value }))}
          value={compartmentShelfCount(compartment)}
        />
      )}

      {type === 'drawer' && (
        <Stepper
          label="Drawers"
          max={6}
          min={1}
          onChange={(value) => onReplace(patchCompartment(compartment, { drawerCount: value }))}
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
              onChange={(value) => onReplace(patchCompartment(compartment, { doorType: value }))}
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
            onChange={(value) => onReplace(patchCompartment(compartment, { shelfCount: value }))}
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
              onReplace(
                patchCompartment(compartment, {
                  type: value as CabinetFridgeCompartmentType,
                  height: compartment.height ?? FRIDGE_COLUMN_HEIGHT,
                }),
              )
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
              onReplace(
                patchCompartment(compartment, {
                  type: value as CabinetCooktopCompartmentType,
                  cooktopLayout:
                    value === 'cooktop-gas'
                      ? COOKTOP_DEFAULT_GAS_LAYOUT
                      : COOKTOP_DEFAULT_INDUCTION_LAYOUT,
                  height: compartment.height ?? 0.08,
                  cooktopBurnersOn: compartmentCooktopBurnersOn(compartment),
                  cooktopShowGrate: compartmentCooktopShowGrate(compartment),
                }),
              )
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
                onReplace(patchCompartment(compartment, { cooktopLayout: value }))
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
              onReplace(
                patchCompartment(compartment, {
                  cooktopBurnersOn: checked,
                  cooktopActiveBurners: checked
                    ? Array.from({ length: count }, (_, index) => index)
                    : [],
                  cooktopKnobProgress: Array.from({ length: count }, () => (checked ? 1 : 0)),
                }),
              )
            }}
          />
          {type === 'cooktop-gas' && (
            <ToggleControl
              checked={compartmentCooktopShowGrate(compartment)}
              label="Top grate"
              onChange={(checked) =>
                onReplace(patchCompartment(compartment, { cooktopShowGrate: checked }))
              }
            />
          )}
        </div>
      )}

      {type === 'sink' && (
        <div>
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Bowls
          </div>
          <SegmentedControl
            onChange={(value) => onReplace(patchCompartment(compartment, { sinkLayout: value }))}
            options={SINK_LAYOUT_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={compartmentSinkLayout(compartment)}
          />
        </div>
      )}

      {type === 'pull-out-pantry' && (
        <div className="space-y-2">
          <Stepper
            label="Baskets"
            max={8}
            min={2}
            onChange={(value) => onReplace(patchCompartment(compartment, { shelfCount: value }))}
            value={compartmentShelfCount(compartment)}
          />
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Rack
            </div>
            <SegmentedControl
              onChange={(value) =>
                onReplace(patchCompartment(compartment, { pantryRackStyle: value }))
              }
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
