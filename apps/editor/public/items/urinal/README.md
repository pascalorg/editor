# Urinal

A generic wall-mounted ceramic urinal for layout planning. The mesh is authored
procedurally using the elliptical shell approach from `kkg-agentic-bim`, with a
recessed bowl, rounded lip and drain cap. It represents no manufacturer or product.
The generator and its outputs are available under this repository's MIT license;
there are no downloaded meshes, textures or other external assets.

## Asset contract

- Dimensions: **0.40 m wide × 0.65 m high × 0.35 m deep**.
- glTF coordinates: X across, Y up, +Z facing out from the wall.
- Bounds: X = −0.20…0.20, Y = 0…0.65, Z = 0…0.35. The origin is at the
  bottom center of the back face, so `attachTo: 'wall-side'` needs no offset.
- Set mounting height with the existing wall-item placement / position controls.
  Dimensions describe the fixture, not its elevation above the floor.
- `slot_ceramic` and `slot_drain` expose separate paintable materials.
- `floor-plan.png` is a transparent, tightly framed top view: back at the top,
  front at the bottom. Its aspect ratio matches the 0.40 × 0.35 m footprint.
- Geometry is for visualization; it does not define supply/waste connections.

## Regenerate

From the repository root, with **Blender 4.5 LTS** installed:

```sh
blender --background --factory-startup --python scripts/generate-urinal.py
```

This writes `model.glb`, `thumbnail.png` and `floor-plan.png` into this directory.
The render lights and camera are excluded from the GLB.

## Preview locally

The catalog uses `/items/urinal/…` paths resolved through the existing asset CDN
setting. To serve the committed assets from the local editor during development:

```sh
NEXT_PUBLIC_ASSETS_CDN_URL=http://localhost:3002 bun dev
```

Open the Bathroom catalog or search for **Urinal**, select it, and place it on a
wall face. Verify both wall sides, the mounting height and the 2D floor-plan view.
