# Mirrored package

This directory is a working-tree mirror of the local Bones clone at
`C:\Dev\Plan Crafters Integration\plugin-bones` (git source of truth, local
commits only, never pushed). Turbopack cannot resolve a `file:` dependency that
lives outside this monorepo, so the tree is copied in as a workspace package.

Sync after committing in the clone:

    robocopy "C:\Dev\Plan Crafters Integration\plugin-bones" packages\plugin-bones /MIR /XD node_modules .git dist .turbo /XF bun.lockb
