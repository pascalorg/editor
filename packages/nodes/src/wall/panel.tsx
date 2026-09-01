'use client'

import {
  type AnyNode,
  type AnyNodeId,
  buildWallFaceBandCountPatch,
  GROUND_SUPPORT_ID,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallCurveLength,
  getWallFaceBandConfig,
  normalizeWallCurveOffset,
  terrainSupportLift,
  useLiveNodeOverrides,
  useScene,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_FACE_BAND_DEFAULT,
  WALL_SKIRTING_DEFAULT,
  type WallNode,
  type WallTrimProfile,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  curveReshapeScope,
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
  useTranslations,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Spline } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'
import { hasWallCurveBlockingChildren } from './curve-eligibility'

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

type WallTrimKey = 'skirting' | 'crown' | 'chairRail'

const WALL_TRIM_PROFILE_OPTIONS: Record<
  WallTrimKey,
  Array<{ labelKey: string; value: WallTrimProfile }>
> = {
  skirting: [
    { labelKey: 'nodes.wall.trimProfile.flat', value: 'flat' },
    { labelKey: 'nodes.wall.trimProfile.modern', value: 'base-modern' },
    { labelKey: 'nodes.wall.trimProfile.colonial', value: 'base-colonial' },
    { labelKey: 'nodes.wall.trimProfile.shoe', value: 'base-shoe' },
    { labelKey: 'nodes.wall.trimProfile.ogee', value: 'base-ogee' },
  ],
  crown: [
    { labelKey: 'nodes.wall.trimProfile.flat', value: 'flat' },
    { labelKey: 'nodes.wall.trimProfile.cove', value: 'crown-cove' },
    { labelKey: 'nodes.wall.trimProfile.ogee', value: 'crown-ogee' },
    { labelKey: 'nodes.wall.trimProfile.craft', value: 'crown-craftsman' },
    { labelKey: 'nodes.wall.trimProfile.layered', value: 'crown-layered' },
  ],
  chairRail: [
    { labelKey: 'nodes.wall.trimProfile.flat', value: 'flat' },
    { labelKey: 'nodes.wall.trimProfile.round', value: 'rail-rounded' },
    { labelKey: 'nodes.wall.trimProfile.ogee', value: 'rail-ogee' },
    { labelKey: 'nodes.wall.trimProfile.picture', value: 'rail-picture' },
    { labelKey: 'nodes.wall.trimProfile.step', value: 'rail-stepped' },
  ],
}

