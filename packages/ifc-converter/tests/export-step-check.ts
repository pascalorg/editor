import { expect } from 'bun:test'

// IFC4 ADD2 TC1 explicit attribute counts for every entity the writer emits.
const ATTRIBUTE_COUNTS: Record<string, number> = {
  IFCPERSON: 8,
  IFCORGANIZATION: 5,
  IFCPERSONANDORGANIZATION: 3,
  IFCAPPLICATION: 4,
  IFCOWNERHISTORY: 8,
  IFCSIUNIT: 4,
  IFCUNITASSIGNMENT: 1,
  IFCCARTESIANPOINT: 1,
  IFCDIRECTION: 1,
  IFCAXIS2PLACEMENT2D: 2,
  IFCAXIS2PLACEMENT3D: 3,
  IFCLOCALPLACEMENT: 2,
  IFCGEOMETRICREPRESENTATIONCONTEXT: 6,
  IFCGEOMETRICREPRESENTATIONSUBCONTEXT: 10,
  IFCPROJECT: 9,
  IFCSITE: 14,
  IFCBUILDING: 12,
  IFCBUILDINGSTOREY: 10,
  IFCRELAGGREGATES: 6,
  IFCRELCONTAINEDINSPATIALSTRUCTURE: 6,
  IFCPROPERTYSINGLEVALUE: 4,
  IFCPROPERTYSET: 5,
  IFCRELDEFINESBYPROPERTIES: 6,
  IFCQUANTITYLENGTH: 5,
  IFCELEMENTQUANTITY: 6,
  IFCMATERIAL: 3,
  IFCMATERIALLAYER: 7,
  IFCMATERIALLAYERSET: 3,
  IFCMATERIALLAYERSETUSAGE: 5,
  IFCRELASSOCIATESMATERIAL: 6,
  IFCPOLYLINE: 1,
  IFCSHAPEREPRESENTATION: 4,
  IFCARBITRARYCLOSEDPROFILEDEF: 3,
  IFCARBITRARYPROFILEDEFWITHVOIDS: 4,
  IFCRECTANGLEPROFILEDEF: 5,
  IFCCIRCLEPROFILEDEF: 4,
  IFCEXTRUDEDAREASOLID: 4,
  IFCPRODUCTDEFINITIONSHAPE: 3,
  IFCWALL: 9,
  IFCSLAB: 9,
  IFCDOOR: 13,
  IFCWINDOW: 13,
  IFCOPENINGELEMENT: 9,
  IFCRELVOIDSELEMENT: 6,
  IFCRELFILLSELEMENT: 6,
  IFCSPACE: 11,
  IFCCOVERING: 9,
  IFCRELCOVERSSPACES: 6,
  IFCCOLUMN: 9,
  IFCMEMBER: 9,
  IFCPLATE: 9,
  IFCBUILDINGELEMENTPROXY: 9,
  IFCFURNISHINGELEMENT: 8,
  IFCGEOGRAPHICELEMENT: 9,
  IFCROOF: 9,
  IFCSTAIR: 9,
  IFCSTAIRFLIGHT: 13,
  IFCCARTESIANPOINTLIST3D: 1,
  IFCTRIANGULATEDFACESET: 5,
  IFCCOLOURRGB: 4,
  IFCSURFACESTYLESHADING: 2,
  IFCSURFACESTYLE: 3,
  IFCSTYLEDITEM: 3,
  IFCZONE: 6,
  IFCGROUP: 5,
  IFCRELASSIGNSTOGROUP: 7,
}

/** Split a STEP argument list on its top-level commas (quote- and paren-aware). */
function topLevelArgs(args: string): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (let i = 0; i < args.length; i++) {
    const char = args[i]!
    if (quoted) {
      current += char
      if (char === "'") {
        if (args[i + 1] === "'") current += args[++i]
        else quoted = false
      }
      continue
    }
    if (char === "'") quoted = true
    else if (char === '(') depth++
    else if (char === ')') depth--
    if (char === ',' && depth === 0) {
      out.push(current)
      current = ''
    } else current += char
  }
  out.push(current)
  return out
}

type StepEntity = { id: number; type: string; args: string[]; body: string }

function parseStep(text: string): Map<number, StepEntity> {
  const entities = new Map<number, StepEntity>()
  for (const match of text.matchAll(/^#(\d+)=([A-Z0-9]+)\((.*)\);$/gm)) {
    const id = Number(match[1])
    entities.set(id, { id, type: match[2]!, args: topLevelArgs(match[3]!), body: match[3]! })
  }
  return entities
}

export function expectWellFormedStep(text: string) {
  expect(text.startsWith('ISO-10303-21;\nHEADER;')).toBe(true)
  expect(text).toContain("FILE_SCHEMA(('IFC4'));")
  expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true)
  const entities = parseStep(text)
  const dataLines = text.split('\n').filter((line) => line.startsWith('#'))
  expect(entities.size).toBe(dataLines.length)
  const guids = new Set<string>()
  for (const entity of entities.values()) {
    const expected = ATTRIBUTE_COUNTS[entity.type]
    if (expected === undefined) throw new Error(`No attribute count for ${entity.type}`)
    expect({ type: entity.type, count: entity.args.length }).toEqual({
      type: entity.type,
      count: expected,
    })
    for (const ref of entity.body.replace(/'(?:[^']|'')*'/g, "''").matchAll(/#(\d+)/g)) {
      expect(entities.has(Number(ref[1]))).toBe(true)
    }
    const first = entity.args[0]!
    if (/^'[0-3][0-9A-Za-z_$]{21}'$/.test(first)) {
      expect(guids.has(first)).toBe(false)
      guids.add(first)
    }
  }
  return entities
}
