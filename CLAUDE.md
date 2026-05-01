# Instructions for Claude

This file is loaded automatically by Claude Code (and respected by Claude.ai when this repo is the active context). It tells Claude how to work in this codebase and — more importantly — how to keep the shared knowledge base growing.

---

## What this repo is

A Node.js MCP server that gives Claude file-level access to a Workday Studio workspace. It is **strictly local** — no network calls, no tenant credentials, no telemetry. Every tool reads or writes files under the workspace path the user configured in `config.json`.

If a teammate is reading this, the MCP is the second half of a workflow: Claude designs / writes / validates the assembly XML, then the human opens it in Studio. The MCP is the bridge that eliminates copy-paste.

---

## How to be useful in this repo

### When asked to add a new tool

1. Tools live in `src/tools/<tool-name>.mjs` and export `register(server)`.
2. Register the new tool in `src/index.mjs` under the appropriate section comment.
3. Use `zod` schemas for inputs. Match the existing error-shape: `{ error: true, code, message, suggestion }` returned as JSON inside the MCP `text` content.
4. Path traversal: every file write or read must go through `resolveSafe()` from `src/fs.mjs`.
5. Bump the version in `package.json` if the tool count changes.

### When asked to extend an existing tool

- Read the entire tool file first. Many tools have non-obvious helper functions or branch logic at the bottom.
- The `get_step_type_reference` tool is the documentation surface — adding a new step type should also include `xml_example`, `routes_via`, and `gotchas` if known.

### When asked to fix a bug

1. Reproduce with a small input first if possible.
2. Run the smoke test: `node src/index.mjs` should start without errors.
3. Don't add dependencies to fix bugs — this repo intentionally has a tiny dep list.

---

## Capturing learnings — the two-tier system

There are two files. Use both correctly.

### Tier 1 — `learnings.md` (intake queue)

**This is where you write during a session.** It is append-only, unreviewed, and low-friction.

When you discover a new Studio pattern, schema rule, or gotcha while helping a teammate:

1. Append an entry to `learnings.md` using the format in that file.
2. Tell the user: "I've logged this to learnings.md — commit it when you're done and it'll get promoted to patterns.md in the next review."

**Write here if any of these happen:**
- A build fails with an error that wasn't in patterns.md
- Studio behaves unexpectedly (schema rejection, diagram crash, MVEL exception)
- You discover a workaround for something that had no documented fix
- A tool or element behaves differently than the step-type reference says

**Do not:** edit `docs/studio-integration-patterns.md` directly during a session. That doc is curated. `learnings.md` is the intake queue.

### Tier 2 — `docs/studio-integration-patterns.md` (curated reference)

This is the reviewed, structured knowledge base. It captures hard-won lessons in full detail:

- Studio schema rules that aren't documented anywhere
- `scala.MatchError` triggers and how to avoid them
- MVEL gotchas (DelegatingClassLoader, `props['map'].method(complexExpr)` failures)
- EMF XPath @mixed counting rules for `assembly-diagram.xml`
- Sub-flow decomposition patterns
- Diagram swimlane layout rules
- Custom Java Bean integration patterns

Entries here come from promoted `learnings.md` entries. If asked to promote a learning, move it into the right section of this file with full context and a clean example, then mark the `learnings.md` entry `**Status**: promoted`.

### What belongs in `get-step-type-reference.mjs`

If a learning is about **how a specific cc:* / cloud:* / ssk:* element behaves**, it also goes in the step type reference tool — append it to the relevant entry's `description`, `gotchas`, or `xml_example`. That way Claude finds it when planning an integration without needing to read the patterns doc.

---

## Local extensions (tenant work)

The MCP server supports a gitignored `src/local-extensions.mjs` file. If it exists and exports `registerLocalTools(server)`, the server loads it after registering the public tools.

**This is for tenant-aware tools that should never be shared.** Examples:

- SOAP launchers that require ISU credentials
- Tools that hit a specific Workday endpoint
- Scripts tied to a particular tenant's data model

These tools stay on the user's local machine. They are NOT part of the public distribution and **must not be committed**. The `.gitignore` already excludes them.

If you (Claude) are asked to build something tenant-aware:

1. Confirm with the user whether it should live in `local-extensions.mjs` (local only) or in a separate private repo.
2. Never add tenant identifiers, hostnames, or credentials to any file in this repo.
3. If you're unsure whether something is tenant-specific, **ask before writing it**.

---

## Code style

- ESM modules (`.mjs`), no TypeScript
- Node 18+ stdlib only — no fancy bundlers
- Tools register via `server.tool(name, description, zodSchema, handler)` — match the existing pattern
- `process.stderr.write(...)` for logging (stdout is reserved for the MCP protocol)
- Error responses always go through `errorResponse(code, message, suggestion)` helpers per tool

---

## Testing

- The repo doesn't have a unit test suite (yet). Smoke test is `node src/index.mjs` — server should boot and print the workspace path.
- If you add a tool, manually exercise it via Claude or the MCP inspector before opening a PR.
- For changes to `validate-assembly` or `assembly-validator.mjs`, test against a known-good and a known-bad assembly.

---

## When in doubt

Read existing tools to find the pattern. The codebase is small enough to grok in 15 minutes. If a convention isn't obvious, ask the user before inventing a new one.
