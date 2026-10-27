'use client'

import {
  type AnyNode,
  type AnyNodeId,
  assemblyThickness,
  BRICK_AIR_SPACE,
  BRICK_VENEER,
  FIBER_CEMENT,
  GROUND_SUPPORT_ID,
  GYPSUM_HALF,
  GYPSUM_SHEATHING,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallAssemblyPreset,
  getWallCurveLength,
  type MessageDescriptor,
  normalizeWallCurveOffset,
  resolveWallAssembly,
  runAsSingleSceneHistoryStep,
  SIDING_LAP,
  STONE_VENEER_UNVERIFIED,
  STUCCO_3_COAT,
  terrainSupportLift,
  useLiveNodeOverrides,
  usePascalI18n,
  useScene,
  WALL_ASSEMBLY_PRESETS,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_SKIRTING_DEFAULT,
  type WallAssembly,
  type WallAssemblyExteriorFinish,
  type WallAssemblyFramingKind,
  type WallAssemblyInteriorFinish,
  type WallAssemblySheathingMaterial,
  type WallFace,
  type WallNode,
  type WallTrimProfile,
  WSP_SHEATHING,
  wallAssemblyFromLegacy,
  wallAssemblyPatch,
  wallAssemblyToLegacy,
  wallAssemblyUnverifiedNote,
  wallTrimPatch,
} from '@pascal-app/core'
import { setWallFaceScript } from '@pascal-app/core/agent-operations'
import {
  ActionButton,
  ActionGroup,
  curveReshapeScope,
  finishScriptCode,
  formatLinearMeasurement,
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  triggerSFX,
  useInteractionScope,
  WallPaintRegionList,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Spline } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'
import { CurtainWallPanel } from './curtain-wall-panel'
import { hasWallCurveBlockingChildren } from './curve-eligibility'
import { buildWallLengthPatch } from './length-patch'
import { type WallReferenceValue, wallReferenceModel } from './panel-model'
import { createWallPropertyPreview } from './property-preview'

/**
 * Base half of the plane-bound repair: a stamped draft offset goes, and a
 * ground host is dropped unless sculpted terrain actually supports it — a
 * terrain-less ground host (regression-era data) pins the base at the level
 * floor and buries the wall in any later slab.
 */
function wallBaseRepairPatch(n: WallNode): Partial<WallNode> {
  const nodes = useScene.getState().nodes
  const terrainSupported =
    n.parentId != null && terrainSupportLift(nodes, n.parentId, n.start[0], n.start[1]) != null
  return {
    supportOffset: undefined,
    ...(n.supportSlabId === GROUND_SUPPORT_ID && !terrainSupported
      ? { supportSlabId: undefined }
      : {}),
  }
}

const WALL_REFERENCE_LABELS: Record<WallReferenceValue, MessageDescriptor> = {
  outside: /* i18n */ { id: 'node.wall.reference.outside', message: 'Outside face' },
  center: /* i18n */ { id: 'node.wall.reference.center', message: 'Center' },
  inside: /* i18n */ { id: 'node.wall.reference.inside', message: 'Inside face' },
  left: /* i18n */ { id: 'node.wall.reference.left', message: 'Left' },
  right: /* i18n */ { id: 'node.wall.reference.right', message: 'Right' },
}

type WallTrimKey = 'skirting' | 'crown' | 'chairRail'

const WALL_TRIM_PROFILE_OPTIONS: Record<
  WallTrimKey,
  Array<{ label: MessageDescriptor; value: WallTrimProfile }>
> = {
  skirting: [
    { label: /* i18n */ { id: 'node.wall.panel.flat', message: 'Flat' }, value: 'flat' },
    { label: /* i18n */ { id: 'node.wall.panel.modern', message: 'Modern' }, value: 'base-modern' },
    {
      label: /* i18n */ { id: 'node.wall.panel.colonial', message: 'Colonial' },
      value: 'base-colonial',
    },
    { label: /* i18n */ { id: 'node.wall.panel.shoe', message: 'Shoe' }, value: 'base-shoe' },
    { label: /* i18n */ { id: 'node.wall.panel.ogee', message: 'Ogee' }, value: 'base-ogee' },
  ],
  crown: [
    { label: /* i18n */ { id: 'node.wall.panel.flat', message: 'Flat' }, value: 'flat' },
    { label: /* i18n */ { id: 'node.wall.panel.cove', message: 'Cove' }, value: 'crown-cove' },
    { label: /* i18n */ { id: 'node.wall.panel.ogee', message: 'Ogee' }, value: 'crown-ogee' },
    {
      label: /* i18n */ { id: 'node.wall.panel.craft', message: 'Craft' },
      value: 'crown-craftsman',
    },
    {
      label: /* i18n */ { id: 'node.wall.panel.layered', message: 'Layered' },
      value: 'crown-layered',
    },
  ],
  chairRail: [
    { label: /* i18n */ { id: 'node.wall.panel.flat', message: 'Flat' }, value: 'flat' },
    { label: /* i18n */ { id: 'node.wall.panel.round', message: 'Round' }, value: 'rail-rounded' },
    { label: /* i18n */ { id: 'node.wall.panel.ogee', message: 'Ogee' }, value: 'rail-ogee' },
    {
      label: /* i18n */ { id: 'node.wall.panel.picture', message: 'Picture' },
      value: 'rail-picture',
    },
    { label: /* i18n */ { id: 'node.wall.panel.step', message: 'Step' }, value: 'rail-stepped' },
  ],
}

