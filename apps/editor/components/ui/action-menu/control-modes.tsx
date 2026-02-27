"use client";

import Image from "next/image";
import { ActionButton } from "./action-button";
import { Pencil, Trash2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import useEditor, { Mode, Phase } from "@/store/use-editor";

type ModeConfig = {
  id: Mode;
  icon?: LucideIcon;
  imageSrc?: string;
  label: string;
  shortcut: string;
  color: string;
  activeColor: string;
};

// All available control modes
const allModes: ModeConfig[] = [
  {
    id: "select",
    imageSrc: "/icons/select.png",
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
    imageSrc: "/icons/build.png",
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
        const isImageMode = Boolean(m.imageSrc);

        return (
          <ActionButton
            key={m.id}
            label={m.label}
            shortcut={m.shortcut}
            className={cn(
              "text-muted-foreground",
              !isImageMode && !isActive && m.color,
              !isImageMode && isActive && m.activeColor,
              isImageMode && isActive && "bg-white/10 hover:bg-white/10",
              isImageMode && !isActive && "hover:bg-white/5"
            )}
            onClick={() => handleModeClick(m.id)}
            size="icon"
            variant="ghost"
          >
            {m.imageSrc ? (
              <Image
                alt={m.label}
                className={cn(
                  "h-[28px] w-[28px] object-contain transition-[opacity,filter] duration-200",
                  !isActive && "opacity-60 grayscale",
                  isActive && "opacity-100 grayscale-0"
                )}
                height={28}
                src={m.imageSrc}
                width={28}
              />
            ) : (
              Icon && <Icon className="h-5 w-5" />
            )}
          </ActionButton>
        );
      })}
    </div>
  );
}
