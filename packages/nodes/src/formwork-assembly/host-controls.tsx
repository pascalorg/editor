'use client'

import {
  type AnyNode,
  type AnyNodeId,
  runAsSingleSceneHistoryStep,
  type TopSurfaceKind,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  ActionButton,
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
  PanelSection,
  SegmentedControl,
  SliderControl,
  ToggleControl,
} from '@pascal-app/editor'
import { Grid3x3 } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { buildSolverJointNodes } from '../construction-joint'
import { type CastableHostNode, pourUnitsForHost, reconcileFormworkNodes } from './attach'
import { formworkAssembliesAffectedBy, formworkAssembliesOnHost } from './dirty-scope'
import type { FormworkAssemblyNode } from './schema'

/**
 * The shuttering and pour controls a wall, a column and a slab all need, in one
 * place. They are shared rather than copied per panel because they are inputs
 * to one engine: the same `castOrder` field decides which faces of *both*
 * elements at a junction get a stop-end, so three panels writing it three
 * different ways would produce three different answers from the same solver.
 */

/**
 * The fields these controls write. Picked off `WallNode` rather than off
 * `CastableHostNode`: `Pick` over a union distributes, which widens every field
 * these three kinds do not share to `unknown` and makes the result assignable
 * to none of them. All three spread the same `ShutteringFields` and
 * `CastableFields`, so one kind's declaration of them is every kind's.
 */
export type HostConstructionUpdate = Partial<
  Pick<
    WallNode,
    | 'formworkType'
    | 'formworkMode'
    | 'shutterMaterial'
    | 'tieSpacing'
    | 'walerSpacing'
    | 'scaffoldRequired'
    | 'castOrder'
    | 'pourId'
    | 'topSurface'
    | 'againstEarthSide'
    | 'maxLiftHeight'
    | 'maxPourLength'
    | 'maxPourVolume'
  >
>

/**
 * The same two spacing fields mean different hardware per kind, so labelling
 * all three "tie" and "waler" would misdescribe two of them. On a column they
 * are the clamp and yoke pitch; on a slab, the bearer and joist centres under
 * the deck.
 */
export const SPACING_LABELS: Record<CastableHostNode['type'], { tie: string; waler: string }> = {
  wall: { tie: 'Tie spacing', waler: 'Waler spacing' },
  column: { tie: 'Clamp spacing', waler: 'Yoke spacing' },
  slab: { tie: 'Bearer spacing', waler: 'Joist spacing' },
}

/**
 * Where the slider starts when a job first takes a spacing off the calculation.
 * Not a default: an unstated spacing is solved from the pour rather than assumed,
 * so these are only the figures the trade reaches for when overriding one.
 */
const SPACING_SEED_M = { tie: 0.6, waler: 0.9 } as const

const SPACING_MIN_M = 0.3
const SPACING_MAX_M = 2

const MONOLITHIC_HINT: Record<CastableHostNode['type'], string> = {
  wall: 'Walls sharing a pour ID are cast monolithically — no joint, no stop-end between them.',
  column:
    'A column sharing its pour ID with the wall it sits in is a pilaster — the shared faces are not formed.',
  slab: 'A slab sharing its pour ID with the beams under it is cast monolithically with them.',
}

/**
 * Everything a panel needs to drive formwork on its own node: the two writes
 * (which dirty differently from a plain edit) and the two counts the button
 * label depends on.
 *
 * `updateConstruction` dirties level-wide rather than just this node because
 * `updateNode` marks only the edited node and its parent — never children,
 * never siblings — and coverage reads the neighbours' cast order.
 */
