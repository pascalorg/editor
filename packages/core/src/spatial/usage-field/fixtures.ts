import { isFloorUnderlay } from '../../agent-operations/furniture-kind'
import {
  CODE_PROFILES,
  type CodeProfile,
  codeProfileOf,
  type Threshold,
  type ThresholdId,
} from '../../building/code-profile'
import type { ItemNode } from '../../schema'
import { catalogueKey } from './catalogue'
import type { UsageIssue } from './findings'
import { m, nameOf, quote, unique } from './labels'
import { type Obstacle, obstaclesInBand, rayHit } from './obstacles'
import { roomAt } from './pieces'
import type { Prism, UsageShapes } from './types'
import type { Nodes } from './walls'

const TOILET = /toilet|water ?closet|(?:^|[^a-z])wc(?![a-z])/i
const BASIN = /basin|lavatory|vanity|bathroom[- ]sink|wash ?hand/i
const BASIN_WORD = /basin|lavatory|vanity|sink|wash ?hand/i
const SHOWER = /shower/i
/** The feet band: what a person's legs and a fixture's rim meet (m above the floor). */
const BAND = { from: 0.05, to: 0.9 }
const RAY_MAX_M = 1.5
/** Where along a fixture's depth, from its back, the sides are read. */
const SIDE_SAMPLES = [0.25, 0.5, 0.75, 1]
/** A lavatory this wide has more than one basin: its centre line is not a basin's. */
const SINGLE_BASIN_MAX_M = 1.0

type Kind = 'toilet' | 'lavatory' | 'shower'
type Point = [number, number]

const kindOf = (item: ItemNode): Kind | null => {
  const text = `${item.name ?? ''} ${item.asset.name ?? ''} ${item.asset.id ?? ''} ${item.asset.category ?? ''}`
  const key = catalogueKey(item.asset.src ?? '')
  if (key === 'system/toilet' || (TOILET.test(text) && !BASIN_WORD.test(text))) return 'toilet'
  if (key === 'system/shower-square' || SHOWER.test(text)) return 'shower'
  if (key === 'system/bathroom-sink' || (BASIN.test(text) && !/kitchen/i.test(text)))
    return 'lavatory'
  return null
}

const inchesText = (metres: number) => `${Math.round(metres / 0.0254)} in`

/**
 * Bathroom fixture clearances: a toilet's centre to the nearest obstruction on each side and its clear
 * space in front, a lavatory's front (and, for a single basin, its side), a shower's clear space at its
 * best open side. Read on the exact outlines of the feet band. The fixture's front is its +Z, checked
 * against the wall behind it (a fixture whose back is free and whose +Z meets a wall is read the other
 * way round); a shower has no opening side in the model, so the best of its four sides is read, which is
 * as good as the opening can be.
 *
 * These are a code's numbers. With no `site.metadata.codeProfile` the scene has no jurisdiction, and a
 * finding is information that names the US IRC it used; with `irc-2021` set it is a warning. A profile
 * with no row for it (the Australian NCC, France hold none of the bathroom figures) reports nothing.
 * Approximate fixture outlines remain labeled as such without downgrading a clearance defect.
 */
