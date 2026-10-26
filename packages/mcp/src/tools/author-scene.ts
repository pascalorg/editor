import type { McpServer } from '@modelcontextprotocol/server'
import { type AnyNode, type DerivedNodeChanges, filterDerivedNodeWrites } from '@pascal-app/core'
import {
  type AgentContext,
  type AuthorSceneDefect,
  type AuthorScenePending,
  achievedChanges,
  authorSceneChecks,
  type SceneNodes,
  verifyScene,
} from '@pascal-app/core/agent-operations'
import {
  type AuthorScenePayload,
  authorScenePayload,
  authorSceneTool,
  isAgentRefusal,
  refuse,
} from '@pascal-app/core/agent-tools'
import { GEOMETRY_SCRIPT_MIME_TYPES } from '@pascal-app/core/schema'
import { compileAuthorScene } from '@pascal-app/geometry-script/author-scene'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { compileAndStore, type GeometryScriptHost, type ObjectMakerHost } from './add-object'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult, toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { toPatches } from './shared-tools'

type Edit = { in: 'module' | 'adapter'; find: string; replace: string }
type Input = {
  payload?: AuthorScenePayload
  module?: string
  adapter?: string
  edits?: Edit[]
  replace?: boolean
  buildingId?: string
  sceneId?: string
}

/**
 * What a conversion keeps on its building (`metadata.authorScene`): its module and adapter as
 * stored scripts, the payload with every module as its stored script (`<key>Script`) and every
 * piece by id, the items still waiting for their piece, and the report.
 */
type StoredConversion = {
  module?: string
  adapter?: string
  payload?: Record<string, unknown>
  pending?: AuthorScenePending[]
}

/** Payload keys holding a module's text; stored as `<key>Script`, the script's hash. */
const CODE_KEYS = new Set(['code', 'floorCode', 'wallCode'])

/**
 * `author_scene` on the MCP: the payload given, or the one the adapter answers on the module (the
 * stored module and adapter, changed by edits, when left out), or the stored conversion again;
 * items naming a piece written with its module, those still being made left for the host to write
 * when they land; every module compiled and stored through the host, the operation applied,
 * Pascal's checks run, and the gate report answered.
 */
