'use client'

import {
  type AnyNodeId,
  buildingFoundationOf,
  type FoundationNode,
  foundationViewOf,
  nodeRegistry,
  type ToolOption,
  traceFoundationOutlines,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  editFoundationOutline,
  followWallsForFoundation,
  houseFoundationOutlines,
  traceFoundationFromWalls,
} from '../../../lib/foundation-view'
import { triggerSFX } from '../../../lib/sfx-bus'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { MetricControl } from '../controls/metric-control'
import { SegmentedControl } from '../controls/segmented-control'
import { Button } from '../primitives/button'
import { BuildingFoundationSection } from './building-foundation-section'
import { PanelWrapper } from './panel-wrapper'

const IN = 0.0254
const ACTION = 'rounded-full'
const HEADING = 'font-medium text-muted-foreground text-xs'
const NOTE = 'px-0.5 text-muted-foreground text-xs'

/** How many footings are drawn on the level footings go on. */
function useFootingCount(buildingId: string): number {
  return useScene((state) => {
    const { levelId } = foundationViewOf(state.nodes, buildingId)
    const level = levelId ? state.nodes[levelId as AnyNodeId] : undefined
    if (level?.type !== 'level') return 0
    return level.children.filter((id) => state.nodes[id as AnyNodeId]?.type === 'footing').length
  })
}

/**
 * Where the house's foundation outline comes from: the outside walls (it moves with them), or an
 * outline of its own to drag, which "Follow the walls" gives up again. Outlines poured on their own
 * (a porch slab) are not the house's and stay either way.
 */
function OutlineSection({ buildingId }: { buildingId: string }) {
  const nodes = useScene((state) => state.nodes)
  const own = useMemo(() => houseFoundationOutlines(nodes, buildingId).length, [nodes, buildingId])
  const traceable = useMemo(
    () => traceFoundationOutlines(nodes, buildingId).length > 0,
    [nodes, buildingId],
  )
  return (
    <section className="flex flex-col gap-1.5" data-foundation-outline>
      <h3 className={HEADING}>Outline</h3>
      <SegmentedControl
        onChange={(source: 'walls' | 'own') =>
          source === 'own' ? editFoundationOutline(buildingId) : followWallsForFoundation(buildingId)
        }
        options={[
          { label: 'Follow the walls', value: 'walls' },
          {
            label: (
              <span title={traceable || own > 0 ? undefined : 'Close the outside walls into a loop first, or draw one'}>
                Edit it myself
              </span>
            ),
            value: 'own',
            disabled: own === 0 && !traceable,
          },
        ]}
        value={own > 0 ? 'own' : 'walls'}
      />
      <p className={NOTE}>
        {own === 0
          ? 'Traced from the outside walls: it moves when they do.'
          : 'Its own: drag its corners and sides in the plan or in 3D. Moving the walls leaves it be.'}
      </p>
      {own > 0 && traceable && (
        <Button
          className={`self-start ${ACTION}`}
          onClick={() => traceFoundationFromWalls(buildingId)}
          size="sm"
          title="Set the outline back to the outside faces of the walls, keeping it your own"
          type="button"
          variant="outline"
        >
          Re-trace from walls
        </Button>
      )}
    </section>
  )
}

const NO_SUBSCRIBE = () => () => {}
const NO_VALUE = () => ''

/**
 * The Foundation tool's "Draw" choices, from the registry (the house's outline, a slab or raised
 * floor of its own, a strip or pad footing): each arms the tool that draws it, and the one armed is
 * lit, with what it draws and how.
 */
function DrawSection({ buildingId }: { buildingId: string }) {
  const option: ToolOption | undefined = nodeRegistry
    .get('foundation')
    ?.toolOptions?.find((candidate) => candidate.id === 'draw')
  const armed = useEditor(
    (state) => state.mode === 'build' && (state.tool === 'foundation' || state.tool === 'footing'),
  )
  const value = useSyncExternalStore(
    option?.subscribe ?? NO_SUBSCRIBE,
    option?.value ?? NO_VALUE,
    option?.value ?? NO_VALUE,
  )
  const footings = useFootingCount(buildingId)
  if (!option) return null
  const active = armed ? option.choices.find((choice) => choice.value === value) : undefined
  return (
    <section className="flex flex-col gap-1.5" data-foundation-draw>
      <h3 className={HEADING}>Draw</h3>
      <div className="grid grid-cols-3 gap-1.5">
        {option.choices.map((choice) => {
          const selected = choice === active
          return (
            <button
              aria-pressed={selected}
              className={cn(
                'rounded-lg px-2 py-2 text-center font-medium text-xs transition-colors',
                selected
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/50'
                  : 'bg-black/4 text-muted-foreground hover:bg-black/8 hover:text-foreground dark:bg-muted/40 dark:hover:bg-muted',
              )}
              data-foundation-draw-choice={choice.value}
              key={choice.value}
              onClick={() => {
                triggerSFX('sfx:menu-click')
                useEditor.getState().setPhase('building')
                option.set(choice.value)
              }}
              title={choice.description}
              type="button"
            >
              {choice.label}
            </button>
          )
        })}
      </div>
      <p className={NOTE}>
        {active
          ? `${active.description}.${active.value === 'strip' || active.value === 'pad' ? '' : ' Click its corners; click the first again, or press Enter, to close it.'}`
          : footings === 0
            ? 'Outlines of slabs and raised floors (porches, patios, a garage pad), and footings under interior bearing walls and posts.'
            : `${footings} ${footings === 1 ? 'footing' : 'footings'} drawn: click one in the plan to size or move it.`}
      </p>
    </section>
  )
}

