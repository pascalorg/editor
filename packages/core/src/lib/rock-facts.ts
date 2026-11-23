import type { AnyNode, BuildingNode, LevelNode, RockNode, SlabNode, WallNode } from '../schema'
import { area, type Ring } from './polygon-boolean'
import { planRock } from './rock-build'
import { rockHolesIn } from './rock-cuts'
import { highestGroundUnder, lowestGroundUnder, type RockSpan, rockSpan } from './rock-ground'
import { wallContacts } from './rock-wall-contact'
import { FLAT_GROUND_Y } from './site-ground-height'
import { persistedTerrainFieldOf } from './terrain-source-persisted'

type Nodes = Readonly<Record<string, AnyNode>>
type Point = [number, number]

export type RockSlabFact = {
  slabId: string
  levelId: string
  buildingId: string
  holeAreaM2: number
}
export type RockWallFact = {
  wallId: string
  levelId: string
  buildingId: string
  insideLengthM: number
  wallType: 'standard' | 'curtain' | 'railing'
}
export type RockFacts = {
  gen: 1
  rockType: RockNode['rockType']
  look: {
    form: RockNode['form']
    strata: boolean
    lichen: number
    weathering: number
    moss: number
  }
  estimatedTriangles: { near: number; far: number }
  outline: Point[]
  footprintAreaM2: number
  heightM: number
  footElevationM: number
  topElevationM: number
  groundM: { lowest: number; highest: number }
  throughSlabs: RockSlabFact[]
  meetsWalls: RockWallFact[]
}

const round = (value: number) => Math.round(value * 1000) / 1000

function polygonAreaOf(ring: readonly Point[]): number {
  return area([{ outer: ring as Ring, holes: [] }])
}

function buildingsOf(siteId: string, nodes: Nodes): BuildingNode[] {
  return Object.values(nodes).filter(
    (node): node is BuildingNode => node.type === 'building' && node.parentId === siteId,
  )
}

function levelsOf(building: BuildingNode, nodes: Nodes): LevelNode[] {
  return building.children
    .map((id) => nodes[id])
    .filter((node): node is LevelNode => node?.type === 'level')
}

function slabsOf(level: LevelNode, nodes: Nodes): SlabNode[] {
  return level.children
    .map((id) => nodes[id])
    .filter((node): node is SlabNode => node?.type === 'slab')
}

function wallsOf(level: LevelNode, nodes: Nodes): WallNode[] {
  return level.children
    .map((id) => nodes[id])
    .filter((node): node is WallNode => node?.type === 'wall')
}

function slabFacts(
  rock: RockNode,
  building: BuildingNode,
  level: LevelNode,
  nodes: Nodes,
): RockSlabFact[] {
  return slabsOf(level, nodes).flatMap((slab) => {
    const holes = rockHolesIn(slab, rock, nodes)
    const holeAreaM2 = holes.reduce((sum, hole) => sum + polygonAreaOf(hole), 0)
    return holeAreaM2 > 0
      ? [
          {
            slabId: slab.id,
            levelId: level.id,
            buildingId: building.id,
            holeAreaM2: round(holeAreaM2),
          },
        ]
      : []
  })
}

function wallFacts(
  rock: RockNode,
  span: RockSpan,
  building: BuildingNode,
  level: LevelNode,
  nodes: Nodes,
): RockWallFact[] {
  return wallContacts(rock, span, building, level, nodes, wallsOf(level, nodes)).map((contact) => ({
    ...contact,
    levelId: level.id,
    buildingId: building.id,
    insideLengthM: round(contact.insideLengthM),
  }))
}

/** What a rock is and what it rises through: facts, not judgements. */
export function rockFacts(rock: RockNode, nodes: Nodes): RockFacts {
  const plan = planRock(rock)
  const site = rock.parentId ? nodes[rock.parentId] : undefined
  const field = site?.type === 'site' ? persistedTerrainFieldOf(site) : null
  const datum = site?.type === 'site' ? FLAT_GROUND_Y : 0
  const { footY, topY } = rockSpan(rock, field, datum)
  const buildings = site ? buildingsOf(site.id, nodes) : []
  const levels = buildings.flatMap((building) =>
    levelsOf(building, nodes).map((level) => ({ building, level })),
  )
  return {
    gen: 1,
    rockType: rock.rockType,
    look: {
      form: rock.form,
      strata: rock.strata,
      lichen: rock.lichen,
      weathering: rock.weathering,
      moss: rock.moss,
    },
    estimatedTriangles: {
      near: plan.estimate.near.triangles,
      far: plan.estimate.far.triangles,
    },
    outline: rock.polygon as Point[],
    footprintAreaM2: round(polygonAreaOf(rock.polygon as Point[])),
    heightM: rock.height,
    footElevationM: round(footY),
    topElevationM: round(topY),
    groundM: {
      lowest: round(lowestGroundUnder(rock.polygon, field, datum)),
      highest: round(highestGroundUnder(rock.polygon, field, datum)),
    },
    throughSlabs: levels.flatMap(({ building, level }) => slabFacts(rock, building, level, nodes)),
    meetsWalls: levels.flatMap(({ building, level }) =>
      wallFacts(rock, { footY, topY }, building, level, nodes),
    ),
  }
}
