import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  type Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
} from 'three'

export function addBox(
  group: Group,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  material: Material,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), material)
  mesh.name = name
  mesh.position.set(...position)
  group.add(mesh)
  return mesh
}

export function sectionOutline(
  shape: 'round' | 'rect' | 'oval',
  width: number,
  height: number,
): Array<[number, number]> {
  if (shape === 'rect')
    return [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [width / 2, height / 2],
      [-width / 2, height / 2],
    ]
  if (shape === 'round')
    return Array.from({ length: 48 }, (_, i) => [
      (Math.cos((i * Math.PI) / 24) * width) / 2,
      (Math.sin((i * Math.PI) / 24) * width) / 2,
    ])
  const r = Math.min(width, height) / 2
  const offset = Math.abs(width - height) / 2
  return Array.from({ length: 50 }, (_, i) => {
    const angle = -Math.PI / 2 + (Math.PI * (i % 25)) / 24 + (i >= 25 ? Math.PI : 0)
    const u = Math.cos(angle) * r + (i < 25 ? offset : -offset)
    const v = Math.sin(angle) * r
    return width >= height ? [u, v] : [v, u]
  })
}

// Extrude a real hollow sleeve or solid closure along local X; width spans Z.
export function addProfile(
  group: Group,
  name: string,
  shape: 'round' | 'rect' | 'oval',
  width: number,
  height: number,
  start: number,
  end: number,
  material: Material,
  wall = 0,
): Mesh {
  const outline = sectionOutline(shape, width, height)
  const profile = new Shape()
  outline.forEach(([u, v], i) => {
    if (i) profile.lineTo(u, v)
    else profile.moveTo(u, v)
  })
  profile.closePath()
  if (wall > 0) {
    const hole = new Path()
    sectionOutline(shape, width - 2 * wall, height - 2 * wall)
      .reverse()
      .forEach(([u, v], i) => {
        if (i) hole.lineTo(u, v)
        else hole.moveTo(u, v)
      })
    hole.closePath()
    profile.holes.push(hole)
  }
  const geometry = new ExtrudeGeometry(profile, {
    depth: end - start,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geometry.rotateY(Math.PI / 2)
  geometry.translate(start, 0, 0)
  const mesh = new Mesh(geometry, material)
  mesh.name = name
  group.add(mesh)
  return mesh
}

export function hardwareMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: '#4b5563', metalness: 0.8, roughness: 0.3 })
}

export function addPlug(group: Group, radius: number, x: number, material: Material): void {
  addProfile(group, 'cleanout-plug', 'round', radius * 2.15, radius * 2.15, x, x + 0.012, material)
  const nut = new Mesh(new CylinderGeometry(radius * 0.5, radius * 0.5, 0.022, 6), material)
  nut.name = 'cleanout-hex-head'
  nut.rotation.z = Math.PI / 2
  nut.position.x = x + 0.023
  group.add(nut)
  for (let i = 0; i < 3; i++)
    addProfile(
      group,
      `cleanout-thread-${i}`,
      'round',
      radius * 2.2,
      radius * 2.2,
      x - 0.006 * i,
      x - 0.006 * i + 0.002,
      material,
      0.002,
    )
}
