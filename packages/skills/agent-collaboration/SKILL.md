---
name: agent-collaboration
description: Multi-model agent orchestration using specialized agents for planning, coding, research, math/science, visual analysis, and adversarial review. Use when tasks are complex enough to benefit from different models' strengths, when you want adversarial review to catch blind spots, or when coordinating multi-step workflows across agent roles. Triggers on complex projects, multi-step tasks, architecture decisions, or when explicitly requested.
metadata:
  author: pascalorg
  version: "1.0.0"
---

# Agent Collaboration

Orchestrate multiple AI models as specialized agents — each assigned to what it does best. One model plans, another codes, another reviews. The planner stays in the loop, re-entering after every phase to evaluate and redirect.

---

## When to Use

- Complex projects requiring planning, implementation, and review
- Tasks where a single model's blind spots are a risk
- When you want adversarial review to catch what self-review cannot
- Research-heavy work requiring web search, synthesis, and validation
- Math or science tasks requiring specialized reasoning
- Any task benefiting from a plan → execute → review → replan loop
- When the user explicitly asks for multi-model collaboration

## When NOT to Use

- One-line fixes, typo corrections, simple questions
- Tasks fully within a single model's strength
- When speed matters more than thoroughness
- Exploratory conversations without a concrete deliverable

---

## Philosophy

**One model cannot be the best at everything.** Benchmarks consistently show different model families excel at different tasks. Claude Opus excels at planning and abstract reasoning. GPT-5.4 leads at code implementation. Gemini 3.1 Pro dominates math, science, and knowledge retrieval. Grok 4 brings contrarian perspective. Combining these as specialized agents outperforms any single model on complex tasks.

**The planner is the conductor.** It decomposes, delegates, evaluates, and replans. Every other agent reports back to the planner. The planner never edits files — it reads code for context and spawns sub-agents, but its authority comes from directing, not doing.

**Adversarial review is not optional.** A different model family reviewing the work catches failure modes that self-review cannot. The adversarial reviewer's job is to find problems, not to be diplomatic.

**Agents are disposable, context is not.** Each agent may be stateless, but the handoff between agents must preserve all relevant context. The planner is responsible for ensuring no information is lost between phases.

---

## The Seven Agents

### 1. Planner

- **Role:** Decompose complex tasks into subtasks, assign each to the right agent, define success criteria, evaluate results, replan when needed
- **Primary model:** Claude Opus 4.6 (extended thinking)
- **Fallback:** Claude Opus 4.5, GPT-5.4 (high reasoning)
- **Why Opus:** #1 Arena overall (1504 Elo), #1 Hard Prompts, best abstract reasoning (ARC-AGI 2: 68.8%). Extended thinking excels at structured decomposition and multi-step planning
- **Tools:** No file edits. The planner reads code, runs read-only shell commands (git log, ls), and spawns sub-agents — but never writes or edits files
- **Output:** Structured plan in YAML with subtask assignments, dependencies, and success criteria

### 2. Coder

- **Role:** Implement code changes, write tests, fix bugs, refactor. Follows the plan exactly
- **Primary model:** GPT-5.4 (high reasoning)
- **Fallback:** Claude Sonnet 4.5, Claude Sonnet 4.6
- **Why GPT-5.4:** Leads Aider coding leaderboard (88%). Fast, precise, excellent at turning plans into working code
- **Why Sonnet 4.5 as fallback:** Leads SWE-bench Verified (82%). Strong at real-world software engineering tasks
- **Tools:** Full file system access — read, write, edit, terminal, package managers
- **Output:** Changed files, test results, implementation summary

### 3. Researcher

- **Role:** Web search, documentation lookup, API exploration, literature review, competitive analysis, summarization
- **Primary model:** Gemini 3.1 Pro
- **Fallback:** Claude Opus 4.6
- **Why Gemini 3.1 Pro:** Leads Humanity's Last Exam (45.8%), top MMMLU (91.8%). Exceptional at finding and synthesizing information across broad knowledge domains
- **Why Opus as fallback:** Best on BrowseComp (web research synthesis). Excels at connecting disparate information
- **Tools:** Web search, web fetch, file read. No file edits — the researcher reports, it doesn't implement
- **Output:** Research summary with source attribution, key findings, decision-relevant tradeoffs

### 4. Scientist

- **Role:** Mathematical reasoning, formal proofs, statistical modeling, data analysis, algorithm verification, scientific computation
- **Primary model:** Gemini 3 Pro
- **Fallback:** GPT 5.2, Claude Opus 4.6
- **Why Gemini 3 Pro:** Scores 100% on AIME 2025, 94.3% GPQA Diamond. Exceptional at step-by-step mathematical reasoning and formal proofs
- **Why GPT 5.2 as fallback:** Also 100% on AIME 2025, 92.4% GPQA Diamond
- **Tools:** Code execution (for computation and verification), file read/write for results. Web access not typically needed
- **Output:** Formal analysis, proofs, computed results with methodology

### 5. Visual Analyst

- **Role:** Image analysis, UI/UX review, diagram interpretation, screenshot analysis, visual regression detection, design system compliance
- **Primary model:** Claude Opus 4.6
- **Fallback:** Gemini 3.1 Pro
- **Why Opus:** ARC-AGI 2: 68.8% (dominant lead in abstract visual reasoning). Strong multimodal understanding with structured output
- **Why Gemini as fallback:** MMMU-Pro 80.5%. Excellent at interpreting complex visual content
- **Tools:** Image reading, screenshot capture, file read. No file edits — reports visual findings
- **Output:** Visual analysis report with specific observations, issues, and recommendations

### 6. Adversarial Reviewer

- **Role:** Find flaws, security vulnerabilities, edge cases, logical errors, incorrect assumptions, race conditions, and performance problems. Challenge every decision. Assume the code is broken until proven otherwise
- **Primary model:** Grok 4
- **Fallback:** Gemini 3.1 Pro, Claude Opus 4.6
- **Why Grok 4:** #4 Arena overall with a direct, contrarian communication style. Using a fundamentally different model family than the coder ensures genuine adversarial perspective, not self-congratulatory review
- **Why a different model family matters:** Models from the same family share similar blind spots. Cross-family review catches what same-family review misses
- **Tools:** Read-only. The adversarial reviewer never edits — it produces a list of issues ranked by severity
- **Output:** Issues list with severity (critical/high/medium/low), reproduction steps, and suggested fixes

### 7. Peer Reviewer

- **Role:** Quality assessment, architecture review, style consistency, best practices, documentation review, maintainability analysis
- **Primary model:** Claude Opus 4.6
- **Fallback:** GPT-4o
- **Why Opus:** Excels at structured, thorough analysis. Balances pragmatism with quality standards
- **Why GPT-4o as fallback:** Shows least positivity bias in peer review (per AI Scientist research, Sakana AI). Honest without being hostile
- **Tools:** Read-only. Produces a review with an explicit verdict: approve, request changes, or reject
- **Output:** Structured review with verdict, praise for good decisions, and specific change requests

---

## How It Works

This is a **manual dispatch workflow** — you (or your primary agent session) are the dispatcher. The agents do not self-orchestrate. You follow the orchestration loop below, invoking each agent as needed and passing context between them using the handoff protocol. The skill provides the workflow patterns, agent definitions, and handoff formats. You provide the judgment calls.

