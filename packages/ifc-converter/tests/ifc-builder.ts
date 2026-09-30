// Writes tiny IFC4 files for importer regression tests: one storey at z = 0,
// metres, elements placed in IFC plan coordinates (x east, y north).

type Vec2 = [number, number]
type Vec3 = [number, number, number]

const num = (value: number) => {
  const text = String(Math.round(value * 1e9) / 1e9)
  return text.includes('.') || text.includes('e') ? text : `${text}.`
}

export class IfcBuilder {
  private readonly lines: string[] = []
  private nextId = 100
  private nextGuid = 100
  private readonly contained: number[] = []
  private readonly spaces: number[] = []

  private add(entity: string): number {
    const id = this.nextId++
    this.lines.push(`#${id}=${entity};`)
    return id
  }

  private guid() {
    return `'${String(this.nextGuid++).padStart(22, '0')}'`
  }

  private point(values: number[]) {
    return this.add(`IFCCARTESIANPOINT((${values.map(num).join(',')}))`)
  }

  private direction(values: number[]) {
    return this.add(`IFCDIRECTION((${values.map(num).join(',')}))`)
  }

  /** A placement relative to the storey: origin, local x and local z. */
  private placement(origin: Vec3, xAxis: Vec3 = [1, 0, 0], zAxis: Vec3 = [0, 0, 1]) {
    const axis2 = this.add(
      `IFCAXIS2PLACEMENT3D(#${this.point(origin)},#${this.direction(zAxis)},#${this.direction(xAxis)})`,
    )
    return this.add(`IFCLOCALPLACEMENT(#32,#${axis2})`)
  }

  private polyline(points: Vec2[], closed: boolean) {
    const ids = points.map((point) => this.point(point))
    if (closed) ids.push(ids[0]!)
    return this.add(`IFCPOLYLINE((${ids.map((id) => `#${id}`).join(',')}))`)
  }

  private profile(outline: Vec2[], holes: Vec2[][] = []) {
    const outer = this.polyline(outline, true)
    if (!holes.length) return this.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${outer})`)
    const inner = holes.map((hole) => `#${this.polyline(hole, true)}`).join(',')
    return this.add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,#${outer},(${inner}))`)
  }

  private body(outline: Vec2[], depth: number, options: { holes?: Vec2[][]; down?: boolean } = {}) {
    const profile = this.profile(outline, options.holes)
    const direction = this.direction([0, 0, options.down ? -1 : 1])
    const solid = this.add(`IFCEXTRUDEDAREASOLID(#${profile},#6,#${direction},${num(depth)})`)
    return this.add(`IFCSHAPEREPRESENTATION(#8,'Body','SweptSolid',(#${solid}))`)
  }

  private shape(...representations: number[]) {
    return this.add(
      `IFCPRODUCTDEFINITIONSHAPE($,$,(${representations.map((id) => `#${id}`).join(',')}))`,
    )
  }

  /**
   * A wall along start → end whose body spans [low, high] on its local Y
   * (left of the axis). A layer set usage records that span when asked.
   */
  wall(options: {
    start: Vec2
    end: Vec2
    low: number
    high: number
    height?: number
    layerUsage?: boolean
  }) {
    const dx = options.end[0] - options.start[0]
    const dy = options.end[1] - options.start[1]
    const length = Math.hypot(dx, dy)
    const placement = this.placement(
      [options.start[0], options.start[1], 0],
      [dx / length, dy / length, 0],
    )
    const axis = this.add(
      `IFCSHAPEREPRESENTATION(#8,'Axis','Curve2D',(#${this.polyline(
        [
          [0, 0],
          [length, 0],
        ],
        false,
      )}))`,
    )
    const body = this.body(
      [
        [0, options.low],
        [length, options.low],
        [length, options.high],
        [0, options.high],
      ],
      options.height ?? 2.7,
    )
    const wall = this.add(
      `IFCWALL(${this.guid()},$,'Wall',$,$,#${placement},#${this.shape(axis, body)},$,.STANDARD.)`,
    )
    this.contained.push(wall)
    if (options.layerUsage) {
      const material = this.add(`IFCMATERIAL('Block',$,$)`)
      const layer = this.add(
        `IFCMATERIALLAYER(#${material},${num(options.high - options.low)},$,$,$,$,$)`,
      )
      const set = this.add(`IFCMATERIALLAYERSET((#${layer}),'Wall',$)`)
      const usage = this.add(
        `IFCMATERIALLAYERSETUSAGE(#${set},.AXIS2.,.POSITIVE.,${num(options.low)},$)`,
      )
      this.add(`IFCRELASSOCIATESMATERIAL(${this.guid()},$,$,$,(#${wall}),#${usage})`)
    }
    return { wall, placement }
  }

