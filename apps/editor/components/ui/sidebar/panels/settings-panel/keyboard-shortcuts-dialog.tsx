import { Keyboard } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/primitives/dialog";

type Shortcut = {
  keys: string[];
  action: string;
  note?: string;
};

type ShortcutCategory = {
  title: string;
  shortcuts: Shortcut[];
};

const KEY_DISPLAY_MAP: Record<string, string> = {
  "Arrow Up": "↑",
  "Arrow Down": "↓",
  Esc: "⎋",
  Shift: "⇧",
  Space: "␣",
};

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: "Editor Navigation",
    shortcuts: [
      { keys: ["1"], action: "Switch to Site phase" },
      { keys: ["2"], action: "Switch to Structure phase" },
      { keys: ["3"], action: "Switch to Furnish phase" },
      { keys: ["S"], action: "Switch to Structure layer" },
      { keys: ["F"], action: "Switch to Furnish layer" },
      { keys: ["Z"], action: "Switch to Zones layer" },
      {
        keys: ["Cmd/Ctrl", "Arrow Up"],
        action: "Select next level in the active building",
      },
      {
        keys: ["Cmd/Ctrl", "Arrow Down"],
        action: "Select previous level in the active building",
      },
      { keys: ["Cmd/Ctrl", "B"], action: "Toggle sidebar" },
    ],
  },
  {
    title: "Modes & History",
    shortcuts: [
      { keys: ["V"], action: "Switch to Select mode" },
      { keys: ["B"], action: "Switch to Build mode" },
      {
        keys: ["Esc"],
        action: "Cancel active tool, clear selection, and exit build mode",
      },
      { keys: ["Delete / Backspace"], action: "Delete selected objects" },
      { keys: ["Cmd/Ctrl", "Z"], action: "Undo" },
      { keys: ["Cmd/Ctrl", "Shift", "Z"], action: "Redo" },
    ],
  },
  {
    title: "Selection",
    shortcuts: [
      {
        keys: ["Cmd/Ctrl", "Click"],
        action: "Add or remove an object from multi-selection",
        note: "Works while in Select mode.",
      },
    ],
  },
  {
    title: "Drawing Tools",
    shortcuts: [
      {
        keys: ["Shift"],
        action: "Temporarily disable angle snapping while drawing walls, slabs, and ceilings",
        note: "Hold while drawing.",
      },
    ],
  },
  {
    title: "Item Placement",
    shortcuts: [
      { keys: ["R"], action: "Rotate item clockwise by 90 degrees" },
      { keys: ["T"], action: "Rotate item counter-clockwise by 90 degrees" },
      {
        keys: ["Shift"],
        action: "Temporarily bypass placement validation constraints",
        note: "Hold while placing.",
      },
    ],
  },
  {
    title: "Camera",
    shortcuts: [
      {
        keys: ["Space", "Drag"],
        action: "Pan camera",
        note: "Hold Space while dragging with the mouse.",
      },
    ],
  },
];

function getDisplayKey(key: string, isMac: boolean): string {
  if (key === "Cmd/Ctrl") return isMac ? "⌘" : "Ctrl";
  if (key === "Delete / Backspace") return isMac ? "⌫" : "Backspace";
  return KEY_DISPLAY_MAP[key] ?? key;
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <div key={`${key}-${index}`} className="flex items-center gap-1">
          {index > 0 ? (
            <span className="text-[10px] text-muted-foreground">+</span>
          ) : null}
          <kbd
            className="inline-flex h-6 items-center rounded border border-border bg-muted px-2 font-mono text-[11px] font-medium text-muted-foreground"
            title={key}
          >
            {getDisplayKey(key, isMac)}
          </kbd>
        </div>
      ))}
    </div>
  );
}

export function KeyboardShortcutsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Keyboard className="size-4" />
          Keyboard Shortcuts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] flex flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are context-aware and depend on the current phase or tool.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {SHORTCUT_CATEGORIES.map((category) => (
            <section key={category.title} className="space-y-2">
              <h3 className="font-medium text-sm">{category.title}</h3>
              <div className="overflow-hidden rounded-md border border-border/80">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    key={`${category.title}-${shortcut.action}`}
                    className="grid grid-cols-[minmax(130px,220px)_1fr] gap-3 px-3 py-2"
                  >
                    <ShortcutKeys keys={shortcut.keys} />
                    <div>
                      <p className="text-sm">{shortcut.action}</p>
                      {shortcut.note ? (
                        <p className="text-muted-foreground text-xs">{shortcut.note}</p>
                      ) : null}
                    </div>
                    {index < category.shortcuts.length - 1 ? (
                      <div className="col-span-2 border-border/60 border-b" />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