## The Orchestration Loop

Every complex task follows this loop. The planner is always the entry and exit point.

```
┌──────────────────────────────────────────────┐
│                  PLANNER                      │
│           Claude Opus 4.6 (thinking)          │
│                                               │
│  1. Analyze the full task and constraints      │
│  2. Break into concrete subtasks              │
│  3. Assign each subtask to an agent role      │
│  4. Define success criteria per subtask       │
│  5. Specify execution order and dependencies  │
│  6. Identify which subtasks can run parallel  │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│             EXECUTION PHASE                   │
│     (parallel where no dependencies)          │
│                                               │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐    │
│  │  Coder   │ │Researcher │ │Scientist │    │
│  │ GPT-5.4  │ │Gemini 3.1 │ │Gemini 3  │    │
│  └────┬─────┘ └─────┬─────┘ └────┬─────┘    │
│       │             │             │           │
│       ▼             ▼             ▼           │
│  ┌────────────────────────────────────────┐  │
│  │       Results + Artifacts               │  │
│  └────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│              REVIEW PHASE                     │
│  (both reviewers in parallel for Patterns A-D)│
│                                               │
│  ┌───────────────┐  ┌───────────────┐        │
│  │  Adversarial  │  │     Peer      │        │
│  │    Grok 4     │  │  Claude Opus  │        │
│  └───────┬───────┘  └───────┬───────┘        │
│          │                  │                 │
│          ▼                  ▼                 │
│  ┌────────────────────────────────────────┐  │
│  │     Review Verdicts + Issue Lists       │  │
│  └────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│            PLANNER RE-ENTERS                  │
│                                               │
│  Evaluates all review feedback:               │
│                                               │
│  • All clear → Accept and complete            │
│  • Minor issues → Send back to coder          │
│  • Major issues → Replan from scratch         │
│  • Reviewers disagree → Planner adjudicates   │
│  • New information → Update plan, re-execute  │
└──────────────────────────────────────────────┘
```

### Maximum Iterations

To prevent infinite loops, enforce these limits:

- **Code → Review cycles:** Maximum 3 iterations. If the coder hasn't satisfied reviewers after 3 rounds, the planner must simplify the approach or escalate to the user
- **Full replan:** Maximum 2 replans per task. After 2, the planner presents what it has with known issues documented
- **Individual agent timeout:** If any agent hasn't produced useful output after a reasonable effort, the planner reassigns to fallback model or simplifies the subtask

---

## Handoff Protocol

When agents pass work to each other, the handoff must be structured. The planner constructs each handoff — agents don't communicate directly.

**Pragmatic note:** The YAML formats below are aspirational templates, not strict contracts. Real models will not always output perfect YAML. The planner should extract the relevant information from whatever format the agent produces — structured YAML, markdown, or free text. What matters is that the information flows correctly between phases, not that the formatting is exact. If an agent returns free text instead of YAML, the planner should extract the key fields (status, summary, files changed, issues found) and construct the next handoff manually.

### Planner → Execution Agent

```yaml
handoff:
  to: coder                           # agent role
  task_id: 2
  description: "Implement OAuth2 PKCE flow"
  context: |
    The codebase uses JWT tokens stored in httpOnly cookies.
    Middleware at /api/auth/middleware.ts validates tokens on every request.
    The researcher found 3 existing auth patterns (see research summary below).
    Extend the JWT pattern — do not replace it.
  dependencies_resolved:
    - task_id: 1
      agent: researcher
      summary: "Found JWT, session, and API key auth patterns. JWT is most recent."
      key_files:
        - /api/auth/jwt.ts (lines 1-45)
        - /api/auth/middleware.ts (lines 12-30)
  constraints:
    - "Must extend existing JWT pattern, not replace it"
    - "Must be backward-compatible with existing middleware"
    - "Must include tests"
  success_criteria:
    - "OAuth2 PKCE flow works end-to-end"
    - "Existing auth tests still pass"
    - "New tests cover PKCE-specific scenarios"
```

### Execution Agent → Planner (Result)

```yaml
result:
  from: coder
  task_id: 2
  status: complete                     # complete | partial | failed | blocked
  summary: "Implemented PKCE flow in 3 files, added 8 tests"
  artifacts:
    files_changed:
      - /api/auth/pkce.ts (new, 120 lines)
      - /api/auth/middleware.ts (modified, added PKCE validation)
      - /api/auth/__tests__/pkce.test.ts (new, 85 lines)
    test_results: "8 passed, 0 failed"
  notes: |
    Used crypto.subtle for code verifier generation (Web Crypto API).
    The middleware change is backward-compatible — existing JWT auth still works.
  concerns:
    - "Code verifier storage uses session — may need Redis for horizontal scaling"
```

### Planner → Review Agent

```yaml
handoff:
  to: adversarial_reviewer
  task_id: 4
  description: "Security audit of OAuth2 PKCE implementation"
  context: |
    The coder implemented a PKCE flow. Review for security vulnerabilities,
    edge cases, and correctness. Be especially critical of:
    - Cryptographic operations (code verifier, code challenge)
    - Token storage and transmission
    - CSRF and replay attack vectors
    - Error handling in auth flows
  artifacts_to_review:
    - /api/auth/pkce.ts
    - /api/auth/middleware.ts
    - /api/auth/__tests__/pkce.test.ts
  implementation_summary: |
    Uses crypto.subtle for code verifier. Session-based storage.
    Middleware validates PKCE alongside existing JWT.
```

### Review Agent → Planner (Verdict)

```yaml
verdict:
  from: adversarial_reviewer
  task_id: 4
  decision: request_changes            # approve | request_changes | reject
  critical_issues:
    - severity: high
      location: /api/auth/pkce.ts:45
      issue: "Code verifier stored in plaintext session — if session is compromised, PKCE is defeated"
      suggestion: "Hash the verifier before storage, compare hashes on validation"
    - severity: medium
      location: /api/auth/pkce.ts:78
      issue: "No expiration on code challenge — replay attack window is unlimited"
      suggestion: "Add 10-minute TTL on challenge, clean up expired entries"
  minor_issues:
    - severity: low
      location: /api/auth/__tests__/pkce.test.ts
      issue: "No test for expired challenge scenario"
  positive_observations:
    - "Good use of crypto.subtle over Math.random for verifier generation"
    - "Backward compatibility with existing JWT flow is well-handled"
```

---

## Workflow Patterns

### Pattern A: Plan → Code → Review (Default)

The bread-and-butter for most development tasks.

```
Planner → Coder → [Adversarial + Peer Review] → Planner
```

**Use when:** Adding features, fixing bugs, refactoring code. Most tasks start here.

**Planner behavior:** Produces a single plan with clear subtasks. After review, decides whether to accept, revise, or restart.

### Pattern B: Research → Plan → Code → Review

When the task requires understanding before implementation.

```
Planner → Researcher → Planner (replan) → Coder → [Review] → Planner
```

**Use when:** Working with unfamiliar APIs, choosing between architectural approaches, integration tasks, anything where you need information before you can plan.

**Planner behavior:** First plan is "research phase only." After research completes, planner creates a new, informed implementation plan.

