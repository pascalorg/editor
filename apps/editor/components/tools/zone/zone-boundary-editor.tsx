import { useScene, type ZoneNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Mesh,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { useThree } from "@react-three/fiber";

const Y_OFFSET = 0.02;

type DragState = {
  isDragging: boolean;
  vertexIndex: number;
  initialPosition: [number, number];
};

/**
 * Zone boundary editor - allows editing zone polygon vertices when a zone is selected
 * Uses the event emitter system for grid interactions
 */
export const ZoneBoundaryEditor: React.FC = () => {
  const { gl, camera } = useThree();
  const selectedZoneId = useViewer((state) => state.selection.zoneId);
  const zoneNode = useScene((state) =>
    selectedZoneId ? state.nodes[selectedZoneId] : null
  );
  const zone = zoneNode?.type === "zone" ? (zoneNode as ZoneNode) : null;
  const updateNode = useScene((state) => state.updateNode);

  // Local state for dragging
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [previewPolygon, setPreviewPolygon] = useState<
    Array<[number, number]> | null
  >(null);
  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null);
  const [hoveredMidpoint, setHoveredMidpoint] = useState<number | null>(null);

  // Refs for raycasting during drag
  const dragPlane = useRef(new Plane(new Vector3(0, 1, 0), -Y_OFFSET));
  const raycaster = useRef(new Raycaster());
  const lineRef = useRef<Mesh>(null!);

  // The polygon to display (preview during drag, or actual zone polygon)
  const displayPolygon = previewPolygon ?? zone?.polygon ?? [];

  // Calculate midpoints for adding new vertices
  const midpoints = useMemo(() => {
    if (displayPolygon.length < 2) return [];
    return displayPolygon.map(([x1, z1], index) => {
      const nextIndex = (index + 1) % displayPolygon.length;
      const [x2, z2] = displayPolygon[nextIndex]!;
      return [(x1! + x2) / 2, (z1! + z2) / 2] as [number, number];
    });
  }, [displayPolygon]);

  // Handle vertex drag
  const handleVertexDrag = useCallback(
    (clientX: number, clientY: number, vertexIndex: number) => {
      if (!zone) return;

      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.current.setFromCamera(new Vector2(x, y), camera);
      const intersection = new Vector3();
      raycaster.current.ray.intersectPlane(dragPlane.current, intersection);

      if (intersection) {
        // Snap to 0.5 grid
        const gridX = Math.round(intersection.x * 2) / 2;
        const gridZ = Math.round(intersection.z * 2) / 2;

        const basePolygon = previewPolygon ?? zone.polygon;
        const newPolygon = [...basePolygon];
        newPolygon[vertexIndex] = [gridX, gridZ];
        setPreviewPolygon(newPolygon);
      }
    },
    [zone, gl, camera, previewPolygon]
  );

  // Commit polygon changes
  const commitPolygonChange = useCallback(() => {
    if (previewPolygon && selectedZoneId) {
      updateNode(selectedZoneId, { polygon: previewPolygon });
    }
    setPreviewPolygon(null);
    setDragState(null);
  }, [previewPolygon, selectedZoneId, updateNode]);

  // Handle adding a new vertex at midpoint
  const handleAddVertex = useCallback(
    (afterIndex: number, position: [number, number]) => {
      if (!zone) return -1;

      const basePolygon = previewPolygon ?? zone.polygon;
      const newPolygon = [
        ...basePolygon.slice(0, afterIndex + 1),
        position,
        ...basePolygon.slice(afterIndex + 1),
      ];

      setPreviewPolygon(newPolygon);
      return afterIndex + 1; // Return new vertex index
    },
    [zone, previewPolygon]
  );

  // Handle deleting a vertex
  const handleDeleteVertex = useCallback(
    (index: number) => {
      if (!zone || !selectedZoneId) return;

      const basePolygon = previewPolygon ?? zone.polygon;
      if (basePolygon.length <= 3) return; // Need at least 3 points

      const newPolygon = basePolygon.filter((_, i) => i !== index);
      updateNode(selectedZoneId, { polygon: newPolygon });
      setPreviewPolygon(null);
    },
    [zone, selectedZoneId, previewPolygon, updateNode]
  );

  // Set up pointer move/up listeners for dragging
  useEffect(() => {
    if (!dragState?.isDragging) return;

    const canvas = gl.domElement;

    const handlePointerMove = (e: PointerEvent) => {
      handleVertexDrag(e.clientX, e.clientY, dragState.vertexIndex);
    };

    const handlePointerUp = () => {
      commitPolygonChange();
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);

    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, gl, handleVertexDrag, commitPolygonChange]);

  // Update line geometry when polygon changes
  useEffect(() => {
    if (!lineRef.current || displayPolygon.length < 2) return;

    const positions: number[] = [];
    for (const [x, z] of displayPolygon) {
      positions.push(x!, Y_OFFSET + 0.01, z!);
    }
    // Close the loop
    const first = displayPolygon[0]!;
    positions.push(first[0]!, Y_OFFSET + 0.01, first[1]!);

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(positions, 3)
    );

    lineRef.current.geometry.dispose();
    lineRef.current.geometry = geometry;
  }, [displayPolygon]);

  if (!zone || displayPolygon.length < 3) return null;

  const canDelete = displayPolygon.length > 3;
  const zoneColor = zone.color || "#3b82f6";

  return (
    <group>
      {/* Border line */}
      {/* @ts-ignore */}
      <line ref={lineRef} frustumCulled={false} renderOrder={10}>
        <bufferGeometry />
        <lineBasicNodeMaterial
          color={zoneColor}
          linewidth={2}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.8}
        />
      </line>

      {/* Vertex handles */}
      {displayPolygon.map(([x, z], index) => {
        const isHovered = hoveredVertex === index;
        const isDragging = dragState?.vertexIndex === index;

        return (
          <mesh
            key={`vertex-${index}`}
            position={[x!, Y_OFFSET, z!]}
            onPointerEnter={(e) => {
              e.stopPropagation();
              setHoveredVertex(index);
            }}
            onPointerLeave={(e) => {
              e.stopPropagation();
              setHoveredVertex(null);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragState({
                isDragging: true,
                vertexIndex: index,
                initialPosition: [x!, z!],
              });
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (canDelete) {
                handleDeleteVertex(index);
              }
            }}
          >
            <sphereGeometry
              args={[isHovered || isDragging ? 0.2 : 0.15, 16, 16]}
            />
            <meshBasicMaterial
              color={
                isDragging
                  ? "#22c55e"
                  : isHovered
                    ? canDelete
                      ? "#ef4444"
                      : "#ffffff"
                    : zoneColor
              }
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        );
      })}

      {/* Midpoint handles for adding vertices (hidden while dragging) */}
      {!dragState &&
        midpoints.map(([x, z], index) => {
          const isHovered = hoveredMidpoint === index;

          return (
            <mesh
              key={`midpoint-${index}`}
              position={[x!, Y_OFFSET, z!]}
              onPointerEnter={(e) => {
                e.stopPropagation();
                setHoveredMidpoint(index);
              }}
              onPointerLeave={(e) => {
                e.stopPropagation();
                setHoveredMidpoint(null);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                const newVertexIndex = handleAddVertex(index, [x!, z!]);
                if (newVertexIndex >= 0) {
                  setDragState({
                    isDragging: true,
                    vertexIndex: newVertexIndex,
                    initialPosition: [x!, z!],
                  });
                  setHoveredMidpoint(null);
                }
              }}
            >
              <sphereGeometry args={[isHovered ? 0.12 : 0.08, 16, 16]} />
              <meshBasicMaterial
                color={isHovered ? "#22c55e" : zoneColor}
                depthTest={false}
                depthWrite={false}
                transparent
                opacity={isHovered ? 1 : 0.4}
              />
            </mesh>
          );
        })}
    </group>
  );
};
