import { Box3, type Object3D, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface InferredCatalogParams {
  dimensions: [number, number, number]
  offset: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  notes: string[]
}

export interface BoundsSnapshot {
  size: [number, number, number]
  center: [number, number, number]
  min: [number, number, number]
}

const round4 = (n: number): number => Number(n.toFixed(4))

const roundTuple3 = (tuple: [number, number, number]): [number, number, number] =>
  tuple.map(round4) as [number, number, number]

/** Format a number for catalog form inputs (meters or radians). */
export function formatCatalogFieldNumber(n: number): string {
  if (Math.abs(n) < 1e-9) return '0'
  return String(round4(n))
}

export function snapshotBoundsFromObject(object: Object3D): BoundsSnapshot {
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) {
    throw new Error('モデルに表示可能なジオメトリがありません（バウンディングボックスが空）。')
  }
  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  return {
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
    min: [box.min.x, box.min.y, box.min.z],
  }
}

/**
 * Infer catalog fields from an axis-aligned bounding box in model space.
 * Heuristics match CATALOG_ITEMS.md (mm scale, Z-up CAD rotation, floor offset).
 */
export function inferCatalogParamsFromBounds(bounds: BoundsSnapshot): InferredCatalogParams {
  const notes: string[] = []
  const [sx, sy, sz] = bounds.size
  const [cx, cy, cz] = bounds.center
  const [minX, minY, minZ] = bounds.min

  const maxDim = Math.max(sx, sy, sz)
  let scale: [number, number, number] = [1, 1, 1]

  if (maxDim > 200) {
    scale = [0.001, 0.001, 0.001]
    notes.push('バウンディングボックス最大辺 > 200。ミリ単位モデルとして scale = 0.001 を推奨')
  } else if (maxDim > 20) {
    scale = [0.01, 0.01, 0.01]
    notes.push('バウンディングボックス最大辺 > 20。センチ単位として scale = 0.01 を推奨')
  } else if (maxDim < 0.01 && maxDim > 0) {
    scale = [1000, 1000, 1000]
    notes.push('モデルが小さすぎます（< 1 cm）。1000 倍拡大を推奨。単位を確認してください')
  }

  const s = scale[0]

  let rotation: [number, number, number] = [0, 0, 0]
  let dimW = sx * s
  let dimH = sy * s
  let dimD = sz * s

  const zIsHeight = sz >= sy * 1.15 && sz >= sx * 1.15
  const xIsHeight = sx >= sy * 1.15 && sx >= sz * 1.15

  if (zIsHeight) {
    rotation = [-Math.PI / 2, 0, 0]
    dimW = sx * s
    dimH = sz * s
    dimD = sy * s
    notes.push('Z 軸が高さ（CAD でよくある）。rotation = [-π/2, 0, 0] を推奨')
  } else if (xIsHeight) {
    rotation = [0, 0, Math.PI / 2]
    dimW = sy * s
    dimH = sx * s
    dimD = sz * s
    notes.push('X 軸が高さ。rotation = [0, 0, π/2] を推奨')
  } else {
    notes.push('Y 軸が高さ（Pascal デフォルトと一致）。rotation は 0 のまま')
  }

  const dimensions = roundTuple3([dimW, dimH, dimD])

  let offset: [number, number, number] = [0, 0, 0]
  const scaledMinY = minY * s
  const scaledCenterX = cx * s
  const scaledCenterZ = cz * s

  if (zIsHeight) {
    const scaledMinZ = minZ * s
    if (Math.abs(scaledMinZ) > 0.02) {
      offset = roundTuple3([0, -scaledMinZ, 0])
      notes.push('底面が原点にないため、Z-up 向け offset で床接地を推奨（微調整可）')
    }
  } else if (Math.abs(scaledMinY) > 0.02) {
    offset = roundTuple3([-scaledCenterX, -scaledMinY, -scaledCenterZ])
    notes.push('底面が y=0 にないため、接地＋XZ 中央寄せの offset を推奨')
  } else if (Math.abs(scaledCenterX) > 0.05 || Math.abs(scaledCenterZ) > 0.05) {
    offset = roundTuple3([-scaledCenterX, 0, -scaledCenterZ])
    notes.push('XZ 平面で中央にないため、水平 offset を推奨')
  } else {
    notes.push('原点・底面は妥当。offset は 0（遠い CAD 原点は Viewer が補正）')
  }

  notes.push(`推奨 dimensions（m）≈ ${dimensions.join(' × ')}`)

  return {
    dimensions,
    offset,
    rotation: roundTuple3(rotation),
    scale: roundTuple3(scale),
    notes,
  }
}

export function inferCatalogParamsFromObject(object: Object3D): InferredCatalogParams {
  return inferCatalogParamsFromBounds(snapshotBoundsFromObject(object))
}

async function loadGltfScene(source: File | string): Promise<Object3D> {
  const loader = new GLTFLoader()

  if (typeof source === 'string') {
    return new Promise((resolve, reject) => {
      loader.load(
        source,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      )
    })
  }

  const buffer = await source.arrayBuffer()
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (gltf) => resolve(gltf.scene),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    )
  })
}

/** Load a GLB/GLTF from an uploaded file and infer catalog placement fields. */
export async function inferCatalogParamsFromGlbFile(file: File): Promise<InferredCatalogParams> {
  const lower = file.name.toLowerCase()
  if (!(lower.endsWith('.glb') || lower.endsWith('.gltf'))) {
    throw new Error('.glb または .gltf ファイルを選択してください。')
  }
  const scene = await loadGltfScene(file)
  return inferCatalogParamsFromObject(scene)
}

/** Load from URL (https or blob:). May fail on CORS for external hosts. */
export async function inferCatalogParamsFromGlbUrl(url: string): Promise<InferredCatalogParams> {
  const trimmed = url.trim()
  if (!trimmed) throw new Error('モデル URL を入力するか、先にファイルをアップロードしてください。')
  const scene = await loadGltfScene(trimmed)
  return inferCatalogParamsFromObject(scene)
}