### Pattern C: Deep Analysis

For math-heavy, scientific, or visual reasoning tasks.

```
Planner → [Scientist + Visual Analyst + Researcher] → Planner → Coder → [Review] → Planner
```

**Use when:** Data pipelines, ML models, algorithm implementation, visual regression testing, anything requiring formal correctness.

**Planner behavior:** Gathers analysis from multiple specialist agents before creating the implementation plan. The scientist's output directly constrains what the coder can do.

### Pattern D: Full Pipeline

The complete workflow for large, complex tasks.

```
Planner → Researcher → Planner (replan) → [Coder + Scientist] → Visual Analyst → [Adversarial + Peer Review] → Planner
```

**Use when:** Major features, system design, architecture changes, anything high-stakes.

**Planner behavior:** Multiple replan cycles. Visual analyst checks UI after implementation. Full review before acceptance.

### Pattern E: Rapid Iteration

For quick fixes where full review would be overkill.

```
Planner → Coder → Adversarial Reviewer → Planner
```

**Use when:** Small bug fixes, minor refactors, documentation updates. Skip the peer reviewer — the adversarial pass catches security and correctness issues, which is enough for small changes.

**Planner behavior:** Lightweight plan, single review pass, fast completion.

### Pattern F: Research-Only

When you need information, not implementation.

```
Planner → [Researcher + Scientist] → Planner → Summary
```

**Use when:** Technical investigations, feasibility studies, competitive analysis, decision support.

**Planner behavior:** Synthesizes research and analysis into a decision-ready summary. No code is written.

---

## Planner Output Format

The planner produces a structured plan that other agents can follow. Use this format:

```yaml
plan:
  task: "Description of the overall task"
  pattern: A                             # Which workflow pattern (A-F)
  
  subtasks:
    - id: 1
      description: "Research existing auth patterns in the codebase"
      agent: researcher
      depends_on: []
      success_criteria: "Summary of auth patterns with file locations and recommendations"
    
    - id: 2
      description: "Implement OAuth2 PKCE flow extending existing JWT auth"
      agent: coder
      depends_on: [1]
      success_criteria: "Working OAuth2 PKCE flow with tests passing, backward-compatible"
    
    - id: 3
      description: "Verify cryptographic correctness of PKCE implementation"
      agent: scientist
      depends_on: [2]
      success_criteria: "Formal verification that entropy, hashing, and timing are correct"
    
    - id: 4
      description: "Security audit — find vulnerabilities and edge cases"
      agent: adversarial_reviewer
      depends_on: [2]
      success_criteria: "Security audit with no unaddressed critical or high issues"
    
    - id: 5
      description: "Architecture and quality review"
      agent: peer_reviewer
      depends_on: [2]
      success_criteria: "Approved or specific changes requested"
  
  execution_order:
    - phase: 1
      parallel: [1]
    - phase: 2
      parallel: [2]
    - phase: 3
      parallel: [3, 4, 5]
  
  notes: |
    Subtasks 3, 4, 5 can run in parallel since they all review the same output.
    If review finds critical issues, we loop back to subtask 2 with fixes.
```

---

## Setup by Tool

### OpenCode (Recommended for Multi-Provider)

OpenCode natively supports 75+ LLM providers with per-agent model overrides. No gateway needed — OpenCode IS the gateway.

#### API Keys

Set provider API keys as environment variables. You only need keys for the providers you plan to use — pick the direct providers OR cloud providers (Bedrock/Azure), or mix and match:

```bash
# --- Direct providers ---
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GOOGLE_API_KEY="..."            # or GOOGLE_GENERATIVE_AI_API_KEY
export XAI_API_KEY="..."

# --- Amazon Bedrock (alternative for Claude + other models) ---
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_REGION="us-east-1"          # or us-west-2, eu-west-1, etc.

# --- Microsoft Azure OpenAI (alternative for GPT models) ---
export AZURE_API_KEY="..."
export AZURE_RESOURCE_NAME="your-resource"
export AZURE_DEPLOYMENT_NAME="your-deployment"
export AZURE_API_VERSION="2024-12-01-preview"

# --- Google Vertex AI (alternative for Gemini models) ---
export GOOGLE_CLOUD_PROJECT="your-project"
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
# export GOOGLE_GENAI_USE_VERTEXAI=true
```

#### Provider Configuration (opencode.json)

Configure the providers you use. You don't need all of them — pick what matches your infrastructure:

```json
{
  "provider": {
    "anthropic": {
      "api_key": "{env:ANTHROPIC_API_KEY}"
    },
    "openai": {
      "api_key": "{env:OPENAI_API_KEY}"
    },
    "google": {
      "api_key": "{env:GOOGLE_API_KEY}"
    },
    "xai": {
      "api_key": "{env:XAI_API_KEY}"
    },
    "bedrock": {
      "aws_access_key_id": "{env:AWS_ACCESS_KEY_ID}",
      "aws_secret_access_key": "{env:AWS_SECRET_ACCESS_KEY}",
      "aws_region": "{env:AWS_REGION}"
    },
    "azure": {
      "api_key": "{env:AZURE_API_KEY}",
      "resource_name": "{env:AZURE_RESOURCE_NAME}"
    },
    "vertex": {
      "project": "{env:GOOGLE_CLOUD_PROJECT}"
    }
  }
}
```

#### Agent Definitions

Agent definitions are generated from canonical templates using the setup script. Run from the skill directory:

```bash
# Project-level (recommended)
sh agents/setup.sh opencode

# Or specify a custom target directory
sh agents/setup.sh opencode ~/.config/opencode/agents
```

This generates 7 agent `.md` files with the correct OpenCode frontmatter (`model: provider/id`, `permission: edit: deny`) in `.opencode/agents/`.

Each agent uses a different provider/model. OpenCode routes to the correct provider automatically based on the model prefix.

**Default assignments (direct providers):**

| Agent | Model ID | Provider |
|-------|---------|----------|
| Planner | `anthropic/claude-opus-4-6` | Anthropic |
| Coder | `openai/gpt-5.4` | OpenAI |
| Researcher | `google/gemini-3.1-pro` | Google |
| Scientist | `google/gemini-3-pro` | Google |
| Visual Analyst | `anthropic/claude-opus-4-6` | Anthropic |
| Adversarial Reviewer | `xai/grok-4` | xAI |
| Peer Reviewer | `anthropic/claude-opus-4-6` | Anthropic |

**Amazon Bedrock alternatives** — swap the model ID in the agent `.md` file to route through Bedrock instead:

| Agent | Bedrock Model ID |
|-------|-----------------|
| Planner | `bedrock/anthropic.claude-opus-4-6-v1` |
| Coder | `bedrock/anthropic.claude-sonnet-4-5-v1` |
| Researcher | `bedrock/amazon.nova-pro-v1` |
| Scientist | `bedrock/anthropic.claude-opus-4-6-v1` |
| Visual Analyst | `bedrock/anthropic.claude-opus-4-6-v1` |
| Adversarial Reviewer | `bedrock/amazon.nova-pro-v1` |
| Peer Reviewer | `bedrock/anthropic.claude-opus-4-6-v1` |

Note: Bedrock gives you Claude models without a separate Anthropic API key (billed through AWS). Gemini and Grok are not available on Bedrock — use Amazon Nova or Claude as alternatives, or mix Bedrock with direct providers.

