"use client";

import { Button } from "@/components/ui/primitives/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";
import { Hammer, MousePointer2, Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import useEditor, { Mode, Phase } from "@/store/use-editor";

type ModeConfig = {
  id: Mode;
  icon: typeof MousePointer2;
  label: string;
  shortcut: string;
  color: string;
  activeColor: string;
};

// All available control modes
const allModes: ModeConfig[] = [
  {
    id: "select",
    icon: MousePointer2,
    label: "Select",
    shortcut: "V",
    color: "hover:bg-blue-500/20 hover:text-blue-400",
    activeColor: "bg-blue-500/20 text-blue-400",
  },
  {
    id: "edit",
    icon: Pencil,
    label: "Edit",
    shortcut: "E",
    color: "hover:bg-orange-500/20 hover:text-orange-400",
    activeColor: "bg-orange-500/20 text-orange-400",
  },
  {
    id: "build",
    icon: Hammer,
    label: "Build",
    shortcut: "B",
    color: "hover:bg-green-500/20 hover:text-green-400",
    activeColor: "bg-green-500/20 text-green-400",
  },
  {
    id: "delete",
    icon: Trash2,
    label: "Delete",
    shortcut: "D",
    color: "hover:bg-red-500/20 hover:text-red-400",
    activeColor: "bg-red-500/20 text-red-400",
  },
  // {
  //   id: 'painting',
  //   icon: Paintbrush,
  //   label: 'Painting',
  //   shortcut: 'P',
  //   color: 'hover:bg-cyan-500/20 hover:text-cyan-400',
  //   activeColor: 'bg-cyan-500/20 text-cyan-400',
  // },
  // {
  //   id: 'guide',
  //   icon: Image,
  //   label: 'Guide',
  //   shortcut: 'G',
  //   color: 'hover:bg-purple-500/20 hover:text-purple-400',
  //   activeColor: 'bg-purple-500/20 text-purple-400',
  // },
];

// Define which modes are available in each editor mode
const modesByPhase: Record<Phase, Mode[]> = {
  site: ["select", "edit"],
  structure: ["select", "delete", "build"],
  furnish: ["select", "delete", "build"],
};

export function ControlModes() {
  const mode = useEditor((state) => state.mode);
  const phase = useEditor((state) => state.phase);
  const setMode = useEditor((state) => state.setMode);

  const availableModeIds = modesByPhase[phase];
  const availableModes = allModes.filter((m) =>
    availableModeIds.includes(m.id)
  );

  const handleModeClick = (mode: Mode) => {
    setMode(mode);
  };

  return (
    <div className="flex items-center gap-1">
      {availableModes.map((m) => {
        const Icon = m.icon;
        const isActive = mode === m.id;

        return (
          <Tooltip key={m.id}>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  "h-8 w-8 transition-all",
                  "text-zinc-400",
                  !isActive && m.color,
                  isActive && m.activeColor
                )}
                onClick={() => handleModeClick(m.id)}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {m.label} ({m.shortcut})
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
