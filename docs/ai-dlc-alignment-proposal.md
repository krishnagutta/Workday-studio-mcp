# Proposal: AI-DLC-aligned integration lifecycle

**Status:** Draft for review — no code changes proposed yet
**Scope:** The lifecycle the MCP guides *its users* through when they build a Workday integration
**Date:** 2026-07-26

---

## 1. Thesis

AWS's [AI-DLC](https://github.com/awslabs/aidlc-workflows) (AI-Driven Development Lifecycle, open-sourced Nov 2025) proposes a staged, approval-gated lifecycle — **Inception → Construction → Operations** — where the agent proposes and the human approves at every stage boundary, with all artifacts persisted to a working directory (`aidlc-docs/`).

**This MCP already implements most of that shape without naming it.** The recommendation is therefore *not* to adopt AI-DLC wholesale. It is to close the three specific gaps that separate our current bag-of-tools from a governed lifecycle, and to skip the parts that conflict with this project's boundaries.

Adopt the **spine**. Skip the **vocabulary**.

---

## 2. What already maps

| AI-DLC concept | Existing implementation |
|---|---|
| Inception / structured elicitation | `plan_integration` — refuses to scaffold until data source, destination, trigger, volume, auth, and error handling are gathered |
| Units of work (replaces "epics") | **Sub-flows** — decomposed at plan time, built one at a time via `update_sub_flow` |
| Construction | `add_assembly_step`, `update_sub_flow`, `rename_steps`, `delete_assembly_step`, `create_xsl_transform` |
| Stage verification gates | `validate_assembly` (10+ rule families), `validate_xml_file` |
| Accumulated context across phases | `learnings.md` → `docs/studio-integration-patterns.md` → served by `get_patterns` |
| Steering rules | `CLAUDE.md` (AI-DLC ships exactly this file for Claude Code) |
| "Agent proposes, human approves" | Design questions before scaffold; TODO stubs rather than invented logic; `dry_run` on mutating tools |

The vocabulary maps almost too neatly: **units of work ≈ sub-flows**. That is not a coincidence — both are "the parallelizable slice you can build and verify independently."

---

## 3. The three real gaps

### Gap 1 — The plan is never persisted *(highest value, verified)*

`src/tools/plan-integration.mjs` builds a rich plan document — design brief, per-sub-flow prop contracts (`reads_props` / `writes_props`), the EMF `@mixed` index map, and a computed gap list — then writes **only** `assembly.xml` and `assembly-diagram.xml`. The plan is returned in the tool response and **never written to disk**:

```js
const plan = buildPlanDocument(project_name, sub_flows, design_brief);
await writeFile(join(wsDir, 'assembly.xml'),         assemblyXml, 'utf-8');
await writeFile(join(wsDir, 'assembly-diagram.xml'), diagramXml,  'utf-8');
// `plan` is returned in the response — and nowhere else
```

**Consequence:** the moment the conversation ends, the integration's *design rationale* is gone. A teammate — or the same person next week — opens the project and sees generated XML with TODO stubs and no record of why it is shaped that way, what each sub-flow's prop contract was meant to be, or which gaps were knowingly deferred. Every follow-up session re-derives context from the XML.

This is exactly what AI-DLC's `aidlc-docs/` exists to prevent, and it is a gap we can close cheaply.

### Gap 2 — No lifecycle state

Nothing records **which stage an integration is in**. There is no way to answer: which sub-flows are still TODO stubs? which were reviewed and approved? what was the last verified-clean state? A user resuming work must reconstruct all of it by reading XML.

### Gap 3 — Sequencing is implicit

The tools exist but nothing enforces or even *communicates* the intended order (elicit → decompose → build unit → verify → next unit). `plan_integration`'s description carries the Inception discipline; nothing carries the Construction loop. A user's agent can call `add_assembly_step` on an unplanned project and no part of the system objects.

---

## 4. Proposed design

### 4.1 A persisted lifecycle artifact

Write the plan — and keep it current — at a stable project-local path:

```
<project>/aidlc-docs/
  ├── plan.md          # human-readable: design brief, sub-flow contracts, gaps, decisions
  └── state.json       # machine-readable lifecycle state
```

`state.json` (illustrative):

```json
{
  "integration": "INT999_Example",
  "phase": "construction",
  "created": "2026-07-26",
  "design_brief": { "data_source": "raas", "record_volume": "large", "...": "..." },
  "units_of_work": [
    { "id": "GetWorkers",  "status": "verified",  "validated_clean": true },
    { "id": "TransformCsv","status": "todo_stub", "validated_clean": false }
  ],
  "open_gaps": ["Replace TODO_REPLACE_WITH_REPORT_WID with the real report WID"],
  "decisions": [
    { "date": "2026-07-26", "decision": "xml-stream-splitter — volume is large" }
  ]
}
```

**Why both files:** `plan.md` is what a human reads in a code review or a handoff; `state.json` is what tools read and update. Keeping them separate avoids parsing prose to find state.

**Ownership:** `plan_integration` creates them. Construction tools update the relevant unit's status. A new read tool surfaces them.

