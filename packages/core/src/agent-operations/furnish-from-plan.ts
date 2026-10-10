import { refuse } from '../agent-tools/refusal'
import { symbolCandidates, symbolRoomType } from '../building/plan-candidates'
import {
  type LabelRoomType,
  labelQuestion,
  type PlanQuestion,
  roomTypeOf,
} from '../building/plan-judge'
import { planLabels } from '../building/plan-labels'
import { markedPlanSvg } from '../building/plan-marks'
import { type PlanSymbol, planSymbols } from '../building/plan-symbols'
import { referenceContours } from '../building/reference-construction'
import { imagePointToLevel } from '../building/reference-transform'
import { pointInPolygon } from '../lib/polygon-relations'
import { previewId as fingerprint } from '../lib/preview-id'
import { type AnyNode, type AssetInput, type GuideNode, ItemNode } from '../schema'
import { type LevelTargetInput, targetLevel } from './level-target'
import { requirePlanGuide } from './plan-calibration'
import type { AgentContext, AgentOperation, SceneNodes } from './types'
import { registerSceneReport } from './verify-scene'

/**
 * `furnish_from_plan` (L53): the furniture, fixtures and cars a plan reference draws, as catalog
 * items. Without picks it is the look: each drawn piece found (planSymbols, the level's rooms as
 * its rooms), numbered in reading order, boxed on the marked plan, with its catalog candidates.
 * With picks and the look's previewId it places them where they are drawn, turned as drawn, at
 * the catalog's size: never distorted, so an item far larger than its drawing is refused (a 3.5 m
 * table cannot stand where a 2 m bed is drawn). Room types come from the host's judge, asked
 * about the plan's labels before the call (`furnishFromPlanQuestions`); without one, the
 * candidates are by size.
 */

type Pt = [number, number]
type Pick = { n: number; assetId: string } | { n: number; none: true }
type FurnishFromPlanInput = LevelTargetInput & {
  guideId?: string
  picks?: Pick[]
  previewId?: string
}

/** An item larger than its drawing by more than this share, on a side, does not stand there. */
const TOO_LARGE = 0.25
/** Pieces whose centres are within this of each other, across the plan, read as one row. */
const ROW = 1

const round = (value: number) => Math.round(value * 100) / 100
const sorted = ([a, b]: readonly number[]): Pt => (a! <= b! ? [a!, b!] : [b!, a!])

/**
 * The plan on the level asked for: the one named, or the level's only one; with `shapes`, only a
 * plan carrying the shapes it draws counts.
 */
export function levelPlanGuide(
  nodes: SceneNodes,
  input: LevelTargetInput & { guideId?: string },
  context: AgentContext,
  { shapes = true } = {},
) {
  if (input.guideId) return requirePlanGuide(nodes, input.guideId)
  const level = targetLevel(nodes, input, context)
  const plans = Object.values(nodes).filter(
    (node): node is GuideNode =>
      node.type === 'guide' &&
      node.parentId === level.id &&
      typeof (node.metadata.planReference as { width?: unknown } | undefined)?.width === 'number' &&
      (!shapes || Array.isArray(node.metadata.referenceContours)),
  )
  if (!plans.length)
    refuse(
      'no_plan_reference',
      `Level ${level.id} has no plan reference${shapes ? ' with shapes to read' : ''}: import the plan first (import_plan_reference).`,
      { levelId: level.id },
    )
  if (plans.length > 1)
    refuse('plan_ambiguous', `Level ${level.id} has ${plans.length} plans: name one by guideId.`, {
      guideIds: plans.map((plan) => plan.id),
    })
  return requirePlanGuide(nodes, plans[0]!.id)
}

/** The plan, with a scale: without one its metres are guesses, and so would be every piece. */
function calibratedPlan(nodes: SceneNodes, input: FurnishFromPlanInput, context: AgentContext) {
  const plan = levelPlanGuide(nodes, input, context)
  if (!plan.guide.scaleReference)
    refuse(
      'not_calibrated',
      `Plan ${plan.guide.id} has no scale yet: calibrate it first (calibrate_plan_reference on a printed or standard length).`,
      { guideId: plan.guide.id },
    )
  return plan
}

/** The plan read in level metres: its pieces, numbered, and its labels in the level's rooms. */
function readPlan(nodes: SceneNodes, { guide, view }: ReturnType<typeof requirePlanGuide>) {
  const levelId = guide.parentId!
  const toLevel = (point: readonly number[]) =>
    imagePointToLevel(point as Pt, view.image, view.transform) as Pt
  const pixels = referenceContours(guide)
  const contours = pixels.map((contour) => ({
    id: contour.id,
    points: contour.points.map(toLevel),
    stroke: contour.stroke,
    dashed: contour.dashed,
  }))
  const printed = ((guide.metadata.referenceLabels ?? []) as { text: string; at: Pt }[]).filter(
    (label) => typeof label.text === 'string' && Array.isArray(label.at),
  )
  const labels = printed.map((label) => ({ text: label.text, at: toLevel(label.at) }))
  const zones = Object.values(nodes).flatMap((node) =>
    node.type === 'zone' && node.parentId === levelId
      ? [{ id: node.id, label: node.name ?? null, polygon: node.polygon as Pt[] }]
      : [],
  )
  const found = planSymbols({
    contours,
    labels,
    ...(zones.length ? { rooms: zones } : {}),
    planYaw: view.transform.rotation,
  })
  // Reading order: rows down the plan, then along each row.
  const symbols = [...found.symbols].sort(
    (a, b) =>
      Math.round(a.center[1] / ROW) - Math.round(b.center[1] / ROW) || a.center[0] - b.center[0],
  )
  const places = planLabels({ contours, labels, rooms: found.rooms, symbols })
  return { guide, view, levelId, pixels, printed, symbols, places }
}