export function useFormworkHost<T extends CastableHostNode>(
  node: T | undefined,
): {
  hasFormwork: boolean
  pourUnitCount: number
  shutterCount: number
  updateConstruction: (updates: Partial<T>) => void
  addFormwork: () => void
} {
  const hostId = node?.id as AnyNodeId | undefined

  // Read by `parentId` rather than off `host.children`, the same way
  // `dirty-scope.ts` does: a scene that lost a child entry still has the
  // assembly, and a shutter this misses is a shutter the button offers to
  // build a second copy of.
  const shutterCount = useScene((s) =>
    hostId ? formworkAssembliesOnHost(hostId as string, s.nodes).length : 0,
  )
  const hasFormwork = shutterCount > 0

  // How many shutters the button will create. An element split into lifts or
  // bays gets one per pour unit, and six assemblies appearing from one click is
  // a surprise worth naming on the button rather than discovering in the tree.
  const pourUnitCount = useScene((s) => {
    const host = hostId ? (s.nodes[hostId] as CastableHostNode | undefined) : undefined
    if (!host) return 1
    return Math.max(1, pourUnitsForHost(host, Object.values(s.nodes)).length)
  })

  const nodeRef = useRef(node)
  nodeRef.current = node

  const updateConstruction = useCallback((updates: Partial<T>) => {
    const n = nodeRef.current
    if (!n) return
    const scene = useScene.getState()
    scene.updateNode(n.id as AnyNode['id'], updates)
    for (const id of formworkAssembliesAffectedBy(n.id as AnyNodeId, scene.nodes)) {
      scene.markDirty(id)
    }
  }, [])

  // One assembly per pour unit, plus the joints the split creates: a shutter is
  // erected, poured and struck as a unit, and each cut between two of them is a
  // real construction joint with roughening and starters attached. Joints are
  // level children, hence the whole node map. One undo step, because a Ctrl-Z
  // that left the joints behind would strand work with nothing to build it.
  //
  // Reconciled rather than appended, and so callable on a host that already has
  // shutters. That is the whole point: capping a wall at 3 m lifts turns one
  // pour unit into three, and the button used to be disabled at exactly that
  // moment — the wall said "cast in 3 pours" and carried one shutter, billing a
  // third of its own formwork with nothing on screen to say so. An existing
  // shutter whose pour unit survives is left completely alone, because it is
  // where the yard's per-part decisions live.
  const addFormwork = useCallback(() => {
    const n = nodeRef.current
    if (!n) return
    runAsSingleSceneHistoryStep(useScene, () => {
      const scene = useScene.getState()
      const levelNodes = Object.values(scene.nodes)
      const existing = formworkAssembliesOnHost(n.id as string, scene.nodes)
        .map((id) => scene.nodes[id] as unknown as FormworkAssemblyNode)
        .filter(Boolean)
      const { create, keep, orphan } = reconcileFormworkNodes(n, existing, levelNodes)
      for (const assembly of create) scene.createNode(assembly, n.id)
      for (const assembly of orphan) scene.deleteNode(assembly.id as AnyNodeId)
      // The survivors were built against the old split, so their geometry is
      // stale even though their nodes are not: lift 0 of a wall that just gained
      // a 3 m cap now covers a third of the height it did.
      for (const assembly of keep) scene.markDirty(assembly.id as AnyNodeId)
      for (const joint of buildSolverJointNodes(n, levelNodes)) {
        scene.createNode(joint, (joint.parentId as AnyNodeId | null) ?? undefined)
      }
    })
  }, [])

  return { hasFormwork, pourUnitCount, shutterCount, updateConstruction, addFormwork }
}

/**
 * The shuttering system and its hardware spacing. `formworkType` is the switch
 * that decides whether the element is formed at all: nothing is shuttered on
 * the user's behalf, so a column left at "None" is reported as unformed rather
 * than quietly given a box.
 */
/**
 * What the button is about to do, said before it is pressed.
 *
 * "Add" and "rebuild" are different enough to name: the second one deletes the
 * shutters whose pour unit has gone, and every per-part decision on them.
 */
function formworkButtonLabel(shutterCount: number, pourUnitCount: number): string {
  if (shutterCount === 0) {
    return pourUnitCount === 1
      ? 'Add formwork geometry'
      : `Add formwork — ${pourUnitCount} shutters`
  }
  if (shutterCount === pourUnitCount) return 'Formwork geometry added'
  const missing = pourUnitCount - shutterCount
  return missing > 0
    ? `Shutter the other ${missing} ${missing === 1 ? 'pour' : 'pours'}`
    : `Rebuild — ${pourUnitCount} ${pourUnitCount === 1 ? 'shutter' : 'shutters'}, not ${shutterCount}`
}

