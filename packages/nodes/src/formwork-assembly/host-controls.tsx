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
import { buildFormworkNodes, type CastableHostNode, pourUnitsForHost } from './attach'
import { formworkAssembliesAffectedBy } from './dirty-scope'

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
  updateConstruction: (updates: Partial<T>) => void
  addFormwork: () => void
} {
  const hostId = node?.id as AnyNodeId | undefined

  // One assembly per pour unit, and never twice — the button used to stack a
  // new node on every click, leaving N identical shutters z-fighting inside the
  // element.
  const hasFormwork = useScene((s) =>
    (hostId ? ((s.nodes[hostId] as { children?: string[] } | undefined)?.children ?? []) : []).some(
      (childId) => s.nodes[childId as AnyNodeId]?.type === 'formwork-assembly',
    ),
  )

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
  const addFormwork = useCallback(() => {
    const n = nodeRef.current
    if (!n) return
    runAsSingleSceneHistoryStep(useScene, () => {
      const scene = useScene.getState()
      const levelNodes = Object.values(scene.nodes)
      for (const assembly of buildFormworkNodes(n, levelNodes)) {
        scene.createNode(assembly, n.id)
      }
      for (const joint of buildSolverJointNodes(n, levelNodes)) {
        scene.createNode(joint, (joint.parentId as AnyNodeId | null) ?? undefined)
      }
    })
  }, [])

  return { hasFormwork, pourUnitCount, updateConstruction, addFormwork }
}

/**
 * The shuttering system and its hardware spacing. `formworkType` is the switch
 * that decides whether the element is formed at all: nothing is shuttered on
 * the user's behalf, so a column left at "None" is reported as unformed rather
 * than quietly given a box.
 */
export function FormworkConstructionSection({
  addFormwork,
  hasFormwork,
  node,
  onUpdate,
  pourUnitCount,
  unit,
}: {
  addFormwork: () => void
  hasFormwork: boolean
  node: CastableHostNode
  onUpdate: (updates: HostConstructionUpdate) => void
  pourUnitCount: number
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
              : {
                  formworkType: value,
                  shutterMaterial: node.shutterMaterial ?? value,
                  tieSpacing: node.tieSpacing ?? 0.6,
                  walerSpacing: node.walerSpacing ?? 0.9,
                },
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
          <SliderControl
            label={labels.tie}
            max={metersToLinearUnit(2, unit)}
            min={metersToLinearUnit(0.3, unit)}
            onChange={(v) =>
              onUpdate({
                tieSpacing: linearControlValueToMeters(v, unit, { maxMeters: 2, minMeters: 0.3 }),
              })
            }
            precision={2}
            step={0.05}
            unit={unitLabel}
            value={metersToLinearUnit(node.tieSpacing ?? 0.6, unit)}
          />
          <SliderControl
            label={labels.waler}
            max={metersToLinearUnit(2, unit)}
            min={metersToLinearUnit(0.3, unit)}
            onChange={(v) =>
              onUpdate({
                walerSpacing: linearControlValueToMeters(v, unit, { maxMeters: 2, minMeters: 0.3 }),
              })
            }
            precision={2}
            step={0.05}
            unit={unitLabel}
            value={metersToLinearUnit(node.walerSpacing ?? 0.9, unit)}
          />
          <ToggleControl
            checked={node.scaffoldRequired ?? false}
            label="Scaffold required"
            onChange={(checked) => onUpdate({ scaffoldRequired: checked })}
          />
          <ActionButton
            className="disabled:pointer-events-none disabled:opacity-50"
            disabled={hasFormwork}
            icon={<Grid3x3 className="h-3.5 w-3.5" />}
            label={
              hasFormwork
                ? 'Formwork geometry added'
                : pourUnitCount === 1
                  ? 'Add formwork geometry'
                  : `Add formwork — ${pourUnitCount} shutters`
            }
            onClick={addFormwork}
          />
        </>
      )}
    </PanelSection>
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