/** The questions the host's judge answers before the call: what each plan label names. */
export function furnishFromPlanQuestions(
  nodes: SceneNodes,
  input: FurnishFromPlanInput,
  context: AgentContext,
): PlanQuestion[] {
  return readPlan(nodes, calibratedPlan(nodes, input, context)).places.map((place, i) =>
    labelQuestion(`label-${i}`, place),
  )
}

/**
 * The way an item stands where a piece is drawn: its long side along the drawing's first (a sofa
 * whose chaise leans its parts to one end still lies along its drawing), then, of the two ways
 * that does, the one whose front faces away from the drawn back. When the back says neither, the
 * facing is a guess. An item's front is its +Z: turned θ, it faces (sin θ, cos θ).
 */
function rotationFor(symbol: PlanSymbol, asset: AssetInput) {
  const [w, , d] = asset.dimensions ?? [1, 1, 1]
  const along = symbol.size[0] >= symbol.size[1] === w >= d ? symbol.yaw : symbol.yaw + Math.PI / 2
  const away = symbol.back
    ? -(Math.sin(along) * symbol.back.direction[0] + Math.cos(along) * symbol.back.direction[1])
    : 0
  return {
    rotation: away < 0 ? along + Math.PI : along,
    guessed: Math.abs(away) < 0.5,
  }
}

