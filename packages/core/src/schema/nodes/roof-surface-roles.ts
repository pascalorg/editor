import type { MaterialSchema as MaterialSchemaType } from '../material'

/**
 * The surfaces of a roof that take their own paint:
 * - top: the roof covering
 * - edge: the gables — the roof's own walls (and step walls)
 * - soffit: the underside of the overhang
 * - fascia: the eave and rake ends of the overhang, and the fascia boards
 * - wall: the inside of the roof
 */
export const ROOF_SURFACE_MATERIAL_ROLES = ['top', 'edge', 'soffit', 'fascia', 'wall'] as const

export type RoofSurfaceMaterialRole = (typeof ROOF_SURFACE_MATERIAL_ROLES)[number]

export type RoofSurfaceMaterialSpec = {
  material?: MaterialSchemaType
  materialPreset?: string
}

/**
 * The soffit and the fascia used to be painted with the gables (role `edge`).
 * Until they are painted on their own they keep following it, so older roofs
 * look as they did.
 */
const ROLE_FALLBACK: Partial<Record<RoofSurfaceMaterialRole, RoofSurfaceMaterialRole>> = {
  soffit: 'edge',
  fascia: 'edge',
}

export type RoofSurfaceMaterialFields = {
  topMaterial?: MaterialSchemaType
  topMaterialPreset?: string
  edgeMaterial?: MaterialSchemaType
  edgeMaterialPreset?: string
  soffitMaterial?: MaterialSchemaType
  soffitMaterialPreset?: string
  fasciaMaterial?: MaterialSchemaType
  fasciaMaterialPreset?: string
  wallMaterial?: MaterialSchemaType
  wallMaterialPreset?: string
}

/** The paint a node carries for one surface role (or the role it still follows), if any. */
export function readRoofRoleMaterial(
  node: RoofSurfaceMaterialFields,
  role: RoofSurfaceMaterialRole,
): RoofSurfaceMaterialSpec | null {
  const material = node[`${role}Material`]
  const preset = node[`${role}MaterialPreset`]
  if (material !== undefined || typeof preset === 'string') {
    return { material, materialPreset: typeof preset === 'string' ? preset : undefined }
  }
  const fallback = ROLE_FALLBACK[role]
  return fallback ? readRoofRoleMaterial(node, fallback) : null
}

/** Whether a node carries paint of its own for any surface role. */
export function hasRoofRoleMaterial(node: RoofSurfaceMaterialFields): boolean {
  return ROOF_SURFACE_MATERIAL_ROLES.some(
    (role) =>
      node[`${role}Material`] !== undefined || typeof node[`${role}MaterialPreset`] === 'string',
  )
}