export function FormworkConstructionSection({
  addFormwork,
  hasFormwork,
  node,
  onUpdate,
  pourUnitCount,
  shutterCount,
  unit,
}: {
  addFormwork: () => void
  hasFormwork: boolean
  node: CastableHostNode
  onUpdate: (updates: HostConstructionUpdate) => void
  pourUnitCount: number
  shutterCount: number
  unit: 'metric' | 'imperial'
}) {
  const labels = SPACING_LABELS[node.type]
  const unitLabel = getLinearUnitLabel(unit)
  const formed = node.formworkType !== undefined && node.formworkType !== 'none'

  return (
    <PanelSection title="Construction">
      <SegmentedControl
        onChange={(value: 'none' | 'plywood' | 'aluminium' | 'steel-panel') =>
          onUpdate(
            value === 'none'
              ? { formworkType: 'none' }
              : { formworkType: value, shutterMaterial: node.shutterMaterial ?? value },
          )
        }
        options={[
          { label: 'None', value: 'none' },
          { label: 'Plywood', value: 'plywood' },
          { label: 'Aluminium', value: 'aluminium' },
          { label: 'Steel', value: 'steel-panel' },
        ]}
        value={node.formworkType ?? 'none'}
      />
      {formed && (
        <>
          <SpacingOverride
            label={labels.tie}
            onChange={(spacingM) => onUpdate({ tieSpacing: spacingM })}
            seedM={SPACING_SEED_M.tie}
            unit={unit}
            unitLabel={unitLabel}
            value={node.tieSpacing}
          />
          <SpacingOverride
            label={labels.waler}
            onChange={(spacingM) => onUpdate({ walerSpacing: spacingM })}
            seedM={SPACING_SEED_M.waler}
            unit={unit}
            unitLabel={unitLabel}
            value={node.walerSpacing}
          />
          <ToggleControl
            checked={node.scaffoldRequired ?? false}
            label="Scaffold required"
            onChange={(checked) => onUpdate({ scaffoldRequired: checked })}
          />
          <ActionButton
            className="disabled:pointer-events-none disabled:opacity-50"
            // Disabled only when the shutters already match the pour. A host
            // whose split has moved needs this button most, and disabling it
            // there was how a wall came to report three pours and carry one.
            disabled={hasFormwork && shutterCount === pourUnitCount}
            icon={<Grid3x3 className="h-3.5 w-3.5" />}
            label={formworkButtonLabel(shutterCount, pourUnitCount)}
            onClick={addFormwork}
          />
          {hasFormwork && shutterCount !== pourUnitCount && (
            <span className="px-1 text-[10px] text-amber-500/90 leading-snug">
              {shutterCount < pourUnitCount
                ? `The pour is cast in ${pourUnitCount} but only ${shutterCount} ${shutterCount === 1 ? 'is' : 'are'} shuttered, so the takeoff is short by the difference.`
                : `${shutterCount - pourUnitCount} ${shutterCount - pourUnitCount === 1 ? 'shutter forms' : 'shutters form'} a pour this element no longer has. Rebuilding removes ${shutterCount - pourUnitCount === 1 ? 'it' : 'them'} — and any part decisions recorded on ${shutterCount - pourUnitCount === 1 ? 'it' : 'them'}.`}
            </span>
          )}
        </>
      )}
    </PanelSection>
  )
}

/**
 * A spacing the job is fixing, or the calculation's own.
 *
 * Unset is the normal state and not a missing value: `wallDesign` and its siblings
 * solve the spacing from the pour, and the answer is graded up the lift — tight at
 * the base where the head is, opening out above — so no single slider position
 * describes it. Stating one is an instruction to use that figure and report the
 * utilisation against it, which is why it has to be possible to hand back.
 */
function SpacingOverride({
  label,
  onChange,
  seedM,
  unit,
  unitLabel,
  value,
}: {
  label: string
  onChange: (spacingM: number | undefined) => void
  seedM: number
  unit: 'metric' | 'imperial'
  unitLabel: string
  value: number | undefined
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-1 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <button
          className="rounded px-1 text-[10px] text-foreground/70 hover:bg-accent/40"
          onClick={() => onChange(value === undefined ? seedM : undefined)}
          type="button"
        >
          {value === undefined ? 'Calculated — override' : 'Stated — use calculated'}
        </button>
      </div>
      {value !== undefined && (
        <SliderControl
          label={label}
          max={metersToLinearUnit(SPACING_MAX_M, unit)}
          min={metersToLinearUnit(SPACING_MIN_M, unit)}
          onChange={(v) =>
            onChange(
              linearControlValueToMeters(v, unit, {
                maxMeters: SPACING_MAX_M,
                minMeters: SPACING_MIN_M,
              }),
            )
          }
          precision={2}
          step={0.05}
          unit={unitLabel}
          value={metersToLinearUnit(value, unit)}
        />
      )}
    </div>
  )
}

/**
 * Cast order and pour identity. These are the primary inputs to face
 * classification, not annotations: which faces need forming is almost entirely
 * a function of what had already hardened when this element was poured.
 */