export default function WallPanel() {
  const i18n = usePascalI18n()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const unit = useViewer((s) => s.unit)
  const setSelection = useViewer((s) => s.setSelection)

  const sceneNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as WallNode | undefined) : undefined,
  )

  // Live override published by the 2D drag handlers (side-arrows /
  // corner dots / curve handle). Merged on top of the scene node so
  // the sliders read the live `start` / `end` / `curveOffset` during
  // a drag without zustand being touched until commit.
  const liveOverride = useLiveNodeOverrides((s) =>
    selectedId ? s.get(selectedId as AnyNodeId) : undefined,
  )

  const node = useMemo<WallNode | undefined>(() => {
    if (!sceneNode) return undefined
    if (!liveOverride || Object.keys(liveOverride).length === 0) return sceneNode
    return { ...sceneNode, ...liveOverride } as WallNode
  }, [sceneNode, liveOverride])

  // Boolean selector — re-renders only when this specific wall's child
  // composition crosses the "has an incompatible hosted child" threshold.
  const hasWallChildrenBlockingCurve = useScene((s) => {
    if (!node) return false
    return hasWallCurveBlockingChildren(
      (node.children ?? []).flatMap((childId) => {
        const child = s.nodes[childId as AnyNodeId]
        return child ? [child] : []
      }),
    )
  })

  // Existing plane-bound walls have no stored height. Resolve their current
  // body height for display and materialize it if the user edits height or
  // enables terrain infill.
  const resolvedHeightMeters = useScene((s) => {
    const wall = selectedId ? (s.nodes[selectedId as AnyNodeId] as WallNode | undefined) : undefined
    if (wall?.type !== 'wall') return undefined
    return resolveWallOpeningCeiling(wall, s.nodes)
  })

  const sceneNodes = useScene((s) => s.nodes)
  const reference = useMemo(
    () => (node ? wallReferenceModel([node], sceneNodes) : null),
    [node, sceneNodes],
  )

  // Mirror the latest node into a ref so the slider handlers below have
  // stable identities across re-renders. Without this, every store tick
  // (one per pointermove during a slider drag) rebuilt the handler
  // refs, destabilising SliderControl's pointer-capture listeners and
  // combining with float drift in `getWallCurveLength` produced a
  // "Maximum update depth exceeded" cascade. Same fix in fence-panel.tsx.
  const nodeRef = useRef(node)
  nodeRef.current = node

  const propertyPreview = useMemo(
    () => (selectedId ? createWallPropertyPreview(selectedId as AnyNodeId) : undefined),
    [selectedId],
  )
  useEffect(() => () => propertyPreview?.cancel(), [propertyPreview])
  const handleUpdate = useCallback(
    (updates: Partial<WallNode>) => propertyPreview?.commit(updates),
    [propertyPreview],
  )
  const handlePreview = useCallback(
    (updates: Partial<WallNode>) => propertyPreview?.preview(updates),
    [propertyPreview],
  )
  const handleCommit = useCallback(() => propertyPreview?.commit(), [propertyPreview])
  const handleCancel = useCallback(() => propertyPreview?.cancel(), [propertyPreview])

  const handleUpdateLength = useCallback(
    (newLength: number) => {
      const n = nodeRef.current
      if (!n || newLength <= 0) return

      handlePreview(buildWallLengthPatch(n, newLength))
    },
    [handlePreview],
  )

  const handleTopModeChange = useCallback(
    (mode: 'storey' | 'custom') => {
      const n = nodeRef.current
      if (!n) return
      const isCustom = n.height != null
      if (mode === 'custom' && !isCustom) {
        // Seed from the current effective height so the geometry doesn't
        // jump at the moment of detaching from the storey plane.
        const seeded = resolveWallOpeningCeiling(n, useScene.getState().nodes)
        handleUpdate({ height: Math.max(0.1, seeded) })
      } else if (mode === 'storey' && isCustom) {
        // Absent `height` = plane-bound; the store strips undefined keys.
        handleUpdate({ height: undefined, ...wallBaseRepairPatch(n) })
      }
    },
    [handleUpdate],
  )

  // Terrain infill only extends the bottom; it must never materialize an
  // explicit height, or toggling it would silently detach the wall top from
  // the storey plane. "Auto" is a re-election, so it carries the same base
  // repair as the follows-level toggle — and the control fires on a click of
  // the already-selected segment, so regression-era walls that DISPLAY Auto
  // while secretly ground-pinned heal from a click on Auto itself.
  const handleInfillChange = useCallback(
    (mode: 'terrain' | 'auto') => {
      const n = nodeRef.current
      if (!n) return
      if (mode === 'terrain') {
        handleUpdate({ fillToTerrain: true })
        return
      }
      handleUpdate({ fillToTerrain: undefined, ...wallBaseRepairPatch(n) })
    },
    [handleUpdate],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleCurve = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    useInteractionScope.getState().begin(curveReshapeScope(node.id))
    setSelection({ selectedIds: [] })
  }, [node, setSelection])

  if (!(node && node.type === 'wall' && selectedId)) return null

  const length = getWallCurveLength(node)

  const followsTerrain = node.fillToTerrain === true
  const isPlaneBound = node.height == null
  const height = node.height ?? resolvedHeightMeters ?? 2.5
  const thickness = node.thickness ?? 0.1
  const curveOffset = getClampedWallCurveOffset(node)
  const maxCurveOffset = getMaxWallCurveOffset(node)
  const unitLabel = getLinearUnitLabel(unit)
  const displayLength = metersToLinearUnit(length, unit)
  const displayHeight = metersToLinearUnit(height, unit)
  const displayThickness = metersToLinearUnit(thickness, unit)
  const displayCurveOffset = metersToLinearUnit(curveOffset, unit)
  const displayMaxCurveOffset = metersToLinearUnit(maxCurveOffset, unit)
  const curveOffsetLimit = Math.max(0.01, maxCurveOffset)
  const wallHeightMeters = height

  const skirting = { ...WALL_SKIRTING_DEFAULT, ...(node.skirting ?? {}) }
  const crown = { ...WALL_CROWN_DEFAULT, ...(node.crown ?? {}) }
  const chairRail = { ...WALL_CHAIR_RAIL_DEFAULT, ...(node.chairRail ?? {}) }

  return (
    <PanelWrapper
      icon="/icons/wall.webp"
      onClose={handleClose}
      title={node.name || i18n._({ id: 'node.wall.panel.wall', message: 'Wall' })}
      width={280}
    >
      <PanelSection title={i18n._({ id: 'node.wall.panel.wallType', message: 'Wall type' })}>
        <SegmentedControl
          onChange={(wallType) => handleUpdate({ wallType })}
          options={[
            {
              label: i18n._({ id: 'node.wall.panel.standard', message: 'Standard' }),
              value: 'standard',
            },
            {
              label: i18n._({ id: 'node.wall.panel.curtainWall', message: 'Curtain wall' }),
              value: 'curtain',
            },
          ]}
          value={node.wallType ?? 'standard'}
        />
      </PanelSection>
      <PanelSection title={i18n._({ id: 'node.wall.panel.dimensions', message: 'Dimensions' })}>
        <SliderControl
          onCommit={handleCommit}
          onCancel={handleCancel}
          restoreOnCommit={false}
          previewWhileTyping
          label={i18n._({ id: 'node.wall.panel.length', message: 'Length' })}
          max={metersToLinearUnit(1000, unit)}
          min={metersToLinearUnit(0.1, unit)}
          onChange={(value) =>
            handleUpdateLength(
              linearControlValueToMeters(value, unit, { maxMeters: 1000, minMeters: 0.1 }),
            )
          }
          precision={2}
          step={unit === 'imperial' ? 0.1 : 0.01}
          unit={unitLabel}
          value={displayLength}
        />
        <div className="px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          {i18n._({ id: 'node.wall.panel.top', message: 'Top' })}
        </div>
        <SegmentedControl
          onChange={handleTopModeChange}
          options={[
            {
              label: i18n._({ id: 'node.wall.panel.followsLevel', message: 'Follows level' }),
              value: 'storey',
            },
            {
              label: i18n._({ id: 'node.wall.panel.customHeight', message: 'Custom height' }),
              value: 'custom',
            },
          ]}
          value={isPlaneBound ? 'storey' : 'custom'}
        />
        {isPlaneBound ? (
          <div className="px-1 text-[11px] text-muted-foreground">
            {i18n._({
              id: 'node.panel.currently',
              message: 'Currently {value}',
              values: { value: formatLinearMeasurement(height, unit) },
            })}
          </div>
        ) : (
          <SliderControl
            onCommit={handleCommit}
            onCancel={handleCancel}
            restoreOnCommit={false}
            previewWhileTyping
            label={i18n._({ id: 'node.wall.panel.height', message: 'Height' })}
            max={metersToLinearUnit(1000, unit)}
            min={metersToLinearUnit(0.1, unit)}
            onChange={(v) =>
              handlePreview({
                height: linearControlValueToMeters(v, unit, { maxMeters: 1000, minMeters: 0.1 }),
              })
            }
            precision={2}
            step={0.1}
            unit={unitLabel}
            value={Math.round(displayHeight * 100) / 100}
          />
        )}
        <div className="px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          {i18n._({ id: 'node.wall.panel.bottom', message: 'Bottom' })}
        </div>
        <SegmentedControl
          onChange={handleInfillChange}
          options={[
            { label: i18n._({ id: 'node.wall.panel.auto', message: 'Auto' }), value: 'auto' },
            {
              label: i18n._({ id: 'node.wall.panel.fillToTerrain', message: 'Fill to terrain' }),
              value: 'terrain',
            },
          ]}
          value={followsTerrain ? 'terrain' : 'auto'}
        />
        {followsTerrain && (
          <div className="px-1 text-[11px] text-muted-foreground">
            {i18n._({
              id: 'node.wall.panel.extendsDownwardToMeetTheTerrain',
              message: 'Extends downward to meet the terrain. Height and top stay unchanged.',
            })}
          </div>
        )}
        {node.assembly && node.wallType !== 'curtain' ? (
          // The assembly owns the total. Editing `thickness` here would put the
          // two out of sync, so the slider becomes a readout and the Assembly
          // section is the only place thickness changes.
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              {i18n._({ id: 'node.wall.panel.thickness', message: 'Thickness' })}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {i18n._({
                id: 'node.wall.panel.thicknessFromAssembly',
                message: '{thickness} · from assembly',
                values: { thickness: formatLinearMeasurement(thickness, unit) },
              })}
            </span>
          </div>
        ) : (
          <SliderControl
            onCommit={handleCommit}
            onCancel={handleCancel}
            restoreOnCommit={false}
            previewWhileTyping
            label={
              node.wallType === 'curtain'
                ? i18n._({ id: 'node.wall.panel.frameDepth', message: 'Frame depth' })
                : i18n._({ id: 'node.wall.panel.thickness', message: 'Thickness' })
            }
            max={metersToLinearUnit(1000, unit)}
            min={metersToLinearUnit(0.05, unit)}
            onChange={(v) =>
              handlePreview({
                thickness: linearControlValueToMeters(v, unit, {
                  maxMeters: 1000,
                  minMeters: 0.05,
                }),
              })
            }
            precision={3}
            step={0.01}
            unit={unitLabel}
            value={Math.round(displayThickness * 1000) / 1000}
          />
        )}
        <div className="px-1 font-medium text-[10px] text-muted-foreground/80">
          {i18n._({ id: 'node.wall.panel.reference', message: 'Reference' })}
        </div>
        {reference && (
          <SegmentedControl
            mixed={reference.value === null}
            onChange={(value) => reference.apply(value)}
            options={reference.options.map((option) => ({
              ...option,
              label: i18n._(WALL_REFERENCE_LABELS[option.value]),
            }))}
            value={reference.value ?? 'center'}
          />
        )}
        {!hasWallChildrenBlockingCurve && (
          <SliderControl
            onCommit={handleCommit}
            onCancel={handleCancel}
            restoreOnCommit={false}
            previewWhileTyping
            label={i18n._({ id: 'node.wall.panel.curve', message: 'Curve' })}
            max={Math.max(metersToLinearUnit(0.01, unit), displayMaxCurveOffset)}
            min={-Math.max(metersToLinearUnit(0.01, unit), displayMaxCurveOffset)}
            onChange={(v) =>
              handlePreview({
                curveOffset: normalizeWallCurveOffset(
                  node,
                  linearControlValueToMeters(v, unit, {
                    maxMeters: curveOffsetLimit,
                    minMeters: -curveOffsetLimit,
                  }),
                ),
              })
            }
            precision={2}
            step={0.1}
            unit={unitLabel}
            value={Math.round(displayCurveOffset * 100) / 100}
          />
        )}
      </PanelSection>

      {node.wallType === 'curtain' ? (
        <CurtainWallPanel
          height={height}
          key={node.id}
          node={node}
          onUpdate={handleUpdate}
          onPreview={handlePreview}
          onCommit={handleCommit}
          onCancel={handleCancel}
          unit={unit}
        />
      ) : (
        <>
          <WallAssemblySection node={node} onUpdate={handleUpdate} unit={unit} />

          <WallPaintRegionList wallId={node.id} />

          <WallFaceScriptSection wallId={node.id} />

          <WallTrimSection
            node={node}
            onUpdate={handleUpdate}
            title={i18n._({ id: 'node.wall.panel.skirting', message: 'Skirting' })}
            trimKey="skirting"
            trimValue={skirting}
            unit={unit}
            unitLabel={unitLabel}
            wallHeightMeters={wallHeightMeters}
          />
          <WallTrimSection
            node={node}
            onUpdate={handleUpdate}
            title={i18n._({ id: 'node.wall.panel.crownMolding', message: 'Crown molding' })}
            trimKey="crown"
            trimValue={crown}
            unit={unit}
            unitLabel={unitLabel}
            wallHeightMeters={wallHeightMeters}
          />
          <WallTrimSection
            node={node}
            onUpdate={handleUpdate}
            title={i18n._({ id: 'node.wall.panel.chairRail', message: 'Chair rail' })}
            trimKey="chairRail"
            trimValue={chairRail}
            unit={unit}
            unitLabel={unitLabel}
            wallHeightMeters={wallHeightMeters}
          />
        </>
      )}

      {!hasWallChildrenBlockingCurve && (
        <PanelSection title={i18n._({ id: 'node.wall.panel.actions', message: 'Actions' })}>
          <ActionGroup>
            <ActionButton
              icon={<Spline className="h-3.5 w-3.5" />}
              label={i18n._({ id: 'node.wall.panel.curve', message: 'Curve' })}
              onClick={handleCurve}
            />
          </ActionGroup>
        </PanelSection>
      )}
    </PanelWrapper>
  )
}