const CONSTRUCTIONS: { label: string; value: FoundationNode['construction'] }[] = [
  { label: 'The house’s', value: 'building' },
  { label: 'Slab', value: 'slab' },
  { label: 'Raised floor', value: 'raised' },
]

const CONSTRUCTION_NOTES: Record<FoundationNode['construction'], string> = {
  building: 'The house’s own foundation, poured as the house’s settings below say, in place of the walls’ outline.',
  slab: 'A slab of its own (a porch, a patio, a garage pad), the ground held 8 in under its top all round.',
  raised: 'A raised floor on a stem wall of its own.',
}

/** A picked foundation outline: what it pours, how far its top sits under the house's floor, and deleting it. */
function PickedOutlineSection({ outline }: { outline: FoundationNode }) {
  const imperial = useViewer((state) => state.unit) === 'imperial'
  const [draft, setDraft] = useState<number | null>(null)
  const update = (data: Partial<FoundationNode>) =>
    useScene.getState().updateNode(outline.id as AnyNodeId, data)
  const toShown = (meters: number) => (imperial ? meters / IN : meters)
  const fromShown = (shown: number) => (imperial ? shown * IN : shown)
  return (
    <section className="flex flex-col gap-1.5" data-foundation-picked={outline.id}>
      <h3 className={HEADING}>{outline.name || 'This outline'}</h3>
      <SegmentedControl
        onChange={(construction: FoundationNode['construction']) =>
          update(construction === 'building' ? { construction, drop: 0 } : { construction })
        }
        options={CONSTRUCTIONS}
        value={outline.construction}
      />
      <p className={NOTE}>{CONSTRUCTION_NOTES[outline.construction]}</p>
      {outline.construction !== 'building' && (
        <div
          data-foundation-drop
          title="How far its top sits under the house’s floor: a porch slab steps down from the door"
        >
          <MetricControl
            className="h-9 text-xs"
            label="Top under the floor"
            max={toShown(1.2)}
            min={0}
            onChange={(next) => setDraft(next)}
            onCommit={(next) => {
              setDraft(null)
              update({ drop: Math.max(0, fromShown(next)) })
            }}
            precision={imperial ? 2 : 3}
            restoreOnCommit={false}
            step={imperial ? 0.5 : 0.5 * IN}
            unit={imperial ? 'in' : 'm'}
            value={draft ?? toShown(outline.drop)}
          />
        </div>
      )}
      <Button
        className={`self-start ${ACTION}`}
        onClick={() => {
          useViewer.getState().setSelection({ selectedIds: [] })
          useScene.getState().deleteNode(outline.id as AnyNodeId)
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        Delete this outline
      </Button>
    </section>
  )
}

/**
 * The building's foundation: the panel of the level list's Foundation row (nothing picked in the
 * foundation view), and of a picked foundation outline, whose own settings come first. Where the
 * house's outline comes from (the outside walls, or one of its own to drag), what else to draw
 * (slabs and raised floors of their own, strip and pad footings), then the house's foundation
 * settings (on or off, type, support, section, sizes, advice). Closing it leaves the view, or
 * `onClose` (an outline's panel lets the outline go).
 */
export function FoundationViewPanel({ onClose }: { onClose?: () => void } = {}) {
  const buildingId = useViewer((state) => state.selection.buildingId)
  const pickedId = useViewer((state) =>
    state.selection.selectedIds.length === 1 ? state.selection.selectedIds[0] : null,
  )
  const setFoundationView = useViewer((state) => state.setFoundationView)
  const building = useScene((state) => {
    const node = buildingId ? state.nodes[buildingId as AnyNodeId] : undefined
    return node?.type === 'building' ? node : null
  })
  const picked = useScene((state) => {
    const node = pickedId ? state.nodes[pickedId as AnyNodeId] : undefined
    return node?.type === 'foundation' ? node : null
  })
  const on = useScene((state) =>
    building ? buildingFoundationOf(state.nodes, building.id)?.enabled === true : false,
  )
  if (!building) return null

  return (
    <PanelWrapper
      icon="/icons/floor.webp"
      kicker={building.name || undefined}
      onClose={onClose ?? (() => setFoundationView(false))}
      title="Foundation"
    >
      <div className="flex flex-col gap-3 px-4 pt-3 pb-4 text-sm" data-foundation-view-panel>
        {picked && <PickedOutlineSection outline={picked} />}
        {on && <OutlineSection buildingId={building.id} />}
        {on && <DrawSection buildingId={building.id} />}
        <BuildingFoundationSection building={building} heading={on ? 'House foundation' : false} />
      </div>
    </PanelWrapper>
  )
}
