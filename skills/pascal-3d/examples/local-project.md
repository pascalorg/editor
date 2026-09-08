# Example: create a local project

User request:

> Keep this on my Mac. Create a 4 m by 3 m room with one door, validate it, and give me the local editor link.

Expected workflow:

1. Select the local CLI path; do not request an account or API key.
2. If needed, install with `npm install --global @pascal-app/cli@beta`, run `pascal editor --no-open`, then configure the active host with `pascal mcp setup <host>`. Use one active agent client per local service; concurrent clients share active scene state.
3. Read `pascal://agent-guide`.
4. Call `create_project`, `create_room`, and `add_door` with meter values.
5. Call `validate_scene`, `verify_scene`, `save_scene` in draft mode, and `get_project_status`.
6. Return the exact local `editorUrl` and any unresolved verification issues.

The answer should not claim cloud backup, account creation, publication, or GLB export.
