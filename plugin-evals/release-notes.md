# OpenAI submission release notes

Draft release notes for a future Pascal agent skills 0.1.12 **With MCP** submission.

First directory submission of Pascal's ChatGPT package. Pascal models buildings as editable 3D scenes through its hosted MCP server at `https://editor.pascal.app/api/mcp`: build rooms and houses from a description or a dimensioned floor plan, try a renovation change, validate and save the result, and return a link that opens it in Pascal's 3D editor. People sign in with their Pascal account through OAuth and approve the workspace the plugin can use.

This package declares that hosted server, with OAuth and CIMD client registration, as its only MCP server, adds the support URL, and rewrites the listing around these capabilities. Every tool carries a title and explicit `readOnlyHint`, `destructiveHint`, and `openWorldHint` values. Models are design aids, not measured surveys, engineering drawings, or permit documents.

It contains only the `pascal-3d` skill. It leaves out the `architect` skill, because Architect's tools need the `architect:run` scope and ChatGPT's connection is not granted it, and it leaves out the `furniture-fit` skill.

Codex installs from Pascal's Git marketplace are a separate channel and do not use this package: they keep the local `pascal mcp connect` server, because Pascal's hosted OAuth sign-in does not accept the Codex client, and Codex users register the hosted endpoint with an API key.

Draft release notes for the previous Pascal agent skills 0.1.10 **With MCP** submission.

The plugin teaches ChatGPT and Codex to create, inspect, edit, validate, save, and hand off editable Pascal 3D scenes through a separately connected Pascal MCP server. It also includes a focused furniture-fit workflow that reports measured footprint evidence, unsupported checks, and one bounded next action without authorizing project changes or spending.

The source package contains two skills, portable Agent Plugins metadata, OpenAI listing metadata, bundled square icons, and a machine-readable packet that gives exact values and per-hint justifications for all 65 expected MCP tools. Local validators require that packet to match the registered server inventory and annotation values. Both skills require Pascal MCP tools for their tool-backed workflows, so they must not be submitted through the Skills only route.

The With MCP submission remains blocked until an authorized verified OpenAI publisher identity is confirmed, the portal-generated domain challenge is served and accepted, the production endpoint passes Scan Tools, OAuth-compatible reviewer access and credentials exist, and each positive case names a disposable fixture a reviewer can access without internal setup. This is submission preparation only. No portal scan, domain verification, submission, review, approval, publication, or listing is represented by this file.
