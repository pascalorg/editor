"use client";
import { useRef, useState, useEffect } from "react";
import { MoreHorizontal } from "lucide-react";
import { RenameModal } from "./RenameModal";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

interface ProjectContextMenuProps {
  projectId: string;
  projectName: string;
}

export function ProjectContextMenu({ projectId, projectName }: ProjectContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleTrigger(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen((prev) => !prev);
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          onClick={handleTrigger}
          aria-label="Project options"
          className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                setIsRenaming(true);
              }}
              className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              Rename
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                setIsDeleting(true);
              }}
              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-zinc-700 transition-colors"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {isRenaming && (
        <RenameModal
          projectId={projectId}
          currentName={projectName}
          onClose={() => setIsRenaming(false)}
        />
      )}

      {isDeleting && (
        <DeleteConfirmModal
          projectId={projectId}
          projectName={projectName}
          onClose={() => setIsDeleting(false)}
        />
      )}
    </>
  );
}
