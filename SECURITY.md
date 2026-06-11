# Security Policy

CC_Pure is a reverse-engineered research fork of Claude Code CLI. Security issues are
taken seriously, especially those involving credential leakage, remote attack surface,
command injection, and unsafe defaults.

## Supported Versions

Only the `main` branch receives security updates. No release tags are maintained.

## Reporting a Vulnerability

**Do NOT open a public issue.** Instead, report vulnerabilities privately:

- GitHub: [Security Advisories](https://github.com/James-FE/CC_Pure/security/advisories/new)
- Expect acknowledgment within 72 hours and a status update within 7 days.

## Scope

| Area | Status |
|------|--------|
| Credential redaction in logs | ✅ Phase 1 |
| Remote control default bind (0.0.0.0 → 127.0.0.1) | ✅ Phase 1 |
| Shell injection via headersHelper | ✅ Phase 3 |
| URL substring validation bypass | ✅ Phase 3 |
| HTML stripping fragility | ✅ Phase 3 + Phase 4 |
| **Command injection (which, imagePaste, exec wrappers)** | ✅ Phase 4 |
| **ReDoS in debugFilter regex** | ✅ Phase 4 |
| **Sanitization bypass (stripHtml, claudemd, sedEditParser, bingAdapter)** | ✅ Phase 4 |
| **Clear-text logging in MCP handler** | ✅ Phase 4 |
| BashTool shell execution | **By design** — BashTool's job is to run shell commands. Do not report shell metacharacter usage as a vulnerability. |
| Teleport / bridge / feature-flagged modules | Out of scope — not enabled in this fork. CodeQL alerts in these modules are accepted risk. |
| Decompilation artifacts (unused variables, dead code) | Out of scope — these are expected in reverse-engineered code. |
| Docker sandbox escape (`bwrap`) | In scope — report via advisory. |

## CodeQL

Code scanning runs on every push to `main` via `codeql.yml` (security-extended suite).
Quality-only rules are dismissed as decompilation artifacts. Security alerts are
triaged and addressed per the above scope.

**Current baseline:** 187 open alerts (down from 199 after Phase 1-4). Remaining
open alerts are predominantly in feature-flagged modules (teleport, bridge, ACP,
computer-use) that are not enabled in this fork. Core-path alerts are all addressed.