export function registerAuthorScene(
  server: McpServer,
  bridge: SceneOperations,
  host: GeometryScriptHost | undefined,
  makers?: ObjectMakerHost,
): void {
  server.registerTool(
    authorSceneTool.name,
    {
      title: authorSceneTool.title,
      description: authorSceneTool.description,
      inputSchema: z.object(authorSceneTool.input),
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async (input: Record<string, unknown>) => {
      if (!host) {
        return toolError('This Pascal server cannot run geometry scripts.', {
          code: 'scripts_unavailable',
        })
      }
      const args = input as Input
      const scene = bridge.getActiveScene()
      if (!scene) {
        return toolError('Open or save a scene first: a conversion is stored with a scene.', {
          code: 'no_active_scene',
        })
      }
      if (args.sceneId && args.sceneId !== scene.id) {
        return toolError('Open the requested scene before converting it.', {
          code: 'scene_mismatch',
          mutationApplied: false,
        })
      }
      const before = bridge.getNodes() as SceneNodes
      const beforeJson = JSON.stringify(before)
      const context: AgentContext = {
        activeLevelId: bridge.activeLevelId?.() ?? null,
        ...(bridge.supportsMaterialUpserts && bridge.getMaterials
          ? { materials: bridge.getMaterials() }
          : {}),
      }
      const readText = async (sha256: string) => {
        const bytes = await host.readArtifact({ sceneId: scene.id, sha256 })
        if (!bytes) throw new Error(`The stored script ${sha256} could not be read`)
        return new TextDecoder().decode(bytes)
      }

      let source: Awaited<ReturnType<typeof sourceOf>>
      try {
        source = await sourceOf(args, storedConversion(before, args.buildingId), host, readText)
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'conversion_failed',
        })
      }
      if ('failed' in source) return source.failed

      const pieces = await withPieces(source.payload, scene.id, makers)
      let outcome: Awaited<ReturnType<typeof compileAuthorScene>>
      try {
        outcome = await compileAuthorScene(
          before,
          { payload: pieces.payload, replace: args.replace, buildingId: args.buildingId },
          context,
          ({ code, kind, inputs, nodeId }) =>
            compileAndStore(
              host,
              scene.id,
              { code, language: 'three', params: undefined, inputs },
              kind,
              { nodeId },
            ),
          host.signal,
        )
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'conversion_failed',
        })
      }
      // Provenance: the design's module and the program that read it, kept as scripts of the scene.
      const provenance: Record<string, string> = {}
      for (const kind of ['module', 'adapter'] as const) {
        const text = source.texts[kind]
        const kept =
          source.changed[kind] && text !== undefined
            ? await host.storeArtifact({
                sceneId: scene.id,
                sha256: await sha256(text),
                bytes: new TextEncoder().encode(text),
                mimeType: GEOMETRY_SCRIPT_MIME_TYPES.three,
                metadata: { kind: 'item' },
              })
            : source.stored[kind]
        if (kept) provenance[kind] = kept
      }

      host.signal?.throwIfAborted()
      await host.assertActive?.()
      if (JSON.stringify(bridge.getNodes()) !== beforeJson) {
        return toolError(
          'The scene changed while its candidate was compiling. Read the current scene and retry the conversion.',
          { code: 'scene_changed', mutationApplied: false },
        )
      }
      const report = {
        ...outcome.result,
        defects: [...pieces.defects, ...outcome.result.defects],
      }
      const buildingUpdate = outcome.changes.update.find(
        (change) => change.id === outcome.buildingId,
      )!
      buildingUpdate.data.metadata = {
        ...buildingUpdate.data.metadata,
        authorScene: {
          ...provenance,
          payload: await withScripts(source.payload),
          pending: pieces.pending,
          report,
          at: new Date().toISOString(),
        },
      }
      // A revision's plates and ceilings follow its walls: what only the reconciler may change on
      // one that stays (its outline, its room) is left to the bridge's reconciliation after the
      // write, as in the editor; a new room's arrive with it.
      const patches = toPatches(
        filterDerivedNodeWrites(
          bridge.getNodes(),
          outcome.changes as unknown as DerivedNodeChanges,
        ) as unknown as typeof outcome.changes,
      )
      if (patches.length) bridge.applyPatch(patches)
      const verified = verifyScene(bridge.getNodes() as SceneNodes, undefined, {
        activeLevelId: null,
      }).result as {
        valid: boolean
        issues: { type?: string; message?: string; severity?: string }[]
      }
      const byType = new Map<string, number>()
      for (const issue of verified.issues)
        byType.set(issue.type ?? 'unknown', (byType.get(issue.type ?? 'unknown') ?? 0) + 1)
      const checks = authorSceneChecks({
        payload: source.payload,
        report,
        pending: pieces.pending,
        issues: verified.issues.filter((issue) => issue.severity !== 'info'),
      })
      const payload = {
        ...report,
        pending: pieces.pending,
        checks,
        complete: pieces.pending.length === 0 && checks.every((check) => check.passed),
        itemTriangles: outcome.itemTriangles,
        itemsCompiled: outcome.itemsCompiled,
        green: report.defects.length === 0,
        verify: {
          valid: verified.valid,
          issues: verified.issues.length,
          byType: Object.fromEntries(byType),
          first: verified.issues.slice(0, 40).map((i) => i.message),
        },
        achieved: achievedChanges(before as SceneNodes, outcome.changes ?? {}),
        ...persistencePayload(await publishLiveSceneSnapshot(bridge, authorSceneTool.name)),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

/** The building a conversion revises: the one named, else the one holding a conversion. */
function storedConversion(nodes: SceneNodes, buildingId?: string): StoredConversion | undefined {
  const holds = (node: AnyNode | undefined) =>
    node?.type === 'building'
      ? ((node.metadata as { authorScene?: StoredConversion } | undefined)?.authorScene ?? null)
      : null
  if (buildingId) return holds(nodes[buildingId] as AnyNode | undefined) ?? undefined
  return (Object.values(nodes) as AnyNode[]).map(holds).find(Boolean) ?? undefined
}

/**
 * The payload to write, with the module and adapter it came from: given; answered by the adapter on
 * the module (each the one given or stored, changed by the edits); or the stored conversion again.
 * An adapter that throws, or answers no valid payload, is answered with why, and nothing is written.
 */
async function sourceOf(
  args: Input,
  stored: StoredConversion | undefined,
  host: GeometryScriptHost,
  readText: (sha256: string) => Promise<string>,
) {
  const edits = args.edits ?? []
  const changed = {
    module: args.module !== undefined || edits.some((edit) => edit.in === 'module'),
    adapter: args.adapter !== undefined || edits.some((edit) => edit.in === 'adapter'),
  }
  const result = (payload: AuthorScenePayload, texts: { module?: string; adapter?: string }) => ({
    payload,
    texts,
    changed,
    stored: { module: stored?.module, adapter: stored?.adapter },
  })
  if (args.payload) {
    if (edits.length)
      refuse(
        'edits_with_payload',
        'Edits change the module or the adapter Pascal runs: leave the payload out to have it run.',
      )
    return result(args.payload, { module: args.module, adapter: args.adapter })
  }
  if (args.module !== undefined || args.adapter !== undefined || edits.length) {
    const texts = {
      module: args.module ?? (stored?.module ? await readText(stored.module) : undefined),
      adapter: args.adapter ?? (stored?.adapter ? await readText(stored.adapter) : undefined),
    }
    edits.forEach((edit, index) => {
      const text = texts[edit.in]
      if (text === undefined)
        refuse(
          'edit_without_source',
          `Edit ${index}: there is no ${edit.in} to change. Pass it, or convert with one first.`,
          { edit: index },
        )
      const at = text.indexOf(edit.find)
      if (at < 0)
        refuse('edit_not_found', `Edit ${index}: its find text is not in the ${edit.in}.`, {
          edit: index,
        })
      if (text.indexOf(edit.find, at + 1) >= 0)
        refuse(
          'edit_ambiguous',
          `Edit ${index}: its find text occurs more than once in the ${edit.in}; give more of it.`,
          { edit: index },
        )
      texts[edit.in] = text.slice(0, at) + edit.replace + text.slice(at + edit.find.length)
    })
    if (texts.adapter === undefined)
      refuse(
        'adapter_required',
        'This scene stores no adapter: pass the payload, or the module and its adapter together in one call.',
      )
    if (texts.module === undefined)
      refuse(
        'module_required',
        'This scene stores no module: pass the module and its adapter together in one call.',
      )
    if (!host.runAdapter)
      refuse('adapter_unavailable', 'This Pascal server cannot run an adapter: pass the payload.')
    let answered: Record<string, unknown>
    try {
      answered = (await host.runAdapter({ adapter: texts.adapter, design: texts.module })).payload
    } catch (error) {
      return {
        failed: toolError(
          `Your adapter failed: ${error instanceof Error ? error.message : String(error)}`,
          { code: 'adapter_failed', mutationApplied: false },
        ),
      }
    }
    const parsed = authorScenePayload.safeParse(answered)
    if (!parsed.success)
      return {
        failed: toolError(
          `Your adapter's payload does not match author_scene's: ${parsed.error.issues
            .slice(0, 12)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
          {
            code: 'payload_invalid',
            mutationApplied: false,
            issues: parsed.error.issues
              .slice(0, 40)
              .map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          },
        ),
      }
    return result(parsed.data, texts)
  }
  if (!stored?.payload)
    refuse(
      'nothing_to_write',
      'Pass a payload, or a module and its adapter: this scene holds no stored conversion to write again.',
    )
  const rehydrated = (await withCode(stored.payload, readText)) as unknown
  const parsed = authorScenePayload.safeParse(rehydrated)
  if (!parsed.success)
    refuse(
      'stored_conversion_unreadable',
      'The stored conversion could not be read back: pass the payload, or the module and its adapter.',
    )
  return result(parsed.data, {})
}

type PayloadItem = NonNullable<AuthorScenePayload['levels'][number]['items']>[number]

/**
 * Items naming a piece, with its module once made; those still being made left out and listed as
 * pending (the host writes them when they land); one that failed, is unknown or has no module, a
 * defect by its id.
 */
async function withPieces(
  payload: AuthorScenePayload,
  sceneId: string,
  makers: ObjectMakerHost | undefined,
) {
  const items = [
    ...payload.levels.flatMap((level) => level.items ?? []),
    ...(payload.roof?.items ?? []),
  ]
  const ids = [...new Set(items.flatMap((item) => (item.piece ? [item.piece] : [])))]
  const states = ids.length && makers ? await makers.pieces({ sceneId, ids }) : {}
  const pending: AuthorScenePending[] = []
  const defects: AuthorSceneDefect[] = []
  const resolve = (list: PayloadItem[] | undefined) =>
    list?.flatMap(({ piece, ...item }): PayloadItem[] => {
      if (!piece) {
        if (item.code) return [item]
        defects.push({ id: item.id, code: 'no_module', message: 'It has neither code nor piece.' })
        return []
      }
      const state = states[piece]
      if (state?.status === 'made') return [{ ...item, code: state.code }]
      if (state?.status === 'making') pending.push({ id: item.id, piece })
      else
        defects.push(
          !makers
            ? {
                id: item.id,
                code: 'pieces_unavailable',
                message: 'This Pascal server makes no pieces: give the item its code.',
              }
            : state
              ? { id: item.id, code: 'piece_failed', message: state.error }
              : {
                  id: item.id,
                  code: 'piece_unknown',
                  message: `No piece "${piece}": make it with add_object's piece first.`,
                },
        )
      return []
    })
  return {
    payload: {
      ...payload,
      levels: payload.levels.map((level) => ({ ...level, items: resolve(level.items) })),
      ...(payload.roof ? { roof: { ...payload.roof, items: resolve(payload.roof.items) } } : {}),
    },
    pending,
    defects,
  }
}

/** The payload as kept with the scene: every module as its stored script's hash, pieces by id. */
async function withScripts(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(withScripts))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value))
    if (CODE_KEYS.has(key) && typeof entry === 'string') out[`${key}Script`] = await sha256(entry)
    else out[key] = await withScripts(entry)
  return out
}

/** The stored payload with its modules read back; one whose script is gone is left without it. */
async function withCode(
  value: unknown,
  readText: (sha256: string) => Promise<string>,
): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((entry) => withCode(entry, readText)))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const base = key.endsWith('Script') ? key.slice(0, -'Script'.length) : null
    if (base && CODE_KEYS.has(base) && typeof entry === 'string')
      out[base] = await readText(entry).catch(() => undefined)
    else out[key] = await withCode(entry, readText)
  }
  return out
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
