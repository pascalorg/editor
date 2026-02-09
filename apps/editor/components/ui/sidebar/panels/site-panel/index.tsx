import {
  type BuildingNode,
  emitter,
  LevelNode,
  type SiteNode,
  useScene,
  type ZoneNode,
} from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import {
  Building2,
  Camera,
  ChevronDown,
  Layers,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import useEditor from "@/store/use-editor";
import { TreeNode } from "./tree-node";
import { ReferencesDialog } from "./references-dialog";
import { RenamePopover } from "./rename-popover";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/primitives/popover";

// Preset colors for zones
const PRESET_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red
  "#a855f7", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
];

// ============================================================================
// PROPERTY LINE SECTION
// ============================================================================

function calculatePerimeter(points: Array<[number, number]>): number {
  if (points.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]!;
    const [x2, z2] = points[(i + 1) % points.length]!;
    perimeter += Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
  }
  return perimeter;
}

function calculatePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i]![0] * polygon[j]![1];
    area -= polygon[j]![0] * polygon[i]![1];
  }
  return Math.abs(area) / 2;
}

function useSiteNode(): SiteNode | null {
  const siteId = useScene((state) => {
    for (const id of state.rootNodeIds) {
      if (state.nodes[id]?.type === "site") return id;
    }
    return null;
  });
  return useScene((state) =>
    siteId ? ((state.nodes[siteId] as SiteNode | undefined) ?? null) : null
  );
}

