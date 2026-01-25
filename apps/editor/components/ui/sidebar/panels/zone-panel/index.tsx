import { useScene, type ZoneNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Hexagon, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import useEditor from "@/store/use-editor";
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

function ZoneItem({ zone }: { zone: ZoneNode }) {
  const deleteNode = useScene((state) => state.deleteNode);
  const updateNode = useScene((state) => state.updateNode);
  const selectedZoneId = useViewer((state) => state.selection.zoneId);
  const setSelection = useViewer((state) => state.setSelection);

  const isSelected = selectedZoneId === zone.id;

  const handleClick = () => {
    setSelection({ zoneId: zone.id });
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

export function ZonePanel() {
  const nodes = useScene((state) => state.nodes);
  const currentLevelId = useViewer((state) => state.selection.levelId);
  const setPhase = useEditor((state) => state.setPhase);
  const setMode = useEditor((state) => state.setMode);
  const setTool = useEditor((state) => state.setTool);

  // Filter nodes to get zones for the current level
  const levelZones = Object.values(nodes).filter(
    (node): node is ZoneNode =>
      node.type === "zone" && node.parentId === currentLevelId
  );

  const handleAddZone = () => {
    if (currentLevelId) {
      setPhase("structure");
      setMode("build");
      setTool("zone");
    }
  };

  if (!currentLevelId) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">
        Select a level to view and create zones
      </div>
    );
  }

  return (
    <div className="py-1">
      {levelZones.length === 0 ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          No zones on this level.{" "}
          <button
            className="text-primary hover:underline cursor-pointer"
            onClick={handleAddZone}
          >
            Add one
          </button>
        </div>
      ) : (
        levelZones.map((zone) => <ZoneItem key={zone.id} zone={zone} />)
      )}
    </div>
  );
}
