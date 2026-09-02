'use client'

import {
  type AnyNode,
  type AnyNodeId,
  assemblyThickness,
  BRICK_AIR_SPACE,
  BRICK_VENEER,
  buildWallFaceBandCountPatch,
  FIBER_CEMENT,
  GROUND_SUPPORT_ID,
  GYPSUM_HALF,
  GYPSUM_SHEATHING,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallAssemblyPreset,
  getWallCurveLength,
  getWallFaceBandConfig,
  normalizeWallCurveOffset,
  resolveWallAssembly,
  SIDING_LAP,
  STONE_VENEER_UNVERIFIED,
  STUCCO_3_COAT,
  terrainSupportLift,
  useLiveNodeOverrides,
  useScene,
  WALL_ASSEMBLY_PRESETS,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_FACE_BAND_DEFAULT,
  WALL_SKIRTING_DEFAULT,
  type WallAssembly,
  type WallAssemblyExteriorFinish,
  type WallAssemblyFramingKind,
  type WallAssemblyInteriorFinish,
  type WallAssemblySheathingMaterial,
  type WallNode,
  type WallTrimProfile,
  WSP_SHEATHING,
  wallAssemblyPatch,
  wallAssemblyUnverifiedNote,
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
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Spline } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'

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
  Array<{ label: string; value: WallTrimProfile }>
> = {
  skirting: [
    { label: 'Flat', value: 'flat' },
    { label: 'Modern', value: 'base-modern' },
    { label: 'Colonial', value: 'base-colonial' },
    { label: 'Shoe', value: 'base-shoe' },
    { label: 'Ogee', value: 'base-ogee' },
  ],
  crown: [
    { label: 'Flat', value: 'flat' },
    { label: 'Cove', value: 'crown-cove' },
    { label: 'Ogee', value: 'crown-ogee' },
    { label: 'Craft', value: 'crown-craftsman' },
    { label: 'Layered', value: 'crown-layered' },
  ],
  chairRail: [
    { label: 'Flat', value: 'flat' },
    { label: 'Round', value: 'rail-rounded' },
    { label: 'Ogee', value: 'rail-ogee' },
    { label: 'Picture', value: 'rail-picture' },
    { label: 'Step', value: 'rail-stepped' },
  ],
}

