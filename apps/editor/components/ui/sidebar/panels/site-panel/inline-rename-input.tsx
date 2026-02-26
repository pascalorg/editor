import { useScene, type AnyNode } from "@pascal-app/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface InlineRenameInputProps {
  node: AnyNode;
  isEditing: boolean;
  onStopEditing: () => void;
  defaultName: string;
  className?: string;
  onStartEditing?: () => void;
}

export function InlineRenameInput({
  node,
  isEditing,
  onStopEditing,
  defaultName,
  className,
  onStartEditing,
}: InlineRenameInputProps) {
  const updateNode = useScene((s) => s.updateNode);
  const [value, setValue] = useState(node.name || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setValue(node.name || "");
      // Focus and select all text after a short delay
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 0);
    }
  }, [isEditing, node.name]);

  const handleSave = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed !== node.name) {
      updateNode(node.id, { name: trimmed || undefined });
    }
    onStopEditing();
  }, [value, node.id, node.name, updateNode, onStopEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onStopEditing();
    }
  };

  if (!isEditing) {
    return (
      <div className="flex items-center gap-1 group/rename min-w-0 h-5">
        <span 
          className={cn("truncate border-b border-transparent", className)}
        >
          {node.name || defaultName}
        </span>
        {onStartEditing && (
          <button
            className="opacity-0 group-hover/rename:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onStartEditing();
            }}
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleSave}
      placeholder={defaultName}
      className={cn(
        "flex-1 w-full bg-transparent text-foreground outline-none border-b border-primary/50 focus:border-primary rounded-none px-0 py-0 m-0 h-5 text-sm",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
