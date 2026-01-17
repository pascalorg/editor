import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sceneRegistry } from "../../hooks/scene-registry/scene-registry";
import { AnyNode, WallNode } from "../../schema";
import useScene from "../../store/use-scene";

export const WallSystem = () => {
  const { nodes, dirtyNodes, clearDirty } = useScene();

  useFrame(() => {
    if (dirtyNodes.size === 0) return;

    dirtyNodes.forEach((id) => {
      const node = nodes[id];
      if (!node) return;
      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh;

      // 1. If a window is dirty, we actually need to redraw its PARENT wall
      // if ((node.type === 'window' || node.type === 'door') && node.parentId) {
      //     updateWallGeometry(node.parentId);
      //     return;
      // }

      // 2. If the wall itself is dirty
      if (node.type === "wall" && mesh) {
        updateWallGeometry(id);
      }
      clearDirty(id); // Reset for next frame
    });
  });

  return null;
};

// Optimization: Logic moved to a vanilla function so it can be called
// by the Editor or the System without React overhead
function updateWallGeometry(wallId: string) {
  const node = useScene.getState().nodes[wallId as WallNode["id"]];
  if (!node) return;
  if (node.type !== "wall") return;

  const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh;
  if (!mesh) return;

  const childrenIds = node.children || [];
  const childrenNodes = childrenIds
    .map((childId) => useScene.getState().nodes[childId])
    .filter((n): n is AnyNode => n !== undefined);

  // Perform the Extrusion with Holes logic we discussed
  const newGeo = generateExtrudedWall(node, childrenNodes);

  mesh.geometry.dispose();
  mesh.geometry = newGeo;

  mesh.position.set(node.start[0], 0, node.start[1]);

  // Rotate mesh to look at 'end' point
  const angle = Math.atan2(
    node.end[1] - node.start[1],
    node.end[0] - node.start[0],
  );
  mesh.rotation.y = -angle;
}

export function generateExtrudedWall(
  wallNode: WallNode,
  childrenNodes: AnyNode[],
) {
  // 1. Calculate Wall Dimensions
  const start = new THREE.Vector2(wallNode.start[0], wallNode.start[1]);
  const end = new THREE.Vector2(wallNode.end[0], wallNode.end[1]);
  const length = start.distanceTo(end);
  const height = wallNode.height || 2.5;
  const thickness = wallNode.thickness || 0.2;

  // 2. Create the Main Wall Shape (a rectangle in 2D)
  // We draw this on the XY plane, where X is "along the wall" and Y is "height"
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.lineTo(length, height);
  shape.lineTo(0, height);
  shape.closePath();

  // 3. Process Openings (Holes)
  // Compute wall's transform info for converting world coords to wall-local coords
  const wallStart: [number, number] = [wallNode.start[0], wallNode.start[1]];
  const wallAngle = Math.atan2(
    wallNode.end[1] - wallNode.start[1],
    wallNode.end[0] - wallNode.start[0],
  );

  childrenNodes.forEach((child) => {
    // Only process items that are intended to be wall cutouts
    if (child.type !== "item") return;

    const childMesh = sceneRegistry.nodes.get(child.id);

    if (!childMesh) {
      return;
    }

    const cutoutMesh = childMesh.getObjectByName("cutout") as THREE.Mesh;
    if (!cutoutMesh) return;

    const holePath = createPathFromCutout(cutoutMesh, wallStart, wallAngle);
    if (holePath) {
      shape.holes.push(holePath);
    }
  });

  // 4. Extrude the Shape into 3D
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });

  // 5. Pivot Alignment
  // Center the geometry thickness so the "start/end" line is in the middle of the wall
  geometry.translate(0, 0, -thickness / 2);

  return geometry;
}

/**
 * Creates a Path from a cutout mesh geometry, transforming vertices
 * from world space to wall-local space.
 *
 * Wall-local space:
 * - Origin at wall start point
 * - X axis runs along the wall (toward end point)
 * - Y axis is height (world Y)
 */
function createPathFromCutout(
  cutoutMesh: THREE.Mesh,
  wallStart: [number, number],
  wallAngle: number,
): THREE.Path | null {
  const geometry = cutoutMesh.geometry;
  if (!geometry) return null;

  const positions = geometry.attributes.position;
  if (!positions) return null;

  // Update world matrix to get correct world positions
  cutoutMesh.updateWorldMatrix(true, false);

  // Collect unique vertices (buffer geometry has duplicates for triangulation)
  const uniquePoints: THREE.Vector2[] = [];
  const seen = new Set<string>();
  const v3 = new THREE.Vector3();

  // Precompute sin/cos for rotation
  const cosAngle = Math.cos(-wallAngle);
  const sinAngle = Math.sin(-wallAngle);

  for (let i = 0; i < positions.count; i++) {
    v3.fromBufferAttribute(positions, i);

    // Transform to world space
    v3.applyMatrix4(cutoutMesh.matrixWorld);

    // Transform from world space to wall-local space:
    // 1. Translate so wall start is at origin (in XZ plane)
    const worldX = v3.x - wallStart[0];
    const worldZ = v3.z - wallStart[1];

    // 2. Rotate around Y axis to align wall with local X axis
    // The wall shape is drawn on XY plane, so we need:
    // - localX = distance along wall
    // - localY = height (world Y)
    const localX = worldX * cosAngle - worldZ * sinAngle;
    const localY = v3.y; // Height stays the same

    // Create a key for deduplication (with small tolerance)
    const key = `${localX.toFixed(4)},${localY.toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePoints.push(new THREE.Vector2(localX, localY));
    }
  }

  if (uniquePoints.length < 3) return null;

  // Sort points in counter-clockwise order around centroid
  const centroid = new THREE.Vector2(0, 0);
  for (const p of uniquePoints) {
    centroid.add(p);
  }
  centroid.divideScalar(uniquePoints.length);

  uniquePoints.sort((a, b) => {
    const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
    const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
    return angleA - angleB;
  });

  // Create the path
  const path = new THREE.Path();
  path.moveTo(uniquePoints[0]?.x || 0, uniquePoints[0]?.y || 0);
  for (let i = 1; i < uniquePoints.length; i++) {
    path.lineTo(uniquePoints[i]?.x || 0, uniquePoints[i]?.y || 0);
  }
  path.closePath();

  return path;
}
