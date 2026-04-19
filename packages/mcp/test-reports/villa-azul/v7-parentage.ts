/**
 * Villa Azul — Phase 9 Verifier V7: parent-child consistency checks.
 *
 * Usage:
 *   bun run packages/mcp/test-reports/villa-azul/v7-parentage.ts
 *
 * Reads the Villa Azul scene and verifies parent-child graph invariants.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SCENE_PATH = '/tmp/pascal-villa/scenes/a6e7919eacbe.json'
const REPORT_PATH = resolve('packages/mcp/test-reports/villa-azul/v7-parentage.md')

type Node = {
  id: string
  type: string
  parentId: string | null
  children?: unknown
}

type Scene = {
  meta: { nodeCount: number; name: string }
  graph: {
    nodes: Record<string, Node>
    rootNodeIds: string[]
  }
}

const scene: Scene = JSON.parse(readFileSync(SCENE_PATH, 'utf-8'))
const nodes = scene.graph.nodes
const rootNodeIds = scene.graph.rootNodeIds
const allIds = Object.keys(nodes)

type CheckResult = {
  name: string
  pass: boolean
  count: number
  details: string[]
}

const results: CheckResult[] = []

function record(name: string, pass: boolean, count: number, details: string[] = []) {
  results.push({ name, pass, count, details })
}

const CONTAINER_TYPES = new Set(['building', 'level', 'wall', 'ceiling', 'roof', 'stair'])

// -----------------------------------------------------------------------------
// Check 1: parent chain terminates at a root, no cycles, no dangling refs
// -----------------------------------------------------------------------------
{
  const rootSet = new Set(rootNodeIds)
  let okCount = 0
  const failures: string[] = []
  for (const id of allIds) {
    const visited = new Set<string>()
    let cur: string | null = id
    let terminated = false
    while (cur !== null) {
      if (visited.has(cur)) {
        failures.push(`cycle detected starting at ${id} (loop at ${cur})`)
        break
      }
      visited.add(cur)
      const n: Node | undefined = nodes[cur]
      if (!n) {
        failures.push(`dangling parent ref from ${id}: missing node ${cur}`)
        break
      }
      if (n.parentId === null) {
        if (!rootSet.has(cur) && n.type !== 'building') {
          // building may be a root-level quirk (site's children hold building)
          failures.push(`chain from ${id} terminates at non-root ${cur}`)
        } else {
          terminated = true
        }
        break
      }
      cur = n.parentId
    }
    if (terminated) okCount++
  }
  record(
    'C1 parent chain valid (terminates at root, no cycles, no dangling refs)',
    failures.length === 0,
    okCount,
    failures.slice(0, 5),
  )
}

// -----------------------------------------------------------------------------
// Check 2: rootNodeIds consistency
// -----------------------------------------------------------------------------
{
  const failures: string[] = []
  let goodRoots = 0
  for (const rid of rootNodeIds) {
    const n = nodes[rid]
    if (!n) {
      failures.push(`rootNodeIds contains missing node ${rid}`)
      continue
    }
    if (n.parentId !== null) {
      failures.push(`rootNodeIds entry ${rid} has parentId=${n.parentId}`)
      continue
    }
    goodRoots++
  }
  // every node with parentId===null must be in rootNodeIds OR be a child of site
  const siteNode = Object.values(nodes).find((n) => n.type === 'site')
  const siteChildIds = new Set<string>()
  if (siteNode && Array.isArray(siteNode.children)) {
    for (const c of siteNode.children as Array<string | { id: string }>) {
      if (typeof c === 'string') siteChildIds.add(c)
      else if (c && typeof c === 'object' && 'id' in c) siteChildIds.add(c.id)
    }
  }
  const rootSet = new Set(rootNodeIds)
  let nullParentAccountedFor = 0
  for (const n of Object.values(nodes)) {
    if (n.parentId === null) {
      if (rootSet.has(n.id) || siteChildIds.has(n.id)) {
        nullParentAccountedFor++
      } else {
        failures.push(`node ${n.id} has parentId=null but is not a root nor a site child`)
      }
    }
  }
  record(
    'C2 rootNodeIds consistent (real nodes, parentId=null, all null-parent nodes accounted for)',
    failures.length === 0,
    nullParentAccountedFor,
    failures.slice(0, 5),
  )
}

// -----------------------------------------------------------------------------
// Check 3: container children arrays — ids exist + parentId bidirectional
// -----------------------------------------------------------------------------
{
  const failures: string[] = []
  let checkedContainers = 0
  let bidirectionalMatches = 0
  for (const n of Object.values(nodes)) {
    if (!CONTAINER_TYPES.has(n.type)) continue
    if (!Array.isArray(n.children)) continue
    checkedContainers++
    const childIds = n.children as string[]
    for (const cid of childIds) {
      if (typeof cid !== 'string') {
        failures.push(`${n.id}.children contains non-string: ${JSON.stringify(cid)}`)
        continue
      }
      const child = nodes[cid]
      if (!child) {
        failures.push(`${n.id}.children references missing node ${cid}`)
        continue
      }
      if (child.parentId !== n.id) {
        failures.push(`child ${cid} parentId=${child.parentId} but listed under ${n.id}`)
      } else {
        bidirectionalMatches++
      }
    }
    // reverse: every node with parentId===n.id must appear in children
    for (const other of Object.values(nodes)) {
      if (other.parentId === n.id && !childIds.includes(other.id)) {
        failures.push(`${other.id} claims parent=${n.id} but is missing from its children`)
      }
    }
  }
  record(
    'C3 container children bidirectional (every id exists; every parentId has reverse entry)',
    failures.length === 0,
    bidirectionalMatches,
    failures.slice(0, 5),
  )
}

// -----------------------------------------------------------------------------
// Check 4: site.children holds objects, at least one is a building object
//          matching the building in nodes
// -----------------------------------------------------------------------------
{
  const failures: string[] = []
  const siteNode = Object.values(nodes).find((n) => n.type === 'site')
  let buildingObjects = 0
  if (!siteNode) {
    failures.push('no site node in graph')
  } else if (!Array.isArray(siteNode.children)) {
    failures.push('site.children is not an array')
  } else {
    for (const c of siteNode.children as unknown[]) {
      if (typeof c !== 'object' || c === null) {
        failures.push(`site.children contains non-object: ${JSON.stringify(c)}`)
        continue
      }
      const obj = c as { type?: string; id?: string }
      if (obj.type === 'building' && obj.id && nodes[obj.id]?.type === 'building') {
        buildingObjects++
      }
    }
    if (buildingObjects === 0) {
      failures.push('no matching building object found in site.children')
    }
  }
  record(
    'C4 site.children holds building objects matching nodes',
    failures.length === 0,
    buildingObjects,
    failures.slice(0, 5),
  )
}

// -----------------------------------------------------------------------------
// Check 5: no orphans — every non-root node's parentId exists in nodes
// -----------------------------------------------------------------------------
{
  const failures: string[] = []
  let goodNonRoot = 0
  for (const n of Object.values(nodes)) {
    if (n.parentId === null) continue
    if (!nodes[n.parentId]) {
      failures.push(`${n.id} has parentId=${n.parentId} which does not exist`)
    } else {
      goodNonRoot++
    }
  }
  record(
    'C5 no orphans (every non-root parentId exists)',
    failures.length === 0,
    goodNonRoot,
    failures.slice(0, 5),
  )
}

// -----------------------------------------------------------------------------
// Check 6: Level.children includes every wall/zone/slab/fence parented to it
// -----------------------------------------------------------------------------
{
  const failures: string[] = []
  const levels = Object.values(nodes).filter((n) => n.type === 'level')
  const TARGET_TYPES = new Set(['wall', 'zone', 'slab', 'fence'])
  const perLevelCounts: Record<string, number> = {}
  let totalMatched = 0
  for (const lvl of levels) {
    const listed = Array.isArray(lvl.children) ? (lvl.children as string[]) : []
    const parented = Object.values(nodes).filter(
      (n) => n.parentId === lvl.id && TARGET_TYPES.has(n.type),
    )
    let localCount = 0
    for (const p of parented) {
      if (!listed.includes(p.id)) {
        failures.push(`${lvl.id}.children missing ${p.type} ${p.id} which claims it as parent`)
      } else {
        localCount++
        totalMatched++
      }
    }
    perLevelCounts[lvl.id] = parented.length
  }
  record(
    `C6 level.children includes all wall/zone/slab/fence children (levels: ${levels
      .map((l) => `${l.id}=${perLevelCounts[l.id]}`)
      .join(', ')})`,
    failures.length === 0,
    totalMatched,
    failures.slice(0, 5),
  )
}

// -----------------------------------------------------------------------------
// Check 7: wall.children contains all doors + windows listing the wall
// -----------------------------------------------------------------------------
{
  const failures: string[] = []
  const walls = Object.values(nodes).filter((n) => n.type === 'wall')
  const OPENING_TYPES = new Set(['door', 'window'])
  // pick first wall that has any doors/windows listed in its children
  const wallWithOpenings = walls.find((w) => {
    const listed = Array.isArray(w.children) ? (w.children as string[]) : []
    return listed.some((cid) => {
      const c = nodes[cid]
      return c && OPENING_TYPES.has(c.type)
    })
  })
  let matched = 0
  if (!wallWithOpenings) {
    failures.push('no wall with door/window children found')
  } else {
    const listed = wallWithOpenings.children as string[]
    for (const cid of listed) {
      const c = nodes[cid]
      if (!c) {
        failures.push(`${wallWithOpenings.id}.children has missing id ${cid}`)
        continue
      }
      if (OPENING_TYPES.has(c.type)) {
        if (c.parentId !== wallWithOpenings.id) {
          failures.push(
            `${cid} (${c.type}) parentId=${c.parentId} but listed under wall ${wallWithOpenings.id}`,
          )
        } else {
          matched++
        }
      }
    }
    // reverse: any door/window parented to this wall must be in children
    for (const n of Object.values(nodes)) {
      if (
        OPENING_TYPES.has(n.type) &&
        n.parentId === wallWithOpenings.id &&
        !listed.includes(n.id)
      ) {
        failures.push(
          `${n.type} ${n.id} claims wall ${wallWithOpenings.id} as parent but missing from children`,
        )
      }
    }
  }
  record(
    `C7 wall.children lists all door+window openings (sampled wall=${
      wallWithOpenings?.id ?? 'n/a'
    })`,
    failures.length === 0,
    matched,
    failures.slice(0, 5),
  )
}

// -----------------------------------------------------------------------------
// Render report
// -----------------------------------------------------------------------------
const overallPass = results.every((r) => r.pass)
const lines: string[] = []
lines.push('# Villa Azul — V7 Parentage Report')
lines.push('')
lines.push(`Scene: \`${SCENE_PATH}\``)
lines.push(`Nodes: ${allIds.length} (meta.nodeCount=${scene.meta.nodeCount})`)
lines.push(`Roots: ${rootNodeIds.length} (${rootNodeIds.join(', ')})`)
lines.push('')
lines.push(`**Overall: ${overallPass ? 'PASS' : 'FAIL'}**`)
lines.push('')
lines.push('| # | Check | Count | Result |')
lines.push('| - | ----- | ----- | ------ |')
for (const [i, r] of results.entries()) {
  const short = r.name.replace(/\|/g, '\\|')
  lines.push(`| ${i + 1} | ${short} | ${r.count} | ${r.pass ? 'PASS' : 'FAIL'} |`)
}
lines.push('')
for (const r of results) {
  if (!r.pass && r.details.length) {
    lines.push(`## ${r.name} — failures`)
    for (const d of r.details) lines.push(`- ${d}`)
    lines.push('')
  }
}

writeFileSync(REPORT_PATH, lines.join('\n'))
console.log(lines.join('\n'))
if (!overallPass) process.exitCode = 1
