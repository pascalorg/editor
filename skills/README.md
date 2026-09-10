# Pascal agent skills

These public skills teach MCP-capable agents to use Pascal for editable building models and bounded spatial answers.

## Channel status

Status on 2026-09-10. Installable and publicly listed are separate results.

| Channel | Status |
| --- | --- |
| [skills.sh](https://skills.sh/pascalorg/editor) | Indexed automatically from this repository; installable, with install counts on that listing. |
| Claude Code plugin | Installable from this Git marketplace; not submitted to the Anthropic plugin directory. |
| Codex and Cursor Agent Plugin | Installable from this repository, including the root [`mcp.json`](../mcp.json) server; a Cursor-native [`.cursor-plugin/plugin.json`](../.cursor-plugin/plugin.json) carries the marketplace logo and category; not submitted to the OpenAI or Cursor marketplaces. |
| Gemini CLI extension | Root [`gemini-extension.json`](../gemini-extension.json) is present; installable from a release tag that carries it, and gallery listing waits on the `gemini-cli-extension` repository topic. |
| Official MCP Registry | `io.github.pascalorg/editor` 0.6.1 is published. |
| ClawHub and OpenClaw | Not published; waiting on an authorized publisher accepting the MIT-0 terms. |

## Install with skills.sh

List the available skills:

```bash
npx skills add https://github.com/pascalorg/editor/tree/main/skills --list
```

Install both skills:

```bash
npx skills add https://github.com/pascalorg/editor/tree/main/skills \
  --skill pascal-3d \
  --skill furniture-fit
```

Install just the furniture workflow:

```bash
npx skills add https://github.com/pascalorg/editor/tree/main/skills/furniture-fit
```

Use `-g` for a user-wide installation or `-a claude-code -a codex` to choose hosts explicitly.

skills.sh indexes this repository automatically, so no submission step is involved; its listing at [skills.sh/pascalorg/editor](https://skills.sh/pascalorg/editor) also reports install counts from the `skills` CLI.

## Install with OpenClaw

After publication under Pascal's ClawHub publisher, use the owner-qualified registry references and verify their trust envelopes:

```bash
openclaw skills install @pascalorg/pascal-3d
openclaw skills install @pascalorg/furniture-fit
openclaw skills verify @pascalorg/pascal-3d
openclaw skills verify @pascalorg/furniture-fit
```

The references above remain unavailable until an authorized Pascal publisher accepts ClawHub's MIT-0 publication terms and creates the releases. OpenClaw's `skills-sh:` resolver also requires the skill to be indexed by ClawHub, so the existing skills.sh listing is not a pre-publication workaround. Installing either skill provides instructions only; follow its setup reference to connect Pascal MCP.

## Install as a Claude Code or Codex plugin

This repository is also a shared plugin marketplace containing one plugin backed by the same `skills/` folders. For Claude Code:

```text
/plugin marketplace add pascalorg/editor
/plugin install pascal-agent-skills@pascal
```

For Codex:

```bash
codex plugin marketplace add pascalorg/editor
codex plugin add pascal-agent-skills@pascal
```

The Claude plugin installs the instructions from the canonical `skills/` directory and supplies two servers: a local stdio server that runs `pascal mcp connect`, and a hosted `pascal-hosted` server for `https://editor.pascal.app/api/mcp` that prompts for an optional Pascal API key when the plugin is enabled and keeps it in the OS keychain. This `skills/` directory is itself the Claude plugin root, so an install copies only the two skill bundles and their plugin metadata rather than the repository. Install and start the Pascal CLI first, and keep `pascal` on Claude Code's `PATH`. The bundled local connector needs no Pascal account or API key and does not upload projects automatically; leaving the hosted key empty keeps the install local-only. Codex and individually installed skills still use the setup reference included in either skill.

Claude Code 2.1.258 loads both the user-scoped `pascal` server created by `pascal mcp setup claude` and the plugin-provided server. Run `claude mcp remove --scope user pascal` before reloading or restarting Claude Code so only the plugin owns the connection lifecycle. Use `/mcp` to remove or disable any project- or local-scoped Pascal connection too. Leaving both connections active violates the one-active-agent-client-per-local-service requirement. For a hosted Pascal project, disable the plugin-provided local server in `/mcp`, then configure the hosted endpoint from the setup reference.

Plugin installation alone never creates an account, uploads a project, or authorizes paid work.

The root [`plugin.json`](../plugin.json) is the portable Agent Plugins manifest used for OpenAI submission, and the root [`mcp.json`](../mcp.json) is the only MCP configuration path Codex and Cursor read; Claude Code reads the same local server from [`.mcp.json`](.mcp.json) in its `skills/` plugin root, next to [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json), and only that file carries the hosted server because `${user_config.*}` substitution is Claude-specific. The repository keeps `.codex-plugin/plugin.json` as a compatibility fallback and validates that both expose the same OpenAI listing metadata. Public-directory submission, review, and publication are separate external steps; a Git marketplace install does not make the plugin publicly listed in ChatGPT or Codex.

The npm `beta` CLI remains on the older runtime contract. For the read-only `check_collisions.candidate` capability used by the current furniture workflow, follow the checksum-verified [GitHub preview instructions](pascal-3d/references/setup.md#verified-github-preview). The preview archive is published on GitHub, not npm.

Use one active agent client per local CLI service. Its standalone HTTP runtime shares active scene state; the hosted endpoint uses a separate session-isolated bridge.

## Install as a Gemini CLI extension

The root [`gemini-extension.json`](../gemini-extension.json) declares the same `pascal mcp connect` server and loads this file as the extension context. Gemini CLI resolves a plain repository URL to the GitHub release marked **Latest**, which predates this manifest, so install from a release tag that contains it:

```bash
gemini extensions install https://github.com/pascalorg/editor --ref <release tag>
```

Gemini CLI copies the extension on install; run `gemini extensions update pascal` to pull later changes.

## Included skills

| Skill | Use it for |
| --- | --- |
| [`pascal-3d`](pascal-3d/SKILL.md) | Connect Pascal safely, inspect or edit a scene, validate it, save it, and return a verified handoff. |
| [`furniture-fit`](furniture-fit/SKILL.md) | Assess a furniture footprint at stated poses and report collisions, door keep-outs, evidence gaps, and one bounded blocker-aware next action. |

Each skill is standalone. Its `references/`, `examples/`, and `evals/` folders travel with that skill when installed individually.

The `source-reviewed` date records a code and public-documentation review. The `native-host-validation` field points to a source-specific record rather than asserting that every host passed. See [the validation record](VALIDATION.md) for evaluated versions, completed checks, and remaining limits. Package installation, native task completion, and public directory listing are separate results.

## Validate the source package

```bash
bun run skills:validate
```

Run `claude plugin validate . --strict` manually as well. It stays out of the script and out of CI because it needs the Claude Code CLI, which is not installed on every runner.

The repository validator checks the exact two-skill public discovery surface, keeps contributor-only workflows internal, and checks frontmatter, semantic skill versions, bundled links and their heading anchors, task and trigger fixtures, semantic furniture next-action decision cases, scoped ClawHub ignore policies without re-inclusion overrides, the exact Claude local and hosted MCP configuration with the hosted key declared as an optional, sensitive user-configuration option, an identical local `pascal` server in the `mcp.json` Codex and Cursor read, a Gemini CLI manifest that runs the same command at the same version, Claude marketplace and plugin skills lists that equal the packaged bundles exactly, the publishing suite, the exact 46-tool OpenAI annotation and justification packet, portable and compatibility manifest consistency with one plugin version, description, and author across every plugin descriptor, OpenAI public-directory metadata limits including its documented interface fields, bundled branding assets, and accidental private-path or credential leakage.