export default function WallPanel() {
  const t = useTranslations()
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

  // Mirror the latest node into a ref so the slider handlers below have
  // stable identities across re-renders. Without this, every store tick
  // (one per pointermove during a slider drag) rebuilt the handler
  // refs, destabilising SliderControl's pointer-capture listeners and
  // combining with float drift in `getWallCurveLength` produced a
  // "Maximum update depth exceeded" cascade. Same fix in fence-panel.tsx.
  const nodeRef = useRef(node)
  nodeRef.current = node

  const handleUpdate = useCallback(
    (updates: Partial<WallNode>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId],
  )

  const handleUpdateLength = useCallback(
    (newLength: number) => {
      const n = nodeRef.current
      if (!n || newLength <= 0) return

      const dx = n.end[0] - n.start[0]
      const dz = n.end[1] - n.start[1]
      const currentLength = Math.sqrt(dx * dx + dz * dz)

      if (currentLength === 0) return

      const dirX = dx / currentLength
      const dirZ = dz / currentLength

      const newEnd: [number, number] = [
        n.start[0] + dirX * newLength,
        n.start[1] + dirZ * newLength,
      ]

      handleUpdate({ end: newEnd })
    },
    [handleUpdate],
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
      title={node.name || t('nodes.wall.fallbackTitle')}
      width={280}
    >
      <PanelSection title={t('nodes.wall.dimensions')}>
        <SliderControl
          label={t('nodes.wall.length')}
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
          {t('nodes.wall.top')}
        </div>
        <SegmentedControl
          onChange={handleTopModeChange}
          options={[
            { label: t('nodes.wall.followsLevel'), value: 'storey' },
            { label: t('nodes.wall.customHeight'), value: 'custom' },
          ]}
          value={isPlaneBound ? 'storey' : 'custom'}
        />
        {isPlaneBound ? (
          <div className="px-1 text-[11px] text-muted-foreground">
            {t('nodes.wall.currently', { measurement: formatLinearMeasurement(height, unit) })}
          </div>
        ) : (
          <SliderControl
            label={t('common.height')}
            max={metersToLinearUnit(1000, unit)}
            min={metersToLinearUnit(0.1, unit)}
            onChange={(v) =>
              handleUpdate({
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
          {t('nodes.wall.bottom')}
        </div>
        <SegmentedControl
          onChange={handleInfillChange}
          options={[
            { label: t('nodes.wall.auto'), value: 'auto' },
            { label: t('nodes.wall.fillToTerrain'), value: 'terrain' },
          ]}
          value={followsTerrain ? 'terrain' : 'auto'}
        />
        {followsTerrain && (
          <div className="px-1 text-[11px] text-muted-foreground">
            {t('nodes.wall.fillToTerrainDescription')}
          </div>
        )}
        <SliderControl
          label={t('nodes.wall.thickness')}
          max={metersToLinearUnit(1000, unit)}
          min={metersToLinearUnit(0.05, unit)}
          onChange={(v) =>
            handleUpdate({
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
        {!hasWallChildrenBlockingCurve && (
          <SliderControl
            label={t('nodes.wall.curve')}
            max={Math.max(metersToLinearUnit(0.01, unit), displayMaxCurveOffset)}
            min={-Math.max(metersToLinearUnit(0.01, unit), displayMaxCurveOffset)}
            onChange={(v) =>
              handleUpdate({
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

      <WallFaceBandSection
        node={node}
        onUpdate={handleUpdate}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />

      <WallTrimSection
        node={node}
        onUpdate={handleUpdate}
        title={t('nodes.wall.skirting')}
        trimKey="skirting"
        trimValue={skirting}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />
      <WallTrimSection
        node={node}
        onUpdate={handleUpdate}
        title={t('nodes.wall.crown')}
        trimKey="crown"
        trimValue={crown}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />
      <WallTrimSection
        node={node}
        onUpdate={handleUpdate}
        title={t('nodes.wall.chairRail')}
        trimKey="chairRail"
        trimValue={chairRail}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />

      {!hasWallChildrenBlockingCurve && (
        <PanelSection title={t('common.actions')}>
          <ActionGroup>
            <ActionButton
              icon={<Spline className="h-3.5 w-3.5" />}
              label={t('nodes.wall.curve')}
              onClick={handleCurve}
            />
          </ActionGroup>
        </PanelSection>
      )}
    </PanelWrapper>
  )
}

function WallFaceBandSection({
  node,
  onUpdate,
  unit,
  unitLabel,
  wallHeightMeters,
}: {
  node: WallNode
  onUpdate: (updates: Partial<WallNode>) => void
  unit: 'metric' | 'imperial'
  unitLabel: string
  wallHeightMeters: number
}) {
  const t = useTranslations()
  const bandConfig = getWallFaceBandConfig(node, wallHeightMeters)
  const bandCount = bandConfig.count
  const lowerHeight = bandConfig.lowerHeight
  const middleHeight = bandConfig.middleHeight
  const upperHeight = bandConfig.upperHeight
  const updateBands = (patch: Partial<NonNullable<WallNode['faceBands']>>) =>
    onUpdate({
      faceBands: {
        ...WALL_FACE_BAND_DEFAULT,
        ...(node.faceBands ?? {}),
        enabled: bandCount > 1,
        count: bandCount,
        ...patch,
      },
    })

  return (
    <PanelSection title={t('nodes.wall.bands')}>
      <SliderControl
        label={t('nodes.wall.bandsCount')}
        max={4}
        min={1}
        onChange={(value) => onUpdate(buildWallFaceBandCountPatch(node, Math.round(value)))}
        precision={0}
        step={1}
        value={bandCount}
      />
      {bandCount >= 2 && (
        <SliderControl
          label={t('nodes.wall.bandsLower')}
          max={metersToLinearUnit(wallHeightMeters, unit)}
          min={metersToLinearUnit(0, unit)}
          onChange={(value) =>
            updateBands({
              lowerHeight: linearControlValueToMeters(value, unit, {
                maxMeters: wallHeightMeters,
                minMeters: 0,
              }),
            })
          }
          precision={2}
          step={0.01}
          unit={unitLabel}
          value={metersToLinearUnit(lowerHeight, unit)}
        />
      )}
      {bandCount >= 3 && (
        <SliderControl
          label={t('nodes.wall.bandsMiddle')}
          max={metersToLinearUnit(Math.max(0, wallHeightMeters - lowerHeight), unit)}
          min={metersToLinearUnit(0, unit)}
          onChange={(value) =>
            updateBands({
              middleHeight: linearControlValueToMeters(value, unit, {
                maxMeters: Math.max(0, wallHeightMeters - lowerHeight),
                minMeters: 0,
              }),
            })
          }
          precision={2}
          step={0.01}
          unit={unitLabel}
          value={metersToLinearUnit(middleHeight, unit)}
        />
      )}
      {bandCount >= 4 && (
        <SliderControl
          label={t('nodes.wall.bandsUpper')}
          max={metersToLinearUnit(Math.max(0, wallHeightMeters - lowerHeight - middleHeight), unit)}
          min={metersToLinearUnit(0, unit)}
          onChange={(value) =>
            updateBands({
              upperHeight: linearControlValueToMeters(value, unit, {
                maxMeters: Math.max(0, wallHeightMeters - lowerHeight - middleHeight),
                minMeters: 0,
              }),
            })
          }
          precision={2}
          step={0.01}
          unit={unitLabel}
          value={metersToLinearUnit(upperHeight, unit)}
        />
      )}
    </PanelSection>
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
  const t = useTranslations()
  const updateTrim = (patch: Partial<NonNullable<WallNode['skirting']>>) =>
    onUpdate({
      [trimKey]: {
        ...trimValue,
        ...patch,
      },
    } as Partial<WallNode>)
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
              ? t('nodes.wall.trimHide', { trim: title.toLowerCase() })
              : t('nodes.wall.trimShow', { trim: title.toLowerCase() })
          }
          onClick={() => updateTrim({ enabled: !trimValue.enabled })}
        />
      </ActionGroup>
      {trimValue.enabled && (
        <>
          <SegmentedControl
            onChange={(next) => updateTrim({ sides: next as any })}
            options={[
              { label: t('nodes.wall.interior'), value: 'interior' },
              { label: t('nodes.wall.exterior'), value: 'exterior' },
              { label: t('nodes.wall.both'), value: 'both' },
            ]}
            value={trimValue.sides}
          />
          <SegmentedControl
            onChange={(next) => updateTrim({ profile: next })}
            options={profileOptions.map((o) => ({ label: t(o.labelKey), value: o.value }))}
            value={selectedProfile}
          />
          <SliderControl
            label={t('common.height')}
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
            label={t('nodes.wall.proud')}
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
              label={t('nodes.wall.offset')}
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
