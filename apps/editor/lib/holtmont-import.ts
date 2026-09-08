/**
 * Normalización de las escenas que Holtmont manda por `HOLTMONT_3D_IMPORT`.
 *
 * Por qué existe este módulo
 * --------------------------
 * `useScene.setScene()` no valida: guarda tal cual el objeto que recibe. Cuando
 * el JSON del agente traía un campo con la forma equivocada — una puerta con
 * `position: 0.5` en lugar de `position: [x, y, z]`, por ejemplo — nada fallaba
 * en el import: el error aparecía después, dentro del `useFrame` de
 * `DoorSystem` (`segments.reduce` sobre `undefined`), que mata el bucle de
 * render de react-three-fiber. Resultado: el lienzo se queda negro, sin
 * mensaje, sin traza visible para quien lo está usando.
 *
 * Aquí cada nodo pasa por el esquema real del editor (`AnyNode`) antes de
 * llegar al store. Eso hace dos cosas:
 *
 *   1. Rellena los valores por defecto (`segments`, `frameThickness`,
 *      `stepCount`…) que `setScene` no rellena.
 *   2. Convierte un nodo mal formado en un descarte anotado, no en una pantalla
 *      negra: el import sigue con el resto y el padre recibe el detalle.
 */

import { AnyNode } from '@pascal-app/core/schema'

/** Lo mínimo del catálogo del editor que necesita la resolución de muebles. */
export type CatalogAsset = {
  id: string
  name: string
  [key: string]: unknown
}

export type DroppedNode = {
  id: string
  type: string
  reason: string
}

export type HoltmontImportResult = {
  nodes: Record<string, AnyNode>
  rootNodeIds: string[]
  collections: Record<string, unknown>
  dropped: DroppedNode[]
}

export class HoltmontImportError extends Error {}

/**
 * Sinónimos entre el vocabulario del agente (español/inglés, singular) y los
 * `id` del catálogo del editor. Vive aquí y no en el generador de Python
 * porque el catálogo es del editor: si mañana cambia un `id`, cambia en un
 * único sitio.
 */
