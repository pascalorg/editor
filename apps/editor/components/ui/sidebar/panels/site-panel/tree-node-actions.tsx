import { type AnyNode, emitter, useScene } from "@pascal-app/core";
import { Camera, Eye, EyeOff, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/primitives/popover";

interface TreeNodeActionsProps {
  node: AnyNode;
}

export function TreeNodeActions({ node }: TreeNodeActionsProps) {
  const [open, setOpen] = useState(false);
  const updateNode = useScene((state) => state.updateNode);
  const hasCamera = !!node.camera;
  const isVisible = node.visible !== false;

  const toggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateNode(node.id, { visible: !isVisible });
  };

  const handleCaptureCamera = (e: React.MouseEvent) => {
    e.stopPropagation();
    emitter.emit("camera-controls:capture", { nodeId: node.id });
    setOpen(false);
  };
  const handleViewCamera = (e: React.MouseEvent) => {
    e.stopPropagation();
    emitter.emit("camera-controls:view", { nodeId: node.id });
    setOpen(false);
  };

  const handleClearCamera = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateNode(node.id, { camera: undefined });
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-0.5">
      <button
        className="w-5 h-5 flex items-center justify-center rounded cursor-pointer hover:bg-primary-foreground/20"
        onClick={toggleVisibility}
        title={isVisible ? "Hide" : "Show"}
      >
        {isVisible ? (
          <Eye className="w-3 h-3" />
        ) : (
          <EyeOff className="w-3 h-3 opacity-50" />
        )}
      </button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="relative w-5 h-5 flex items-center justify-center rounded cursor-pointer hover:bg-primary-foreground/20"
            onClick={(e) => e.stopPropagation()}
            title="Camera snapshot"
          >
            <Camera className="w-3 h-3" />
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
                onClick={handleViewCamera}
              >
                <Camera className="w-3.5 h-3.5" />
                View snapshot
              </button>
            )}
            <button
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
              onClick={handleCaptureCamera}
            >
              <Camera className="w-3.5 h-3.5" />
              {hasCamera ? "Update snapshot" : "Take snapshot"}
            </button>
            {hasCamera && (
              <button
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-destructive hover:text-destructive-foreground text-left w-full"
                onClick={handleClearCamera}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear snapshot
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
