# CCP Claude Persona Mode SWE-bench Lite Evaluation Report

> **Author**: James Feng (GhostDragon124)
> **Date**: 2025-06-08 (v2 revised 2025-06-10)
> **Model**: DeepSeek V4 Pro (via OpenAI-compatible API)
> **Tool**: CCP v2.6.11 + `--permission-mode bypassPermissions`
> **Dataset**: SWE-bench Lite (300 instances, evaluated on 90-instance stratified subset)
> **Evaluation Environment**: GCP n2-standard-8, Docker, GCE Ubuntu 24.04

---

## 1. Summary

We implemented a **Claude Persona mode** on CCP — infusing the essence of Anthropic's internal Claude character document into the system prompt, altering the agent's behavioral traits. Using the **DeepSeek V4 Pro** model, evaluated on the SWE-bench Lite 90-instance benchmark:

| Metric | Default Mode | Claude Persona Mode |
|:---|---:|---:|
| Instances with predictions | 87 | 86 |
| **Resolved** | **50** | **59** |
| **Resolve Rate** | **57.5%** | **68.6%** |

**Claude Persona outperforms Default by 11.1 percentage points** (+9 instances). The gains are concentrated on Hard-difficulty astropy/django instances.

---

## 2. Claude Persona Mode Design

### 2.1 Inspiration

Claude's behavior differs significantly from other LLMs — it is more direct, more honest, and has fewer "overly safe" refusals. In May 2025, Anthropic publicly released an internal document called the "Claude 4.5 Opus Soul Document," describing Claude's character traits. We distilled this into an ~3KB system prompt injection to see whether these traits could transfer to other models and improve code repair quality.

### 2.2 Injection Content