export default function WallPanel() {
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
  // composition crosses the "has a door/window/wall-item" threshold.
  const hasWallChildrenBlockingCurve = useScene((s) => {
    if (!node) return false
    return (node.children ?? []).some((childId) => {
      const child = s.nodes[childId as AnyNodeId]
      if (!child) return false
      if (child.type === 'door' || child.type === 'window') return true
      if (child.type === 'item') {
        const attachTo = child.asset?.attachTo
        return attachTo === 'wall' || attachTo === 'wall-side'
      }
      return false
    })
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
      title={node.name || 'Wall'}
      width={280}
    >
      <PanelSection title="Dimensions">
        <SliderControl
          label="Length"
          max={metersToLinearUnit(20, unit)}
          min={metersToLinearUnit(0.1, unit)}
          onChange={(value) =>
            handleUpdateLength(
              linearControlValueToMeters(value, unit, { maxMeters: 20, minMeters: 0.1 }),
            )
          }
          precision={2}
          step={unit === 'imperial' ? 0.1 : 0.01}
          unit={unitLabel}
          value={displayLength}
        />
        <div className="px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Top
        </div>
        <SegmentedControl
          onChange={handleTopModeChange}
          options={[
            { label: 'Follows level', value: 'storey' },
            { label: 'Custom height', value: 'custom' },
          ]}
          value={isPlaneBound ? 'storey' : 'custom'}
        />
        {isPlaneBound ? (
          <div className="px-1 text-[11px] text-muted-foreground">
            Currently {formatLinearMeasurement(height, unit)}
          </div>
        ) : (
          <SliderControl
            label="Height"
            max={metersToLinearUnit(20, unit)}
            min={metersToLinearUnit(0.1, unit)}
            onChange={(v) =>
              handleUpdate({
                height: linearControlValueToMeters(v, unit, { maxMeters: 20, minMeters: 0.1 }),
              })
            }
            precision={2}
            step={0.1}
            unit={unitLabel}
            value={Math.round(displayHeight * 100) / 100}
          />
        )}
        <div className="px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Bottom
        </div>
        <SegmentedControl
          onChange={handleInfillChange}
          options={[
            { label: 'Auto', value: 'auto' },
            { label: 'Fill to terrain', value: 'terrain' },
          ]}
          value={followsTerrain ? 'terrain' : 'auto'}
        />
        {followsTerrain && (
          <div className="px-1 text-[11px] text-muted-foreground">
            Extends downward to meet the terrain. Height and top stay unchanged.
          </div>
        )}
        {node.assembly ? (
          // The assembly owns the total. Editing `thickness` here would put the
          // two out of sync, so the slider becomes a readout and the Assembly
          // section is the only place thickness changes.
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              Thickness
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {formatLinearMeasurement(thickness, unit)} · from assembly
            </span>
          </div>
        ) : (
          <SliderControl
            label="Thickness"
            max={metersToLinearUnit(1, unit)}
            min={metersToLinearUnit(0.05, unit)}
            onChange={(v) =>
              handleUpdate({
                thickness: linearControlValueToMeters(v, unit, {
                  maxMeters: 1,
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
        {!hasWallChildrenBlockingCurve && (
          <SliderControl
            label="Curve"
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

      <WallAssemblySection node={node} onUpdate={handleUpdate} unit={unit} />

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
        title="Skirting"
        trimKey="skirting"
        trimValue={skirting}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />
      <WallTrimSection
        node={node}
        onUpdate={handleUpdate}
        title="Crown molding"
        trimKey="crown"
        trimValue={crown}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />
      <WallTrimSection
        node={node}
        onUpdate={handleUpdate}
        title="Chair rail"
        trimKey="chairRail"
        trimValue={chairRail}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />

      {!hasWallChildrenBlockingCurve && (
        <PanelSection title="Actions">
          <ActionGroup>
            <ActionButton
              icon={<Spline className="h-3.5 w-3.5" />}
              label="Curve"
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
    <PanelSection title="Wall bands">
      <SliderControl
        label="Bands"
        max={4}
        min={1}
        onChange={(value) => onUpdate(buildWallFaceBandCountPatch(node, Math.round(value)))}
        precision={0}
        step={1}
        value={bandCount}
      />
      {bandCount >= 2 && (
        <SliderControl
          label="Lower"
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
          label="Middle"
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
          label="Upper"
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
          label={trimValue.enabled ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}
          onClick={() => updateTrim({ enabled: !trimValue.enabled })}
        />
      </ActionGroup>
      {trimValue.enabled && (
        <>
          <SegmentedControl
            onChange={(next) => updateTrim({ sides: next as any })}
            options={[
              { label: 'Interior', value: 'interior' },
              { label: 'Exterior', value: 'exterior' },
              { label: 'Both', value: 'both' },
            ]}
            value={trimValue.sides}
          />
          <SegmentedControl
            onChange={(next) => updateTrim({ profile: next })}
            options={profileOptions}
            value={selectedProfile}
          />
          <SliderControl
            label="Height"
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
            label="Proud"
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
              label="Offset"
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

const EXTERIOR_FINISH_OPTIONS: Array<{ value: WallAssemblyExteriorFinish; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'siding', label: 'Lap siding' },
  { value: 'fiber-cement', label: 'Fiber cement' },
  { value: 'stucco', label: 'Stucco' },
  { value: 'brick', label: 'Brick veneer' },
  { value: 'stone', label: 'Stone veneer' },
]

const SHEATHING_OPTIONS: Array<{ value: WallAssemblySheathingMaterial; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'osb', label: 'OSB' },
  { value: 'plywood', label: 'Plywood' },
  { value: 'gypsum', label: 'Gypsum' },
]

const FRAMING_OPTIONS: Array<{ value: WallAssemblyFramingKind; label: string }> = [
  { value: 'wood', label: 'Wood studs' },
  { value: 'lgs', label: 'Steel studs' },
  { value: 'cmu', label: 'CMU' },
  { value: 'icf', label: 'ICF' },
]

const INTERIOR_FINISH_OPTIONS: Array<{ value: WallAssemblyInteriorFinish; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'drywall', label: 'Drywall' },
  { value: 'plaster', label: 'Plaster' },
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
  const assembly = node.assembly
  const resolved = resolveWallAssembly(node)
  const presetNote = wallAssemblyUnverifiedNote(node)

  // Every write goes through wallAssemblyPatch so `thickness` is re-derived.
  // Changing any layer clears `preset` — the stack is no longer that preset.
  const apply = (next: WallAssembly) => onUpdate(wallAssemblyPatch(next))
  const edit = (mutate: (draft: WallAssembly) => WallAssembly) => {
    if (!assembly) return
    const next = mutate({ ...assembly })
    apply({ ...next, preset: undefined })
  }

  return (
    <PanelSection title="Assembly">
      <LayerRow label="Preset">
        <select
          className={SELECT_CLASS}
          onChange={(event) => {
            const id = event.target.value
            if (!id) {
              onUpdate({ assembly: undefined })
              return
            }
            const preset = getWallAssemblyPreset(id)
            if (preset) apply({ ...preset.assembly })
          }}
          value={assembly?.preset ?? ''}
        >
          <option value="">{assembly ? 'Custom' : 'None (single layer)'}</option>
          {WALL_ASSEMBLY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </LayerRow>

      {assembly && (
        <>
          <LayerRow label="Exterior">
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
                  {option.label}
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

          <LayerRow label="Sheathing">
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
                  {option.label}
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

          <LayerRow label="Framing">
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
                  {option.label}
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

          <LayerRow label="Interior">
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
                  {option.label}
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
              Total thickness
            </span>
            <span className="font-medium text-[11px] text-foreground tabular-nums">
              {formatLayerThickness(assemblyThickness(assembly), unit)}
            </span>
          </div>

          {resolved.kind === 'partition' && (
            <div className="px-2 pb-1.5 text-[10px] text-muted-foreground">
              Partition: the interior finish is applied to both faces.
            </div>
          )}
          {resolved.kind === 'envelope' && resolved.exteriorSide == null && (
            <div className="px-2 pb-1.5 text-[10px] text-muted-foreground">
              Which face is outside is undetermined (no room detected on either side) — the exterior
              layers are drawn on the front face.
            </div>
          )}
          {presetNote && (
            <div className="px-2 pb-2 text-[10px] text-amber-600 dark:text-amber-400">
              Unverified: {presetNote}
            </div>
          )}
          <div className="px-2 pb-2 text-[10px] text-muted-foreground">
            Layer thicknesses follow the 2021 IRC assembly data. Drafting aid, not engineering —
            verify with the authority having jurisdiction.
          </div>
        </>
      )}
    </PanelSection>
  )
}
