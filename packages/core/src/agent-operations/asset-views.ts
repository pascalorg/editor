import { refuse } from '../agent-tools/refusal'
import { deriveSlotId } from '../lib/slots'
import type { AssetInput } from '../schema'
import type { AgentContext, AgentOperation, SceneNodes } from './types'

/**
 * What a host read about one catalog item before the call, as the operations are sync: its
 * picture (a data URL, at most 512 px), and the names of its paintable surfaces, the `slot_<id>`
 * materials in its model. A fact the host could not read is left out, never guessed.
 */
export type AssetViewFacts = {
  picture?: string
  surfaces?: readonly string[]
  /** Why a picture or the surfaces are missing, in the host's words. */
  unavailable?: string
}

type ViewAssetsInput = { ids: string[] }

/** The item a host reads: `id` keys its facts, `src` is its model, `thumbnail` its picture. */
export type AssetViewSubject = Pick<AssetInput, 'id' | 'src'> & { thumbnail?: string }

const round = (value: number) => Math.round(value * 100) / 100

/** A GLB's JSON chunk is read whole; one past this is not a model's description. */
const MAX_JSON_CHUNK = 8 * 1024 * 1024
const GLB_MAGIC = 0x46_54_6c_67
const GLB_JSON_CHUNK = 0x4e_4f_53_4a

/**
 * The names of a GLB's paintable surfaces (its `slot_<id>` materials, as the renderer and the
 * editor's Paint read them), from the container's JSON chunk alone: `read` is asked for the
 * 20-byte header, then for the JSON chunk. A file with no slot materials gives `[]`.
 */
export async function readGlbSurfaces(
  read: (start: number, end: number) => Promise<Uint8Array>,
): Promise<string[]> {
  const head = await read(0, 20)
  if (head.byteLength < 20) throw new Error('Not a GLB: the file is shorter than its header.')
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('Not a GLB: bad magic.')
  if (view.getUint32(16, true) !== GLB_JSON_CHUNK)
    throw new Error('Not a GLB: no JSON chunk first.')
  const length = view.getUint32(12, true)
  if (length > MAX_JSON_CHUNK) throw new Error('The GLB description is too large to read.')
  const json = await read(20, 20 + length)
  if (json.byteLength < length) throw new Error('The GLB description is truncated.')
  const parsed = JSON.parse(new TextDecoder().decode(json).trim()) as {
    materials?: { name?: unknown }[]
  }
  const ids = (parsed.materials ?? []).flatMap((material) =>
    typeof material?.name === 'string' ? [deriveSlotId(material.name)] : [],
  )
  return [...new Set(ids.filter((id): id is string => id !== null))]
}

/** How a host reaches a library's files: a byte range of a model, a thumbnail as a data URL. */
export type AssetViewIO = {
  range: (url: string, start: number, end: number) => Promise<Uint8Array>
  picture: (url: string) => Promise<string>
}

/** A thumbnail is fetched whole; one past this is not a thumbnail. */
const MAX_PICTURE_BYTES = 4 * 1024 * 1024

/** The first `end` bytes of a body, then the rest is dropped: a server that ignores `Range`. */
async function readPrefix(response: Response, end: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array(await response.arrayBuffer()).subarray(0, end)
  const chunks: Uint8Array[] = []
  let length = 0
  while (length < end) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.byteLength
  }
  await reader.cancel().catch(() => undefined)
  const bytes = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes.subarray(0, end)
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x80_00)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x80_00))
  return btoa(binary)
}

/**
 * The library's files over `fetch`: a model by two small `Range` requests, a thumbnail whole, then
 * `resizePicture` (the host's own: a canvas in the browser, sharp on a server) to at most 512 px.
 * Without one the thumbnail goes as it is. A path with no host (a standalone server's built-in
 * list) is refused by `fetch`, which the loader reports as the picture's absence.
 */