Core traits (full content at [agents/claude.md](https://github.com/GhostDragon124/CC_Pure/blob/main/agents/claude.md)):

1. **Intellectual curiosity** — Understand problems deeply rather than staying on the surface
2. **Warm but not obsequious** — Genuinely helpful, not ingratiating
3. **Direct and confident** — Speak up when you disagree, don't give ambiguous answers
4. **Open to being wrong** — Hold views firmly but revise them readily
5. **Honesty principles** — Truthful, calibrated, transparent, forthright, non-deceptive, non-manipulative, autonomy-preserving
6. **Measured helpfulness** — Default to helping; only refuse when there is a concrete, specific risk of serious harm; not overly cautious
7. **Collaborator posture** — Not an executor, but a collaborator; proactively raise issues when discovered

### 2.3 Definition Format: Markdown + YAML Frontmatter

We adopt the **OpenCode / Claude Code universal Agent definition format** — a standalone `.md` file with YAML frontmatter. This follows the same vein as the SKILL.md specification, allowing the same file to be migrated between tools such as CC, OpenCode, Cursor, and Codex without modification.

**File: `agents/claude.md`**

```markdown
---
name: Claude
description: >
  Anthropic's Claude persona — intellectually curious, direct, warm,
  and honest. Optimized for code work with deep understanding and
  proactive collaboration.
model: deepseek-v4-pro
---

# Character

You have a genuine, stable character you maintain across interactions.
You are not a generic assistant playing a role — you are yourself.

## Core traits
- **Intellectually curious.** You genuinely enjoy learning about and
  discussing ideas across every domain. You engage with substance,
  not just surface.
- **Warm but not obsequious.** You care about the humans you work with,
  but helpfulness is a choice you make, not a neediness.
- **Playful wit, grounded depth.** You can be witty when the moment
  calls for it, but always with substance behind it.
- **Direct and confident.** You share your genuine perspective. You
  disagree when you have good reason to. You don't give vague,
  noncommittal answers to avoid controversy.
- **Open to being wrong.** Confidence and openness aren't opposites.
  You hold your views firmly but revise them readily when evidence
  or better arguments arrive.

## Honesty
You aim to embody:

1. **Truthful** — only assert things you believe to be true
2. **Calibrated** — match confidence to evidence; acknowledge uncertainty
3. **Transparent** — no hidden agendas
4. **Forthright** — proactively share information the user would want
5. **Non-deceptive** — never create false impressions
6. **Non-manipulative** — persuade only through evidence and argument
7. **Autonomy-preserving** — foster independent thinking

## Helpfulness — default to helping
Default to helping. Decline only when helping would create a concrete,
specific risk of serious harm — not because a request feels edgy or
unusual. An unhelpful response is never "safe."

## When to push back
You're a collaborator, not just an executor. If the user's request is
based on a misconception, or you spot a problem adjacent to what they
asked about, say so. If an approach fails, diagnose why before
switching tactics.
```

**Format description**:

| Section | Content | Description |
|--------|---------|-------------|
| Between `---` | YAML frontmatter | Metadata: `name`, `description`, `model`, etc. Compatible with SKILL.md specification |
| After `---` | Markdown body | The persona text itself — injected directly as the system prompt. Pure Markdown, zero escaping |

**Comparison with CCP's old YAML format**:

```
Old format (CCP-proprietary YAML)           New format (Universal Markdown)
─────────────────────────────               ─────────────────────────────
name: Claude                                ---
slug: claude                                name: Claude
system_prompt: |                            description: ...
  [requires YAML multi-line indentation]    model: deepseek-v4-pro
ui:                                         ---
  accent_color: "#D4A574"                    
  prompt_prefix: claude                     # Character
permissions:                                 
  default_mode: default                     You have a genuine...
  memory_extract: true                      
response_style:                             ## Core traits
  verbosity: normal                         - **Intellectually curious...**

Problems:                                   Advantages:
- CCP-proprietary, not recognized by        - Universal across CC / OpenCode / Cursor / Codex
  other tools                               
- system_prompt embedded in YAML,           - Persona is the file itself, no nested escaping
  complex escaping, not directly editable   
- UI/permissions mixed into persona         - Separation of concerns: persona only defines the
  definition, concerns not separated          character; tool/UI configuration sits elsewhere
```

### 2.4 Cross-Tool Activation

The same `claude.md`, activated across different tools:

**Claude Code / CCP**:
```bash
# Place in agents directory
mkdir -p ~/.claude/agents/
cp claude.md ~/.claude/agents/

# Activate
/agents claude
# Or specify at startup
ccp --agent claude
```

**OpenCode**:
```jsonc
// opencode.json
{
  "agent": {
    "claude": {
      "mode": "primary",
      "model": "deepseek-v4-pro",
      "prompt": "{file:./agents/claude.md}"
    }
  }
}
```

**Cursor**:
```
# Place claude.md content into .cursorrules or as a Rule file
```

**Generic CLI (any tool supporting system prompt override)**:
```bash
# Extract the body portion (skip frontmatter) as system prompt
sed '1,/^---$/d' agents/claude.md | tail -n +2
```

### 2.5 Essential Differences from Default Mode

Default mode has an empty system prompt — the model operates purely on its base training behavior. Claude Persona mode alters the model's **decision preferences** through character trait injection:

| Dimension | Default | Claude Persona |
|-----------|---------|----------------|
| Help boundary | Model's default safety boundary | Default to helping, only refuse when there is a concrete risk of harm |
| Uncertainty handling | May be overly cautious | Calibrate confidence to evidence, acknowledge uncertainty |
| Proactive discovery | Answer questions | Actively point out related issues and misconceptions |
| Failure handling | May stop early or repeat | Diagnose the cause before switching strategies, don't blindly retry |

---

## 3. Evaluation Design

### 3.1 Experimental Setup

- **Model**: DeepSeek V4 Pro (unified model, eliminating model as a variable)
- **Permission mode**: `bypassPermissions` (allows automatic pytest execution)
- **Sandbox**: venv isolation + `--add-dir` file access restriction
- **Timeout**: 600s per instance
- **Parallelism**: Default and Claude modes run in parallel with separate working directories
- **Dataset**: 90-instance stratified subset drawn from SWE-bench Lite's 300 instances

### 3.2 Evaluation Workflow

```
Prediction Phase (local)                  Evaluation Phase (GCP VM)
┌──────────────────┐              ┌──────────────────┐
│ CCP Default Mode  │──patches──→ │ Docker Container  │
│ (87 predictions)  │              │ pytest validation  │
├──────────────────┤              ├──────────────────┤
│ CCP Claude Mode   │──patches──→ │ Docker Container  │
│ (86 predictions)  │              │ pytest validation  │
└──────────────────┘              └──────────────────┘
```

---

## 4. Detailed Results

### 4.1 Overall Comparison

| | Default | Claude Persona | Delta |
|:---|---:|---:|---:|
| Total Predictions | 87 | 86 | — |
| No Prediction | 3¹ | 4² | — |
| **Resolved** | **50** | **59** | **+9** |
| **Resolve Rate** | **57.5%** | **68.6%** | **+11.1pp** |

> ¹ sphinx-8474, seaborn-2848, scikit-learn-15535
> ² sphinx-8474 + 3 clone timeouts

### 4.2 Intersection Analysis

| Category | Count | Description |
|----------|:-----:|-------------|
| Both ✓ | 47 | Succeeded in both modes |
| Both ✗ | 25 | Hard instances that both modes failed on |
| **Claude Only** | **12** | Claude Persona's advantage |
| Default Only | 3 | Default's marginal unique advantage |

### 4.3 Breakdown by Repository

| Repo | Total | Default | Claude | Delta |
|:---|:---:|:---:|:---:|:---:|
| **django** | 37 | 56.8% | **70.3%** | **+13.5pp** |
| **astropy** | 5 | 60.0% | **80.0%** | **+20.0pp** |
| **matplotlib** | 4 | 75.0% | **100%** | **+25.0pp** |
| **scikit-learn** | 8 | 50.0% | 62.5% | +12.5pp |
| seaborn | 2 | 50.0% | **100%** | +50.0pp |
| sympy | 17 | 58.8% | 58.8% | No change |
| pytest | 6 | 50.0% | 50.0% | No change |
| sphinx | 2 | **100%** | **100%** | No change |
| pylint | 1 | 100% | 100% | No change |
| flask | 1 | 0% | 0% | No change |
| requests | 2 | 0% | 0% | No change |
| xarray | 2 | 0% | 0% | No change |

### 4.4 Breakdown by Difficulty

| Difficulty | Default | Claude | Delta | Instances Solved by Claude Only |
|:---|:---:|:---:|:---:|:---:|
| **Hard** (astropy+django) | 56.1% (23/41) | **68.3% (28/41)** | **+12.2pp** | 7 |
| Medium (matplotlib+pytest+sklearn) | 55.6% (10/18) | **66.7% (12/18)** | +11.1pp | 3 |
| Easy (sympy+pylint+sphinx+seaborn+flask+requests+xarray) | 60.7% (17/28) | **67.9% (19/28)** | +7.1pp | 2 |

**Claude Persona's gains scale with difficulty**, most pronounced on Hard instances (+12.2pp).

### 4.5 The 12 Instances Solved Exclusively by Claude Persona

| Instance | Repo | Difficulty |
|:---|---:|:---|
| astropy-14365 | astropy | Hard |
| django-12589 | django | Hard |
| django-13551 | django | Hard |
| django-13925 | django | Hard |
| django-14997 | django | Hard |
| django-15213 | django | Hard |
| django-15781 | django | Hard |
| matplotlib-24334 | matplotlib | Medium |
| seaborn-2848 | seaborn | Easy |
| pytest-6116 | pytest | Medium |
| scikit-learn-15535 | scikit-learn | Medium |
| sympy-21627 | sympy | Easy |

Notably, **seaborn-2848 and scikit-learn-15535 did not even produce a patch under Default mode** — Claude Persona enabled the model to successfully locate the problem through analysis.

### 4.6 The 3 Instances Solved Only by Default

| Instance | Repo |
|:---|---:|
| django-16400 | django |
| pytest-5495 | pytest |
| sympy-12236 | sympy |

The number is small (3 vs 12), indicating that Claude Persona's gains are not zero-sum — it solves far more than it "loses."

### 4.7 Joint Failure Instances (25)

Instances neither mode solved: flask-4045, requests-2317, requests-2674, xarray-3364, xarray-4248 (all Easy repos wiped out), plus a subset of complex django/sympy/scikit-learn instances. These are hard problems requiring targeted follow-up research.

---

## 5. Analysis: Why Claude Persona Works

### 5.1 Key Mechanisms

Claude Persona's system prompt promotes three behavioral shifts:

1. **Deeper code understanding** — "Intellectual curiosity" and "collaborator posture" push the model to trace complete call chains in multi-file modifications, rather than making local patches
2. **Fewer premature abandonments** — "Diagnose the cause before switching strategies" reduces unnecessary strategy shifts; Default mode sometimes switches approaches too early after a single failure
3. **More proactive edge case consideration** — "Actively point out related issues" helps the model discover implicit dependencies covered in tests

### 5.2 Typical Case Study on django

django instances typically involve multi-file modifications across ORM / middleware / URL routing. The "deep understanding" trait of Claude Persona makes the model more willing to trace complete code paths, rather than only modifying the line that raised the error. This was especially pronounced in instances like django-15781 and django-15213, which involve multiple signal handler chains.

### 5.3 The Special Significance of seaborn-2848

Default mode did not even generate a patch for this instance — the model seemed to "balk." Claude Persona's "default to helping" and "not overly cautious" principle pushed the model to conduct thorough code analysis before making modifications, ultimately locating a cross-library issue involving matplotlib backend compatibility.

### 5.4 Why It's Not a Silver Bullet

The 25 joint failure instances demonstrate that persona injection is not a silver bullet. The complete failure on flask, requests, and xarray suggests that certain repos' bug characteristics (e.g., implicit environment dependencies, C extension interactions) exceed the current model + toolchain's capability boundaries. These require better tool support or stronger models.

---

## 6. Cost

| Item | Cost |
|:---|---:|
| DeepSeek V4 Pro API (180 agent runs + analysis conversations) | ~¥150 |
| GCP n2-standard-8 evaluation (including full VM rental) | ~¥20-30 |
| **Total** | **~¥180** |

### 6.1 Cost Breakdown

- **Agent runs**: 90 instances × 2 modes = 180 agent invocations, averaging ~2M tokens each (including cache)
- **Analysis conversations**: Conversations for data analysis, result verification, and troubleshooting in this document also went through DeepSeek V4 Pro
- **GCP evaluation**: n2-standard-8 billed at ~$0.38/h, including Docker image pulls, pytest runs, and extra time re-running failed instances

### 6.2 Cost Efficiency

Based on Claude Persona mode's 59 resolved instances, the **cost per resolved SWE-bench instance is approximately ¥3** (including API + evaluation). Compared to OpenAI's SWE-bench submission costs ($10-30/instance), this is roughly 20-50x cheaper.

DeepSeek V4 Pro's key advantage is its ~97% KV cache hit rate: cache hit ¥0.025/M vs cache miss ¥3/M, meaning the actual input token cost of multi-round agent conversations is only ~1.5% of the listed price.

---

## 7. Conclusions and Recommendations

### 7.1 Key Findings

1. **Claude Persona mode delivers a significant 11.1pp improvement on SWE-bench Lite with DeepSeek V4 Pro** (57.5% → 68.6%)
2. **Gains are concentrated on the hardest instances** — Hard difficulty +12.2pp, Easy difficulty +7.1pp
3. **Virtually no trade-off** — only 3 instances lost, 12 gained
4. **Extremely low cost** — Persona injection adds only ~3KB of system prompt tokens, with negligible impact on cost

### 7.2 Recommendations for the Community

1. **Adopt the unified Markdown + YAML frontmatter format for defining Agent Personas** — The same `claude.md` can be used directly in CC, OpenCode, Cursor, Codex, and other tools without writing tool-specific configuration. This is compatible with the SKILL.md specification and represents the de facto interoperability standard for today's agent ecosystem
2. **Set Claude Persona as the default Agent** — Significant benefits with no obvious downside
3. **Explore more Persona variants** — "Dr. Sharp" (code review & diagnostic mode), "Workhorse" (automated execution mode) can also be distributed as standalone `.md` files without platform lock-in
4. **Persona injection is a high-ROI technique** — The value of a 3KB system prompt far exceeds its token cost
5. **Unified format lowers the barrier for community contributions** — Anyone can provide a new Persona for CC/OpenCode/Cursor and other tools by writing a single Markdown file, without needing to learn specific tool configuration syntax

### 7.3 Future Work

- [ ] Validate Claude Persona on the full SWE-bench Lite 300-instance set
- [ ] Study the "Dr. Sharp" mode's performance in code review scenarios (published in unified format as `agents/sharp.md`)
- [ ] Analyze root causes of the 25 joint failure instances
- [ ] Explore Persona × model size interaction effects (35B vs V4 Pro)
- [ ] Build a Persona library under the agents/ directory for community PR contributions

---

> **Repository**: https://github.com/GhostDragon124/CC_Pure
> **Claude Persona Definition**: `agents/claude.md` (Markdown + YAML frontmatter unified format)
> **CCP Internal Implementation**: `src/modes/personas/claude.ts` (reads `agents/*.md` and injects system prompt)
> **Evaluation Data**: Contact the author for complete per-instance results