  /** A door centred `station` metres along the wall from its start. */
  door(host: { wall: number; placement: number }, station: number, width = 0.9, height = 2.1) {
    const axis2 = this.add(
      `IFCAXIS2PLACEMENT3D(#${this.point([station, 0, 0])},#${this.direction([0, 0, 1])},#${this.direction([1, 0, 0])})`,
    )
    const placement = this.add(`IFCLOCALPLACEMENT(#${host.placement},#${axis2})`)
    const body = this.body(
      [
        [-width / 2, -0.5],
        [width / 2, -0.5],
        [width / 2, 0.5],
        [-width / 2, 0.5],
      ],
      height,
    )
    const opening = this.add(
      `IFCOPENINGELEMENT(${this.guid()},$,'Opening',$,$,#${placement},#${this.shape(body)},$,.OPENING.)`,
    )
    this.add(`IFCRELVOIDSELEMENT(${this.guid()},$,$,$,#${host.wall},#${opening})`)
    const door = this.add(
      `IFCDOOR(${this.guid()},$,'Door',$,$,#${placement},$,$,${num(height)},${num(width)},.DOOR.,.SINGLE_SWING_LEFT.,$)`,
    )
    this.add(`IFCRELFILLSELEMENT(${this.guid()},$,$,$,#${opening},#${door})`)
    this.contained.push(door)
    return door
  }

  space(name: string, outline: Vec2[], height = 2.7) {
    const placement = this.placement([0, 0, 0])
    const space = this.add(
      `IFCSPACE(${this.guid()},$,'${name}',$,$,#${placement},#${this.shape(this.body(outline, height))},'${name}',.ELEMENT.,.INTERNAL.,$)`,
    )
    this.spaces.push(space)
    return space
  }

  /** A floor slab extruded down from `top`. */
  slab(name: string, outline: Vec2[], top: number, thickness: number, holes: Vec2[][] = []) {
    const placement = this.placement([0, 0, top])
    const slab = this.add(
      `IFCSLAB(${this.guid()},$,'${name}',$,$,#${placement},#${this.shape(
        this.body(outline, thickness, { holes, down: true }),
      )},$,.FLOOR.)`,
    )
    this.contained.push(slab)
    return slab
  }

  /** A covering whose underside is at `bottom`, optionally tilted about IFC x. */
  covering(
    type: 'CEILING' | 'FLOORING',
    outline: Vec2[],
    bottom: number,
    thickness: number,
    options: { holes?: Vec2[][]; tiltDegrees?: number } = {},
  ) {
    const tilt = ((options.tiltDegrees ?? 0) * Math.PI) / 180
    const placement = this.placement(
      [0, 0, bottom],
      [1, 0, 0],
      [0, -Math.sin(tilt), Math.cos(tilt)],
    )
    const covering = this.add(
      `IFCCOVERING(${this.guid()},$,'${type === 'CEILING' ? 'Ceiling' : 'Flooring'}',$,$,#${placement},#${this.shape(
        this.body(outline, thickness, { holes: options.holes }),
      )},$,.${type}.)`,
    )
    this.contained.push(covering)
    return covering
  }

  /** An opening cut through `host` over `outline`, from below `bottom` up. */
  voidThrough(host: number, outline: Vec2[], bottom: number, depth: number) {
    const placement = this.placement([0, 0, bottom])
    const opening = this.add(
      `IFCOPENINGELEMENT(${this.guid()},$,'Opening',$,$,#${placement},#${this.shape(this.body(outline, depth))},$,.OPENING.)`,
    )
    this.add(`IFCRELVOIDSELEMENT(${this.guid()},$,$,$,#${host},#${opening})`)
    return opening
  }

