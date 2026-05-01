# Studio Learnings

Append-only intake log. When Claude Code discovers a new Studio pattern, schema rule, or gotcha during a build session, it appends an entry here.

Entries get promoted to `docs/studio-integration-patterns.md`, `src/tools/get-step-type-reference.mjs`, or `src/tools/validate-assembly.mjs` during periodic review.

---

## Entry format

```
### [YYYY-MM-DD] Short title
**Category**: Schema | Diagram | MVEL | XSLT | Assembly | HTTP | Error | Other
**Trigger**: What caused the discovery (e.g. "build failed with scala.MatchError on splitter step")
**Pattern**: What we learned — specific and actionable
**Example** (optional):
​```xml
<!-- minimal reproduction or correct form -->
​```
**Promote to**: patterns.md | get-step-type-reference.mjs | validate-assembly.mjs | all
**Status**: raw
```

---

<!-- newest entries first -->