export const furnishFromPlan: AgentOperation<FurnishFromPlanInput> = (nodes, input, context) => {
  const catalog = context.catalog
  if (!catalog) refuse('no_catalog', 'This host has no item catalog to furnish from.')
  const plan = readPlan(nodes, calibratedPlan(nodes, input, context))
  const types = plan.places.map((place, i) => ({
    ...place,
    type: roomTypeOf(context.planAnswers?.[`label-${i}`] ?? null) as LabelRoomType | null,
  }))
  const clusters = plan.symbols.map((symbol, i) => {
    const roomType = symbolRoomType(symbol, types)
    return {
      n: i + 1,
      symbol,
      roomType,
      candidates: symbolCandidates(symbol.size, catalog, roomType),
    }
  })
  const id = fingerprint({
    guide: plan.guide.id,
    pieces: clusters.map(({ symbol }) => [[...symbol.ids].sort(), symbol.center.map(round)]),
  })

  if (!input.picks) {
    const shapes = new Map(plan.pixels.map((contour) => [contour.id, contour.points as Pt[]]))
    const marks = clusters.map(({ n, symbol }) => {
      const points = symbol.ids.flatMap((part) => shapes.get(part) ?? [])
      return {
        n,
        box: {
          minX: Math.min(...points.map((p) => p[0])),
          minY: Math.min(...points.map((p) => p[1])),
          maxX: Math.max(...points.map((p) => p[0])),
          maxY: Math.max(...points.map((p) => p[1])),
        },
      }
    })
    const items = Object.fromEntries(
      clusters.flatMap(({ candidates }) =>
        candidates.map((candidate) => [
          candidate.assetId,
          { name: candidate.name, size: candidate.size.map(round) },
        ]),
      ),
    )
    return {
      result: {
        ok: true,
        previewId: id,
        guideId: plan.guide.id,
        levelId: plan.levelId,
        clusters: clusters.map(({ n, symbol, roomType, candidates }) => ({
          n,
          center: symbol.center.map(round),
          size: symbol.size.map(round),
          rotationDeg: round((symbol.yaw * 180) / Math.PI),
          room: symbol.room?.label ?? null,
          roomType,
          candidates: candidates.map((candidate) => candidate.assetId),
        })),
        items,
        markedPlanSvg: markedPlanSvg({
          width: plan.view.image.width,
          height: plan.view.image.height,
          contours: plan.pixels.map((contour) => ({
            points: contour.points as Pt[],
            stroke: contour.stroke,
          })),
          labels: plan.printed,
          marks,
        }),
        message: `${clusters.length} pieces drawn on the plan, numbered on markedPlan. Name only the numbers to place, each with a catalog item: its candidates are suggestions (items: names and footprints), any catalog item will do. The others stay as they are. Call again with previewId and picks.`,
      },
    }
  }

  if (input.previewId !== id)
    refuse(
      'plan_not_previewed',
      input.previewId
        ? 'The plan or its rooms changed since that preview: call furnish_from_plan without picks again and pick from the new numbers.'
        : 'Look first: call furnish_from_plan without picks, then pass its previewId with your picks.',
      { previewId: id },
    )
  const placed: Record<string, unknown>[] = []
  const refused: Record<string, unknown>[] = []
  const unmatched: Record<string, unknown>[] = []
  const created: AnyNode[] = []
  for (const pick of input.picks) {
    const cluster = clusters[pick.n - 1]
    if (!cluster) {
      refused.push({
        n: pick.n,
        code: 'piece_not_found',
        reason: `No piece ${pick.n}: 1 to ${clusters.length}.`,
      })
      continue
    }
    const { symbol } = cluster
    const drawn = symbol.size.map(round)
    if ('none' in pick) {
      unmatched.push({
        n: pick.n,
        center: symbol.center.map(round),
        size: drawn,
        rotationDeg: round((symbol.yaw * 180) / Math.PI),
        hint: 'Build it with add_object at this size, centre and turn if it belongs in the model.',
      })
      continue
    }
    const asset = catalog.find((entry) => entry.id === pick.assetId)
    if (!asset) {
      refused.push({
        n: pick.n,
        code: 'asset_not_found',
        reason: `${pick.assetId} is not in the catalog.`,
      })
      continue
    }
    const [w, , d] = asset.dimensions ?? [1, 1, 1]
    const [drawnShort, drawnLong] = sorted(symbol.size)
    const [short, long] = sorted([w, d])
    if (short > drawnShort * (1 + TOO_LARGE) || long > drawnLong * (1 + TOO_LARGE)) {
      refused.push({
        n: pick.n,
        code: 'item_too_large',
        drawnSize: drawn,
        itemSize: [round(w), round(d)],
        reason: `${asset.name} (${round(w)} × ${round(d)} m) would not fit where piece ${pick.n} is drawn (${drawn[0]} × ${drawn[1]} m): pick a smaller candidate, none, or build it with add_object at the drawn size.`,
      })
      continue
    }
    const { rotation, guessed } = rotationFor(symbol, asset)
    const node = ItemNode.parse({
      name: asset.name,
      parentId: plan.levelId,
      position: [symbol.center[0], 0, symbol.center[1]],
      rotation: [0, rotation, 0],
      asset,
    })
    created.push(node)
    const fits = short >= drawnShort * (1 - TOO_LARGE) && long >= drawnLong * (1 - TOO_LARGE)
    placed.push({
      n: pick.n,
      itemId: node.id,
      assetId: asset.id,
      fits,
      drawnSize: drawn,
      itemSize: [round(w), round(d)],
      rotationDeg: round((rotation * 180) / Math.PI),
      notes: [
        ...(fits
          ? []
          : [
              'Smaller than its drawing (a table drawn with its chairs, say): add what the drawing holds round it.',
            ]),
        ...(guessed
          ? [
              'Turned along its drawing, its front a guess: turn it half round if it faces the wrong way.',
            ]
          : []),
      ],
    })
  }
  return {
    result: { ok: true, placed, refused, unmatched, levelId: plan.levelId },
    ...(created.length
      ? { changes: { create: created.map((node) => ({ node, parentId: plan.levelId })) } }
      : {}),
  }
}

/**
 * The want (L53): verify_scene names the rooms a calibrated plan draws furniture in that the scene
 * leaves empty, as advice, not as an issue: a room may stay empty on purpose.
 */
function unfurnished(nodes: SceneNodes): Record<string, unknown> {
  const rooms: { zoneId: string; name: string | null; drawn: number }[] = []
  for (const node of Object.values(nodes)) {
    if (
      node.type !== 'guide' ||
      !node.scaleReference ||
      !Array.isArray(node.metadata.referenceContours) ||
      typeof (node.metadata.planReference as { width?: unknown } | undefined)?.width !== 'number'
    )
      continue
    // verify_scene never fails on a plan it cannot read: it gives no advice from it.
    let read: ReturnType<typeof readPlan>
    try {
      read = readPlan(nodes, requirePlanGuide(nodes, node.id))
    } catch {
      continue
    }
    const { levelId, symbols } = read
    const items = Object.values(nodes).filter(
      (item) => item.type === 'item' && item.parentId === levelId,
    ) as (AnyNode & { position: number[] })[]
    for (const zone of Object.values(nodes)) {
      if (zone.type !== 'zone' || zone.parentId !== levelId) continue
      const drawn = symbols.filter((symbol) => symbol.room?.id === zone.id).length
      const polygon = zone.polygon as Pt[]
      if (
        drawn &&
        !items.some((item) => pointInPolygon([item.position[0]!, item.position[2]!], polygon))
      )
        rooms.push({ zoneId: zone.id, name: zone.name ?? null, drawn })
    }
  }
  return rooms.length
    ? {
        unfurnished: {
          rooms,
          hint: `The plan draws furniture in ${rooms.length === 1 ? 'a room' : `${rooms.length} rooms`} the scene leaves empty: furnish_from_plan numbers it on the plan and places it from the catalog.`,
        },
      }
    : {}
}

registerSceneReport({ name: 'unfurnished', run: unfurnished })
