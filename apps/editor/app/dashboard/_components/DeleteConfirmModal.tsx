"use client";
import { useTransition } from "react";
import { deleteProject } from "../actions";

interface DeleteConfirmModalProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export function DeleteConfirmModal({ projectId, projectName, onClose }: DeleteConfirmModalProps) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteProject(projectId);
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-2">Delete Project</h2>
        <p className="text-sm text-zinc-400 mb-6">
          Are you sure you want to delete <span className="text-white font-medium">&ldquo;{projectName}&rdquo;</span>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
