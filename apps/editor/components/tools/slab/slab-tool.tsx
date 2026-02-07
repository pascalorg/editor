import { emitter, type GridEvent, useScene, SlabNode, type LevelNode, sceneRegistry } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BufferGeometry, DoubleSide, type Line, type Mesh, Plane, Raycaster, Shape, Vector3 } from "three";
import useEditor from "@/store/use-editor";

const Y_OFFSET = 0.02; // Small offset above floor level
const UP = new Vector3(0, 1, 0);

/**
 * Snaps a point to the nearest axis-aligned or 45-degree diagonal from the last point
 */
const calculateSnapPoint = (
  lastPoint: [number, number],
  currentPoint: [number, number]
): [number, number] => {
  const [x1, y1] = lastPoint;
  const [x, y] = currentPoint;

  const dx = x - x1;
  const dy = y - y1;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Calculate distances to horizontal, vertical, and diagonal lines
  const horizontalDist = absDy;
  const verticalDist = absDx;
  const diagonalDist = Math.abs(absDx - absDy);

  // Find the minimum distance to determine which axis to snap to
  const minDist = Math.min(horizontalDist, verticalDist, diagonalDist);

  if (minDist === diagonalDist) {
    // Snap to 45° diagonal
    const diagonalLength = Math.min(absDx, absDy);
    return [
      x1 + Math.sign(dx) * diagonalLength,
      y1 + Math.sign(dy) * diagonalLength,
    ];
  } else if (minDist === horizontalDist) {
    // Snap to horizontal
    return [x, y1];
  } else {
    // Snap to vertical
    return [x1, y];
  }
};

/**
 * Creates a slab with the given polygon points and returns its ID
 */
const commitSlabDrawing = (
  levelId: LevelNode["id"],
  points: Array<[number, number]>
): string => {
  const { createNode, nodes } = useScene.getState();

  // Count existing slabs for naming
  const slabCount = Object.values(nodes).filter((n) => n.type === "slab").length;
  const name = `Slab ${slabCount + 1}`;

  const slab = SlabNode.parse({
    name,
    polygon: points,
  });

  createNode(slab, levelId);
  return slab.id;
};

type PreviewState = {
  points: Array<[number, number]>;
  cursorPoint: [number, number] | null;
  levelY: number;
};

// Helper to validate point values (no NaN or Infinity)
const isValidPoint = (
  pt: [number, number] | null | undefined
): pt is [number, number] => {
  if (!pt) return false;
  return Number.isFinite(pt[0]) && Number.isFinite(pt[1]);
};