const ASSET_SYNONYMS: Record<string, string[]> = {
  'double-bed': ['bed', 'cama', 'cama matrimonial', 'double bed', 'matrimonial'],
  'single-bed': ['single bed', 'cama individual', 'cama sencilla'],
  bunkbed: ['bunk bed', 'litera'],
  sofa: ['sofa', 'sofá', 'couch'],
  'lounge-chair': ['armchair', 'sillon', 'sillón'],
  'dining-table': ['table', 'mesa', 'dining table', 'mesa de comedor'],
  'coffee-table': ['coffee table', 'mesa de centro'],
  'office-table': ['desk', 'escritorio', 'office table'],
  'dining-chair': ['chair', 'silla', 'dining chair'],
  'office-chair': ['office chair', 'silla de oficina'],
  stool: ['stool', 'banco', 'taburete'],
  closet: ['wardrobe', 'closet', 'armario', 'ropero'],
  dresser: ['dresser', 'comoda', 'cómoda'],
  toilet: ['toilet', 'wc', 'inodoro', 'retrete'],
  'bathroom-sink': ['sink', 'lavabo', 'lavamanos', 'bathroom sink'],
  bathtub: ['bathtub', 'tina', 'bañera', 'banera'],
  'shower-square': ['shower', 'regadera', 'ducha'],
  fridge: ['refrigerator', 'fridge', 'refrigerador', 'nevera'],
  stove: ['stove', 'estufa', 'cocina'],
  microwave: ['microwave', 'microondas'],
  'washing-machine': ['washing machine', 'lavadora'],
  'kitchen-counter': ['kitchen counter', 'barra', 'cubierta de cocina'],
  bookshelf: ['bookshelf', 'librero', 'estanteria', 'estantería'],
  television: ['tv', 'television', 'televisión', 'televisor'],
  'tv-stand': ['tv stand', 'mueble de tv'],
  'indoor-plant': ['plant', 'planta', 'maceta'],
  'rectangular-carpet': ['carpet', 'rug', 'alfombra', 'tapete'],
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Índice `término normalizado → id de catálogo`, construido una vez por catálogo. */
function buildAssetIndex(catalog: readonly CatalogAsset[]): Map<string, CatalogAsset> {
  const byId = new Map<string, CatalogAsset>()
  for (const asset of catalog) byId.set(asset.id, asset)

  const index = new Map<string, CatalogAsset>()
  const remember = (term: string, asset: CatalogAsset) => {
    const key = normalizeKey(term)
    if (key && !index.has(key)) index.set(key, asset)
  }

  // Primero los sinónimos explícitos: ganan al nombre genérico del catálogo.
  for (const [assetId, terms] of Object.entries(ASSET_SYNONYMS)) {
    const asset = byId.get(assetId)
    if (!asset) continue
    for (const term of terms) remember(term, asset)
  }

  for (const asset of catalog) {
    remember(asset.id, asset)
    remember(asset.name, asset)
  }

  return index
}

/**
 * Un `item` sin `asset` no es renderizable: el `ItemRenderer` lee
 * `node.asset.src` para cargar el GLB. El generador manda solo el nombre en
 * `metadata.holtmontAsset` y aquí se resuelve contra el catálogo real.
 */
function resolveItemAsset(
  node: Record<string, unknown>,
  index: Map<string, CatalogAsset>,
): Record<string, unknown> | null {
  if (node.asset && typeof node.asset === 'object') return node

  const metadata = (node.metadata ?? {}) as Record<string, unknown>
  const wanted = metadata.holtmontAsset
  if (typeof wanted !== 'string') return null

  const key = normalizeKey(wanted)
  const asset = index.get(key)
  if (!asset) return null

  return { ...node, asset }
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Valida y completa la escena entrante.
 *
 * Lanza `HoltmontImportError` solo cuando el mensaje no es una escena en
 * absoluto (sin `nodes`, o sin ningún nodo que sobreviva). Un lienzo negro es
 * peor que un error: si no hay nada que dibujar, quien llama debe enterarse y
 * dejar la escena anterior en pie.
 */
export function normalizeHoltmontScene(
  projectData: unknown,
  catalog: readonly CatalogAsset[] = [],
): HoltmontImportResult {
  const data = asPlainObject(projectData)
  if (!data) throw new HoltmontImportError('projectData no es un objeto')

  const rawNodes = asPlainObject(data.nodes)
  if (!rawNodes) throw new HoltmontImportError('projectData.nodes ausente o no es un objeto')

  const assetIndex = buildAssetIndex(catalog)
  const dropped: DroppedNode[] = []

  // Primera pasada: resolver los muebles contra el catálogo. Un mueble sin
  // modelo se descarta aquí, antes de validar, para que su id no quede colgando
  // en los `children` de su nivel: `LevelNode` valida esa lista, así que un id
  // muerto tumbaría el nivel entero —y con él todos sus muros—.
  const candidates: Record<string, Record<string, unknown>> = {}
  for (const [id, rawValue] of Object.entries(rawNodes)) {
    const raw = asPlainObject(rawValue)
    if (!raw) {
      dropped.push({ id, type: 'desconocido', reason: 'el nodo no es un objeto' })
      continue
    }
    const type = typeof raw.type === 'string' ? raw.type : 'desconocido'

    if (type === 'item') {
      const conAsset = resolveItemAsset({ ...raw, id }, assetIndex)
      if (!conAsset) {
        const metadata = asPlainObject(raw.metadata) ?? {}
        dropped.push({
          id,
          type,
          reason: `sin asset en el catálogo para "${String(metadata.holtmontAsset ?? '')}"`,
        })
        continue
      }
      candidates[id] = conAsset
      continue
    }

    candidates[id] = { ...raw, id }
  }

  pruneChildReferences(candidates)

  const nodes: Record<string, AnyNode> = {}
  for (const [id, candidate] of Object.entries(candidates)) {
    const type = typeof candidate.type === 'string' ? candidate.type : 'desconocido'
    const parsed = AnyNode.safeParse(candidate)
    if (!parsed.success) {
      dropped.push({ id, type, reason: formatZodIssues(parsed.error) })
      continue
    }
    nodes[id] = parsed.data as AnyNode
  }

  pruneDanglingReferences(nodes, dropped)

  const rootNodeIds = (Array.isArray(data.rootNodeIds) ? data.rootNodeIds : [])
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => id in nodes)

  if (Object.keys(nodes).length === 0) {
    throw new HoltmontImportError(
      `ningún nodo de la escena pasó la validación (${dropped.length} descartados)`,
    )
  }
  if (rootNodeIds.length === 0) {
    throw new HoltmontImportError('rootNodeIds vacío o apunta a nodos que no existen')
  }

  return {
    nodes,
    rootNodeIds,
    collections: asPlainObject(data.collections) ?? {},
    dropped,
  }
}

function formatZodIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('; ')
}

/**
 * Quita referencias a nodos que no sobrevivieron y, en cascada, los nodos cuyo
 * padre desapareció. `setScene` ya borra huérfanos, pero solo un nivel y sin
 * limpiar los `children` del padre: un id colgado en `children` termina en
 * `NodeRenderer` con `nodes[id] === undefined`, que es un render vacío
 * silencioso.
 */
function pruneChildReferences(nodes: Record<string, { children?: unknown }>): void {
  for (const node of Object.values(nodes)) {
    if (!Array.isArray(node.children)) continue
    node.children = node.children.filter((child) =>
      typeof child === 'string' ? child in nodes : true,
    )
  }
}

function pruneDanglingReferences(nodes: Record<string, AnyNode>, dropped: DroppedNode[]): void {
  let changed = true
  while (changed) {
    changed = false

    for (const [id, node] of Object.entries(nodes)) {
      const parentId = (node as { parentId?: string | null }).parentId
      if (parentId && !(parentId in nodes)) {
        delete nodes[id]
        dropped.push({ id, type: node.type, reason: `su padre ${parentId} fue descartado` })
        changed = true
      }
    }

    for (const node of Object.values(nodes)) {
      const children = (node as { children?: unknown }).children
      if (!Array.isArray(children)) continue
      const kept = children.filter((child) => (typeof child === 'string' ? child in nodes : true))
      if (kept.length !== children.length) {
        ;(node as { children: unknown[] }).children = kept
        changed = true
      }
    }
  }
}
