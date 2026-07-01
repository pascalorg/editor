'use client'

import type { CabinetNode as CabinetNodeType } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import {
  ActionButton,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  ToggleControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { ArrowDown, ArrowUp, Minus, Pause, Play, Plus, Trash } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  compartmentDoorType,
  compartmentDrawerCount,
  compartmentShelfCount,
  normalizeCabinetStack,
  newCabinetCompartment,
  stackForCabinet,
  type CabinetCompartment,
  type CabinetCompartmentType,
} from './stack'

const COMPARTMENT_TYPE_OPTIONS = [
  { value: 'shelf', label: 'Shelf' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'door', label: 'Door' },
] as const

const DOOR_TYPE_OPTIONS = [
  { value: 'single-left', label: 'Left' },
  { value: 'single-right', label: 'Right' },
  { value: 'double', label: 'Double' },
  { value: 'glass', label: 'Glass' },
] as const

const HANDLE_STYLE_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'cutout', label: 'Cutout' },
  { value: 'hole', label: 'Hole' },
  { value: 'none', label: 'None' },
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
        <span className="min-w-7 text-center text-xs font-medium tabular-nums text-foreground">{value}</span>
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

function CompartmentCard({
  compartment,
  index,
  displayIndex,
  total,
  carcassHeight,
  resolvedHeight,
  width,
  onReplace,
  onRemove,
  onMove,
}: {
  compartment: CabinetCompartment
  index: number
  displayIndex: number
  total: number
  carcassHeight: number
  resolvedHeight: number
  width: number
  onReplace: (next: CabinetCompartment) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}) {
  const type = compartment.type as CabinetCompartmentType
  return (
    <div className="rounded-lg border border-border/40 bg-[#252527] p-2">
      <div className="flex items-center justify-between pb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {displayIndex === 0 ? 'Top' : displayIndex === total - 1 ? 'Bottom' : `#${total - displayIndex}`}
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
        <SegmentedControl
          onChange={(value) =>
            onReplace({
              ...newCabinetCompartment(value as CabinetCompartmentType),
              id: compartment.id,
            })
          }
          options={COMPARTMENT_TYPE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          value={type}
        />
      </div>

      <div className="pb-2">
        <SliderControl
          label="Height"
          max={carcassHeight}
          min={0.1}
          onChange={(value) => onReplace({ ...compartment, height: value })}
          precision={2}
          step={0.01}
          unit="m"
          value={resolvedHeight}
        />
      </div>

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
    </div>
  )
}

export default function CabinetPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const animationFrameRef = useRef<number | null>(null)
  const animationTargetRef = useRef<0 | 1 | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as CabinetNodeType['id']] as CabinetNodeType | undefined) : undefined,
  )

  const updateNode = useCallback(
    (patch: Partial<CabinetNodeType>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as CabinetNodeType['id'], patch)
    },
    [selectedId],
  )

  const close = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

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

      const liveNode = useScene.getState().nodes[selectedId as CabinetNodeType['id']]
      if (liveNode?.type !== 'cabinet') return

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
      const duration = 320

      const step = (time: number) => {
        const t = Math.min(1, (time - startTime) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
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

  if (!(node && node.type === 'cabinet')) return null

  const stack = stackForCabinet(node)
  const normalized = normalizeCabinetStack(node)
  const rowHeights = new Map(normalized.map((row) => [row.index, row.height]))
  const rows = stack.map((compartment, index) => ({ compartment, index })).reverse()

  const commitStack = (next: CabinetCompartment[]) => updateNode({ stack: next })
  const replaceAt = (index: number, next: CabinetCompartment) =>
    commitStack(stack.map((compartment, i) => (i === index ? next : compartment)))
  const removeAt = (index: number) => commitStack(stack.filter((_, i) => i !== index))
  const addCompartment = () => commitStack([...stack, newCabinetCompartment('shelf')])
  const moveCompartment = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= stack.length) return
    const next = stack.slice()
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    commitStack(next)
  }

  return (
    <PanelWrapper
      icon="/icons/furniture.webp"
      onClose={close}
      title={node.name || 'Modular Cabinet'}
      width={320}
    >
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
          max={1.4}
          min={0.4}
          onChange={(value) => updateNode({ carcassHeight: value })}
          precision={2}
          step={0.01}
          unit="m"
          value={node.carcassHeight}
        />
      </PanelSection>

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
            aria-label={isAnimating ? 'Stop animation' : (node.operationState ?? 0) >= 0.99 ? 'Close cabinet' : 'Open cabinet'}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border/40 bg-[#2C2C2E] px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-[#3e3e3e]"
            onClick={() => {
              if (isAnimating) {
                stopAnimation()
                return
              }
              animateOperationState((node.operationState ?? 0) >= 0.99 ? 0 : 1)
            }}
            title={isAnimating ? 'Stop animation' : (node.operationState ?? 0) >= 0.99 ? 'Close cabinet' : 'Play animation'}
            type="button"
          >
            {isAnimating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>{isAnimating ? 'Stop' : (node.operationState ?? 0) >= 0.99 ? 'Close' : 'Play'}</span>
          </button>
        </div>
      </PanelSection>

      <PanelSection title="Compartments">
        <div className="flex flex-col gap-2 px-1 pb-2">
          {rows.map(({ compartment, index }, displayIndex) => (
            <CompartmentCard
              compartment={compartment}
              carcassHeight={node.carcassHeight}
              displayIndex={displayIndex}
              index={index}
              key={compartment.id}
              onMove={(delta) => moveCompartment(index, delta)}
              onRemove={() => removeAt(index)}
              onReplace={(next) => replaceAt(index, next)}
              resolvedHeight={rowHeights.get(index) ?? node.carcassHeight / Math.max(stack.length, 1)}
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

      <PanelSection title="Plinth & Countertop">
        <div className="space-y-2 px-1 pb-2">
          <ToggleControl
            checked={node.showPlinth}
            label="Show plinth"
            onChange={(checked) => updateNode({ showPlinth: checked })}
          />
          {node.showPlinth && (
            <div className="space-y-1.5 rounded-lg border border-border/30 bg-black/10 p-2">
              <SliderControl
                label="Plinth height"
                max={0.3}
                min={0.02}
                onChange={(value) => updateNode({ plinthHeight: value })}
                precision={2}
                step={0.01}
                unit="m"
                value={node.plinthHeight}
              />
              <SliderControl
                label="Toe-kick depth"
                max={0.2}
                min={0}
                onChange={(value) => updateNode({ toeKickDepth: value })}
                precision={2}
                step={0.005}
                unit="m"
                value={node.toeKickDepth}
              />
            </div>
          )}

          <ToggleControl
            checked={node.withCountertop}
            label="Show countertop"
            onChange={(checked) => updateNode({ withCountertop: checked })}
          />
          {node.withCountertop && (
            <div className="space-y-1.5 rounded-lg border border-border/30 bg-black/10 p-2">
              <SliderControl
                label="Countertop height"
                max={0.08}
                min={0.005}
                onChange={(value) => updateNode({ countertopThickness: value })}
                precision={3}
                step={0.005}
                unit="m"
                value={node.countertopThickness}
              />
              <SliderControl
                label="Countertop depth"
                max={0.12}
                min={0}
                onChange={(value) => updateNode({ countertopOverhang: value })}
                precision={2}
                step={0.005}
                unit="m"
                value={node.countertopOverhang}
              />
            </div>
          )}
        </div>
      </PanelSection>

      <PanelSection title="Handles">
        <div className="space-y-2 px-1 pb-2">
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Style
            </div>
            <SegmentedControl
              onChange={(value) => updateNode({ handleStyle: value as CabinetNodeType['handleStyle'] })}
              options={HANDLE_STYLE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={node.handleStyle}
            />
          </div>
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}
