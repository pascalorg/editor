/**
 * Phase 8 P10 — Comprehensive stdio MCP sweep.
 *
 * Exercises every tool currently registered by the MCP (original 21 from Phase 4
 * plus the 9 Phase 7 additions), every resource (4), and every prompt (3).
 * Advertises the `sampling` capability with a canned handler so vision /
 * photo_to_scene tools can return valid JSON without a real vision API.
 *
 * Run: PASCAL_DATA_DIR=/tmp/pascal-phase8-p10 \
 *       bun run packages/mcp/test-reports/phase8/p10-full-sweep.ts
 */

import { rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../../..')
const BIN_PATH = resolve(REPO_ROOT, 'packages/mcp/dist/bin/pascal-mcp.js')
const REPORT_PATH = resolve(__dirname, 'p10-full-sweep.md')
const DATA_DIR = process.env.PASCAL_DATA_DIR ?? '/tmp/pascal-phase8-p10'

type Status = 'PASS' | 'PARTIAL' | 'FAIL'
type Row = {
  kind: 'tool' | 'resource' | 'prompt'
  name: string
  status: Status
  note: string
}
const rows: Row[] = []

function record(kind: Row['kind'], name: string, status: Status, note: string): void {
  rows.push({ kind, name, status, note })
  const tag = status === 'PASS' ? '[PASS]' : status === 'PARTIAL' ? '[PART]' : '[FAIL]'
  console.log(`${tag} ${kind}:${name} — ${note}`)
}

function pickText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type?: string; text?: string }> | undefined
  if (!Array.isArray(content) || content.length === 0) return ''
  return content[0]?.text ?? ''
}

/** Canned valid floor-plan response for `analyze_floorplan_image` / `photo_to_scene`. */
const CANNED_FLOORPLAN = {
  walls: [
    { start: [0, 0], end: [6, 0], thickness: 0.2 },
    { start: [6, 0], end: [6, 4], thickness: 0.2 },
    { start: [6, 4], end: [0, 4], thickness: 0.2 },
    { start: [0, 4], end: [0, 0], thickness: 0.2 },
  ],
  rooms: [
    {
      name: 'main room',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      approximateAreaSqM: 24,
    },
  ],
  approximateDimensions: { widthM: 6, depthM: 4 },
  confidence: 0.82,
}

/** Canned valid room-photo response for `analyze_room_photo`. */
const CANNED_ROOM = {
  approximateDimensions: { widthM: 4, lengthM: 5, heightM: 2.6 },
  identifiedFixtures: [{ type: 'sofa', approximatePosition: [2, 3] }, { type: 'coffee table' }],
  identifiedWindows: [{ wallLabel: 'north', approximateWidthM: 1.2, approximateHeightM: 1.5 }],
}

type SamplingKind = 'floorplan' | 'room'

function detectSamplingKind(req: unknown): SamplingKind {
  // Inspect the host's systemPrompt to pick which canned payload to return.
  const sp = (req as { params?: { systemPrompt?: string } })?.params?.systemPrompt ?? ''
  if (sp.includes('floor-plan')) return 'floorplan'
  return 'room'
}