export function PourSequenceFields({
  node,
  onUpdate,
}: {
  node: CastableHostNode
  onUpdate: (updates: HostConstructionUpdate) => void
}) {
  return (
    <>
      <label className="flex items-center gap-2 px-1 text-xs">
        <span className="w-20 shrink-0 text-muted-foreground">Cast order</span>
        <input
          className="h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-[#2C2C2E] px-2 font-mono outline-none"
          defaultValue={node.castOrder ?? ''}
          key={`cast-order-${node.id}-${node.castOrder ?? 'none'}`}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim()
            if (raw === '') {
              onUpdate({ castOrder: undefined })
              return
            }
            const parsed = Number.parseInt(raw, 10)
            if (Number.isFinite(parsed)) onUpdate({ castOrder: parsed })
          }}
          placeholder="unsequenced"
          step={1}
          type="number"
        />
      </label>
      <label className="flex items-center gap-2 px-1 text-xs">
        <span className="w-20 shrink-0 text-muted-foreground">Pour ID</span>
        <input
          className="h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-[#2C2C2E] px-2 outline-none"
          defaultValue={node.pourId ?? ''}
          key={`pour-id-${node.id}-${node.pourId ?? 'none'}`}
          maxLength={120}
          onBlur={(event) => {
            const value = event.currentTarget.value.trim()
            onUpdate({ pourId: value === '' ? undefined : value })
          }}
          placeholder="own pour"
          type="text"
        />
      </label>
      <div className="px-1 text-[10px] text-muted-foreground leading-snug">
        {MONOLITHIC_HINT[node.type]}
      </div>
    </>
  )
}

/**
 * How the top is finished. A screeded top costs nothing; a formed one is a
 * whole extra face plus hold-downs, and past about 15° a nominally screeded top
 * has to be formed anyway because the concrete would run.
 */
export function TopSurfaceFields({
  boundedOption,
  node,
  onUpdate,
}: {
  /** A slab has nothing above it to cast against, so it has no bounded top. */
  boundedOption: boolean
  node: CastableHostNode
  onUpdate: (updates: HostConstructionUpdate) => void
}) {
  const topSurface = node.topSurface ?? { kind: 'open' as TopSurfaceKind, slopeDeg: 0 }
  const options: Array<{ label: string; value: TopSurfaceKind }> = [
    { label: 'Screeded', value: 'open' },
    { label: 'Formed', value: 'formed' },
  ]
  if (boundedOption) options.push({ label: 'Under soffit', value: 'bounded' })

  return (
    <>
      <div className="px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
        Top
      </div>
      <SegmentedControl
        onChange={(value: TopSurfaceKind) =>
          onUpdate({ topSurface: { ...topSurface, kind: value } })
        }
        options={options}
        value={topSurface.kind}
      />
      {topSurface.kind !== 'bounded' && (
        <SliderControl
          label="Top slope"
          max={45}
          min={0}
          onChange={(value) => onUpdate({ topSurface: { ...topSurface, slopeDeg: value } })}
          precision={0}
          step={1}
          unit="°"
          value={topSurface.slopeDeg}
        />
      )}
    </>
  )
}

/**
 * A cap that is genuinely optional: blank means "no limit from this source",
 * which is a different answer from zero and the one that yields a single pour.
 * Committed on blur rather than per keystroke because each edit re-splits the
 * element and re-derives every shutter.
 */
export function PourLimitInput({
  hint,
  label,
  onChange,
  value,
}: {
  hint: string
  label: string
  onChange: (value: number | undefined) => void
  value: number | undefined
}) {
  return (
    <label className="flex flex-col gap-0.5 px-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
        <input
          className="h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-[#2C2C2E] px-2 font-mono outline-none"
          defaultValue={value ?? ''}
          key={`${label}-${value ?? 'none'}`}
          min={0}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim()
            if (raw === '') {
              onChange(undefined)
              return
            }
            const parsed = Number.parseFloat(raw)
            onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined)
          }}
          placeholder="no limit"
          step={0.1}
          type="number"
        />
      </div>
      <span className="text-[10px] text-muted-foreground/70 leading-snug">{hint}</span>
    </label>
  )
}

/** How the element will actually be cast, once every cap is applied. */
export function PourUnitHint({ pourUnitCount }: { pourUnitCount: number }) {
  return (
    <div className="px-1 text-[10px] text-muted-foreground leading-snug">
      {pourUnitCount === 1
        ? 'Cast in one pour — one shutter, erected and struck once.'
        : `Cast in ${pourUnitCount} pours — one shutter each, and a construction joint between them.`}
    </div>
  )
}