### 4.2 Two phases, not three

| Phase | In scope? | Rationale |
|---|---|---|
| **Inception** | Yes — exists, needs persistence | `plan_integration` already does the elicitation |
| **Construction** | Yes — exists, needs sequencing + state | Build/verify loop per sub-flow |
| **Operations** | **No — explicit human handoff** | Deploy/monitor requires tenant access. This MCP is deliberately local-only: no network, no credentials (`README.md` § Security). Forcing Ops in would break the project's core boundary. |

Operations should be represented as a **documented handoff checklist** in `plan.md` (deploy steps, WIDs to wire in the Workday UI, ISU permissions to grant) — not as automation. This is consistent with the existing `local-extensions.mjs` escape hatch for tenant-aware tooling.

### 4.3 Delivery — the lesson from `get_patterns`

**The steering files cannot live only in this repo.** AI-DLC ships its rules as `CLAUDE.md` / `.cursor/rules/` in *the user's* project. But studio-mcp users work in their **own Studio workspace** — this repo's `CLAUDE.md` and `docs/` are not in their context. That is precisely why `docs/studio-integration-patterns.md` was invisible to users until `get_patterns` shipped (v1.5.0).

So the lifecycle guidance must be **delivered through the MCP**, via some combination of:

1. **Tool descriptions** — the most reliable channel; the agent always sees them. `plan_integration`'s description already proves this works.
2. **A `get_workflow` tool** — returns the current phase, next recommended action, and the ordered lifecycle contract, read from `state.json`.
3. **Response-embedded next steps** — each Construction tool returns `next_recommended_action` alongside its result.

Option 1 + 2 is the recommended pairing. Shipping a `CLAUDE.md` template *for the user's project* is a possible bonus, but must not be the primary channel — it will not reach most users.

---

## 5. Deliberately rejected

- **"Bolts" and "Mob Elaboration/Construction"** — team-ritual vocabulary that adds nothing to a tool contract. Notably, AWS's own open-source rules largely drop these terms in favor of plainer "units of work" and phase gates; the ceremony lives mainly in the announcement blog. We should describe stages in plain language.
- **The `"Using AI-DLC, ..."` activation phrase** — a steering-file convention that presumes rules loaded in the user's project. Our activation is calling the tools; a magic prefix would be a second, unreliable path.
- **Hard enforcement / refusing out-of-order calls** — the tools are useful individually (someone fixing one assembly should not be forced through Inception). Guidance and state tracking, not gatekeeping. At most a soft warning when a project has no `aidlc-docs/`.
- **Renaming existing tools** — `plan_integration` is already the Inception tool. Renaming for framework purity would break every existing user for zero functional gain.

---

## 6. Suggested increments

Each is independently shippable and independently useful.

| # | Increment | Value | Risk |
|---|---|---|---|
| 1 | **Persist `plan.md` + `state.json`** from `plan_integration` | High — closes Gap 1, useful even if nothing else ships | Low — additive writes |
| 2 | **`get_workflow` tool** — read state, report phase + next action | High — closes Gap 3, delivers the lifecycle through the MCP | Low — read-only |
| 3 | **Construction tools update unit status** (`update_sub_flow`, `validate_assembly`) | Medium — closes Gap 2, makes state self-maintaining | Medium — touches existing tools; must degrade gracefully when `aidlc-docs/` is absent |
| 4 | **Ops handoff checklist** generated into `plan.md` | Medium — captures the tenant work the MCP deliberately will not do | Low |

**Recommended first step: increment 1 alone.** It is a small, additive change that stops the most valuable artifact in the system from evaporating, and it is a prerequisite for 2–4.

### Compatibility notes

- All new files are **additive** and project-local; no existing tool output changes shape.
- Every tool must work unchanged when `aidlc-docs/` is absent — existing projects predate it.
- `aidlc-docs/` should be committed to the user's project repo (it *is* the documentation), so it must never contain credentials or tenant identifiers — same public-repo hygiene rule as `learnings.md`.

---

## 7. Open questions

1. **Directory name** — `aidlc-docs/` matches the AI-DLC convention (helpful if a team already uses it elsewhere) but leaks framework jargon into a Workday project. Alternative: `integration-docs/`.
2. **Location** — project root, or alongside the assembly in `ws/WSAR-INF/`? Root is more discoverable; `WSAR-INF` keeps Studio artifacts together. Does anything in Studio's build choke on unexpected root directories?
3. **Retrofit** — should a tool be able to generate `aidlc-docs/` for an *existing* integration by reading its assembly? Valuable for the many projects that predate this, but inference-based and necessarily incomplete.
4. **Scope of increment 3** — which tools should write state? Every mutation, or only `validate_assembly` (the natural "this unit is now verified" signal)?

---

## 8. Recommendation

Proceed with **increment 1** as a standalone PR: persist `plan.md` + `state.json` from `plan_integration`, no other behavior change. It closes the highest-value gap, is low-risk and additive, and makes increments 2–4 possible without committing to them.

Defer the naming and location questions (§7.1, §7.2) to that PR's review, since they only become concrete once files are actually being written.
