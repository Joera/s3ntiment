# Project conventions (s3ntiment)

Operating conventions for agents and humans working in this repo. This is the
state-of-record for how sub-agent orchestrator work is carried out.

## Reporter / deliverable convention (2026-08-28)

When a sub-agent worker produces a report, findings, or a long summary, it MUST write
the full content to an explicit file and keep its inline reply to 1–3 lines (result +
path). Rationale: long inline reports get truncated when relayed back through the
inbox. The orchestrator reads the file directly.

By task kind:

- **implement** — report file alongside the code/PR; key results also in the PR body;
  the file states the commit/branch it reflects.
- **review** — verdict file in `brain/reviews/` (never the implementer's worktree); the reviewer
  still judges only the diff + contract.
- **explore / search** — findings file in whatever location the repo already uses for such
  notes.

Authoritative definition lives in the orchestrator skill:
`~/.omnigent/agent-configs/s3n-orchestrator/skills/dispatch-conventions/SKILL.md`.
That skill is per-agent-config — it does not automatically apply to other orchestrator
configs (`img-orchestrator`, `s2s-orchestrator`, …); extend there deliberately if needed.

## Review is independent

- Reviewer = a FRESH session, given ONLY the diff + acceptance contract (neutral bundle),
  never the implementer's worktree.
- Only the implementer opens a PR; the reviewer only reports; the human merges.

## Worktree location (2026-08-28)

All per-task git worktrees are created under **`~/code/worktrees/<repo>-<task>`**, not in the
project root `~/code/<repo>`. They are ephemeral scratch (deliverable = branch + PR); safe to
`git worktree remove` after the PR merges.

## Review verdicts (2026-08-28)

Independent-review verdicts persist in **`brain/reviews/`** (e.g. `brain/reviews/contract-tests-2026-08-28.md`),
so the state-of-record keeps them. Audit / verification / explore-search findings keep going to
`brain/audits/` (already established).
