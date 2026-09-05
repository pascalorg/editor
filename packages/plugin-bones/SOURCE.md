# Bones lives here now

`packages/plugin-bones` is the source of truth for Bones in this workspace as of
2026-09-04. It began as a working-tree mirror of the local clone at
`C:\Dev\Plan Crafters Integration\plugin-bones` (last synced at that clone's
commit c280b3f — the two trees were byte-identical when the mirror was retired),
because Turbopack cannot resolve a `file:` dependency outside the monorepo.

The clone is kept only as history; nothing syncs from it any more. Edit Bones
here, commit here (local commits only — this workspace never pushes to any
pascalorg remote), and treat `git log -- packages/plugin-bones` as its history
from this point on.