export function fixtureClearanceIssues(nodes: Nodes, shapes: UsageShapes): UsageIssue[] {
  const profile = codeProfileOf(nodes)
  const applied: CodeProfile = profile ?? CODE_PROFILES['irc-2021']
  if (Object.keys(applied.thresholds).length === 0) return []
  const out: UsageIssue[] = []

  for (const level of shapes.levels) {
    const prisms = level.prisms.filter(
      (prism) =>
        !(nodes[prism.nodeId]?.type === 'item' && isFloorUnderlay(nodes[prism.nodeId] as ItemNode)),
    )
    for (const item of Object.values(nodes)) {
      if (item.type !== 'item' || item.visible === false || item.parentId !== level.levelId)
        continue
      const kind = kindOf(item)
      if (!kind) continue
      const own = prisms.filter((p) => p.nodeId === item.id)
      if (!own.length) continue
      const approximate = own.some((p) => p.shape === 'approx')
      // the feet band stands on the fixture's own floor: a floor plate set off its storey's base is the fixture's floor
      const floorY = Math.min(...own.map((p) => p.z0))
      const band = { z0: floorY + BAND.from, z1: floorY + BAND.to }
      const yaw = item.rotation?.[1] ?? 0
      const f: Point = [Math.sin(yaw), Math.cos(yaw)]
      const r: Point = [Math.cos(yaw), -Math.sin(yaw)]
      const points = own.flatMap((p: Prism) => p.outer) as Point[]
      const project = (u: Point) => points.map((p) => p[0] * u[0] + p[1] * u[1])
      const [r0, r1] = [Math.min(...project(r)), Math.max(...project(r))]
      const [f0, f1] = [Math.min(...project(f)), Math.max(...project(f))]
      const at = (ur: number, uf: number): Point => [r[0] * ur + f[0] * uf, r[1] * ur + f[1] * uf]
      const obstacles: Obstacle[] = obstaclesInBand(prisms, band, undefined, (p) => {
        if (p.nodeId === item.id || p.kind === 'treatment') return true
        const owner = nodes[p.nodeId]
        return owner?.type === 'item' && owner.parentId === item.id
      })
      const middle = (r0 + r1) / 2
      const depth = f1 - f0
      const behind = rayHit(at(middle, f0 - 0.001), [-f[0], -f[1]], obstacles, 0.4)
      const ahead = rayHit(at(middle, f1 + 0.001), f, obstacles, 0.4)
      const turned = behind > ahead + 0.05 && ahead < 0.15
      const front: Point = turned ? [-f[0], -f[1]] : f
      const edge = turned ? f0 - 0.001 : f1 + 0.001

      const measures: { id: ThresholdId; label: string; value: number }[] = []
      if (kind === 'shower') {
        let best = 0
        for (const [dir, e, u0, u1, across] of [
          [f, f1 + 0.001, r0, r1, true],
          [[-f[0], -f[1]] as Point, f0 - 0.001, r0, r1, true],
          [r, r1 + 0.001, f0, f1, false],
          [[-r[0], -r[1]] as Point, r0 - 0.001, f0, f1, false],
        ] as const) {
          const clear = Math.min(
            ...[0.25, 0.5, 0.75].map((s) => {
              const u = u0 + (u1 - u0) * s
              return rayHit(across ? at(u, e) : at(e, u), dir, obstacles, RAY_MAX_M)
            }),
          )
          best = Math.max(best, clear)
        }
        measures.push({
          id: 'showerFrontClear',
          label: 'in front of its best open side',
          value: best,
        })
      } else {
        const front0 = [-0.25, -0.125, 0, 0.125, 0.25].map((o) =>
          rayHit(at(middle + o, edge), front, obstacles, RAY_MAX_M),
        )
        measures.push({
          id: kind === 'toilet' ? 'toiletFrontClear' : 'lavatoryFrontClear',
          label: 'in front',
          value: Math.min(...front0),
        })
        if (kind === 'toilet' || r1 - r0 <= SINGLE_BASIN_MAX_M) {
          let side = Number.POSITIVE_INFINITY
          // not along the back edge: a ray grazing the wall behind the fixture is not a side obstruction
          for (const sign of [-1, 1] as const)
            for (const share of SIDE_SAMPLES)
              side = Math.min(
                side,
                (r1 - r0) / 2 +
                  rayHit(
                    at(sign > 0 ? r1 + 0.001 : r0 - 0.001, f0 + depth * share),
                    [r[0] * sign, r[1] * sign],
                    obstacles,
                    0.6,
                  ),
              )
          measures.push({
            id: kind === 'toilet' ? 'toiletSideClear' : 'lavatorySideClear',
            label: 'from its centre to the nearest obstruction at the side',
            value: side,
          })
        }
      }

      const room = roomAt(nodes, level.levelId, at(middle, (f0 + f1) / 2))
      const name = nameOf(nodes, item.id)
      for (const { id, label, value } of measures) {
        const row: Threshold | undefined = applied.thresholds[id]
        if (!row || !(value < row.value - 0.005)) continue
        const secondary = row.source === 'secondary source'
        const best = id === 'showerFrontClear'
        out.push({
          type: 'usage_fixture_clearance',
          message: `${quote(name)}${room ? ` in ${quote(room.name)}` : ''} has ${m(value)} m ${label}${best ? ', the best of its four sides (the model has no opening side)' : ''}; ${applied.label} (${row.section}${secondary ? ', secondary source' : ''}) asks ${m(row.value)} m (${inchesText(row.value)})${profile ? '' : ', and this project names no code'}.`,
          severity: profile ? 'warning' : 'info',
          nodeIds: unique([room?.id, item.id]),
          valueM: Math.round(value * 1000) / 1000,
          thresholdM: row.value,
          place: {
            room: room?.name ?? '',
            roomId: room?.id ?? level.levelId,
            at: at(middle, (f0 + f1) / 2),
          },
          obstacles: [],
          approximate,
          code: {
            profile: applied.id,
            cite: row.cite,
            source: row.source,
            byDefault: profile === null,
          },
        })
      }
    }
  }
  return out
}
