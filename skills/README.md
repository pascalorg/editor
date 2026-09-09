# Pascal agent skills

These public skills teach MCP-capable agents to use Pascal for editable building models and bounded spatial answers.

## Install with skills.sh

List the available skills:

```bash
npx skills add pascalorg/editor --list
```

Install both skills:

```bash
npx skills add pascalorg/editor \
  --skill pascal-3d \
  --skill furniture-fit
```

Install just the furniture workflow:

```bash
npx skills add https://github.com/pascalorg/editor/tree/main/skills/furniture-fit
```

Use `-g` for a user-wide installation or `-a claude-code -a codex` to choose hosts explicitly.

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

The plugin installs the instructions from the canonical `skills/` directory. Connect Pascal MCP separately by following the setup reference included in either skill. Installation alone never creates an account, uploads a project, or authorizes paid work.

The root [`plugin.json`](../plugin.json) is the portable Agent Plugins manifest used for OpenAI submission. The repository keeps `.codex-plugin/plugin.json` as a compatibility fallback and validates that both expose the same OpenAI listing metadata. Public-directory submission, review, and publication are separate external steps; a Git marketplace install does not make the plugin publicly listed in ChatGPT or Codex.

The npm `beta` CLI remains on the older runtime contract. For the read-only `check_collisions.candidate` capability used by the current furniture workflow, follow the checksum-verified [GitHub preview instructions](pascal-3d/references/setup.md#candidate-enabled-github-preview). The preview archive is published on GitHub, not npm.

Use one active agent client per local CLI service. Its standalone HTTP runtime shares active scene state; the hosted endpoint uses a separate session-isolated bridge.

## Included skills

| Skill | Use it for |
| --- | --- |
| [`pascal-3d`](pascal-3d/SKILL.md) | Connect Pascal safely, inspect or edit a scene, validate it, save it, and return a verified handoff. |
| [`furniture-fit`](furniture-fit/SKILL.md) | Assess a furniture footprint at stated poses and report collisions, door keep-outs, evidence gaps, and one bounded blocker-aware next action. |

Each skill is standalone. Its `references/`, `examples/`, and `evals/` folders travel with that skill when installed individually.

The `source-reviewed` date records a code and public-documentation review. The `native-host-validation` field points to a source-specific record rather than asserting that every host passed. See [the validation record](VALIDATION.md) for evaluated versions, completed checks, and remaining limits. Package installation, native task completion, and public directory listing are separate results.

## Validate the source package

```bash
bun scripts/validate-skills.ts
claude plugin validate . --strict
```

The repository validator checks frontmatter, bundled links, task and trigger fixtures, semantic furniture next-action decision cases, the publishing suite, portable and compatibility manifest consistency, OpenAI public-directory metadata limits, bundled branding assets, and accidental private-path or credential leakage.