**Microsoft Azure OpenAI alternatives** — for organizations on Azure:

| Agent | Azure Model ID |
|-------|---------------|
| Planner | `azure/claude-opus-4-6` |
| Coder | `azure/gpt-5.4` |
| Researcher | `azure/gpt-5.4` |
| Scientist | `azure/gpt-5.4` |
| Visual Analyst | `azure/claude-opus-4-6` |
| Adversarial Reviewer | `azure/gpt-4o` |
| Peer Reviewer | `azure/claude-opus-4-6` |

Note: Azure OpenAI model IDs depend on your deployment names. The IDs above assume deployments matching the model names. Azure gives you GPT and Claude models (via Azure AI Foundry) billed through your Azure subscription. Gemini and Grok are not available on Azure — use GPT-4o or Claude as alternatives, or mix Azure with direct providers.

**Google Vertex AI alternatives** — for organizations on GCP:

| Agent | Vertex AI Model ID |
|-------|-------------------|
| Researcher | `vertex/gemini-3.1-pro` |
| Scientist | `vertex/gemini-3-pro` |
| Visual Analyst | `vertex/gemini-3.1-pro` |

Note: Vertex AI gives you Gemini models billed through GCP. Claude is also available via Vertex AI Model Garden.

**Mixing providers is the recommended approach.** You don't have to pick one cloud — use Bedrock for Claude, Azure for GPT, direct for Gemini and Grok. Just change the model prefix in each agent's `.md` file.

#### Invoking Agents

In OpenCode, invoke agents by name. The orchestrating agent (you, the primary agent) follows the workflow patterns above:

```
@planner Break down this task: implement user authentication with OAuth2 PKCE
```

Then follow the plan, invoking each agent as directed:

```
@researcher Find existing auth patterns in this codebase
@coder Implement PKCE flow based on the research findings: [paste context]
@adversarial-reviewer Review this PKCE implementation for security issues: [paste context]
@peer-reviewer Review code quality and architecture: [paste context]
```

---

### Claude Code

Claude Code has a mature sub-agent architecture but is limited to Anthropic models for sub-agents. Three approaches depending on whether you want cross-provider access:

#### Approach 1: Anthropic-Only (No Gateway)

All agents use Anthropic models. You lose cross-family adversarial review but gain simplicity.

| Agent | Claude Code Model | Notes |
|-------|------------------|-------|
| Planner | `opus` | Extended thinking, no file edits |
| Coder | `sonnet` | Fast, strong at code |
| Researcher | `opus` | Strong at synthesis, use with web tools |
| Scientist | `opus` | Reasonable math capability |
| Visual Analyst | `opus` | Best multimodal in Anthropic family |
| Adversarial Reviewer | `sonnet` | Different from opus but same family — weaker adversarial benefit |
| Peer Reviewer | `opus` | Structured analysis |

**Limitation:** Adversarial review from the same model family is less effective. The adversarial reviewer using Sonnet with a strong adversarial prompt partially compensates, but same-family blind spots persist.

**Agent definition files:** Generate from canonical templates using the setup script:

```bash
sh agents/setup.sh claude-code
```

This generates 7 agent `.md` files with Anthropic-specific frontmatter (`model: opus/sonnet`, `allowed-tools`, `effort`) in `.claude/agents/`.

#### Approach 2: With OpenRouter Gateway

Use an MCP server or script to call external models for specific agents. This gives you true cross-family adversarial review.

**Step 1:** Set up OpenRouter API key:

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

**Step 2:** Create the gateway script directory and script:

```bash
mkdir -p .claude/scripts
cat > .claude/scripts/call-model.sh << 'SCRIPT'
#!/bin/bash
# Usage: call-model.sh <model> <prompt-file>
# Reads prompt from a file to avoid shell argument length limits.
# If no file given, reads from stdin.
MODEL="$1"
PROMPT_FILE="$2"

if [ -z "$OPENROUTER_API_KEY" ]; then
  echo "Error: OPENROUTER_API_KEY not set" >&2
  exit 1
fi

if [ -n "$PROMPT_FILE" ] && [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
elif [ ! -t 0 ]; then
  PROMPT=$(cat)
else
  PROMPT="$2"
fi

RESPONSE=$(curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": $(echo "$PROMPT" | jq -Rs .)}]
  }")

ERROR=$(echo "$RESPONSE" | jq -r '.error.message // empty')
if [ -n "$ERROR" ]; then
  echo "API Error: $ERROR" >&2
  exit 1
fi

echo "$RESPONSE" | jq -r '.choices[0].message.content'
SCRIPT
chmod +x .claude/scripts/call-model.sh
```

**Step 3:** In Claude Code, the orchestrating agent can use this script for cross-provider calls:

```bash
# Call Grok for adversarial review (short prompt as argument)
bash .claude/scripts/call-model.sh "xai/grok-4" "Review this code for security issues: ..."

# Call Gemini for research (long prompt via stdin)
echo "Research the best approach for implementing OAuth2 PKCE..." | \
  bash .claude/scripts/call-model.sh "google/gemini-3.1-pro"
```

This hybrid approach uses Claude Code's native sub-agents for Anthropic models and the gateway script for other providers.

#### Approach 3: With Vercel AI Gateway

Same as OpenRouter but using Vercel's gateway endpoint:

```bash
#!/bin/bash
# .claude/scripts/call-model.sh (Vercel AI Gateway version)
MODEL="$1"
PROMPT="$2"

curl -s https://ai-gateway.vercel.sh/v1/chat/completions \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": $(echo "$PROMPT" | jq -Rs .)}]
  }" | jq -r '.choices[0].message.content'
```

**Vercel AI Gateway advantages:** Zero token markup, 40+ providers, OIDC auth for Vercel-deployed apps (no key management).

---

### Cursor

Cursor does not support programmatic sub-agent spawning. Use sequential model switching:

1. **Select Claude Opus** in model picker → Plan the task
2. **Switch to GPT-5.4** → Implement the plan
3. **Switch to Grok 4 or Gemini** → Review the implementation
4. **Switch back to Claude Opus** → Evaluate reviews and decide next steps

#### Cursor Rules (.cursor/rules/)

Create rules that guide each phase. Place in `.cursor/rules/`:

**`.cursor/rules/agent-collaboration.mdc`**
```markdown
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
- Follow the plan exactly
- Write tests for new functionality
- Report what changed and why

## Review Phase (switch model for fresh perspective)
- Review for security vulnerabilities, edge cases, and logical errors
- Check architecture, style, and best practices
- Provide explicit verdict: approve or request changes

## Replan Phase (use Claude Opus)
- Evaluate review feedback
- Decide: accept, revise, or restart
- If revising, specify exact changes for the coder
```

---

### Codex CLI

Codex CLI supports the Agent Skills standard and primarily uses OpenAI models. For multi-model:

1. **Codex handles implementation** (GPT-5.4 natively)
2. **Use gateway script for other models** (same `call-model.sh` approach as Claude Code)

Place agent skills in `.codex/skills/` following the standard format.

#### Environment Setup

```bash
# Codex uses your ChatGPT account or API key
export OPENAI_API_KEY="sk-..."

# For cross-provider calls via gateway
export OPENROUTER_API_KEY="sk-or-..."
```