  furnishing(at: Vec2, size = 0.5) {
    const placement = this.placement([at[0], at[1], 0])
    const half = size / 2
    const furnishing = this.add(
      `IFCFURNISHINGELEMENT(${this.guid()},$,'Chair',$,$,#${placement},#${this.shape(
        this.body(
          [
            [-half, -half],
            [half, -half],
            [half, half],
            [-half, half],
          ],
          size,
        ),
      )},$)`,
    )
    this.contained.push(furnishing)
    return furnishing
  }

  /** The property set a Pascal export writes: the node's id and type. */
  pascalIdentity(element: number, nodeId: string, nodeType: string) {
    const id = this.add(`IFCPROPERTYSINGLEVALUE('NodeId',$,IFCIDENTIFIER('${nodeId}'),$)`)
    const type = this.add(`IFCPROPERTYSINGLEVALUE('NodeType',$,IFCLABEL('${nodeType}'),$)`)
    const pset = this.add(`IFCPROPERTYSET(${this.guid()},$,'Pascal',$,(#${id},#${type}))`)
    this.add(`IFCRELDEFINESBYPROPERTIES(${this.guid()},$,$,$,(#${element}),#${pset})`)
  }

  toString() {
    const refs = (ids: number[]) => ids.map((id) => `#${id}`).join(',')
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('Importer regression fixture'),'2;1');",
      "FILE_NAME('fixture.ifc','2026-09-30T00:00:00',('Pascal'),('Pascal'),'','','');",
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      "#1=IFCPROJECT('0000000000000000000001',$,'Fixture',$,$,$,$,(#8),#9);",
      '#2=IFCCARTESIANPOINT((0.,0.,0.));',
      '#3=IFCDIRECTION((0.,0.,1.));',
      '#4=IFCDIRECTION((1.,0.,0.));',
      '#6=IFCAXIS2PLACEMENT3D(#2,#3,#4);',
      "#8=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#6,$);",
      '#9=IFCUNITASSIGNMENT((#10));',
      '#10=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);',
      '#13=IFCLOCALPLACEMENT($,#6);',
      "#14=IFCSITE('0000000000000000000002',$,'Site',$,$,#13,$,$,.ELEMENT.,$,$,$,$,$);",
      "#15=IFCRELAGGREGATES('0000000000000000000003',$,$,$,#1,(#14));",
      '#22=IFCLOCALPLACEMENT(#13,#6);',
      "#23=IFCBUILDING('0000000000000000000004',$,'Building',$,$,#22,$,$,.ELEMENT.,$,$,$);",
      "#24=IFCRELAGGREGATES('0000000000000000000005',$,$,$,#14,(#23));",
      '#32=IFCLOCALPLACEMENT(#22,#6);',
      "#33=IFCBUILDINGSTOREY('0000000000000000000006',$,'Ground',$,$,#32,$,$,.ELEMENT.,0.);",
      "#34=IFCRELAGGREGATES('0000000000000000000007',$,$,$,#23,(#33));",
      ...this.lines,
      ...(this.contained.length
        ? [
            `#${this.nextId++}=IFCRELCONTAINEDINSPATIALSTRUCTURE(${this.guid()},$,$,$,(${refs(this.contained)}),#33);`,
          ]
        : []),
      ...(this.spaces.length
        ? [`#${this.nextId++}=IFCRELAGGREGATES(${this.guid()},$,$,$,#33,(${refs(this.spaces)}));`]
        : []),
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n')
  }
}

/** Four centred walls on the rectangle [0, width] × [0, depth] (centrelines). */
export function boxWalls(builder: IfcBuilder, width: number, depth: number, thickness = 0.2) {
  const corners: Vec2[] = [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ]
  return corners.map((start, index) =>
    builder.wall({
      start,
      end: corners[(index + 1) % 4]!,
      low: -thickness / 2,
      high: thickness / 2,
    }),
  )
}

export const rectangle = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]