function PropertyLineSection() {
  const siteNode = useSiteNode();
  const updateNode = useScene((state) => state.updateNode);
  const mode = useEditor((state) => state.mode);
  const setMode = useEditor((state) => state.setMode);

  if (!siteNode) return null;

  const points = siteNode.polygon?.points ?? [];
  const area = calculatePolygonArea(points);
  const perimeter = calculatePerimeter(points);
  const isEditing = mode === "edit";

  const handleToggleEdit = () => {
    setMode(isEditing ? "select" : "edit");
  };

  const handlePointChange = (index: number, axis: 0 | 1, value: number) => {
    const newPoints = [...points.map((p) => [...p] as [number, number])];
    newPoints[index]![axis] = value;
    updateNode(siteNode.id, {
      polygon: { type: "polygon" as const, points: newPoints },
    });
  };

  const handleAddPoint = () => {
    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];
    if (!lastPoint || !firstPoint) return;

    const newPoint: [number, number] = [
      (lastPoint[0] + firstPoint[0]) / 2,
      (lastPoint[1] + firstPoint[1]) / 2,
    ];
    const newPoints = [...points, newPoint];
    updateNode(siteNode.id, {
      polygon: { type: "polygon" as const, points: newPoints },
    });
  };

  const handleDeletePoint = (index: number) => {
    if (points.length <= 3) return;
    const newPoints = points.filter((_, i) => i !== index);
    updateNode(siteNode.id, {
      polygon: { type: "polygon" as const, points: newPoints },
    });
  };

  return (
    <div className="border-b border-border/50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Property Line</span>
        </div>
        <button
          className={cn(
            "w-6 h-6 flex items-center justify-center rounded cursor-pointer transition-colors",
            isEditing
              ? "bg-orange-500/20 text-orange-400"
              : "hover:bg-accent text-muted-foreground"
          )}
          onClick={handleToggleEdit}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Measurements */}
      <div className="flex gap-3 px-3 pb-2">
        <div className="text-xs text-muted-foreground">
          Area: <span className="text-foreground">{area.toFixed(1)} m²</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Perimeter:{" "}
          <span className="text-foreground">{perimeter.toFixed(1)} m</span>
        </div>
      </div>

      {/* Vertex list (shown when editing) */}
      {isEditing && (
        <div className="px-3 pb-2">
          <div className="flex flex-col gap-1">
            {points.map((point, index) => (
              <div
                key={index}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className="w-4 text-muted-foreground text-right shrink-0">
                  {index + 1}
                </span>
                <label className="text-muted-foreground shrink-0">X</label>
                <input
                  type="number"
                  value={point[0]}
                  onChange={(e) =>
                    handlePointChange(index, 0, parseFloat(e.target.value) || 0)
                  }
                  step={0.5}
                  className="w-16 bg-accent/50 rounded px-1.5 py-0.5 text-xs text-foreground border border-border/50 focus:outline-none focus:border-primary"
                />
                <label className="text-muted-foreground shrink-0">Z</label>
                <input
                  type="number"
                  value={point[1]}
                  onChange={(e) =>
                    handlePointChange(index, 1, parseFloat(e.target.value) || 0)
                  }
                  step={0.5}
                  className="w-16 bg-accent/50 rounded px-1.5 py-0.5 text-xs text-foreground border border-border/50 focus:outline-none focus:border-primary"
                />
                <button
                  className={cn(
                    "w-5 h-5 flex items-center justify-center rounded cursor-pointer shrink-0",
                    points.length > 3
                      ? "hover:bg-red-500/20 text-muted-foreground hover:text-red-400"
                      : "text-muted-foreground/30 cursor-not-allowed"
                  )}
                  onClick={() => handleDeletePoint(index)}
                  disabled={points.length <= 3}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <button
            className="flex items-center gap-1 mt-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded cursor-pointer transition-colors"
            onClick={handleAddPoint}
          >
            <Plus className="w-3 h-3" />
            Add point
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SITE PHASE VIEW - Property line + building buttons
// ============================================================================

function SitePhaseView() {
  const nodes = useScene((state) => state.nodes);
  const rootNodeIds = useScene((state) => state.rootNodeIds);
  const selectedBuildingId = useViewer((state) => state.selection.buildingId);
  const setSelection = useViewer((state) => state.setSelection);

  // Get site node and its building children
  const siteNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : null;
  const buildings = (siteNode?.type === 'site' ? siteNode.children : [])
    .map((child) => typeof child === 'string' ? nodes[child] : child)
    .filter((node): node is BuildingNode => node?.type === "building");

  return (
    <div className="flex flex-col h-full">
      <PropertyLineSection />
      {buildings.length === 0 ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          No buildings yet
        </div>
      ) : (
        <div className="flex flex-col gap-1 p-2">
          {buildings.map((building) => (
            <button
              key={building.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer",
                selectedBuildingId === building.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent/50 hover:bg-accent text-foreground"
              )}
              onClick={() => setSelection({ buildingId: building.id })}
            >
              <Building2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{building.name || "Building"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STRUCTURE/FURNISH PHASE VIEW - Building dropdown + Levels + Content
// ============================================================================

function BuildingSelector() {
  const nodes = useScene((state) => state.nodes);
  const rootNodeIds = useScene((state) => state.rootNodeIds);
  const selectedBuildingId = useViewer((state) => state.selection.buildingId);
  const setSelection = useViewer((state) => state.setSelection);

  // Get site node and its building children
  const siteNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : null;
  const buildings = (siteNode?.type === 'site' ? siteNode.children : [])
    .map((child) => typeof child === 'string' ? nodes[child] : child)
    .filter((node): node is BuildingNode => node?.type === "building");

  const selectedBuilding = selectedBuildingId
    ? (nodes[selectedBuildingId] as BuildingNode)
    : null;

  if (buildings.length === 0) return null;

  // If only one building, just show it as a header
  if (buildings.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium truncate">
          {buildings[0]?.name || "Building"}
        </span>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center justify-between w-full px-3 py-2 border-b border-border/50 hover:bg-accent/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate">
              {selectedBuilding?.name || "Select Building"}
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {buildings.map((building) => (
          <button
            key={building.id}
            className={cn(
              "flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors cursor-pointer",
              selectedBuildingId === building.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
            onClick={() => {
              setSelection({ buildingId: building.id });
              // Also select first level if available
              if (building.children.length > 0) {
                setSelection({ levelId: building.children[0] as LevelNode["id"] });
              }
            }}
          >
            <Building2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{building.name || "Building"}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LevelsSection() {
  const nodes = useScene((state) => state.nodes);
  const createNode = useScene((state) => state.createNode);
  const updateNode = useScene((state) => state.updateNode);
  const selectedBuildingId = useViewer((state) => state.selection.buildingId);
  const selectedLevelId = useViewer((state) => state.selection.levelId);
  const setSelection = useViewer((state) => state.setSelection);

  const [referencesLevelId, setReferencesLevelId] = useState<string | null>(null);
  const [cameraPopoverOpen, setCameraPopoverOpen] = useState<string | null>(null);

  const building = selectedBuildingId
    ? (nodes[selectedBuildingId] as BuildingNode)
    : null;

  if (!building) return null;

  const levels = building.children
    .map((id) => nodes[id])
    .filter((node): node is LevelNode => node?.type === "level");

  const handleAddLevel = () => {
    const newLevel = LevelNode.parse({
      level: levels.length,
      children: [],
      parentId: building.id,
    });
    createNode(newLevel, building.id);
    setSelection({ levelId: newLevel.id });
  };

  return (
    <div className="border-b border-border/50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Levels
        </span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-accent cursor-pointer"
          onClick={handleAddLevel}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Level buttons */}
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {levels.map((level) => (
          <div
            key={level.id}
            className={cn(
              "flex items-center group/level rounded transition-colors",
              selectedLevelId === level.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent/50 text-foreground"
            )}
          >
            <button
              className="flex-1 flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer min-w-0"
              onClick={() => setSelection({ levelId: level.id })}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{level.name || `Level ${level.level}`}</span>
            </button>
            {/* Camera snapshot button */}
            <Popover open={cameraPopoverOpen === level.id} onOpenChange={(open) => setCameraPopoverOpen(open ? level.id : null)}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "relative opacity-0 group-hover/level:opacity-100 w-6 h-6 mr-1 flex items-center justify-center rounded cursor-pointer shrink-0",
                    selectedLevelId === level.id
                      ? "hover:bg-primary-foreground/20"
                      : "hover:bg-accent"
                  )}
                  onClick={(e) => e.stopPropagation()}
                  title="Camera snapshot"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {level.camera && (
                    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="w-auto p-1"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col gap-0.5">
                  {level.camera && (
                    <button
                      className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        emitter.emit("camera-controls:view", { nodeId: level.id });
                        setCameraPopoverOpen(null);
                      }}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      View snapshot
                    </button>
                  )}
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      emitter.emit("camera-controls:capture", { nodeId: level.id });
                      setCameraPopoverOpen(null);
                    }}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {level.camera ? "Update snapshot" : "Take snapshot"}
                  </button>
                  {level.camera && (
                    <button
                      className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-destructive hover:text-destructive-foreground text-left w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateNode(level.id, { camera: undefined });
                        setCameraPopoverOpen(null);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear snapshot
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "opacity-0 group-hover/level:opacity-100 w-6 h-6 mr-1 flex items-center justify-center rounded cursor-pointer shrink-0",
                    selectedLevelId === level.id
                      ? "hover:bg-primary-foreground/20"
                      : "hover:bg-accent"
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="right" className="w-40 p-1">
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-sm hover:bg-accent cursor-pointer"
                  onClick={() => setReferencesLevelId(level.id)}
                >
                  References
                </button>
              </PopoverContent>
            </Popover>
          </div>
        ))}
        {levels.length === 0 && (
          <div className="text-xs text-muted-foreground px-2 py-1">
            No levels yet
          </div>
        )}
      </div>

      {/* References dialog */}
      {referencesLevelId && (
        <ReferencesDialog
          levelId={referencesLevelId}
          open={!!referencesLevelId}
          onOpenChange={(open) => {
            if (!open) setReferencesLevelId(null);
          }}
        />
      )}
    </div>
  );
}

function LayerToggle() {
  const structureLayer = useEditor((state) => state.structureLayer);
  const setStructureLayer = useEditor((state) => state.setStructureLayer);

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border/50">
      <button
        className={cn(
          "flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer",
          structureLayer === "elements"
            ? "bg-primary text-primary-foreground"
            : "bg-accent/50 hover:bg-accent text-muted-foreground"
        )}
        onClick={() => setStructureLayer("elements")}
      >
        Elements
      </button>
      <button
        className={cn(
          "flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer",
          structureLayer === "zones"
            ? "bg-primary text-primary-foreground"
            : "bg-accent/50 hover:bg-accent text-muted-foreground"
        )}
        onClick={() => setStructureLayer("zones")}
      >
        Zones
      </button>
    </div>
  );
}

function ZoneItem({ zone }: { zone: ZoneNode }) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [cameraPopoverOpen, setCameraPopoverOpen] = useState(false);
  const deleteNode = useScene((state) => state.deleteNode);
  const updateNode = useScene((state) => state.updateNode);
  const selectedZoneId = useViewer((state) => state.selection.zoneId);
  const hoveredId = useViewer((state) => state.hoveredId);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);
  const setPhase = useEditor((state) => state.setPhase);
  const setMode = useEditor((state) => state.setMode);

  const isSelected = selectedZoneId === zone.id;
  const isHovered = hoveredId === zone.id;

  const area = calculatePolygonArea(zone.polygon).toFixed(1);
  const defaultName = `Zone (${area}m²)`;

  const handleClick = () => {
    setSelection({ zoneId: zone.id });
    setPhase("structure");
    setMode("select");
  };

  const handleDoubleClick = () => {
    setRenameOpen(true);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(zone.id);
    if (isSelected) {
      setSelection({ zoneId: null });
    }
  };

  const handleColorChange = (color: string) => {
    updateNode(zone.id, { color });
  };

  return (
    <RenamePopover
      node={zone}
      open={renameOpen}
      onOpenChange={setRenameOpen}
      defaultName={defaultName}
    >
      <div
        className={cn(
          "flex items-center h-7 cursor-pointer group/row text-sm px-3 select-none",
          isSelected
            ? "text-primary-foreground bg-primary/80 hover:bg-primary/90"
            : isHovered
              ? "bg-accent/70 text-foreground"
              : "text-muted-foreground hover:bg-accent/50"
        )}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setHoveredId(zone.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="mr-2 size-3 shrink-0 rounded-sm border border-border/50 transition-transform hover:scale-110 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: zone.color }}
            />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-4 gap-1">
              {PRESET_COLORS.map((color) => (
                <button
                  className={cn(
                    "size-6 rounded-sm border transition-transform hover:scale-110 cursor-pointer",
                    color === zone.color ? "ring-2 ring-primary ring-offset-1" : ""
                  )}
                  key={color}
                  onClick={() => handleColorChange(color)}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <span className="truncate flex-1">{zone.name || defaultName}</span>
        {/* Camera snapshot button */}
        <Popover open={cameraPopoverOpen} onOpenChange={setCameraPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className="relative opacity-0 group-hover/row:opacity-100 w-5 h-5 flex items-center justify-center rounded cursor-pointer hover:bg-primary-foreground/20"
              onClick={(e) => e.stopPropagation()}
              title="Camera snapshot"
            >
              <Camera className="w-3 h-3" />
              {zone.camera && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            className="w-auto p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-0.5">
              {zone.camera && (
                <button
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    emitter.emit("camera-controls:view", { nodeId: zone.id });
                    setCameraPopoverOpen(false);
                  }}
                >
                  <Camera className="w-3.5 h-3.5" />
                  View snapshot
                </button>
              )}
              <button
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  emitter.emit("camera-controls:capture", { nodeId: zone.id });
                  setCameraPopoverOpen(false);
                }}
              >
                <Camera className="w-3.5 h-3.5" />
                {zone.camera ? "Update snapshot" : "Take snapshot"}
              </button>
              {zone.camera && (
                <button
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-destructive hover:text-destructive-foreground text-left w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateNode(zone.id, { camera: undefined });
                    setCameraPopoverOpen(false);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear snapshot
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <button
          className="opacity-0 group-hover/row:opacity-100 w-5 h-5 flex items-center justify-center rounded cursor-pointer hover:bg-primary-foreground/20"
          onClick={handleDelete}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </RenamePopover>
  );
}

function ContentSection() {
  const nodes = useScene((state) => state.nodes);
  const selectedLevelId = useViewer((state) => state.selection.levelId);
  const structureLayer = useEditor((state) => state.structureLayer);
  const phase = useEditor((state) => state.phase);
  const setPhase = useEditor((state) => state.setPhase);
  const setMode = useEditor((state) => state.setMode);
  const setTool = useEditor((state) => state.setTool);

  const level = selectedLevelId ? (nodes[selectedLevelId] as LevelNode) : null;

  if (!level) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">
        Select a level to view content
      </div>
    );
  }

  if (structureLayer === "zones") {
    // Show zones for this level
    const levelZones = Object.values(nodes).filter(
      (node): node is ZoneNode =>
        node.type === "zone" && node.parentId === selectedLevelId
    );

    const handleAddZone = () => {
      setPhase("structure");
      setMode("build");
      setTool("zone");
    };

    if (levelZones.length === 0) {
      return (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          No zones on this level.{" "}
          <button
            className="text-primary hover:underline cursor-pointer"
            onClick={handleAddZone}
          >
            Add one
          </button>
        </div>
      );
    }

    return (
      <div className="py-1">
        {levelZones.map((zone) => (
          <ZoneItem key={zone.id} zone={zone} />
        ))}
      </div>
    );
  }

  // Filter elements based on phase
  const elementChildren = level.children.filter((childId) => {
    const childNode = nodes[childId];
    if (!childNode || childNode.type === "zone") return false;

    // In structure mode, show structural elements (walls, slabs, etc.) and doors/windows
    if (phase === "structure") {
      if (childNode.type === "item") {
        const category = childNode.asset?.category?.toLowerCase() || "";
        // Only show doors and windows in structure mode
        return category === "door" || category === "window";
      }
      // Show all other structural elements (walls, slabs, ceiling, roof)
      return true;
    }

    // In furnish mode, only show items that are NOT doors or windows
    if (phase === "furnish") {
      if (childNode.type === "item") {
        const category = childNode.asset?.category?.toLowerCase() || "";
        // Hide doors and windows in furnish mode
        return category !== "door" && category !== "window";
      }
      // Hide structural elements in furnish mode
      return false;
    }

    return true;
  });

  if (elementChildren.length === 0) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">
        No elements on this level
      </div>
    );
  }

  return (
    <div className="py-1">
      {elementChildren.map((childId) => (
        <TreeNode key={childId} nodeId={childId} depth={0} />
      ))}
    </div>
  );
}

function StructurePhaseView() {
  const phase = useEditor((state) => state.phase);

  return (
    <div className="flex flex-col h-full">
      <BuildingSelector />
      <LevelsSection />
      {/* Only show layer toggle in structure phase, furnish is always elements */}
      {phase === "structure" && <LayerToggle />}
      <div className="flex-1 overflow-auto">
        <ContentSection />
      </div>
    </div>
  );
}

// ============================================================================
// MAIN SITE PANEL
// ============================================================================

export function SitePanel() {
  const phase = useEditor((state) => state.phase);

  if (phase === "site") {
    return <SitePhaseView />;
  }

  return <StructurePhaseView />;
}