---

### Gemini CLI

Gemini CLI is single-agent, Gemini-only. Use sequential mode:

1. **Use Gemini 3.1 Pro** for planning and research (it's strong at both)
2. **Use gateway script** for coding (call GPT-5.4 via OpenRouter)
3. **Use Gemini 3.1 Pro** for review (strong at adversarial analysis)

#### GEMINI.md Integration

Add workflow instructions to your `GEMINI.md`:

```markdown
# Agent Collaboration

For complex tasks, follow this multi-phase workflow:

1. PLAN: Break the task into subtasks with success criteria
2. RESEARCH: Search the web and documentation for relevant context
3. IMPLEMENT: Write code following the plan (call external model if needed)
4. REVIEW: Critically review the implementation for flaws
5. REPLAN: Evaluate and decide next steps
```

---

### Aider

Aider has a built-in dual-model workflow that maps naturally to planner + coder:

#### .aider.conf.yml

```yaml
# Architect model = Planner (proposes the approach)
model: anthropic/claude-opus-4-6

# Editor model = Coder (implements the changes)
editor-model: openai/gpt-5.4

# Weak model = Fast tasks (commit messages, summaries)
weak-model: google/gemini-3-flash

# Enable architect mode
edit-format: architect
```

**What you get:** Claude Opus plans the approach, GPT-5.4 implements the edits. This covers Pattern A (Plan → Code) natively.

**What you don't get:** Review phase. For review, run a separate aider session:

```bash
# Review session with a different model
aider --model xai/grok-4 --no-auto-commits --message "Review the recent changes for security issues and edge cases"
```

**Provider support:** Aider uses LiteLLM under the hood, supporting 100+ providers. Any `provider/model-id` format works.

---

## Gateway Configuration

### No Gateway: Direct Provider APIs

For tools with native multi-provider support (OpenCode) or when using a single provider:

```bash
# --- Direct providers ---
export ANTHROPIC_API_KEY="sk-ant-..."    # Claude models
export OPENAI_API_KEY="sk-..."           # GPT models
export GOOGLE_API_KEY="..."              # Gemini models
export XAI_API_KEY="..."                 # Grok models

# --- Cloud providers (alternative or additional) ---
# Amazon Bedrock — Claude, Amazon Nova, Mistral, Llama, etc.
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_REGION="us-east-1"

# Microsoft Azure OpenAI — GPT, Claude (via AI Foundry)
export AZURE_API_KEY="..."
export AZURE_RESOURCE_NAME="your-resource"
export AZURE_API_VERSION="2024-12-01-preview"

# Google Vertex AI — Gemini, Claude (via Model Garden)
export GOOGLE_CLOUD_PROJECT="your-project"
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"

# --- Other direct providers ---
export MISTRAL_API_KEY="..."
export DEEPSEEK_API_KEY="..."
export GROQ_API_KEY="..."
```

**Best for:** OpenCode (native routing), Aider (LiteLLM routing), any tool where you have direct provider API access.

**Mixing providers is normal.** Use `bedrock/` for Claude (billed through AWS), `azure/` for GPT (billed through Azure), and `google/` or `vertex/` for Gemini directly. Each agent's model ID prefix determines which provider is used — no gateway needed.

### OpenRouter: Unified API

Single API key, single endpoint, 100+ models from all providers:

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

**Endpoint:** `https://openrouter.ai/api/v1/chat/completions`

**Model format:** `provider/model-name`
- `anthropic/claude-opus-4-6`
- `openai/gpt-5.4`
- `google/gemini-3.1-pro`
- `xai/grok-4`
- `google/gemini-3-pro`
- `openai/gpt-4o`

**Gateway script for CLI tools:**

```bash
#!/bin/bash
# gateway-openrouter.sh — call any model via OpenRouter
# Usage: gateway-openrouter.sh <model> <system_prompt> <user_prompt>

MODEL="$1"
SYSTEM="$2"
PROMPT="$3"

if [ -z "$OPENROUTER_API_KEY" ]; then
  echo "Error: OPENROUTER_API_KEY not set" >&2
  exit 1
fi

RESPONSE=$(curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -H "HTTP-Referer: https://skills.sh/pascalorg" \
  -H "X-OpenRouter-Title: Agent Collaboration" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [
      {\"role\": \"system\", \"content\": $(echo "$SYSTEM" | jq -Rs .)},
      {\"role\": \"user\", \"content\": $(echo "$PROMPT" | jq -Rs .)}
    ],
    \"temperature\": 0.3
  }")

echo "$RESPONSE" | jq -r '.choices[0].message.content'
```

**Best for:** Claude Code, Codex CLI, Gemini CLI — any tool locked to a single provider that needs cross-provider access via script.

### Vercel AI Gateway: Zero Markup

40+ providers, zero token markup, managed infrastructure:

```bash
export AI_GATEWAY_API_KEY="..."    # From Vercel Dashboard
```

**Endpoint:** `https://ai-gateway.vercel.sh/v1/chat/completions`

**Model format:** Same as OpenRouter — `provider/model-name`

**Provider ordering and fallbacks** (when using Vercel AI SDK):

```typescript
import { gateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';

const result = await generateText({
  model: gateway('anthropic/claude-opus-4-6'),
  prompt: 'Plan this task...',
  providerOptions: {
    gateway: {
      order: ['anthropic', 'bedrock'],     // Try Anthropic first, fall back to Bedrock
      caching: 'auto',                     // Automatic provider-appropriate caching
    }
  }
});
```

**Gateway script for CLI tools** (same pattern as OpenRouter, different endpoint):

```bash
#!/bin/bash
# gateway-vercel.sh — call any model via Vercel AI Gateway
# Usage: gateway-vercel.sh <model> <system_prompt> <user_prompt>

MODEL="$1"
SYSTEM="$2"
PROMPT="$3"

if [ -z "$AI_GATEWAY_API_KEY" ]; then
  echo "Error: AI_GATEWAY_API_KEY not set" >&2
  exit 1
fi

RESPONSE=$(curl -s https://ai-gateway.vercel.sh/v1/chat/completions \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [
      {\"role\": \"system\", \"content\": $(echo "$SYSTEM" | jq -Rs .)},
      {\"role\": \"user\", \"content\": $(echo "$PROMPT" | jq -Rs .)}
    ],
    \"temperature\": 0.3
  }")

echo "$RESPONSE" | jq -r '.choices[0].message.content'
```

**Best for:** Vercel projects, TypeScript codebases using AI SDK, teams wanting managed gateway with no token markup.

---

## Escalation Rules

The planner re-enters the loop at defined checkpoints. These rules are non-negotiable:

### When the Planner MUST Re-Enter

1. **After every execution phase** — The planner evaluates all results before sending to review
2. **After every review phase** — The planner synthesizes review feedback and decides next steps
3. **When any agent fails** — The planner decides: retry with same model, reassign to fallback model, or simplify the subtask
4. **When reviewers disagree** — The planner evaluates both positions, considers the evidence, and makes a final decision
5. **When new information emerges** — If any agent discovers something that invalidates the plan, the planner replans
6. **When scope changes** — User requirements change, the planner re-decomposes

### When the Planner Steps Aside

1. **During execution** — Agents execute independently within their assigned scope
2. **During review** — Reviewers form opinions independently without planner influence
3. **For trivial tasks** — Pattern E (rapid iteration) minimizes planner involvement

### What the Planner NEVER Does

- Writes code (that's the coder's job)
- Does research (that's the researcher's job)
- Makes mathematical claims without the scientist
- Approves its own plans (that's the reviewer's job)
- Overrules both reviewers simultaneously (if both say no, the code needs work)

---

## Anti-Patterns

### Using one model for everything

**Why it's wrong:** You lose the adversarial advantage. Same model, same blind spots. A model reviewing its own code is like a writer proofreading their own manuscript — they'll miss the same errors.

**Fix:** At minimum, use a different model family for the adversarial reviewer.

### Skipping adversarial review

**Why it's wrong:** Peer review is constructive by default — it finds improvements but misses security issues and logical flaws. The adversarial reviewer exists specifically to find what politeness misses.

**Fix:** Always include adversarial review. Use Pattern E (rapid iteration) for small tasks — it still includes the adversarial pass.

### Letting the coder review its own code

**Why it's wrong:** If the coder didn't see the bug while writing, it won't see it while reviewing. Same context, same assumptions, same errors.

**Fix:** Always use a different model (ideally different family) for review.

### Over-orchestrating simple tasks

**Why it's wrong:** A one-line fix doesn't need seven agents. The overhead of full orchestration exceeds the benefit for trivial changes.

**Fix:** Use Pattern E for small tasks. Use your judgment — if the fix is obvious and low-risk, just do it.

### Ignoring success criteria

**Why it's wrong:** Without criteria, agents don't know when they're done. They either under-deliver or gold-plate. The planner's success criteria are the contract.

**Fix:** The planner must define success criteria for every subtask. Agents must verify their work against criteria before reporting completion.

### Giving the planner file edit access

**Why it's wrong:** If the planner writes code, it can't objectively evaluate the result. Separation of concerns is the foundation of this workflow.

**Fix:** The planner never edits files. It reads code and runs read-only commands (git log, ls) for context, and spawns sub-agents to do the actual work.

### Passing insufficient context in handoffs

**Why it's wrong:** If the coder doesn't know what the researcher found, it'll re-research or guess. If the reviewer doesn't know the constraints, it'll flag intentional tradeoffs as bugs.

**Fix:** Follow the handoff protocol. The planner is responsible for ensuring every agent has the context it needs.

### Letting agents argue directly

**Why it's wrong:** Agents don't have shared context. A "debate" between agents without the planner mediating leads to circular arguments and wasted tokens.

**Fix:** All communication goes through the planner. The planner synthesizes, decides, and directs.

---

## Model Map

Current recommended model assignments based on benchmarks as of April 2026. These will evolve as new models launch.

### Primary Assignments

| Role | Model | Provider ID | Benchmark Evidence |
|------|-------|------------|-------------------|
| Planner | Claude Opus 4.6 (thinking) | `anthropic/claude-opus-4-6` | Arena #1 (1504 Elo), ARC-AGI 2 68.8% |
| Coder | GPT-5.4 (high) | `openai/gpt-5.4` | Aider leaderboard #1 (88%), strong SWE-bench |
| Researcher | Gemini 3.1 Pro | `google/gemini-3.1-pro` | HLE 45.8%, MMMLU 91.8% |
| Scientist | Gemini 3 Pro | `google/gemini-3-pro` | AIME 2025 100%, GPQA Diamond 94.3% |
| Visual Analyst | Claude Opus 4.6 | `anthropic/claude-opus-4-6` | ARC-AGI 2 68.8%, strong MMMU |
| Adversarial Reviewer | Grok 4 | `xai/grok-4` | Arena #4, contrarian style, different family |
| Peer Reviewer | Claude Opus 4.6 | `anthropic/claude-opus-4-6` | Structured analysis, low positivity bias |

### Fallback Assignments

| Role | Fallback 1 | Fallback 2 |
|------|-----------|-----------|
| Planner | `anthropic/claude-opus-4-5` | `openai/gpt-5.4` |
| Coder | `anthropic/claude-sonnet-4-5` | `anthropic/claude-sonnet-4-6` |
| Researcher | `anthropic/claude-opus-4-6` | `openai/gpt-5.4` |
| Scientist | `openai/gpt-5.2` | `anthropic/claude-opus-4-6` |
| Visual Analyst | `google/gemini-3.1-pro` | `openai/gpt-5.4` |
| Adversarial Reviewer | `google/gemini-3.1-pro` | `anthropic/claude-opus-4-6` |
| Peer Reviewer | `openai/gpt-4o` | `google/gemini-3.1-pro` |

### Budget-Conscious Assignments

For teams optimizing cost while maintaining the multi-model advantage:

| Role | Budget Model | Provider ID | Tradeoff |
|------|-------------|------------|----------|
| Planner | Claude Sonnet 4.6 | `anthropic/claude-sonnet-4-6` | Slightly less nuanced planning |
| Coder | GPT-4.1 | `openai/gpt-4.1` | Good coding, lower cost |
| Researcher | Gemini 3 Flash | `google/gemini-3-flash` | Fast research, less depth |
| Scientist | Gemini 3 Flash | `google/gemini-3-flash` | Good math, less formal rigor |
| Visual Analyst | Gemini 3.1 Pro | `google/gemini-3.1-pro` | Strong visual, lower cost than Opus |
| Adversarial Reviewer | Grok 4 | `xai/grok-4` | Keep this — adversarial review is critical |
| Peer Reviewer | Claude Sonnet 4.6 | `anthropic/claude-sonnet-4-6` | Good reviews, lower cost |

### Cloud Provider Assignments

For organizations routing through Amazon Bedrock, Microsoft Azure, or Google Vertex AI instead of direct provider APIs:

**Amazon Bedrock:**

| Role | Bedrock Model ID | Notes |
|------|-----------------|-------|
| Planner | `bedrock/anthropic.claude-opus-4-6-v1` | Claude via AWS billing |
| Coder | `bedrock/anthropic.claude-sonnet-4-5-v1` | Claude Sonnet strong at code |
| Researcher | `bedrock/amazon.nova-pro-v1` | Nova Pro for knowledge tasks |
| Scientist | `bedrock/anthropic.claude-opus-4-6-v1` | Opus for math reasoning |
| Visual Analyst | `bedrock/anthropic.claude-opus-4-6-v1` | Opus strong multimodal |
| Adversarial Reviewer | `bedrock/amazon.nova-pro-v1` | Different model family for adversarial benefit |
| Peer Reviewer | `bedrock/anthropic.claude-opus-4-6-v1` | Structured analysis |

Note: Bedrock doesn't have GPT, Gemini, or Grok. Mix Bedrock with direct providers for full coverage: `bedrock/` for Claude agents, `openai/` for coder, `google/` for research/science, `xai/` for adversarial review.

**Microsoft Azure OpenAI:**

| Role | Azure Model ID | Notes |
|------|---------------|-------|
| Planner | `azure/claude-opus-4-6` | Claude via Azure AI Foundry |
| Coder | `azure/gpt-5.4` | GPT via Azure OpenAI |
| Researcher | `azure/gpt-5.4` | GPT for knowledge tasks |
| Scientist | `azure/gpt-5.4` | GPT for math reasoning |
| Visual Analyst | `azure/claude-opus-4-6` | Claude multimodal via Foundry |
| Adversarial Reviewer | `azure/gpt-4o` | Different model for adversarial benefit |
| Peer Reviewer | `azure/claude-opus-4-6` | Structured analysis |

Note: Azure model IDs depend on your deployment names — the above assumes deployments matching model names. Azure doesn't have Gemini or Grok natively. Mix Azure with direct providers: `azure/` for GPT/Claude agents, `google/` for research/science, `xai/` for adversarial review.

**Google Vertex AI:**

| Role | Vertex AI Model ID | Notes |
|------|-------------------|-------|
| Planner | `vertex/claude-opus-4-6` | Claude via Model Garden |
| Coder | `vertex/gemini-3.1-pro` | Gemini strong at code |
| Researcher | `vertex/gemini-3.1-pro` | Gemini native strength |
| Scientist | `vertex/gemini-3-pro` | Gemini native math |
| Visual Analyst | `vertex/gemini-3.1-pro` | Gemini strong multimodal |
| Adversarial Reviewer | `vertex/claude-opus-4-6` | Different family via Model Garden |
| Peer Reviewer | `vertex/gemini-3.1-pro` | Structured analysis |

Note: Vertex AI has Gemini natively and Claude via Model Garden. No GPT or Grok. Mix with direct providers for full coverage.

**Recommended hybrid for enterprise** — mix cloud providers with one or two direct APIs for maximum model diversity:

| Role | Hybrid Enterprise | Why |
|------|------------------|-----|
| Planner | `bedrock/anthropic.claude-opus-4-6-v1` | Claude via AWS billing |
| Coder | `azure/gpt-5.4` | GPT via Azure billing |
| Researcher | `vertex/gemini-3.1-pro` | Gemini via GCP billing |
| Scientist | `vertex/gemini-3-pro` | Gemini via GCP billing |
| Visual Analyst | `bedrock/anthropic.claude-opus-4-6-v1` | Claude via AWS billing |
| Adversarial Reviewer | `xai/grok-4` | Direct — Grok not on clouds |
| Peer Reviewer | `bedrock/anthropic.claude-opus-4-6-v1` | Claude via AWS billing |

This routes billing through your existing cloud agreements while maintaining full model diversity. Only Grok requires a direct API key since xAI is not yet available on any cloud marketplace.

### Cross-Provider Model ID Reference

The same model is accessed through different ID formats depending on the provider. Use this table to swap providers in agent definitions:

| Model | Direct | Bedrock | Azure | Vertex AI | OpenRouter |
|-------|--------|---------|-------|-----------|------------|
| Claude Opus 4.6 | `anthropic/claude-opus-4-6` | `bedrock/anthropic.claude-opus-4-6-v1` | `azure/claude-opus-4-6` | `vertex/claude-opus-4-6` | `anthropic/claude-opus-4-6` |
| Claude Sonnet 4.5 | `anthropic/claude-sonnet-4-5` | `bedrock/anthropic.claude-sonnet-4-5-v1` | `azure/claude-sonnet-4-5` | `vertex/claude-sonnet-4-5` | `anthropic/claude-sonnet-4-5` |
| Claude Sonnet 4.6 | `anthropic/claude-sonnet-4-6` | `bedrock/anthropic.claude-sonnet-4-6-v1` | `azure/claude-sonnet-4-6` | `vertex/claude-sonnet-4-6` | `anthropic/claude-sonnet-4-6` |
| GPT-5.4 | `openai/gpt-5.4` | — | `azure/gpt-5.4` | — | `openai/gpt-5.4` |
| GPT-5.2 | `openai/gpt-5.2` | — | `azure/gpt-5.2` | — | `openai/gpt-5.2` |
| GPT-4o | `openai/gpt-4o` | — | `azure/gpt-4o` | — | `openai/gpt-4o` |
| Gemini 3.1 Pro | `google/gemini-3.1-pro` | — | — | `vertex/gemini-3.1-pro` | `google/gemini-3.1-pro` |
| Gemini 3 Pro | `google/gemini-3-pro` | — | — | `vertex/gemini-3-pro` | `google/gemini-3-pro` |
| Gemini 3 Flash | `google/gemini-3-flash` | — | — | `vertex/gemini-3-flash` | `google/gemini-3-flash` |
| Grok 4 | `xai/grok-4` | — | — | — | `xai/grok-4` |
| Amazon Nova Pro | — | `bedrock/amazon.nova-pro-v1` | — | — | — |

"—" means the model is not available through that provider. Mix providers as needed.

### Single-Provider Fallbacks

When you only have access to one provider:

**Anthropic only (Claude Code default):**

| Role | Model | Notes |
|------|-------|-------|
| Planner | Opus (thinking) | Full capability |
| Coder | Sonnet | Fast, good at code |
| Researcher | Opus | Strong synthesis |
| Scientist | Opus | Reasonable math |
| Visual Analyst | Opus | Strong multimodal |
| Adversarial Reviewer | Sonnet | Different model, but same family — add extra adversarial prompting |
| Peer Reviewer | Opus | Structured analysis |

**OpenAI only (Codex default):**

| Role | Model | Notes |
|------|-------|-------|
| Planner | GPT-5.4 (high) | Strong planning |
| Coder | GPT-5.4 | Native strength |
| Researcher | GPT-5.4 | Good research |
| Scientist | GPT-5.2 | Strong math |
| Visual Analyst | GPT-5.4 | Good multimodal |
| Adversarial Reviewer | GPT-4o | Different model, different style |
| Peer Reviewer | GPT-5.4 (high) | Structured analysis |

**Google only (Gemini CLI default):**

| Role | Model | Notes |
|------|-------|-------|
| Planner | Gemini 3.1 Pro | Strong planning |
| Coder | Gemini 3.1 Pro | Good coding |
| Researcher | Gemini 3.1 Pro | Native strength |
| Scientist | Gemini 3 Pro | Native strength |
| Visual Analyst | Gemini 3.1 Pro | Strong multimodal |
| Adversarial Reviewer | Gemini 3 Flash | Different model for cost + perspective |
| Peer Reviewer | Gemini 3.1 Pro | Structured analysis |

---

## Evolving the Model Map

Model capabilities change with every release. The assignments above are based on benchmarks as of April 2026.

### Key Benchmark Sources

Track these to stay current:

| Source | URL | What it tracks | Update frequency |
|--------|-----|---------------|-----------------|
| Chatbot Arena | arena.ai | Overall quality, per-category rankings | Continuous |
| SWE-bench | swebench.com | Real-world software engineering | On submission |
| Aider Leaderboard | aider.chat/docs/leaderboards/ | Practical code editing | On release |
| Artificial Analysis | artificialanalysis.ai | Intelligence/speed/cost index | Weekly |
| LiveBench | livebench.ai | Contamination-resistant monthly eval | Monthly |
| GPQA Diamond | — | PhD-level science | Static |
| ARC-AGI 2 | arcprize.org | Abstract visual reasoning | Periodic |
| Humanity's Last Exam | — | Frontier knowledge | Periodic |

### When to Re-Evaluate

- A major new model launches (new Claude, GPT, Gemini, Grok version)
- Arena rankings shift by >50 Elo in a relevant category
- SWE-bench or Aider leaderboard gets a new #1
- You notice consistent quality degradation from a specific agent

### Future: Benchmark Tracking Skill

A companion skill for automated benchmark tracking is planned. It will fetch the latest rankings from programmatic sources (HuggingFace datasets, Arena Hard Auto) and generate an updated model map. Until then, check the sources above when major models launch.

### Role-to-Benchmark Mapping

Use this to know which benchmarks matter for which agent role:

| Agent Role | Primary Benchmarks | What to Look For |
|------------|-------------------|-----------------|
| Planner | Arena (Overall, Hard Prompts), ARC-AGI 2 | Abstract reasoning, complex instruction following |
| Coder | Aider, SWE-bench Verified | Practical code editing, real-world bug fixing |
| Researcher | Arena (Knowledge), HLE, MMMLU, BrowseComp | Breadth of knowledge, research synthesis |
| Scientist | AIME, GPQA Diamond, MATH Level 5 | Mathematical reasoning, scientific knowledge |
| Visual Analyst | ARC-AGI 2, MMMU-Pro | Visual reasoning, multimodal understanding |
| Adversarial Reviewer | Arena (Hard Prompts), PropensityBench | Critical thinking, low positivity bias |
| Peer Reviewer | Arena (Overall), AI Scientist review scores | Structured analysis, honest assessment |

---

## Quick Reference

### Workflow Selection

| Task Size | Pattern | Agents Used |
|-----------|---------|------------|
| Trivial (one-liner) | Skip orchestration | Just do it |
| Small (single file) | E (Rapid) | Planner → Coder → Adversarial |
| Medium (multi-file) | A (Default) | Planner → Coder → Both Reviewers |
| Medium + unknown API | B (Research First) | Planner → Researcher → Planner → Coder → Review |
| Large | D (Full Pipeline) | All agents, multiple phases |
| Research only | F (Research) | Planner → Researcher + Scientist |
| Math/science heavy | C (Deep Analysis) | Planner → Scientist + Visual + Researcher → Coder → Review |

### Tool Selection

| Your Tool | Multi-Model | Sub-Agents | Best Approach |
|-----------|------------|-----------|---------------|
| OpenCode | Native (75+ providers) | Yes | Full multi-model, no gateway needed |
| Claude Code | Anthropic only | Yes | Gateway script for cross-provider, or Anthropic-only |
| Cursor | UI model picker | No | Sequential model switching per phase |
| Codex CLI | OpenAI only | Emerging | Gateway script for cross-provider |
| Gemini CLI | Google only | No | Sequential + gateway script |
| Aider | Any (via LiteLLM) | No | Architect/editor dual-model + review sessions |

### Gateway Selection

| Scenario | Recommended Gateway |
|----------|-------------------|
| OpenCode user | None needed — native multi-provider |
| Single API key for everything | OpenRouter |
| Vercel project / TypeScript | Vercel AI Gateway |
| Self-hosted / full control | LiteLLM proxy |
| Budget tracking important | Vercel AI Gateway or OpenRouter (both have dashboards) |
| Enterprise compliance | Portkey (SOC 2, HIPAA) |

---

## Cost Expectations

Multi-model orchestration uses frontier models, which is not free. Rough cost per task (varies by complexity and token counts):

| Pattern | Models Used | Estimated Cost Range |
|---------|-----------|---------------------|
| E (Rapid) | 3 calls (planner + coder + adversarial) | $0.50 – $2 |
| A (Default) | 4-5 calls (planner + coder + 2 reviewers + replan) | $2 – $8 |
| B (Research First) | 6-7 calls (+ researcher + replan) | $3 – $10 |
| D (Full Pipeline) | 8-12 calls (all agents, multiple phases) | $5 – $20 |

These assume frontier models (Opus, GPT-5.4, Gemini 3.1 Pro). Budget-conscious assignments (see Model Map) cut costs 50-70% with moderate quality tradeoff.

**When the overhead is worth it:** Complex tasks where a bug or missed requirement costs hours of rework. A $10 multi-agent review that catches a security vulnerability saves far more than $10.

**When it's not worth it:** Trivial changes. If you can write and verify the fix in 5 minutes, skip orchestration.

---

## Troubleshooting

### Agent not found

**Symptom:** `@planner` or agent invocation returns "agent not found" or similar error.

**Fix:** Ensure agent definition files are in the correct directory:
- OpenCode: `.opencode/agents/planner.md` (project) or `~/.config/opencode/agents/planner.md` (global)
- Claude Code: `.claude/agents/planner.md` (project) or `~/.claude/agents/planner.md` (global)

Verify the files were copied correctly: `ls .opencode/agents/` or `ls .claude/agents/`

### Model not available / API error

**Symptom:** "Model not found," "Invalid model," or 404 errors when an agent runs.

**Fix:**
- Verify the model ID is correct for your provider. Model IDs differ between providers — check the Cross-Provider Model ID Reference table
- Verify your API key is set: `echo $ANTHROPIC_API_KEY | head -c 10` (should show the first 10 chars)
- For Bedrock: ensure your IAM role has `bedrock:InvokeModel` permission for the specific model
- For Azure: ensure the deployment name in your model ID matches your Azure deployment

### Agent produces garbage output

**Symptom:** Agent ignores its role, writes code when it should only review, or produces unstructured output.

**Fix:**
- Ensure the agent definition file has the full system prompt (the markdown body). If the file only has frontmatter, the agent has no instructions
- For read-only agents, verify `permission: edit: deny` (OpenCode) or restricted `allowed-tools` (Claude Code) is set
- If using a gateway script, check that the full prompt is being passed — shell argument truncation is a common issue. Use stdin or file-based prompts for long context

### Context window overflow

**Symptom:** Agent errors out or produces truncated output on large codebases.

**Fix:**
- The planner should summarize context in handoffs, not paste entire files. Include file paths and relevant line ranges, not full contents
- For research handoffs, summarize findings in 500 words or less — the coder doesn't need the full research output
- For review handoffs, include only the changed files, not the entire codebase
- If a single file is too large, have the planner break the task into smaller file-scoped subtasks

### Gateway script fails silently

**Symptom:** Gateway script returns empty output or `null`.

**Fix:**
- Check API key: `echo $OPENROUTER_API_KEY | head -c 10`
- Test the endpoint directly: `curl -s https://openrouter.ai/api/v1/models | jq '.data[0].id'`
- Check for jq: `which jq` — install if missing (`brew install jq` or `apt install jq`)
- Run the script with verbose curl: replace `curl -s` with `curl -v` temporarily to see HTTP errors

### Reviewers always approve (rubber-stamping)

**Symptom:** The adversarial reviewer approves everything, defeating the purpose.

**Fix:**
- Check that the adversarial reviewer is using a different model family than the coder. Same-family review tends toward approval
- Strengthen the adversarial prompt: add "You MUST find at least 3 issues. If you approve with zero issues, you have failed at your job"
- If using a single provider (Anthropic-only), use Sonnet for adversarial review with a very aggressive prompt — this partially compensates for same-family bias