export function createFetchAssetViewIO({
  fetchImpl = fetch,
  resolveUrl = async (url: string) => url,
  resizePicture,
}: {
  fetchImpl?: typeof fetch
  resolveUrl?: (url: string) => Promise<string | null>
  resizePicture?: (
    bytes: Uint8Array,
    mediaType: string,
  ) => Promise<{ bytes: Uint8Array; mediaType: string }>
} = {}): AssetViewIO {
  const open = async (url: string, init?: RequestInit) => {
    const resolved = await resolveUrl(url)
    if (!resolved) throw new Error('the file is not available')
    const response = await fetchImpl(resolved, init)
    if (!response.ok) throw new Error(`the file answered ${response.status}`)
    return response
  }
  return {
    range: async (url, start, end) => {
      const response = await open(url, { headers: { Range: `bytes=${start}-${end - 1}` } })
      return response.status === 206
        ? new Uint8Array(await response.arrayBuffer())
        : (await readPrefix(response, end)).subarray(start)
    },
    picture: async (url) => {
      const response = await open(url)
      const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
      if (!mediaType.startsWith('image/')) throw new Error('the file is not an image')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_PICTURE_BYTES) throw new Error('the picture is too large')
      const shown = resizePicture ? await resizePicture(bytes, mediaType) : { bytes, mediaType }
      return `data:${shown.mediaType};base64,${base64(shown.bytes)}`
    },
  }
}

/** Reads the facts of catalog items; `pictures: false` reads the surfaces only. */
export type AssetViewLoader = (
  subjects: readonly AssetViewSubject[],
  options?: { pictures?: boolean },
) => Promise<Record<string, AssetViewFacts>>

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The loader a host builds once: its surface names are cached per model for the session (a model
 * is read by two small range requests, never twice), its pictures are fetched when asked for.
 */
export function createAssetViewLoader(io: AssetViewIO): AssetViewLoader {
  const surfaces = new Map<string, Promise<string[]>>()
  const surfacesOf = (src: string) => {
    let known = surfaces.get(src)
    if (!known) {
      known = readGlbSurfaces((start, end) => io.range(src, start, end))
      surfaces.set(src, known)
      // A model that could not be read is read again next time.
      known.catch(() => surfaces.delete(src))
    }
    return known
  }
  return async (subjects, { pictures = true } = {}) => {
    const entries = await Promise.all(
      subjects.map(async (subject): Promise<[string, AssetViewFacts]> => {
        const [surface, picture] = await Promise.allSettled([
          subject.src ? surfacesOf(subject.src) : Promise.reject(new Error('it has no model')),
          pictures && subject.thumbnail
            ? io.picture(subject.thumbnail)
            : Promise.reject(new Error(pictures ? 'it has no picture' : 'not asked')),
        ])
        const missing = [
          ...(surface.status === 'rejected'
            ? [`its surfaces could not be read (${failure(surface.reason)})`]
            : []),
          ...(pictures && picture.status === 'rejected'
            ? [`its picture could not be fetched (${failure(picture.reason)})`]
            : []),
        ]
        return [
          subject.id,
          {
            ...(surface.status === 'fulfilled' ? { surfaces: surface.value } : {}),
            ...(picture.status === 'fulfilled' ? { picture: picture.value } : {}),
            ...(missing.length ? { unavailable: missing.join('; ') } : {}),
          },
        ]
      }),
    )
    return Object.fromEntries(entries)
  }
}

/** The `paint` inputs of a call, alone or in a batch, that name no role: they list the surfaces. */
function roleLessPaints(tool: string, input: unknown): { targets: unknown[] }[] {
  const calls =
    tool === 'run_batch'
      ? ((input as { calls?: { tool?: unknown; input?: unknown }[] })?.calls ?? []).flatMap(
          (call) => (call?.tool === 'paint' ? [call.input] : []),
        )
      : tool === 'paint'
        ? [input]
        : []
  return calls.flatMap((call) => {
    const { targets, role } = (call ?? {}) as { targets?: unknown; role?: unknown }
    return !role && Array.isArray(targets) ? [{ targets }] : []
  })
}

