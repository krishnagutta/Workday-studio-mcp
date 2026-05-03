Read `learnings.md` in the repo root. Find every entry with `**Status**: raw`.

For each raw entry, do the following in order:

1. Parse the `**Promote to**` field. Based on its value:

   **`patterns.md`** (or `all`):
   - Find the most relevant section in `docs/studio-integration-patterns.md`
   - Add the learning as a new subsection or bullet with a concrete example
   - If no section fits, add to the end under a new heading

   **`get-step-type-reference.mjs`** (or `all`):
   - Find the relevant `cc:*` / `cloud:*` / `ssk:*` step type in `src/tools/get-step-type-reference.mjs`
   - Append the learning to the step's `gotchas` array or `description`
   - If no step type matches, skip this target and note why

   **`validate-assembly.mjs`** (or `all`):
   - Add a new validation rule to `src/assembly-validator.mjs`
   - Rule should catch the error described in `**Trigger**` and return a clear message pointing to the fix
   - Follow the existing rule pattern in that file

2. After promoting, update the entry in `learnings.md`:
   - Change `**Status**: raw` to `**Status**: promoted`
   - Add a line: `**Promoted**: YYYY-MM-DD` with today's date

After processing all entries, show a summary table:
| Entry | Promoted to | Notes |

Then ask the user to review the changes and commit.