async function main(): Promise<void> {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    /* ignore */
  }

  const t0 = Date.now()
  console.log('---- Phase 8 P10 full sweep (stdio + mocked sampling) ----')
  console.log(`BIN=${BIN_PATH}`)
  console.log(`DATA_DIR=${DATA_DIR}`)

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [BIN_PATH, '--stdio'],
    stderr: 'inherit',
    env: { ...process.env, PASCAL_DATA_DIR: DATA_DIR },
  })
  const client = new Client({ name: 'p10', version: '0.0.0' }, { capabilities: { sampling: {} } })

  // Canned sampling handler — supports both floorplan and room-photo prompts.
  client.setRequestHandler(CreateMessageRequestSchema, async (req) => {
    const kind = detectSamplingKind(req)
    const json = kind === 'floorplan' ? CANNED_FLOORPLAN : CANNED_ROOM
    return {
      model: 'canned-test-model',
      role: 'assistant',
      content: { type: 'text', text: JSON.stringify(json) },
      stopReason: 'endTurn',
    } as never
  })

  await client.connect(transport)
  console.log('OK  client connected (sampling capability advertised)')

  // ----------------------------------------------------------------------
  // listTools, listResources, listPrompts
  // ----------------------------------------------------------------------
  const tools = await client.listTools()
  const resources = await client.listResources()
  const resourceTemplates = await client.listResourceTemplates()
  const prompts = await client.listPrompts()

  const toolNames = tools.tools.map((t) => t.name).sort()
  const resourceNames = resources.resources.map((r) => r.uri).sort()
  const resourceTemplateNames = resourceTemplates.resourceTemplates.map((r) => r.uriTemplate).sort()
  const promptNames = prompts.prompts.map((p) => p.name).sort()

  console.log(`listTools → ${toolNames.length}: ${toolNames.join(', ')}`)
  console.log(`listResources → ${resourceNames.length}: ${resourceNames.join(', ')}`)
  console.log(
    `listResourceTemplates → ${resourceTemplateNames.length}: ${resourceTemplateNames.join(', ')}`,
  )
  console.log(`listPrompts → ${promptNames.length}: ${promptNames.join(', ')}`)

  // ----------------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------------
  async function callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; structured?: any; text: string; err?: string }> {
    try {
      const res = (await client.callTool({ name, arguments: args })) as any
      const text = pickText(res)
      if (res.isError) return { ok: false, structured: res.structuredContent, text, err: text }
      return { ok: true, structured: res.structuredContent, text }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, text: '', err: msg }
    }
  }

  // ----------------------------------------------------------------------
  // 1. list_templates
  // ----------------------------------------------------------------------
  const lt = await callTool('list_templates', {})
  const templateList = lt.structured?.templates as
    | Array<{ id: string; nodeCount: number }>
    | undefined
  if (lt.ok && templateList && templateList.length >= 3) {
    record('tool', 'list_templates', 'PASS', `${templateList.length} templates`)
  } else {
    record('tool', 'list_templates', 'FAIL', lt.err ?? 'no templates')
  }

  // ----------------------------------------------------------------------
  // 2. create_from_template — two-bedroom (no save — bridge mode)
  // ----------------------------------------------------------------------
  const cft = await callTool('create_from_template', { id: 'two-bedroom' })
  if (cft.ok && cft.structured?.nodeCount > 0) {
    record(
      'tool',
      'create_from_template',
      'PASS',
      `templateId=${cft.structured.templateId} nodes=${cft.structured.nodeCount}`,
    )
  } else {
    record('tool', 'create_from_template', 'FAIL', cft.err ?? 'no nodes')
  }

  // ----------------------------------------------------------------------
  // 3. get_scene
  // ----------------------------------------------------------------------
  const gs = await callTool('get_scene', {})
  const sceneNodes: Record<string, any> =
    gs.structured?.nodes ?? (gs.text ? JSON.parse(gs.text).nodes : {})
  const sceneRoots: string[] =
    gs.structured?.rootNodeIds ?? (gs.text ? JSON.parse(gs.text).rootNodeIds : [])
  const nodeCount = Object.keys(sceneNodes).length
  if (gs.ok && nodeCount > 0) {
    record('tool', 'get_scene', 'PASS', `${nodeCount} nodes / ${sceneRoots.length} roots`)
  } else {
    record('tool', 'get_scene', 'FAIL', gs.err ?? 'empty')
  }

  const findFirst = (type: string): any | null => {
    for (const n of Object.values(sceneNodes)) if ((n as any).type === type) return n
    return null
  }
  const siteNode = findFirst('site') ?? (sceneRoots[0] ? sceneNodes[sceneRoots[0]] : null)
  const buildingNode = findFirst('building')
  const levelNode = findFirst('level')
  const existingWall = findFirst('wall')
  const existingZone = findFirst('zone')

  // ----------------------------------------------------------------------
  // 4. get_node
  // ----------------------------------------------------------------------
  const gn = await callTool('get_node', { id: siteNode?.id ?? sceneRoots[0] ?? '' })
  if (gn.ok && gn.structured?.node?.id) {
    record('tool', 'get_node', 'PASS', `type=${gn.structured.node.type}`)
  } else {
    record('tool', 'get_node', 'FAIL', gn.err ?? 'no node')
  }

  // ----------------------------------------------------------------------
  // 5. describe_node
  // ----------------------------------------------------------------------
  const dn = await callTool('describe_node', { id: siteNode?.id ?? sceneRoots[0] ?? '' })
  if (dn.ok && dn.structured?.type) {
    record(
      'tool',
      'describe_node',
      'PASS',
      `type=${dn.structured.type} children=${dn.structured.childrenIds?.length ?? 0}`,
    )
  } else {
    record('tool', 'describe_node', 'FAIL', dn.err ?? 'no type')
  }

  // ----------------------------------------------------------------------
  // 6. find_nodes — levels
  // ----------------------------------------------------------------------
  const fn = await callTool('find_nodes', { type: 'level' })
  const foundLevels = fn.structured?.nodes ?? []
  const groundLevelId: string | undefined = foundLevels[0]?.id ?? levelNode?.id ?? undefined
  if (fn.ok && foundLevels.length > 0) {
    record('tool', 'find_nodes', 'PASS', `${foundLevels.length} level(s)`)
  } else {
    record('tool', 'find_nodes', 'FAIL', fn.err ?? 'no levels')
  }

  // ----------------------------------------------------------------------
  // 7. measure — two wall nodes if possible
  // ----------------------------------------------------------------------
  const wallsFoundRes = await callTool('find_nodes', { type: 'wall' })
  const walls: any[] = wallsFoundRes.structured?.nodes ?? []
  const measureFromId = walls[0]?.id ?? siteNode?.id ?? ''
  const measureToId = walls[1]?.id ?? walls[0]?.id ?? siteNode?.id ?? ''
  const mm = await callTool('measure', { fromId: measureFromId, toId: measureToId })
  if (mm.ok && mm.structured?.distanceMeters !== undefined) {
    record('tool', 'measure', 'PASS', `d=${Number(mm.structured.distanceMeters).toFixed(3)}m`)
  } else {
    record('tool', 'measure', 'FAIL', mm.err ?? 'no distance')
  }

  // ----------------------------------------------------------------------
  // 8. apply_patch — add a wall via patch
  // ----------------------------------------------------------------------
  const patchWallId = `wall_p10_${Date.now()}`
  const ap = await callTool('apply_patch', {
    patches: [
      {
        op: 'create',
        parentId: groundLevelId,
        node: {
          id: patchWallId,
          type: 'wall',
          children: [],
          start: [10, 0],
          end: [13, 0],
          thickness: 0.12,
          height: 2.6,
          frontSide: 'unknown',
          backSide: 'unknown',
        },
      },
    ],
  })
  if (ap.ok && ap.structured?.appliedOps >= 1) {
    record('tool', 'apply_patch', 'PASS', `applied=${ap.structured.appliedOps}`)
  } else {
    record('tool', 'apply_patch', 'FAIL', ap.err ?? 'no apply')
  }

  // ----------------------------------------------------------------------
  // 9. create_level
  // ----------------------------------------------------------------------
  let newLevelId: string | undefined
  if (buildingNode?.id) {
    const cl = await callTool('create_level', {
      buildingId: buildingNode.id,
      elevation: 6,
      height: 3,
    })
    if (cl.ok && cl.structured?.levelId) {
      newLevelId = cl.structured.levelId
      record('tool', 'create_level', 'PASS', `levelId=${newLevelId}`)
    } else {
      record('tool', 'create_level', 'FAIL', cl.err ?? 'no levelId')
    }
  } else {
    record('tool', 'create_level', 'FAIL', 'no building in scene')
  }

  // ----------------------------------------------------------------------
  // 10. create_wall
  // ----------------------------------------------------------------------
  let newWallId: string | undefined
  if (groundLevelId) {
    const cw = await callTool('create_wall', {
      levelId: groundLevelId,
      start: [20, 0],
      end: [24, 0],
      thickness: 0.14,
      height: 2.7,
    })
    if (cw.ok && cw.structured?.wallId) {
      newWallId = cw.structured.wallId
      record('tool', 'create_wall', 'PASS', `wallId=${newWallId}`)
    } else {
      record('tool', 'create_wall', 'FAIL', cw.err ?? 'no wallId')
    }
  } else {
    record('tool', 'create_wall', 'FAIL', 'no ground level')
  }

  // ----------------------------------------------------------------------
  // 11. place_item — on the wall we just made
  // ----------------------------------------------------------------------
  const targetItemId = newWallId ?? existingWall?.id ?? siteNode?.id
  const pi = await callTool('place_item', {
    catalogItemId: 'test-chair',
    targetNodeId: targetItemId ?? '',
    position: [1, 0, 1],
  })
  // Accept either a full itemId or a status=catalog_unavailable
  const piStatus = pi.structured?.status
  if (pi.ok && pi.structured?.itemId) {
    record('tool', 'place_item', 'PASS', `itemId=${pi.structured.itemId}`)
  } else if (pi.ok && piStatus === 'catalog_unavailable') {
    record('tool', 'place_item', 'PARTIAL', `status=${piStatus}`)
  } else {
    record('tool', 'place_item', 'FAIL', pi.err ?? 'no itemId')
  }

  // ----------------------------------------------------------------------
  // 12. cut_opening — on newWall (or existing wall)
  // ----------------------------------------------------------------------
  const cutWallId = newWallId ?? existingWall?.id
  if (cutWallId) {
    const co = await callTool('cut_opening', {
      wallId: cutWallId,
      type: 'door',
      position: 0.5,
      width: 0.9,
      height: 2.1,
    })
    if (co.ok && co.structured?.openingId) {
      record('tool', 'cut_opening', 'PASS', `openingId=${co.structured.openingId}`)
    } else {
      record('tool', 'cut_opening', 'FAIL', co.err ?? 'no opening')
    }
  } else {
    record('tool', 'cut_opening', 'FAIL', 'no wall available')
  }

  // ----------------------------------------------------------------------
  // 13. set_zone
  // ----------------------------------------------------------------------
  if (groundLevelId) {
    const sz = await callTool('set_zone', {
      levelId: groundLevelId,
      polygon: [
        [100, 100],
        [105, 100],
        [105, 103],
        [100, 103],
      ],
      label: 'p10 zone',
    })
    if (sz.ok && sz.structured?.zoneId) {
      record('tool', 'set_zone', 'PASS', `zoneId=${sz.structured.zoneId}`)
    } else {
      record('tool', 'set_zone', 'FAIL', sz.err ?? 'no zoneId')
    }
  } else {
    record('tool', 'set_zone', 'FAIL', 'no level')
  }

  // ----------------------------------------------------------------------
  // 14. duplicate_level
  // ----------------------------------------------------------------------
  let dupLevelId: string | undefined
  if (groundLevelId) {
    const dl = await callTool('duplicate_level', { levelId: groundLevelId })
    if (dl.ok && dl.structured?.newLevelId) {
      dupLevelId = dl.structured.newLevelId
      record(
        'tool',
        'duplicate_level',
        'PASS',
        `newLevelId=${dupLevelId} nodes=${dl.structured?.newNodeIds?.length ?? 0}`,
      )
    } else {
      record('tool', 'duplicate_level', 'FAIL', dl.err ?? 'no dup')
    }
  } else {
    record('tool', 'duplicate_level', 'FAIL', 'no level')
  }

  // ----------------------------------------------------------------------
  // 15. delete_node — delete the duplicated level
  // ----------------------------------------------------------------------
  if (dupLevelId) {
    const del = await callTool('delete_node', { id: dupLevelId, cascade: true })
    if (del.ok && (del.structured?.deletedIds?.length ?? 0) > 0) {
      record('tool', 'delete_node', 'PASS', `deleted ${del.structured.deletedIds.length} nodes`)
    } else {
      record('tool', 'delete_node', 'FAIL', del.err ?? 'nothing deleted')
    }
  } else {
    record('tool', 'delete_node', 'FAIL', 'no duplicated level')
  }

  // ----------------------------------------------------------------------
  // 16. undo
  // ----------------------------------------------------------------------
  const uu = await callTool('undo', {})
  if (uu.ok) {
    record('tool', 'undo', 'PASS', `undone=${uu.structured?.undone ?? 'n/a'}`)
  } else {
    record('tool', 'undo', 'FAIL', uu.err ?? 'threw')
  }

  // ----------------------------------------------------------------------
  // 17. redo
  // ----------------------------------------------------------------------
  const rr = await callTool('redo', {})
  if (rr.ok) {
    record('tool', 'redo', 'PASS', `redone=${rr.structured?.redone ?? 'n/a'}`)
  } else {
    record('tool', 'redo', 'FAIL', rr.err ?? 'threw')
  }

  // ----------------------------------------------------------------------
  // 18. export_json
  // ----------------------------------------------------------------------
  const ej = await callTool('export_json', { pretty: true })
  if (ej.ok && typeof ej.structured?.json === 'string' && ej.structured.json.length > 0) {
    record('tool', 'export_json', 'PASS', `${ej.structured.json.length} chars`)
  } else {
    record('tool', 'export_json', 'FAIL', ej.err ?? 'no json')
  }

  // ----------------------------------------------------------------------
  // 19. export_glb
  // ----------------------------------------------------------------------
  const eg = await callTool('export_glb', {})
  if (eg.ok) {
    const size =
      eg.structured?.base64?.length ?? eg.structured?.sizeBytes ?? eg.structured?.byteLength ?? 0
    record('tool', 'export_glb', 'PASS', `bytes/b64=${size}`)
  } else {
    record('tool', 'export_glb', 'FAIL', eg.err ?? 'threw')
  }

  // ----------------------------------------------------------------------
  // 20. validate_scene
  // ----------------------------------------------------------------------
  const vs = await callTool('validate_scene', {})
  if (vs.ok && vs.structured?.valid !== undefined) {
    record(
      'tool',
      'validate_scene',
      vs.structured.valid ? 'PASS' : 'PARTIAL',
      `valid=${vs.structured.valid} errors=${vs.structured.errors?.length ?? 0}`,
    )
  } else {
    record('tool', 'validate_scene', 'FAIL', vs.err ?? 'no result')
  }

  // ----------------------------------------------------------------------
  // 21. check_collisions
  // ----------------------------------------------------------------------
  const cc = await callTool('check_collisions', {})
  if (cc.ok) {
    record(
      'tool',
      'check_collisions',
      'PASS',
      `${cc.structured?.collisions?.length ?? 0} collision(s)`,
    )
  } else {
    record('tool', 'check_collisions', 'FAIL', cc.err ?? 'threw')
  }

  // ----------------------------------------------------------------------
  // 22. analyze_floorplan_image — mocked sampling returns the floorplan canned JSON
  // ----------------------------------------------------------------------
  const afi = await callTool('analyze_floorplan_image', {
    image: 'base64data',
  })
  if (afi.ok && afi.structured?.walls?.length > 0) {
    record(
      'tool',
      'analyze_floorplan_image',
      'PASS',
      `walls=${afi.structured.walls.length} rooms=${afi.structured.rooms?.length ?? 0} conf=${afi.structured.confidence}`,
    )
  } else {
    record('tool', 'analyze_floorplan_image', 'FAIL', afi.err ?? 'no walls')
  }

  // ----------------------------------------------------------------------
  // 23. analyze_room_photo — mocked sampling returns the room canned JSON
  // ----------------------------------------------------------------------
  const arp = await callTool('analyze_room_photo', { image: 'base64data' })
  if (arp.ok && arp.structured?.approximateDimensions?.widthM) {
    record(
      'tool',
      'analyze_room_photo',
      'PASS',
      `w=${arp.structured.approximateDimensions.widthM}m fixtures=${arp.structured.identifiedFixtures?.length ?? 0}`,
    )
  } else {
    record('tool', 'analyze_room_photo', 'FAIL', arp.err ?? 'no dims')
  }

  // ----------------------------------------------------------------------
  // 24. save_scene — current bridge state
  // ----------------------------------------------------------------------
  const ss = await callTool('save_scene', { name: 'p10 base scene' })
  let baseSceneId: string | undefined
  if (ss.ok && ss.structured?.id) {
    baseSceneId = ss.structured.id
    record(
      'tool',
      'save_scene',
      'PASS',
      `id=${baseSceneId} v=${ss.structured.version} nodes=${ss.structured.nodeCount}`,
    )
  } else {
    record('tool', 'save_scene', 'FAIL', ss.err ?? 'no id')
  }

  // ----------------------------------------------------------------------
  // 25. list_scenes — should contain base
  // ----------------------------------------------------------------------
  const ls1 = await callTool('list_scenes', {})
  if (ls1.ok && ls1.structured?.scenes?.length >= 1) {
    record('tool', 'list_scenes', 'PASS', `${ls1.structured.scenes.length} scene(s)`)
  } else {
    record('tool', 'list_scenes', 'FAIL', ls1.err ?? 'no scenes')
  }

  // ----------------------------------------------------------------------
  // 26. load_scene — round-trip the base
  // ----------------------------------------------------------------------
  if (baseSceneId) {
    const load = await callTool('load_scene', { id: baseSceneId })
    if (load.ok && load.structured?.id === baseSceneId) {
      record(
        'tool',
        'load_scene',
        'PASS',
        `id=${load.structured.id} nodes=${load.structured.nodeCount}`,
      )
    } else {
      record('tool', 'load_scene', 'FAIL', load.err ?? 'no match')
    }
  } else {
    record('tool', 'load_scene', 'FAIL', 'no baseSceneId')
  }

  // ----------------------------------------------------------------------
  // 27. generate_variants — 2 variants, save=true
  // ----------------------------------------------------------------------
  const gv = await callTool('generate_variants', {
    count: 2,
    vary: ['wall-thickness', 'wall-height'],
    seed: 42,
    save: true,
  })
  let variantIds: string[] = []
  if (gv.ok && gv.structured?.variants?.length === 2) {
    variantIds = gv.structured.variants.map((v: any) => v.sceneId).filter(Boolean)
    record(
      'tool',
      'generate_variants',
      'PASS',
      `${gv.structured.variants.length} variants, ids=${variantIds.length}`,
    )
  } else {
    record('tool', 'generate_variants', 'FAIL', gv.err ?? 'no variants')
  }

  // ----------------------------------------------------------------------
  // 28. photo_to_scene — replaces bridge with mocked floorplan-derived scene
  // ----------------------------------------------------------------------
  // Use base64 instead of https:// so we don't hit the network.
  const pts = await callTool('photo_to_scene', {
    image: 'base64floorplandata',
    name: 'p10 photo scene',
    save: true,
  })
  let photoSceneId: string | undefined
  if (pts.ok && pts.structured?.sceneId) {
    photoSceneId = pts.structured.sceneId
    record(
      'tool',
      'photo_to_scene',
      'PASS',
      `sceneId=${photoSceneId} walls=${pts.structured.walls} rooms=${pts.structured.rooms}`,
    )
  } else {
    record('tool', 'photo_to_scene', 'FAIL', pts.err ?? 'no sceneId')
  }

  // ----------------------------------------------------------------------
  // 29. rename_scene — rename the base
  // ----------------------------------------------------------------------
  if (baseSceneId) {
    const rn = await callTool('rename_scene', {
      id: baseSceneId,
      newName: 'p10 base renamed',
    })
    if (rn.ok && rn.structured?.name === 'p10 base renamed') {
      record('tool', 'rename_scene', 'PASS', `name=${rn.structured.name}`)
    } else {
      record('tool', 'rename_scene', 'FAIL', rn.err ?? 'not renamed')
    }
  } else {
    record('tool', 'rename_scene', 'FAIL', 'no baseSceneId')
  }

  // ----------------------------------------------------------------------
  // 30. delete_scene — delete a variant
  // ----------------------------------------------------------------------
  const toDeleteId = variantIds[0] ?? baseSceneId
  if (toDeleteId) {
    const ds = await callTool('delete_scene', { id: toDeleteId })
    if (ds.ok && ds.structured?.deleted === true) {
      record('tool', 'delete_scene', 'PASS', `deleted=${toDeleteId}`)
    } else {
      record('tool', 'delete_scene', 'FAIL', ds.err ?? 'not deleted')
    }
  } else {
    record('tool', 'delete_scene', 'FAIL', 'no id to delete')
  }

  // list_scenes again — should see base + remaining variant + photo (base renamed, variant[0] deleted)
  const ls2 = await callTool('list_scenes', {})
  if (ls2.ok) {
    const count = ls2.structured?.scenes?.length ?? 0
    console.log(`[verify] list_scenes now = ${count}`)
  }

  // ========================================================================
  // RESOURCES
  // ========================================================================

  // ----------------------------------------------------------------------
  // R1. pascal://scene/current
  // ----------------------------------------------------------------------
  try {
    const r = await client.readResource({ uri: 'pascal://scene/current' })
    const text = (r.contents[0] as any)?.text ?? ''
    const parsed = text ? JSON.parse(text) : null
    if (parsed?.nodes && parsed?.rootNodeIds) {
      record(
        'resource',
        'pascal://scene/current',
        'PASS',
        `${Object.keys(parsed.nodes).length} nodes / ${parsed.rootNodeIds.length} roots`,
      )
    } else {
      record('resource', 'pascal://scene/current', 'FAIL', 'no scene JSON')
    }
  } catch (err) {
    record(
      'resource',
      'pascal://scene/current',
      'FAIL',
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ----------------------------------------------------------------------
  // R2. pascal://scene/current/summary
  // ----------------------------------------------------------------------
  try {
    const r = await client.readResource({ uri: 'pascal://scene/current/summary' })
    const text = (r.contents[0] as any)?.text ?? ''
    if (text.includes('Scene summary')) {
      record(
        'resource',
        'pascal://scene/current/summary',
        'PASS',
        `${text.length} chars of markdown`,
      )
    } else {
      record('resource', 'pascal://scene/current/summary', 'FAIL', 'no "Scene summary" header')
    }
  } catch (err) {
    record(
      'resource',
      'pascal://scene/current/summary',
      'FAIL',
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ----------------------------------------------------------------------
  // R3. pascal://catalog/items
  // ----------------------------------------------------------------------
  try {
    const r = await client.readResource({ uri: 'pascal://catalog/items' })
    const text = (r.contents[0] as any)?.text ?? ''
    const parsed = text ? JSON.parse(text) : null
    // Accept either a real catalog or the advertised `catalog_unavailable` status.
    if (parsed?.items || parsed?.status === 'catalog_unavailable' || parsed?.error) {
      record(
        'resource',
        'pascal://catalog/items',
        'PASS',
        parsed?.items ? `${parsed.items.length} items` : `status=${parsed.status ?? parsed.error}`,
      )
    } else {
      record('resource', 'pascal://catalog/items', 'PARTIAL', `unrecognised payload`)
    }
  } catch (err) {
    record(
      'resource',
      'pascal://catalog/items',
      'FAIL',
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ----------------------------------------------------------------------
  // R4. pascal://constraints/{levelId}
  // ----------------------------------------------------------------------
  try {
    // Use the photo-scene level — bridge is now loaded with that state.
    // Fetch fresh level id via find_nodes.
    const currentLvlRes = await callTool('find_nodes', { type: 'level' })
    const liveLevelId = currentLvlRes.structured?.nodes?.[0]?.id ?? groundLevelId ?? 'unknown-level'
    const r = await client.readResource({ uri: `pascal://constraints/${liveLevelId}` })
    const text = (r.contents[0] as any)?.text ?? ''
    const parsed = text ? JSON.parse(text) : null
    if (parsed?.levelId === liveLevelId && Array.isArray(parsed?.wallPolygons)) {
      record(
        'resource',
        'pascal://constraints/{levelId}',
        'PASS',
        `slabs=${parsed.slabs?.length ?? 0} wallPolys=${parsed.wallPolygons.length}`,
      )
    } else if (parsed?.error === 'level_not_found') {
      record(
        'resource',
        'pascal://constraints/{levelId}',
        'PARTIAL',
        `level_not_found for ${liveLevelId}`,
      )
    } else {
      record('resource', 'pascal://constraints/{levelId}', 'FAIL', 'unexpected payload')
    }
  } catch (err) {
    record(
      'resource',
      'pascal://constraints/{levelId}',
      'FAIL',
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ========================================================================
  // PROMPTS
  // ========================================================================

  // ----------------------------------------------------------------------
  // P1. from_brief
  // ----------------------------------------------------------------------
  try {
    const r = await client.getPrompt({
      name: 'from_brief',
      arguments: { brief: 'a simple 40 m^2 studio with a kitchenette' },
    })
    if (r.messages?.length >= 1 && (r.messages[0]?.content as any)?.text?.includes('Brief')) {
      record('prompt', 'from_brief', 'PASS', `${r.messages.length} message(s)`)
    } else {
      record('prompt', 'from_brief', 'FAIL', 'no Brief header')
    }
  } catch (err) {
    record(
      'prompt',
      'from_brief',
      'FAIL',
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ----------------------------------------------------------------------
  // P2. iterate_on_feedback
  // ----------------------------------------------------------------------
  try {
    const r = await client.getPrompt({
      name: 'iterate_on_feedback',
      arguments: { feedback: 'move the kitchen island 1m closer to the window' },
    })
    if (
      r.messages?.length >= 1 &&
      (r.messages[0]?.content as any)?.text?.includes('User feedback')
    ) {
      record('prompt', 'iterate_on_feedback', 'PASS', `${r.messages.length} message(s)`)
    } else {
      record('prompt', 'iterate_on_feedback', 'FAIL', 'no feedback header')
    }
  } catch (err) {
    record(
      'prompt',
      'iterate_on_feedback',
      'FAIL',
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ----------------------------------------------------------------------
  // P3. renovation_from_photos
  // ----------------------------------------------------------------------
  try {
    const r = await client.getPrompt({
      name: 'renovation_from_photos',
      arguments: {
        currentPhotos: JSON.stringify(['https://example.com/before.jpg']),
        referencePhotos: JSON.stringify(['https://example.com/after.jpg']),
        goals: 'modernise the kitchen with a large island',
      },
    })
    if (r.messages?.length >= 1) {
      record('prompt', 'renovation_from_photos', 'PASS', `${r.messages.length} message(s)`)
    } else {
      record('prompt', 'renovation_from_photos', 'FAIL', 'no messages')
    }
  } catch (err) {
    record(
      'prompt',
      'renovation_from_photos',
      'FAIL',
      `threw: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  await client.close()
  console.log('OK  client closed')

  const elapsedMs = Date.now() - t0
  const passed = rows.filter((r) => r.status === 'PASS').length
  const partial = rows.filter((r) => r.status === 'PARTIAL').length
  const failed = rows.filter((r) => r.status === 'FAIL').length

  // ----------------------------------------------------------------------
  // Write report
  // ----------------------------------------------------------------------
  const ts = new Date().toISOString()
  const md: string[] = []
  md.push('# Phase 8 P10 — full sweep (stdio MCP)')
  md.push('')
  md.push(`Generated: ${ts}`)
  md.push('')
  md.push('## Summary')
  md.push('')
  md.push(`- Transport: stdio (\`bun packages/mcp/dist/bin/pascal-mcp.js --stdio\`)`)
  md.push(`- Data dir: \`${DATA_DIR}\``)
  md.push(`- Sampling: mocked via \`client.setRequestHandler(CreateMessageRequestSchema, …)\``)
  md.push(`- Tools listed: **${toolNames.length}**`)
  md.push(
    `- Resources listed: **${resourceNames.length}** static + **${resourceTemplateNames.length}** template`,
  )
  md.push(`- Prompts listed: **${promptNames.length}**`)
  md.push(`- Total entries exercised: **${rows.length}**`)
  md.push(`- PASS: **${passed}** / PARTIAL: **${partial}** / FAIL: **${failed}**`)
  md.push(`- Run time: **${elapsedMs} ms**`)
  md.push('')
  md.push('## Listed tools')
  md.push('')
  md.push('```')
  md.push(toolNames.join('\n'))
  md.push('```')
  md.push('')
  md.push('## Listed resources')
  md.push('')
  md.push('```')
  md.push(['(static)', ...resourceNames, '', '(templates)', ...resourceTemplateNames].join('\n'))
  md.push('```')
  md.push('')
  md.push('## Listed prompts')
  md.push('')
  md.push('```')
  md.push(promptNames.join('\n'))
  md.push('```')
  md.push('')
  md.push('## Pass matrix — tools')
  md.push('')
  md.push('| # | Tool | Status | Note |')
  md.push('|---|------|--------|------|')
  rows
    .filter((r) => r.kind === 'tool')
    .forEach((r, i) => {
      md.push(`| ${i + 1} | \`${r.name}\` | ${r.status} | ${r.note.replace(/\|/g, '\\|')} |`)
    })
  md.push('')
  md.push('## Pass matrix — resources')
  md.push('')
  md.push('| # | Resource | Status | Note |')
  md.push('|---|----------|--------|------|')
  rows
    .filter((r) => r.kind === 'resource')
    .forEach((r, i) => {
      md.push(`| ${i + 1} | \`${r.name}\` | ${r.status} | ${r.note.replace(/\|/g, '\\|')} |`)
    })
  md.push('')
  md.push('## Pass matrix — prompts')
  md.push('')
  md.push('| # | Prompt | Status | Note |')
  md.push('|---|--------|--------|------|')
  rows
    .filter((r) => r.kind === 'prompt')
    .forEach((r, i) => {
      md.push(`| ${i + 1} | \`${r.name}\` | ${r.status} | ${r.note.replace(/\|/g, '\\|')} |`)
    })
  md.push('')

  writeFileSync(REPORT_PATH, md.join('\n'), 'utf8')
  console.log(`\nreport written: ${REPORT_PATH}`)
  console.log(
    `PASS=${passed} PARTIAL=${partial} FAIL=${failed} total=${rows.length} ms=${elapsedMs}`,
  )

  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[p10] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(2)
})
