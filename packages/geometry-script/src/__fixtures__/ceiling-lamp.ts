export const CHEF_LAMP_SCRIPT = `
import * as THREE from 'three';
export const params = {
  radius: { default: 1.15, min: .3, max: 1.5, step: .05 },
  drop: { default: 3.5, min: .25, max: 4, step: .05 },
  tiers: { default: 3, min: 1, max: 3, step: 1 },
};
export const mount = 'ceiling';
export default function build({ params: p, THREE }) {
  const g = new THREE.Group();
  const bronze = new THREE.MeshStandardMaterial({ color: '#b79b65', metalness: .82, roughness: .24 });
  bronze.name = 'slot_champagne';
  const glow = new THREE.MeshStandardMaterial({ color: '#fff0d3', emissive: '#ffd59a', emissiveIntensity: .85, roughness: .3 });
  glow.name = 'slot_alabaster';
  const rings = new THREE.Group(); rings.name = 'part:alabaster_rings'; rings.userData.type = 'light'; g.add(rings);
  const cables = new THREE.Group(); cables.name = 'part:suspension'; cables.userData.type = 'light'; g.add(cables);
  for (let j = 0; j < p.tiers; j++) {
    const r = p.radius * (1 - j * .23), y = p.drop * (.12 + j * .24);
    for (const dy of [-.05, .05]) {
      const a = new THREE.Mesh(new THREE.TorusGeometry(r, .018, 12, 80), bronze);
      a.rotation.x = Math.PI / 2; a.position.y = y + dy; rings.add(a);
    }
    const a = new THREE.Mesh(new THREE.TorusGeometry(r, .044, 16, 80), glow);
    a.rotation.x = Math.PI / 2; a.position.y = y; rings.add(a);
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(.003, .003, p.drop - y, 6), bronze);
      c.position.set(r * Math.cos(angle), (p.drop + y) / 2, r * Math.sin(angle)); cables.add(c);
    }
    const light = new THREE.PointLight('#ffdcad', 38 / p.tiers, 12, 2);
    light.name = 'light:ring_' + j; light.position.set(0, y, 0); rings.add(light);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .025, 32), bronze);
  cap.position.y = p.drop; cables.add(cap);
  return g;
}
`
