import type { WebGPURenderer } from 'three/webgpu'
import { hasDrawableGeometry } from './drawable-geometry'
import { ensureWebGPUCompatibleGeometry } from './safe-geometry'

const warnedEmptyDraw = process.env.NODE_ENV === 'production' ? null : new WeakSet<object>()
const warnedRepairedDraw = process.env.NODE_ENV === 'production' ? null : new WeakSet<object>()

/**
 * Renderer-level safety net against the empty-vertex-buffer crash.
 *
 * WebGPU rejects a draw when the geometry has no usable `position` attribute.
 * The rejection poisons the whole command encoder, so this guard must remain
 * installed even after renderer-state reset paths.
 */
export function installEmptyDrawGuard(renderer: WebGPURenderer) {
  renderer.setRenderObjectFunction(
    (
      object: any,
      scene: any,
      camera: any,
      geometry: any,
      material: any,
      group: any,
      lightsNode: any,
      clippingContext: any,
      passId: any,
    ) => {
      if (!hasDrawableGeometry(geometry, group)) {
        if (warnedEmptyDraw && !warnedEmptyDraw.has(geometry ?? object)) {
          warnedEmptyDraw.add(geometry ?? object)
          console.debug(
            '[viewer] skipped a zero-count draw (would poison the WebGPU command encoder)',
            {
              name: object?.name,
              type: object?.type,
              material: material?.name || material?.type,
              group,
              attributes: getGeometryAttributeSummary(geometry),
              indexCount: geometry?.index?.count,
              drawRange: geometry?.drawRange,
            },
          )
        }
        return
      }

      const needsAttributeRepair = hasMissingWebGPUAttributes(geometry)
      const attributeSummary = needsAttributeRepair ? getGeometryAttributeSummary(geometry) : null
      const safeGeometry = ensureWebGPUCompatibleGeometry(geometry)
      if (safeGeometry !== geometry && object?.geometry === geometry) {
        object.geometry = safeGeometry
      }
      if (needsAttributeRepair && warnedRepairedDraw && !warnedRepairedDraw.has(geometry)) {
        warnedRepairedDraw.add(geometry)
        console.debug('[viewer] repaired a geometry before WebGPU draw', {
          name: object?.name,
          type: object?.type,
          material: material?.name || material?.type,
          attributes: attributeSummary,
        })
      }

      ;(renderer as any).renderObject(
        object,
        scene,
        camera,
        safeGeometry,
        material,
        group,
        lightsNode,
        clippingContext,
        passId,
      )
    },
  )
}

function hasMissingWebGPUAttributes(geometry: any): boolean {
  const position = geometry?.getAttribute?.('position')
  if (!position) return true
  const vertexCount = position.count
  return ['normal', 'uv', 'uv1', 'uv2', 'uv3', 'tangent', 'color'].some((name) => {
    const attribute = geometry.getAttribute(name)
    return !attribute || attribute.count !== vertexCount
  })
}

function getGeometryAttributeSummary(geometry: any): Record<string, unknown> {
  const attributes = geometry?.attributes ?? {}
  return Object.fromEntries(
    Object.entries(attributes).map(([name, attribute]: [string, any]) => [
      name,
      {
        count: attribute?.count,
        itemSize: attribute?.itemSize,
      },
    ]),
  )
}
