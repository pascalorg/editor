import { useScene, type AnyNode } from "@pascal-app/core";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/primitives/popover";

interface RenamePopoverProps {
  node: AnyNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  defaultName: string;
}

export function RenamePopover({
  node,
  open,
  onOpenChange,
  children,
  defaultName,
}: RenamePopoverProps) {
  const updateNode = useScene((s) => s.updateNode);
  const [value, setValue] = useState(node.name || "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset value when popover opens
  useEffect(() => {
    if (open) {
      setValue(node.name || "");
      // Focus and select all text after a short delay
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [open, node.name]);

  const handleSave = useCallback(() => {
    const trimmed = value.trim();
    // Only update if name actually changed
    if (trimmed !== node.name) {
      updateNode(node.id, { name: trimmed || undefined });
    }
    onOpenChange(false);
  }, [value, node.id, node.name, updateNode, onOpenChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        className="w-64 p-2 z-50"
        align="start"
        side="right"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={defaultName}
            className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={handleSave}
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
