export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER' | 'COMMENTER'

export function canEdit(role: ProjectRole): boolean {
  return role === 'OWNER' || role === 'EDITOR'
}

export function canComment(role: ProjectRole): boolean {
  return role !== 'VIEWER'
}

export function toAccessLevel(role: ProjectRole): 'edit' | 'view' {
  return canEdit(role) ? 'edit' : 'view'
}

export const ROLE_LABELS: Record<ProjectRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
  COMMENTER: 'Commenter',
}

export const ROLE_COLORS: Record<ProjectRole, string> = {
  OWNER: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  EDITOR: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  VIEWER: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
  COMMENTER: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
}