export const SlabTool: React.FC = () => {
  const cursorRef = useRef<Mesh>(null);
  const mainLineRef = useRef<Line>(null!);
  const closingLineRef = useRef<Line>(null!);
  const pointsRef = useRef<Array<[number, number]>>([]);
  const levelYRef = useRef(0);
  const cursorPositionRef = useRef<[number, number]>([0, 0]);
  const lastDisplayRef = useRef<{ x: number; z: number } | null>(null);
  const currentLevelId = useViewer((state) => state.selection.levelId);
  const setSelection = useViewer((state) => state.setSelection);
  const setTool = useEditor((state) => state.setTool);

  // Reusable objects for raycasting (created once, avoid per-frame allocations)
  const raycaster = useMemo(() => new Raycaster(), []);
  const levelPlane = useMemo(() => new Plane(UP, 0), []);
  const hitPoint = useMemo(() => new Vector3(), []);

  // Preview state for reactive rendering (for shape and point markers)
  const [preview, setPreview] = useState<PreviewState>({
    points: [],
    cursorPoint: null,
    levelY: 0,
  });

  // Resolve the current level's Y position from scene registry or node data
  const getLevelY = (): number => {
    if (!currentLevelId) return 0;
    const levelMesh = sceneRegistry.nodes.get(currentLevelId);
    if (levelMesh) return levelMesh.position.y;
    const levelNode = useScene.getState().nodes[currentLevelId];
    if (levelNode && 'level' in levelNode) {
      const levelMode = useViewer.getState().levelMode;
      const LEVEL_HEIGHT = 2.5;
      const EXPLODED_GAP = 5;
      return ((levelNode as any).level || 0) * (LEVEL_HEIGHT + (levelMode === 'exploded' ? EXPLODED_GAP : 0));
    }
    return 0;
  };

  // Imperatively update line geometries (called from useFrame)
  const updateLines = () => {
    if (!mainLineRef.current || !closingLineRef.current) return;

    const points = pointsRef.current;
    const cursorPosition = cursorPositionRef.current;
    const y = levelYRef.current + Y_OFFSET;

    if (points.length === 0) {
      mainLineRef.current.visible = false;
      closingLineRef.current.visible = false;
      return;
    }

    // Build main line points
    const linePoints: Vector3[] = points.map(
      ([x, z]) => new Vector3(x, y, z)
    );

    // Add cursor point
    const lastPoint = points[points.length - 1];
    if (lastPoint) {
      const snapped = calculateSnapPoint(lastPoint, cursorPosition);
      if (isValidPoint(snapped)) {
        linePoints.push(new Vector3(snapped[0], y, snapped[1]));
      }
    }

    // Update main line geometry
    if (linePoints.length >= 2) {
      mainLineRef.current.geometry.dispose();
      mainLineRef.current.geometry = new BufferGeometry().setFromPoints(linePoints);
      mainLineRef.current.visible = true;
    } else {
      mainLineRef.current.visible = false;
    }

    // Update closing line (from cursor back to first point)
    const firstPoint = points[0];
    if (points.length >= 2 && lastPoint && isValidPoint(firstPoint)) {
      const snapped = calculateSnapPoint(lastPoint, cursorPosition);
      if (isValidPoint(snapped)) {
        const closingPoints = [
          new Vector3(snapped[0], y, snapped[1]),
          new Vector3(firstPoint[0], y, firstPoint[1]),
        ];
        closingLineRef.current.geometry.dispose();
        closingLineRef.current.geometry = new BufferGeometry().setFromPoints(closingPoints);
        closingLineRef.current.visible = true;
      }
    } else {
      closingLineRef.current.visible = false;
    }
  };

  // Per-frame cursor positioning via direct raycasting onto the level plane.
  // This bypasses R3F's event propagation (grid:move), ensuring the cursor
  // always tracks the pointer regardless of tool activation/deactivation state.
  useFrame((state) => {
    if (!cursorRef.current) return;

    // Sync level Y from scene registry each frame
    levelYRef.current = getLevelY();

    // Raycast from camera through pointer onto horizontal plane at level Y
    raycaster.setFromCamera(state.pointer, state.camera);
    levelPlane.constant = -levelYRef.current;
    const hit = raycaster.ray.intersectPlane(levelPlane, hitPoint);
    if (!hit) return;

    // Snap to 0.5m grid
    const gridX = Math.round(hit.x * 2) / 2;
    const gridZ = Math.round(hit.z * 2) / 2;
    cursorPositionRef.current = [gridX, gridZ];

    // Apply axis snapping from last placed point
    const lastPoint = pointsRef.current[pointsRef.current.length - 1];
    let displayPoint: [number, number];
    if (lastPoint) {
      displayPoint = calculateSnapPoint(lastPoint, cursorPositionRef.current);
    } else {
      displayPoint = [gridX, gridZ];
    }

    // Update cursor mesh position imperatively
    cursorRef.current.position.set(displayPoint[0], levelYRef.current, displayPoint[1]);

    // Update line geometries imperatively
    updateLines();

    // Only trigger React state update when snapped display position changes
    if (
      !lastDisplayRef.current ||
      lastDisplayRef.current.x !== displayPoint[0] ||
      lastDisplayRef.current.z !== displayPoint[1]
    ) {
      lastDisplayRef.current = { x: displayPoint[0], z: displayPoint[1] };
      setPreview({
        points: [...pointsRef.current],
        cursorPoint: displayPoint,
        levelY: levelYRef.current,
      });
    }
  });

  // Click and double-click handlers for point placement
  useEffect(() => {
    if (!currentLevelId) return;

    // Initialize line geometries
    if (mainLineRef.current) {
      mainLineRef.current.geometry = new BufferGeometry();
    }
    if (closingLineRef.current) {
      closingLineRef.current.geometry = new BufferGeometry();
    }

    // Reset state on level change
    pointsRef.current = [];
    lastDisplayRef.current = null;
    setPreview({ points: [], cursorPoint: null, levelY: getLevelY() });

    const onGridClick = (_event: GridEvent) => {
      if (!currentLevelId) return;

      // Use the cursor position tracked by useFrame (matches what user sees)
      let clickPoint: [number, number] = [...cursorPositionRef.current];

      // Snap to axis from last point
      const lastPoint = pointsRef.current[pointsRef.current.length - 1];
      if (lastPoint) {
        clickPoint = calculateSnapPoint(lastPoint, clickPoint);
      }

      // Check if clicking on the first point to close the shape
      const firstPoint = pointsRef.current[0];
      if (
        pointsRef.current.length >= 3 &&
        firstPoint &&
        Math.abs(clickPoint[0] - firstPoint[0]) < 0.25 &&
        Math.abs(clickPoint[1] - firstPoint[1]) < 0.25
      ) {
        // Create the slab and select it
        const slabId = commitSlabDrawing(currentLevelId, pointsRef.current);
        setSelection({ selectedIds: [slabId] });

        // Reset state
        pointsRef.current = [];
        lastDisplayRef.current = null;
        setPreview({ points: [], cursorPoint: null, levelY: levelYRef.current });
        if (mainLineRef.current) mainLineRef.current.visible = false;
        if (closingLineRef.current) closingLineRef.current.visible = false;
      } else {
        // Add point to polygon
        pointsRef.current = [...pointsRef.current, clickPoint];
        lastDisplayRef.current = null; // Force preview update on next frame
      }
    };

    const onGridDoubleClick = (_event: GridEvent) => {
      if (!currentLevelId) return;

      // Need at least 3 points to form a polygon
      if (pointsRef.current.length >= 3) {
        // Create the slab and select it
        const slabId = commitSlabDrawing(currentLevelId, pointsRef.current);
        setSelection({ selectedIds: [slabId] });

        // Reset state
        pointsRef.current = [];
        lastDisplayRef.current = null;
        setPreview({ points: [], cursorPoint: null, levelY: levelYRef.current });
        if (mainLineRef.current) mainLineRef.current.visible = false;
        if (closingLineRef.current) closingLineRef.current.visible = false;
      }
    };

    emitter.on("grid:click", onGridClick);
    emitter.on("grid:double-click", onGridDoubleClick);

    return () => {
      emitter.off("grid:click", onGridClick);
      emitter.off("grid:double-click", onGridDoubleClick);

      // Reset state on unmount
      pointsRef.current = [];
    };
  }, [currentLevelId, setSelection]);

  const { points, cursorPoint, levelY } = preview;

  // Create preview shape when we have 3+ points
  const previewShape = useMemo(() => {
    if (points.length < 3) return null;

    const allPoints = [...points];
    if (isValidPoint(cursorPoint)) {
      allPoints.push(cursorPoint);
    }

    // THREE.Shape is in X-Y plane. After rotation of -PI/2 around X:
    // - Shape X -> World X
    // - Shape Y -> World -Z (so we negate Z to get correct orientation)
    const firstPt = allPoints[0];
    if (!isValidPoint(firstPt)) return null;

    const shape = new Shape();
    shape.moveTo(firstPt[0], -firstPt[1]);

    for (let i = 1; i < allPoints.length; i++) {
      const pt = allPoints[i];
      if (isValidPoint(pt)) {
        shape.lineTo(pt[0], -pt[1]);
      }
    }
    shape.closePath();

    return shape;
  }, [points, cursorPoint]);

  return (
    <group>
      {/* Cursor */}
      <mesh ref={cursorRef}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial
          color="#a3a3a3"
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      {/* Preview fill */}
      {previewShape && (
        <mesh
          frustumCulled={false}
          position={[0, levelY + Y_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#a3a3a3"
            depthTest={false}
            opacity={0.3}
            side={DoubleSide}
            transparent
          />
        </mesh>
      )}

      {/* Main line - uses native line element with TSL-compatible material */}
      {/* @ts-ignore */}
      <line ref={mainLineRef} frustumCulled={false} renderOrder={1} visible={false}>
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#737373"
          linewidth={3}
          depthTest={false}
          depthWrite={false}
        />
      </line>

      {/* Closing line - uses native line element with TSL-compatible material */}
      {/* @ts-ignore */}
      <line ref={closingLineRef} frustumCulled={false} renderOrder={1} visible={false}>
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#737373"
          linewidth={2}
          depthTest={false}
          depthWrite={false}
          opacity={0.5}
          transparent
        />
      </line>

      {/* Point markers */}
      {points.map(([x, z], index) =>
        isValidPoint([x, z]) ? (
          <mesh key={index} position={[x, levelY + Y_OFFSET + 0.01, z]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshBasicMaterial
              color={index === 0 ? "#22c55e" : "#a3a3a3"}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        ) : null
      )}
    </group>
  );
};
