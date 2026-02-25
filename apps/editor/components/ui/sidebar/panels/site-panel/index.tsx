import {
  type AnyNodeId,
  type AnyNode,
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
import { InlineRenameInput } from "./inline-rename-input";
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

function CameraPopover({
  nodeId,
  hasCamera,
  open,
  onOpenChange,
  buttonClassName,
}: {
  nodeId: AnyNodeId;
  hasCamera: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buttonClassName?: string;
}) {
  const updateNode = useScene((state) => state.updateNode);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "relative w-6 h-6 flex items-center justify-center rounded cursor-pointer",
            buttonClassName
          )}
          onClick={(e) => e.stopPropagation()}
          title="Camera snapshot"
        >
          <Camera className="w-3.5 h-3.5" />
          {hasCamera && (
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
          {hasCamera && (
            <button
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
              onClick={(e) => {
                e.stopPropagation();
                emitter.emit("camera-controls:view", { nodeId });
                onOpenChange(false);
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
              emitter.emit("camera-controls:capture", { nodeId });
              onOpenChange(false);
            }}
          >
            <Camera className="w-3.5 h-3.5" />
            {hasCamera ? "Update snapshot" : "Take snapshot"}
          </button>
          {hasCamera && (
            <button
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-destructive hover:text-destructive-foreground text-left w-full"
              onClick={(e) => {
                e.stopPropagation();
                updateNode(nodeId, { camera: undefined });
                onOpenChange(false);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear snapshot
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


function LevelItem({
  level,
  selectedLevelId,
  setSelection,
  setReferencesLevelId,
  deleteNode,
  updateNode,
}: {
  level: LevelNode;
  selectedLevelId: string | null;
  setSelection: (selection: any) => void;
  setReferencesLevelId: (id: string | null) => void;
  deleteNode: (id: AnyNodeId) => void;
  updateNode: (id: AnyNodeId, updates: Partial<AnyNode>) => void;
}) {
  const [cameraPopoverOpen, setCameraPopoverOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div
      className={cn(
        "flex items-center group/level border-b border-border/50 pr-2 transition-all duration-200",
        selectedLevelId === level.id
          ? "bg-accent/50 text-foreground"
          : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
      )}
    >
      <div
        className="flex-1 flex items-center gap-2 pl-3 py-2 text-sm cursor-pointer min-w-0"
        onClick={() => setSelection({ levelId: level.id })}
        onDoubleClick={() => setIsEditing(true)}
      >
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <InlineRenameInput
          node={level}
          isEditing={isEditing}
          onStopEditing={() => setIsEditing(false)}
          onStartEditing={() => setIsEditing(true)}
          defaultName={`Level ${level.level}`}
        />
      </div>
        {/* Camera snapshot button */}
        <Popover open={cameraPopoverOpen} onOpenChange={setCameraPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "relative opacity-0 group-hover/level:opacity-100 w-6 h-6 mr-1 flex items-center justify-center rounded-md cursor-pointer shrink-0 transition-colors",
                selectedLevelId === level.id
                  ? "hover:bg-black/5 dark:hover:bg-white/10"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
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
                  emitter.emit("camera-controls:capture", { nodeId: level.id });
                  setCameraPopoverOpen(false);
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
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "opacity-0 group-hover/level:opacity-100 w-6 h-6 mr-1 flex items-center justify-center rounded-md cursor-pointer shrink-0 transition-colors",
                selectedLevelId === level.id
                  ? "hover:bg-black/5 dark:hover:bg-white/10"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
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
            {level.level !== 0 && (
              <button
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-sm hover:bg-accent hover:text-red-600 cursor-pointer"
                onClick={() => deleteNode(level.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </PopoverContent>
        </Popover>
      </div>
  );
}

function LevelsSection() {
  const nodes = useScene((state) => state.nodes);
  const createNode = useScene((state) => state.createNode);
  const updateNode = useScene((state) => state.updateNode);
  const deleteNode = useScene((state) => state.deleteNode);
  const selectedBuildingId = useViewer((state) => state.selection.buildingId);
  const selectedLevelId = useViewer((state) => state.selection.levelId);
  const setSelection = useViewer((state) => state.setSelection);

  const [referencesLevelId, setReferencesLevelId] = useState<string | null>(null);

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
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
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
      <div className="flex flex-col">
        {levels.map((level) => (
          <LevelItem
            key={level.id}
            level={level}
            selectedLevelId={selectedLevelId}
            setSelection={setSelection}
            setReferencesLevelId={setReferencesLevelId}
            deleteNode={deleteNode}
            updateNode={updateNode}
          />
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
  const phase = useEditor((state) => state.phase);
  const setPhase = useEditor((state) => state.setPhase);

  return (
    <div className="flex items-center p-1 bg-accent/20 gap-1 border-b border-border/50">
      <button
        className={cn(
          "flex-1 flex flex-col items-center justify-center py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer",
          phase === "structure" && structureLayer === "elements"
            ? "bg-white dark:bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/10 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/50 dark:hover:bg-accent/50"
        )}
        onClick={() => {
          setPhase("structure");
          setStructureLayer("elements");
        }}
      >
        <img
          src="/icons/room.png"
          alt="Structure"
          className={cn("w-6 h-6 mb-1", !(phase === "structure" && structureLayer === "elements") && "opacity-50 grayscale")}
        />
        Structure
      </button>
      <button
        className={cn(
          "flex-1 flex flex-col items-center justify-center py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer",
          phase === "furnish"
            ? "bg-white dark:bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/10 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/50 dark:hover:bg-accent/50"
        )}
        onClick={() => {
          setPhase("furnish");
        }}
      >
        <img
          src="/icons/couch.png"
          alt="Furnish"
          className={cn("w-6 h-6 mb-1", phase !== "furnish" && "opacity-50 grayscale")}
        />
        Furnish
      </button>
      <button
        className={cn(
          "flex-1 flex flex-col items-center justify-center py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer",
          phase === "structure" && structureLayer === "zones"
            ? "bg-white dark:bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/10 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/50 dark:hover:bg-accent/50"
        )}
        onClick={() => {
          setPhase("structure");
          setStructureLayer("zones");
        }}
      >
        <img
          src="/icons/kitchen.png"
          alt="Zones"
          className={cn("w-6 h-6 mb-1", !(phase === "structure" && structureLayer === "zones") && "opacity-50 grayscale")}
        />
        Zones
      </button>
    </div>
  );
}

function ZoneItem({ zone }: { zone: ZoneNode }) {
  const [isEditing, setIsEditing] = useState(false);
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
    setIsEditing(true);
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
    <div
      className={cn(
        "flex items-center h-8 cursor-pointer group/row text-sm px-3 select-none border-b border-border/50 transition-all duration-200",
        isSelected
          ? "bg-accent/50 text-foreground"
          : isHovered
            ? "bg-accent/30 text-foreground"
            : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
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
      <InlineRenameInput
        node={zone}
        isEditing={isEditing}
        onStopEditing={() => setIsEditing(false)}
        onStartEditing={() => setIsEditing(true)}
        defaultName={defaultName}
      />
      {/* Camera snapshot button */}
      <Popover open={cameraPopoverOpen} onOpenChange={setCameraPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            className="relative opacity-0 group-hover/row:opacity-100 w-6 h-6 flex items-center justify-center rounded-md cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
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
        className="opacity-0 group-hover/row:opacity-100 w-6 h-6 flex items-center justify-center rounded-md cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
        onClick={handleDelete}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
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
      <div className="flex flex-col">
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
    <div className="flex flex-col">
      {elementChildren.map((childId) => (
        <TreeNode key={childId} nodeId={childId} depth={0} />
      ))}
    </div>
  );
}

export function SitePanel() {
  const nodes = useScene((state) => state.nodes);
  const rootNodeIds = useScene((state) => state.rootNodeIds);
  const updateNode = useScene((state) => state.updateNode);
  const selectedBuildingId = useViewer((state) => state.selection.buildingId);
  const setSelection = useViewer((state) => state.setSelection);
  const phase = useEditor((state) => state.phase);
  const setPhase = useEditor((state) => state.setPhase);

  const [siteCameraOpen, setSiteCameraOpen] = useState(false);
  const [buildingCameraOpen, setBuildingCameraOpen] = useState<string | null>(null);

  const siteNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : null;
  const buildings = (siteNode?.type === 'site' ? siteNode.children : [])
    .map((child) => {
      const id = typeof child === 'string' ? child : child.id;
      return nodes[id] as BuildingNode | undefined;
    })
    .filter((node): node is BuildingNode => node?.type === "building");

  return (
    <div className="flex flex-col h-full">
      {/* Site Header */}
      {siteNode && (
        <div 
          className={cn(
            "flex items-center justify-between px-3 py-3 border-b border-border/50 cursor-pointer transition-colors",
            phase === "site" ? "bg-accent/50 text-foreground" : "hover:bg-accent/30 text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setPhase("site")}
        >
          <div className="flex items-center gap-2">
            <img 
              src="/icons/site.png" 
              className={cn("w-5 h-5 object-contain transition-all", phase !== "site" && "opacity-60 grayscale")} 
              alt="Site" 
            />
            <span className="text-sm font-medium">{siteNode.name || "Site"}</span>
          </div>
          <CameraPopover
            nodeId={siteNode.id as AnyNodeId}
            hasCamera={!!siteNode.camera}
            open={siteCameraOpen}
            onOpenChange={setSiteCameraOpen}
            buttonClassName={cn("transition-colors", phase === "site" ? "hover:bg-black/5 dark:hover:bg-white/10" : "hover:bg-accent")}
          />
        </div>
      )}

      <div className="flex-1 overflow-auto flex flex-col">
        {/* When phase is site, show property line immediately under site header */}
        {phase === "site" && <PropertyLineSection />}

        {/* Buildings List */}
        {buildings.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            No buildings yet
          </div>
        ) : (
          <div className="flex flex-col">
            {buildings.map((building) => {
              const isBuildingActive = (phase === "structure" || phase === "furnish") && selectedBuildingId === building.id;

              return (
                <div key={building.id} className="flex flex-col">
                  <div
                    className={cn(
                      "group/building flex items-center h-10 border-b border-border/50 pr-2 transition-all duration-200",
                      isBuildingActive
                        ? "bg-accent/50 text-foreground"
                        : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                    )}
                  >
                    <button
                      className="flex-1 flex items-center gap-2 pl-3 py-2 h-full cursor-pointer min-w-0"
                      onClick={() => {
                        setSelection({ buildingId: building.id });
                        if (phase === "site") {
                          setPhase("structure");
                        }
                      }}
                    >
                      <img 
                        src="/icons/building.png" 
                        className={cn("w-5 h-5 object-contain transition-all", !isBuildingActive && "opacity-60 grayscale")} 
                        alt="Building" 
                      />
                      <span className="truncate font-medium text-sm">{building.name || "Building"}</span>
                    </button>
                    <Popover
                      open={buildingCameraOpen === building.id}
                      onOpenChange={(open) => setBuildingCameraOpen(open ? building.id : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "relative opacity-0 group-hover/building:opacity-100 w-7 h-7 mr-1.5 flex items-center justify-center rounded-md cursor-pointer shrink-0 transition-colors",
                            isBuildingActive
                              ? "hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground"
                              : "hover:bg-accent text-muted-foreground hover:text-foreground"
                          )}
                          onClick={(e) => e.stopPropagation()}
                          title="Camera snapshot"
                        >
                          <Camera className="w-4 h-4" />
                          {building.camera && (
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
                          {building.camera && (
                            <button
                              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                emitter.emit("camera-controls:view", { nodeId: building.id });
                                setBuildingCameraOpen(null);
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
                              emitter.emit("camera-controls:capture", { nodeId: building.id });
                              setBuildingCameraOpen(null);
                            }}
                          >
                            <Camera className="w-3.5 h-3.5" />
                            {building.camera ? "Update snapshot" : "Take snapshot"}
                          </button>
                          {building.camera && (
                            <button
                              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-destructive hover:text-destructive-foreground text-left w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateNode(building.id, { camera: undefined });
                                setBuildingCameraOpen(null);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Clear snapshot
                            </button>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Tools and content for the active building */}
                  {isBuildingActive && (
                    <div className="flex flex-col animate-in fade-in slide-in-from-top-2 duration-200">
                      <LevelsSection />
                      <LayerToggle />
                      <ContentSection />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
