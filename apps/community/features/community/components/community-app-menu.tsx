"use client";

import { ArrowLeft, Command, FolderOpen, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/primitives/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/primitives/popover";
import { useCommandPalette } from "@/components/ui/command-palette";
import { cn } from "@/lib/utils";
import { useProjectStore } from "../lib/projects/store";

function OpenProjectModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => s.activeProject);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);

  useEffect(() => {
    if (open && projects.length === 0) {
      fetchProjects();
    }
  }, [open, projects.length, fetchProjects]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/50">
          <DialogTitle className="text-sm font-medium">Open project</DialogTitle>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {projects.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground text-center">
              No projects found
            </p>
          ) : (
            projects.map((project) => {
              const isActive = project.id === activeProject?.id;
              return (
                <button
                  key={project.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
                    isActive && "bg-accent/50"
                  )}
                  onClick={() => {
                    onOpenChange(false);
                    router.push(`/editor/${project.id}`);
                  }}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted overflow-hidden">
                    {project.thumbnail_url ? (
                      <img
                        src={project.thumbnail_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <p className="flex-1 min-w-0 truncate text-sm font-medium">
                    {project.name}
                  </p>
                  {isActive && (
                    <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CommunityAppMenu() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isOpenProjectOpen, setIsOpenProjectOpen] = useState(false);

  const handleOpenProject = () => {
    setIsMenuOpen(false);
    setIsOpenProjectOpen(true);
  };

  return (
    <>
      <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-all hover:bg-accent"
          >
            <Image
              src="/pascal-logo-shape.svg"
              alt="Pascal"
              width={24}
              height={24}
              className="h-6 w-6 dark:invert"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-52 p-1" sideOffset={8}>
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            onClick={() => setIsMenuOpen(false)}
          >
            <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            Back to community
          </Link>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            onClick={handleOpenProject}
          >
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            Open project
          </button>
          <div className="my-1 h-px bg-border/50" />
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => { setIsMenuOpen(false); useCommandPalette.getState().setOpen(true); }}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">Actions...</span>
            <span className="flex items-center gap-0.5 rounded border border-border/60 bg-muted/60 px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
              <Command className="h-2.5 w-2.5" />
              K
            </span>
          </button>
        </PopoverContent>
      </Popover>

      <OpenProjectModal open={isOpenProjectOpen} onOpenChange={setIsOpenProjectOpen} />
    </>
  );
}