/**
 * "Scripted finish": a face a script builds (it owns that face's colours, so Paint leaves it), with
 * its code to read and a way to take it off, back to the face's own finish.
 */
function WallFaceScriptSection({ wallId }: { wallId: string }) {
  const i18n = usePascalI18n()
  const shas = useScene(
    useShallow((scene) => {
      const wall = scene.nodes[wallId as AnyNodeId]
      return wall?.type === 'wall'
        ? [wall.finishScripts?.a?.script, wall.finishScripts?.b?.script]
        : []
    }),
  )
  if (!(shas[0] || shas[1])) return null
  return (
    <PanelSection
      title={i18n._({ id: 'node.wall.panel.scriptedFinish', message: 'Scripted finish' })}
    >
      {(['a', 'b'] as const).map((face, index) => {
        const sha = shas[index]
        return sha ? <WallFaceScriptRow face={face} key={face} sha={sha} wallId={wallId} /> : null
      })}
    </PanelSection>
  )
}

function WallFaceScriptRow({ face, sha, wallId }: { face: WallFace; sha: string; wallId: string }) {
  const i18n = usePascalI18n()
  const [code, setCode] = useState<{ sha: string; text: string } | null>(null)
  const [open, setOpen] = useState(false)
  const unreadable = i18n._({
    id: 'editor.panels.scriptUnreadable',
    message: 'The script could not be read.',
  })
  const toggleCode = () => {
    setOpen((shown) => !shown)
    if (code?.sha === sha) return
    finishScriptCode(sha).then(
      (text) => setCode({ sha, text: text ?? unreadable }),
      () => setCode({ sha, text: unreadable }),
    )
  }
  const remove = () => {
    const { changes } = setWallFaceScript(
      useScene.getState().nodes,
      { wallId, face, remove: true },
      { activeLevelId: null },
    )
    runAsSingleSceneHistoryStep(useScene, () => {
      for (const { id, data } of changes?.update ?? [])
        useScene.getState().updateNode(id as AnyNodeId, data)
    })
  }
  return (
    <div className="flex flex-col gap-2" data-wall-face-script={face}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          {i18n._({
            id: 'node.wall.panel.sideFace',
            message: 'Side {face}',
            values: { face: face.toUpperCase() },
          })}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            className="rounded-full border border-border/50 px-2.5 py-0.5 text-xs transition-colors hover:bg-accent"
            onClick={toggleCode}
            type="button"
          >
            {open
              ? i18n._({ id: 'node.wall.panel.hideCode', message: 'Hide code' })
              : i18n._({ id: 'node.wall.panel.viewCode', message: 'View code' })}
          </button>
          <button
            className="rounded-full border border-border/50 px-2.5 py-0.5 text-xs transition-colors hover:bg-accent"
            onClick={remove}
            type="button"
          >
            {i18n._({ id: 'node.wall.panel.remove', message: 'Remove' })}
          </button>
        </div>
      </div>
      {open && (
        <pre className="max-h-60 overflow-auto whitespace-pre rounded-lg border border-border/50 p-2 font-mono text-[11px] text-foreground">
          {code?.sha === sha
            ? code.text
            : i18n._({ id: 'node.wall.panel.loading', message: 'Loading…' })}
        </pre>
      )}
    </div>
  )
}