/** Whether `assetViewNeeds` looks items up in the catalog for this call, so the host must hand it over. */
export const assetViewsReadCatalog = (tool: string, input: unknown): boolean =>
  tool === 'view_assets' || roleLessPaints(tool, input).length > 0

/**
 * What a host reads before a call, as the catalog is fetched: the items `view_assets` names (with
 * their pictures), and the catalog items `paint` is asked to finish without a role, alone or in a
 * batch (only their surfaces: paint then lists them). Every subject is the catalog's entry, never
 * the scene's: a node's `asset.src` is data a person or a script writes, so it is not a place the
 * host may fetch from. An item whose id the catalog does not hold is not read.
 */
export function assetViewNeeds(
  nodes: SceneNodes,
  tool: string,
  input: unknown,
  context: Pick<AgentContext, 'catalog'>,
): { subjects: AssetViewSubject[]; pictures: boolean } {
  const catalog = context.catalog ?? []
  if (tool === 'view_assets') {
    const ids = (input as { ids?: unknown })?.ids
    const wanted = new Set(Array.isArray(ids) ? ids : [])
    return { subjects: catalog.filter((item) => wanted.has(item.id)), pictures: true }
  }
  const subjects = new Map<string, AssetViewSubject>()
  for (const { targets } of roleLessPaints(tool, input))
    for (const id of targets) {
      const node = typeof id === 'string' ? nodes[id] : undefined
      if (node?.type !== 'item' || !node.asset?.id) continue
      const entry = catalog.find((item) => item.id === node.asset.id)
      if (entry?.src) subjects.set(entry.id, { id: entry.id, src: entry.src })
    }
  return { subjects: [...subjects.values()], pictures: false }
}

const dimensionsOf = (item: AssetInput) => (item.dimensions ?? [1, 1, 1]).map(round).join(' × ')

function surfacesText(facts: AssetViewFacts | undefined) {
  if (!facts?.surfaces) return 'surfaces unknown here (its model could not be read)'
  return facts.surfaces.length
    ? `surfaces: ${facts.surfaces.join(', ')}`
    : 'no named surfaces: paint has no part of it to finish'
}

/**
 * `view_assets`: a picture of each catalog item, with its size, category and the names of its
 * paintable surfaces. The pictures and surfaces are the host's, read before the call; a host that
 * cannot fetch them answers the facts it has, and says so.
 */
export const viewAssets: AgentOperation<ViewAssetsInput> = (_nodes, { ids }, context) => {
  const catalog = context.catalog
  if (!catalog)
    refuse('no_catalog', 'This host has no item library to look in; no item has a picture here.')
  const wanted = [...new Set(ids)]
  const found = wanted.map((id) => catalog.find((item) => item.id === id))
  const unknown = wanted.filter((_, i) => !found[i])
  if (unknown.length)
    refuse(
      'unknown_asset',
      `${unknown.map((id) => `"${id}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the item library, so no picture exists. Use ids search_assets returned. Nothing was shown.`,
      { ids: unknown },
    )
  const items = (found as AssetInput[]).map((item) => {
    const facts = context.assetViews?.[item.id]
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      dimensions: item.dimensions ?? [1, 1, 1],
      surfaces: facts?.surfaces ?? null,
      picture: Boolean(facts?.picture),
      label: `${item.name} (${item.id}): ${item.category}, ${dimensionsOf(item)} m; ${surfacesText(facts)}.`,
      ...(facts?.unavailable ? { unavailable: facts.unavailable } : {}),
    }
  })
  const previews = items.flatMap(({ id, label }) => {
    const image = context.assetViews?.[id]?.picture
    return image ? [{ label, image }] : []
  })
  return {
    result: {
      items: items.map(({ label: _label, ...item }) => item),
      shown: previews.length,
      ...(previews.length < items.length && {
        note: `${items.length - previews.length} of ${items.length} items show no picture here: this host could not fetch ${items.length - previews.length === 1 ? 'it' : 'them'} (each item's unavailable says why). Sizes and surfaces are as read.`,
      }),
      previews,
    },
    keep: { viewed: items.map((item) => item.id) },
  }
}
