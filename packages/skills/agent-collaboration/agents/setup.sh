#!/bin/sh
# Generates tool-specific agent definitions from canonical agent files.
# Usage: sh setup.sh <tool> [target-dir]
#
# Tools: claude-code, opencode, cursor, aider
#
# Examples:
#   sh setup.sh opencode                           # → .opencode/agents/
#   sh setup.sh claude-code                        # → .claude/agents/
#   sh setup.sh opencode ~/myproject/.opencode/agents/
#   sh setup.sh claude-code ~/.claude/agents/

set -e

TOOL="$1"
CUSTOM_DIR="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$TOOL" ]; then
  echo "Usage: sh setup.sh <tool> [target-dir]"
  echo "Tools: claude-code, opencode, cursor, aider"
  exit 1
fi

# --- Default target directories ---
case "$TOOL" in
  claude-code) TARGET_DIR="${CUSTOM_DIR:-.claude/agents}" ;;
  opencode)    TARGET_DIR="${CUSTOM_DIR:-.opencode/agents}" ;;
  cursor)      TARGET_DIR="${CUSTOM_DIR:-.cursor/rules}" ;;
  aider)       TARGET_DIR="${CUSTOM_DIR:-.}" ;;
  *)
    echo "Error: Unknown tool '$TOOL'. Use: claude-code, opencode, cursor, aider" >&2
    exit 1
    ;;
esac

mkdir -p "$TARGET_DIR"

# --- Extract body from a canonical agent file (strip frontmatter) ---
extract_body() {
  # Skip everything between first --- and second ---
  awk 'BEGIN{fm=0} /^---$/{fm++; next} fm>=2{print}' "$1"
}

# --- Write an agent file with new frontmatter ---
write_agent() {
  AGENT_NAME="$1"
  FRONTMATTER="$2"
  SOURCE="$SCRIPT_DIR/$AGENT_NAME.md"
  DEST="$TARGET_DIR/$AGENT_NAME.md"

  if [ ! -f "$SOURCE" ]; then
    echo "  skip: $AGENT_NAME.md (not found)" >&2
    return
  fi

  {
    echo "---"
    echo "$FRONTMATTER"
    echo "---"
    extract_body "$SOURCE"
  } > "$DEST"

  echo "  wrote: $DEST"
}

# ============================================================
# Claude Code: Anthropic models, allowed-tools, effort levels
# ============================================================
setup_claude_code() {
  echo "Generating Claude Code agents → $TARGET_DIR/"

  write_agent "planner" "model: opus
effort: high
description: Decomposes complex tasks, assigns subtasks to specialist agents, evaluates results, and replans when needed
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Agent"

  write_agent "coder" "model: sonnet
effort: medium
description: Implements code changes, writes tests, and fixes bugs following the planner's specifications
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash"

  write_agent "researcher" "model: opus
effort: high
description: Web search, documentation lookup, summarization, and research synthesis
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - WebFetch"

  write_agent "scientist" "model: opus
effort: high
description: Mathematical reasoning, formal proofs, data analysis, and scientific computation
allowed-tools:
  - Read
  - Write
  - Grep
  - Glob
  - Bash"

  write_agent "visual-analyst" "model: opus
effort: high
description: Image analysis, UI/UX review, diagram interpretation, and visual reasoning
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash"

  write_agent "adversarial-reviewer" "model: sonnet
effort: high
description: Finds flaws, security vulnerabilities, edge cases, and logical errors. Assumes the code is broken.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash"

  write_agent "peer-reviewer" "model: opus
effort: high
description: Quality, architecture, and style review. Balances criticism with recognition of good decisions.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash"
}

# ============================================================
# OpenCode: Cross-provider models, permission system
# ============================================================
setup_opencode() {
  echo "Generating OpenCode agents → $TARGET_DIR/"

  write_agent "planner" "model: anthropic/claude-opus-4-6
description: Decomposes complex tasks, assigns subtasks to specialist agents, evaluates results, replans
permission:
  edit: deny"

  write_agent "coder" "model: openai/gpt-5.4
description: Implements code, writes tests, fixes bugs following the planner's specifications"

  write_agent "researcher" "model: google/gemini-3.1-pro
description: Web search, documentation lookup, summarization, and research synthesis
permission:
  edit: deny"

  write_agent "scientist" "model: google/gemini-3-pro
description: Mathematical reasoning, formal proofs, data analysis, scientific computation"

  write_agent "visual-analyst" "model: anthropic/claude-opus-4-6
description: Image analysis, UI/UX review, diagram interpretation, visual reasoning
permission:
  edit: deny"

  write_agent "adversarial-reviewer" "model: xai/grok-4
description: Finds flaws, security vulnerabilities, edge cases, and logical errors. Assumes the code is broken.
permission:
  edit: deny"

  write_agent "peer-reviewer" "model: anthropic/claude-opus-4-6
description: Quality, architecture, and style review. Balances criticism with recognition of good decisions.
permission:
  edit: deny"
}

# ============================================================
# Cursor: .mdc rule file (single file, no sub-agents)
# ============================================================
setup_cursor() {
  echo "Generating Cursor rules → $TARGET_DIR/"
  cat > "$TARGET_DIR/agent-collaboration.mdc" << 'CURSOR_EOF'
---
description: Multi-model agent collaboration workflow
globs: ["**/*"]
---

# Agent Collaboration Workflow

When working on complex tasks, follow this workflow:

## Planning Phase (use Claude Opus)
- Break the task into subtasks with clear success criteria
- Identify dependencies between subtasks
- Assign each subtask to an execution phase

## Implementation Phase (use GPT-5.4 or Claude Sonnet)
- Follow the plan exactly — no scope expansion
- Write tests for new functionality
- Report what changed and why

## Review Phase (switch model for fresh perspective)
- Review for security vulnerabilities, edge cases, and logical errors
- Check architecture, style, and best practices
- Provide explicit verdict: approve or request changes

## Replan Phase (use Claude Opus)
- Evaluate review feedback
- Decide: accept, revise, or restart
- If revising, specify exact changes needed
CURSOR_EOF
  echo "  wrote: $TARGET_DIR/agent-collaboration.mdc"
}

# ============================================================
# Aider: .aider.conf.yml (dual-model architect/editor)
# ============================================================
setup_aider() {
  echo "Generating Aider config → $TARGET_DIR/"
  cat > "$TARGET_DIR/.aider.conf.yml" << 'AIDER_EOF'
# Agent Collaboration: Planner (architect) + Coder (editor) dual-model
model: anthropic/claude-opus-4-6
editor-model: openai/gpt-5.4
weak-model: google/gemini-3-flash
edit-format: architect
AIDER_EOF
  echo "  wrote: $TARGET_DIR/.aider.conf.yml"
  echo ""
  echo "  Aider handles Plan→Code natively via architect/editor mode."
  echo "  For review, run a separate session:"
  echo "    aider --model xai/grok-4 --no-auto-commits --message \"Review recent changes for issues\""
}

# --- Dispatch ---
case "$TOOL" in
  claude-code) setup_claude_code ;;
  opencode)    setup_opencode ;;
  cursor)      setup_cursor ;;
  aider)       setup_aider ;;
esac

echo ""
echo "Done. Agents generated for $TOOL."