function WallTrimSection({
  node,
  onUpdate,
  title,
  trimKey,
  trimValue,
  unit,
  unitLabel,
  wallHeightMeters,
}: {
  node: WallNode
  onUpdate: (updates: Partial<WallNode>) => void
  title: string
  trimKey: WallTrimKey
  trimValue: NonNullable<WallNode['skirting']>
  unit: 'metric' | 'imperial'
  unitLabel: string
  wallHeightMeters: number
}) {
  const i18n = usePascalI18n()
  const updateTrim = (patch: Partial<NonNullable<WallNode['skirting']>>) =>
    onUpdate(wallTrimPatch(node, trimKey, patch))
  const profileOptions = WALL_TRIM_PROFILE_OPTIONS[trimKey]
  const selectedProfile = profileOptions.some((option) => option.value === trimValue.profile)
    ? trimValue.profile
    : profileOptions[0]!.value

  return (
    <PanelSection title={title}>
      <ActionGroup>
        <ActionButton
          label={
            trimValue.enabled
              ? i18n._({
                  id: 'node.wall.trim.hide',
                  message:
                    '{trim, select, skirting {Hide skirting} crown {Hide crown molding} other {Hide chair rail}}',
                  values: { trim: trimKey },
                })
              : i18n._({
                  id: 'node.wall.trim.show',
                  message:
                    '{trim, select, skirting {Show skirting} crown {Show crown molding} other {Show chair rail}}',
                  values: { trim: trimKey },
                })
          }
          onClick={() => updateTrim({ enabled: !trimValue.enabled })}
        />
      </ActionGroup>
      {trimValue.enabled && (
        <>
          <SegmentedControl
            onChange={(next) => updateTrim({ sides: next as any })}
            options={[
              { label: i18n._({ id: 'node.wall.panel.sideA', message: 'Side A' }), value: 'a' },
              { label: i18n._({ id: 'node.wall.panel.sideB', message: 'Side B' }), value: 'b' },
              { label: i18n._({ id: 'node.wall.panel.both', message: 'Both' }), value: 'both' },
            ]}
            value={
              trimValue.sides === 'interior'
                ? 'a'
                : trimValue.sides === 'exterior'
                  ? 'b'
                  : trimValue.sides
            }
          />
          <SegmentedControl
            onChange={(next) => updateTrim({ profile: next })}
            options={profileOptions.map((option) => ({ ...option, label: i18n._(option.label) }))}
            value={selectedProfile}
          />
          <SliderControl
            label={i18n._({ id: 'node.wall.panel.height', message: 'Height' })}
            max={metersToLinearUnit(Math.max(0.05, wallHeightMeters), unit)}
            min={metersToLinearUnit(0.01, unit)}
            onChange={(value) =>
              updateTrim({
                height: linearControlValueToMeters(value, unit, {
                  maxMeters: Math.max(0.05, wallHeightMeters),
                  minMeters: 0.01,
                }),
              })
            }
            precision={2}
            step={0.01}
            unit={unitLabel}
            value={metersToLinearUnit(trimValue.height, unit)}
          />
          <SliderControl
            label={i18n._({ id: 'node.wall.panel.depth', message: 'Depth' })}
            max={metersToLinearUnit(0.2, unit)}
            min={metersToLinearUnit(0.001, unit)}
            onChange={(value) =>
              updateTrim({
                proud: linearControlValueToMeters(value, unit, {
                  maxMeters: 0.2,
                  minMeters: 0.001,
                }),
              })
            }
            precision={3}
            step={0.005}
            unit={unitLabel}
            value={metersToLinearUnit(trimValue.proud, unit)}
          />
          {trimKey === 'chairRail' && (
            <SliderControl
              label={i18n._({ id: 'node.wall.panel.offset', message: 'Offset' })}
              max={metersToLinearUnit(Math.max(0.05, wallHeightMeters - trimValue.height), unit)}
              min={metersToLinearUnit(0, unit)}
              onChange={(value) =>
                updateTrim({
                  offsetY: linearControlValueToMeters(value, unit, {
                    maxMeters: Math.max(0.05, wallHeightMeters - trimValue.height),
                    minMeters: 0,
                  }),
                })
              }
              precision={2}
              step={0.01}
              unit={unitLabel}
              value={metersToLinearUnit(trimValue.offsetY ?? 0, unit)}
            />
          )}
        </>
      )}
    </PanelSection>
  )
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------
//
// The assembly is the SINGLE SOURCE OF TRUTH for `wall.thickness` — every edit
// here goes through `wallAssemblyPatch`, which writes the layer stack AND the
// re-derived total in one `updateNode` call, so the 2D plan and the 3D wall
// both move on the same store tick.

const METRES_PER_INCH = 0.0254

/**
 * Imperial-friendly thickness input. Accepts `5/8`, `5/8"`, `7/16 in`,
 * `1-1/4"`, `1 1/2"`, `12mm`, `0.012m`. A bare number means INCHES in imperial
 * display and MILLIMETRES in metric — wall layers are millimetre-scale and
 * typing `0.0127` for half-inch board is nobody's idea of usable.
 */
function parseLayerThickness(raw: string, unit: 'metric' | 'imperial'): number | null {
  const text = raw.trim().toLowerCase().replace(/["”]/g, ' in ')
  if (!text) return null
  const explicit = /(mm|cm|m|in|ft|')\s*$/.exec(text)
  const suffix = explicit?.[1]
  const body = (suffix ? text.slice(0, explicit?.index) : text).trim()

  // `1-1/4` / `1 1/2` / `5/8` / `0.4375`
  const mixed = /^(\d+(?:\.\d+)?)[\s-]+(\d+)\s*\/\s*(\d+)$/.exec(body)
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(body)
  let value: number
  if (mixed) {
    value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  } else if (fraction) {
    value = Number(fraction[1]) / Number(fraction[2])
  } else {
    value = Number(body)
  }
  if (!Number.isFinite(value) || value < 0) return null

  switch (suffix) {
    case 'mm':
      return value / 1000
    case 'cm':
      return value / 100
    case 'm':
      return value
    case 'in':
      return value * METRES_PER_INCH
    case 'ft':
    case "'":
      return value * 12 * METRES_PER_INCH
    default:
      return unit === 'imperial' ? value * METRES_PER_INCH : value / 1000
  }
}

/** Nearest common fraction of an inch, so 0.0111 m reads back as `7/16"`. */
function formatLayerThickness(metres: number, unit: 'metric' | 'imperial'): string {
  if (unit !== 'imperial') return `${Math.round(metres * 1000 * 10) / 10} mm`
  const inchValue = metres / METRES_PER_INCH
  const sixteenths = Math.round(inchValue * 16)
  if (Math.abs(inchValue * 16 - sixteenths) > 1e-6) return `${Math.round(inchValue * 1000) / 1000}"`
  const whole = Math.floor(sixteenths / 16)
  let numerator = sixteenths % 16
  let denominator = 16
  while (numerator % 2 === 0 && numerator > 0) {
    numerator /= 2
    denominator /= 2
  }
  if (numerator === 0) return `${whole}"`
  return whole > 0 ? `${whole}-${numerator}/${denominator}"` : `${numerator}/${denominator}"`
}

const SELECT_CLASS =
  'h-7 w-full rounded border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary'
const INPUT_CLASS =
  'h-7 w-full rounded border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary'
const ROW_LABEL_CLASS =
  'w-[68px] shrink-0 text-[10px] text-muted-foreground uppercase tracking-wide'

function LayerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <span className={ROW_LABEL_CLASS}>{label}</span>
      <div className="flex flex-1 items-center gap-1.5">{children}</div>
    </div>
  )
}

function ThicknessInput({
  metres,
  onCommit,
  unit,
}: {
  metres: number
  onCommit: (metres: number) => void
  unit: 'metric' | 'imperial'
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? formatLayerThickness(metres, unit)
  return (
    <input
      className={INPUT_CLASS}
      onBlur={() => {
        if (draft != null) {
          const parsed = parseLayerThickness(draft, unit)
          if (parsed != null) onCommit(parsed)
        }
        setDraft(null)
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
      spellCheck={false}
      value={display}
    />
  )
}

const EXTERIOR_FINISH_OPTIONS: Array<{
  value: WallAssemblyExteriorFinish
  label: MessageDescriptor
}> = [
  { value: 'none', label: /* i18n */ { id: 'node.wall.panel.none', message: 'None' } },
  { value: 'siding', label: /* i18n */ { id: 'node.wall.panel.lapSiding', message: 'Lap siding' } },
  {
    value: 'fiber-cement',
    label: /* i18n */ { id: 'node.wall.panel.fiberCement', message: 'Fiber cement' },
  },
  { value: 'stucco', label: /* i18n */ { id: 'node.wall.panel.stucco', message: 'Stucco' } },
  {
    value: 'brick',
    label: /* i18n */ { id: 'node.wall.panel.brickVeneer', message: 'Brick veneer' },
  },
  {
    value: 'stone',
    label: /* i18n */ { id: 'node.wall.panel.stoneVeneer', message: 'Stone veneer' },
  },
]

const SHEATHING_OPTIONS: Array<{ value: WallAssemblySheathingMaterial; label: MessageDescriptor }> =
  [
    { value: 'none', label: /* i18n */ { id: 'node.wall.panel.none', message: 'None' } },
    { value: 'osb', label: /* i18n */ { id: 'node.wall.panel.osb', message: 'OSB' } },
    { value: 'plywood', label: /* i18n */ { id: 'node.wall.panel.plywood', message: 'Plywood' } },
    { value: 'gypsum', label: /* i18n */ { id: 'node.wall.panel.gypsum', message: 'Gypsum' } },
  ]

const FRAMING_OPTIONS: Array<{ value: WallAssemblyFramingKind; label: MessageDescriptor }> = [
  { value: 'wood', label: /* i18n */ { id: 'node.wall.panel.woodStuds', message: 'Wood studs' } },
  { value: 'lgs', label: /* i18n */ { id: 'node.wall.panel.steelStuds', message: 'Steel studs' } },
  { value: 'cmu', label: /* i18n */ { id: 'node.wall.panel.cmu', message: 'CMU' } },
  { value: 'icf', label: /* i18n */ { id: 'node.wall.panel.icf', message: 'ICF' } },
]

const INTERIOR_FINISH_OPTIONS: Array<{
  value: WallAssemblyInteriorFinish
  label: MessageDescriptor
}> = [
  { value: 'none', label: /* i18n */ { id: 'node.wall.panel.none', message: 'None' } },
  { value: 'drywall', label: /* i18n */ { id: 'node.wall.panel.drywall', message: 'Drywall' } },
  { value: 'plaster', label: /* i18n */ { id: 'node.wall.panel.plaster', message: 'Plaster' } },
]

/** Cited default thickness for a finish the user just switched to. */
const EXTERIOR_FINISH_DEFAULT: Record<WallAssemblyExteriorFinish, number> = {
  none: 0,
  siding: SIDING_LAP,
  'fiber-cement': FIBER_CEMENT,
  stucco: STUCCO_3_COAT,
  brick: BRICK_VENEER + BRICK_AIR_SPACE,
  stone: STONE_VENEER_UNVERIFIED,
}

function WallAssemblySection({
  node,
  onUpdate,
  unit,
}: {
  node: WallNode
  onUpdate: (updates: Partial<WallNode>) => void
  unit: 'metric' | 'imperial'
}) {
  const i18n = usePascalI18n()
  const stack = node.assembly
  // The cladding / sheathing / framing / interior editor works on the WS5 view
  // of the F2 stack; a stack it cannot express is listed read-only.
  const assembly = stack ? (wallAssemblyToLegacy(stack) ?? undefined) : undefined
  const resolved = resolveWallAssembly(node)
  const presetNote = wallAssemblyUnverifiedNote(node)

  // Every write goes through wallAssemblyPatch so `thickness` is re-derived.
  // Changing any layer clears `preset` — the stack is no longer that preset.
  const apply = (next: WallAssembly) => onUpdate(wallAssemblyPatch(wallAssemblyFromLegacy(next)))
  const edit = (mutate: (draft: WallAssembly) => WallAssembly) => {
    if (!assembly) return
    const next = mutate({ ...assembly })
    apply({ ...next, preset: undefined })
  }

  return (
    <PanelSection title={i18n._({ id: 'node.wall.panel.assembly', message: 'Assembly' })}>
      <LayerRow label={i18n._({ id: 'node.wall.panel.preset', message: 'Preset' })}>
        <select
          className={SELECT_CLASS}
          onChange={(event) => {
            const id = event.target.value
            if (!id) {
              onUpdate({ assembly: undefined })
              return
            }
            const preset = getWallAssemblyPreset(id)
            if (preset) onUpdate(wallAssemblyPatch(preset.assembly))
          }}
          value={stack?.presetId ?? ''}
        >
          <option value="">
            {stack
              ? i18n._({ id: 'node.wall.panel.custom', message: 'Custom' })
              : i18n._({ id: 'node.wall.panel.noneSingleLayer', message: 'None (single layer)' })}
          </option>
          {WALL_ASSEMBLY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </LayerRow>

      {assembly && (
        <>
          <LayerRow label={i18n._({ id: 'node.wall.panel.exterior', message: 'Exterior' })}>
            <select
              className={SELECT_CLASS}
              onChange={(event) => {
                const finish = event.target.value as WallAssemblyExteriorFinish
                edit((draft) => ({
                  ...draft,
                  exterior: { finish, thickness: EXTERIOR_FINISH_DEFAULT[finish] },
                }))
              }}
              value={assembly.exterior?.finish ?? 'none'}
            >
              {EXTERIOR_FINISH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {i18n._(option.label)}
                </option>
              ))}
            </select>
            {assembly.exterior && assembly.exterior.finish !== 'none' && (
              <ThicknessInput
                metres={assembly.exterior.thickness}
                onCommit={(thickness) =>
                  edit((draft) => ({
                    ...draft,
                    exterior: { finish: draft.exterior?.finish ?? 'siding', thickness },
                  }))
                }
                unit={unit}
              />
            )}
          </LayerRow>

          <LayerRow label={i18n._({ id: 'node.wall.panel.sheathing', message: 'Sheathing' })}>
            <select
              className={SELECT_CLASS}
              onChange={(event) => {
                const material = event.target.value as WallAssemblySheathingMaterial
                edit((draft) => ({
                  ...draft,
                  sheathing: {
                    material,
                    thickness:
                      material === 'none'
                        ? 0
                        : material === 'gypsum'
                          ? GYPSUM_SHEATHING
                          : WSP_SHEATHING,
                  },
                }))
              }}
              value={assembly.sheathing?.material ?? 'none'}
            >
              {SHEATHING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {i18n._(option.label)}
                </option>
              ))}
            </select>
            {assembly.sheathing && assembly.sheathing.material !== 'none' && (
              <ThicknessInput
                metres={assembly.sheathing.thickness}
                onCommit={(thickness) =>
                  edit((draft) => ({
                    ...draft,
                    sheathing: { material: draft.sheathing?.material ?? 'osb', thickness },
                  }))
                }
                unit={unit}
              />
            )}
          </LayerRow>

          <LayerRow label={i18n._({ id: 'node.wall.panel.framing', message: 'Framing' })}>
            <select
              className={SELECT_CLASS}
              onChange={(event) =>
                edit((draft) => ({
                  ...draft,
                  framing: {
                    kind: event.target.value as WallAssemblyFramingKind,
                    depth: draft.framing.depth,
                  },
                }))
              }
              value={assembly.framing.kind}
            >
              {FRAMING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {i18n._(option.label)}
                </option>
              ))}
            </select>
            <ThicknessInput
              metres={assembly.framing.depth}
              onCommit={(depth) =>
                edit((draft) => ({ ...draft, framing: { kind: draft.framing.kind, depth } }))
              }
              unit={unit}
            />
          </LayerRow>

          <LayerRow label={i18n._({ id: 'node.wall.panel.interior', message: 'Interior' })}>
            <select
              className={SELECT_CLASS}
              onChange={(event) => {
                const finish = event.target.value as WallAssemblyInteriorFinish
                edit((draft) => ({
                  ...draft,
                  interior: {
                    finish,
                    thickness: finish === 'none' ? 0 : (draft.interior?.thickness ?? GYPSUM_HALF),
                  },
                }))
              }}
              value={assembly.interior?.finish ?? 'none'}
            >
              {INTERIOR_FINISH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {i18n._(option.label)}
                </option>
              ))}
            </select>
            {assembly.interior && assembly.interior.finish !== 'none' && (
              <ThicknessInput
                metres={assembly.interior.thickness}
                onCommit={(thickness) =>
                  edit((draft) => ({
                    ...draft,
                    interior: { finish: draft.interior?.finish ?? 'drywall', thickness },
                  }))
                }
                unit={unit}
              />
            )}
          </LayerRow>

          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
              {i18n._({ id: 'node.wall.panel.totalThickness', message: 'Total thickness' })}
            </span>
            <span className="font-medium text-[11px] text-foreground tabular-nums">
              {formatLayerThickness(assemblyThickness(stack!), unit)}
            </span>
          </div>

          {resolved.kind === 'partition' && (
            <div className="px-2 pb-1.5 text-[10px] text-muted-foreground">
              {i18n._({
                id: 'node.wall.panel.partitionTheInteriorFinishIsApplied',
                message: 'Partition: the interior finish is applied to both faces.',
              })}
            </div>
          )}
          {resolved.kind === 'envelope' && resolved.exteriorSide == null && (
            <div className="px-2 pb-1.5 text-[10px] text-muted-foreground">
              {i18n._({
                id: 'node.wall.panel.whichFaceIsOutsideIsUndetermined',
                message:
                  'Which face is outside is undetermined (no room detected on either side) — the exterior layers are drawn on side B.',
              })}
            </div>
          )}
          {presetNote && (
            <div className="px-2 pb-2 text-[10px] text-amber-600 dark:text-amber-400">
              {i18n._({
                id: 'node.wall.panel.unverifiedPresetnote',
                message: 'Unverified: {presetNote}',
                values: { presetNote },
              })}
            </div>
          )}
          <div className="px-2 pb-2 text-[10px] text-muted-foreground">
            {i18n._({
              id: 'node.wall.panel.layerThicknessesFollowThe2021Irc',
              message:
                'Layer thicknesses follow the 2021 IRC assembly data. Drafting aid, not engineering — verify with the authority having jurisdiction.',
            })}
          </div>
        </>
      )}
      {stack && !assembly && (
        <>
          {resolved.layers.map((layer, index) => (
            <LayerRow key={`${layer.role}-${index}`} label={layer.material}>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatLayerThickness(layer.thickness, unit)}
              </span>
            </LayerRow>
          ))}
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
              {i18n._({ id: 'node.wall.panel.totalThickness', message: 'Total thickness' })}
            </span>
            <span className="font-medium text-[11px] text-foreground tabular-nums">
              {formatLayerThickness(assemblyThickness(stack), unit)}
            </span>
          </div>
        </>
      )}
    </PanelSection>
  )
}
