import {
  type BuildingNode,
  LevelNode,
  useScene,
  type ZoneNode,
} from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import {
  Building2,
  ChevronDown,
  Hexagon,
  Layers,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import useEditor from "@/store/use-editor";
import { TreeNode } from "./tree-node";
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
// SITE PHASE VIEW - Simple building buttons
// ============================================================================

function SitePhaseView() {
  const nodes = useScene((state) => state.nodes);
  const rootNodeIds = useScene((state) => state.rootNodeIds);
  const selectedBuildingId = useViewer((state) => state.selection.buildingId);
  const setSelection = useViewer((state) => state.setSelection);

  const buildings = rootNodeIds
    .map((id) => nodes[id])
    .filter((node): node is BuildingNode => node?.type === "building");

  if (buildings.length === 0) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">
        No buildings yet
      </div>
    );
  }

  return (
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

  const buildings = rootNodeIds
    .map((id) => nodes[id])
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
  const selectedBuildingId = useViewer((state) => state.selection.buildingId);
  const selectedLevelId = useViewer((state) => state.selection.levelId);
  const setSelection = useViewer((state) => state.setSelection);

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
          <button
            key={level.id}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors cursor-pointer",
              selectedLevelId === level.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent/50 text-foreground"
            )}
            onClick={() => setSelection({ levelId: level.id })}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{level.name || `Level ${level.level}`}</span>
          </button>
        ))}
        {levels.length === 0 && (
          <div className="text-xs text-muted-foreground px-2 py-1">
            No levels yet
          </div>
        )}
      </div>
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
  const deleteNode = useScene((state) => state.deleteNode);
  const updateNode = useScene((state) => state.updateNode);
  const selectedZoneId = useViewer((state) => state.selection.zoneId);
  const setSelection = useViewer((state) => state.setSelection);
  const setPhase = useEditor((state) => state.setPhase);
  const setMode = useEditor((state) => state.setMode);

  const isSelected = selectedZoneId === zone.id;

  const handleClick = () => {
    setSelection({ zoneId: zone.id });
    setPhase("structure");
    setMode("select");
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
        "flex items-center h-7 cursor-pointer group/row text-sm px-3",
        isSelected
          ? "text-primary-foreground bg-primary/80 hover:bg-primary/90"
          : "text-muted-foreground hover:bg-accent/50"
      )}
      onClick={handleClick}
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
      <Hexagon className="w-3.5 h-3.5 mr-1.5 shrink-0" />
      <span className="truncate flex-1">{zone.name}</span>
      <button
        className="opacity-0 group-hover/row:opacity-100 w-5 h-5 flex items-center justify-center rounded cursor-pointer hover:bg-primary-foreground/20"
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

  // Show elements (walls, items, etc.) for this level
  if (level.children.length === 0) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">
        No elements on this level
      </div>
    );
  }

  return (
    <div className="py-1">
      {level.children.map((childId) => (
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
