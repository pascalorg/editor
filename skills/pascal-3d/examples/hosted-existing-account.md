# Example: edit an existing hosted project

User request:

> Add one window to the project in my Pascal workspace and leave everything else alone.

Expected workflow:

1. Use a Settings-created key for the same user or organization that owns the project.
2. Load the exact project, record its version or graph hash, and identify the target wall.
3. Add one window with the semantic opening tool.
4. Re-read the target, verify that unrelated node counts remain stable, then run `validate_scene` and `verify_scene`.
5. Save a draft and return the `editorUrl`, changed node ID, and validation result.

Self-registration is the wrong path because it creates a separate owner account.
