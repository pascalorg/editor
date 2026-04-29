"use client";
import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { starProject, unstarProject } from "../actions";

interface StarButtonProps {
  projectId: string;
  initialStarred: boolean;
}

export function StarButton({ projectId, initialStarred }: StarButtonProps) {
  const [starred, setStarred] = useState(initialStarred);
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !starred;
    setStarred(next); // optimistic
    startTransition(async () => {
      try {
        if (next) await starProject(projectId);
        else await unstarProject(projectId);
      } catch {
        setStarred(!next); // revert on error
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      aria-label={starred ? "Unstar project" : "Star project"}
      className={`p-1.5 rounded transition-colors ${
        starred
          ? "text-yellow-400 hover:text-yellow-300"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      <Star className="w-4 h-4" fill={starred ? "currentColor" : "none"} />
    </button>
  );
}
