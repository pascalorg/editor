// Pure TypeScript — no DOM APIs, no Node.js-only imports.

// ─── Output type ──────────────────────────────────────────────────────────────

export type MergedFurniture = {
  kind: 'furniture'
  id: string
  pascalItemId: string
  /** [x, 0, z] in metres — level coordinate system, resting on floor */
  position: [number, number, number]
  /** Y-axis rotation in radians */
  rotation: number
  /** [length, width, height] in metres (from Madori XML) */
  dimensions: [number, number, number]
}

// ─── Raw input type (values already converted from cm to metres) ──────────────

export type RawFurniture3D = {
  posX: number
  posY: number    // Y-axis already negated to match Pascal orientation
  rotate: number  // radians, already negated for Y-flip
  length: number
  width: number
  height: number
  source: string  // e.g. ".../BGSdt014/BGSdt014.3ds"
  groupName: string
}

// ─── Abstract base ────────────────────────────────────────────────────────────

export abstract class FurnitureConverter {
  abstract readonly pascalItemId: string
  abstract readonly madoriModelIds: ReadonlySet<string>

  canConvert(modelId: string): boolean {
    return this.madoriModelIds.has(modelId)
  }

  convert(raw: RawFurniture3D, seq: number): MergedFurniture {
    return {
      kind:         'furniture',
      id:           `f_${String(seq).padStart(3, '0')}`,
      pascalItemId: this.pascalItemId,
      position:     [raw.posX, 0, raw.posY],
      rotation:     raw.rotate,
      dimensions:   [raw.length, raw.width, raw.height],
    }
  }
}

// ─── Concrete converters ──────────────────────────────────────────────────────

export class OfficeChairConverter extends FurnitureConverter {
  readonly pascalItemId = 'office-chair'
  readonly madoriModelIds: ReadonlySet<string> = new Set([
    'BGSdt014', // office chair with armrests ~72×68 cm
    'YZyz153',  // office chair with armrests ~72×68 cm (alt model)
    'XDxzcv05', // large armchair ~77×77 cm
    'AJdsa06',  // small conference chair ~43×49 cm
  ])
}

export class OfficeTableConverter extends FurnitureConverter {
  readonly pascalItemId = 'office-table'
  readonly madoriModelIds: ReadonlySet<string> = new Set([
    'OSkctbb01', // single workstation ~120×51 cm
    'MSsfd02',   // large work table ~164×70 cm
    'OSfgd201',  // desk ~150×64 cm
    'WEcx003',   // long conference table ~209×89 cm
    'QHdfg01',   // small square table ~50×50 cm
  ])
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class FurnitureConverterRegistry {
  private readonly converters: FurnitureConverter[] = []
  private seq = 0

  register(converter: FurnitureConverter): this {
    this.converters.push(converter)
    return this
  }

  /**
   * Extract the model folder name from a 3dMadori source path.
   * ".../c2B279.../BGSdt014/BGSdt014.3ds"  →  "BGSdt014"
   */
  static extractModelId(source: string): string {
    const parts = source.replace(/\\/g, '/').split('/')
    if (parts.length >= 2) return parts[parts.length - 2]!
    return parts[parts.length - 1]!.replace(/\.3ds$/i, '')
  }

  convert(raw: RawFurniture3D): MergedFurniture | null {
    const modelId = FurnitureConverterRegistry.extractModelId(raw.source)
    for (const c of this.converters) {
      if (c.canConvert(modelId)) {
        this.seq++
        return c.convert(raw, this.seq)
      }
    }
    return null
  }

  /** Reset sequence counter — call before each parse run. */
  resetSeq(): void {
    this.seq = 0
  }
}

// ─── Default registry (pre-registered converters) ─────────────────────────────

export const DEFAULT_FURNITURE_REGISTRY = new FurnitureConverterRegistry()
  .register(new OfficeChairConverter())
  .register(new OfficeTableConverter())
