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

### [2026-05-05] Conditional cc:local-out chaining — routes-response-to is the skip fallthrough
**Category**: Assembly
**Trigger**: Splitting one cc:local-out into two mutually exclusive conditional alternatives. The second local-out was never reached because the sync-mediation still routed directly to it, and the first local-out's routes-response-to pointed to the final destination instead of the second step.
**Pattern**: When a cc:sync-mediation needs to choose between two conditional cc:local-out steps, chain them sequentially:
1. sync-mediation.routes-to = FIRST local-out
2. FIRST local-out.routes-response-to = SECOND local-out (NOT the final destination)
3. SECOND local-out.routes-response-to = final destination

When a cc:local-out is skipped (execute-when=false), Studio fires its routes-response-to as a pass-through fallthrough — it does NOT automatically proceed to the next sibling. The fallthrough chain must be explicit via routes-response-to.

Both paths converge at the final destination:
- Path A (conditionA true): StepA executes → sub-flow → returns → StepB skipped → Destination
- Path B (conditionB true): StepA skipped → StepB executes → sub-flow → returns → Destination
**Example**:
```xml
<!-- WRONG: mediator routes directly to StepB; StepA is unreachable dead code -->
<cc:sync-mediation id="LogStep" routes-to="StepB" .../>
<cc:local-out id="StepA" execute-when="conditionA" routes-response-to="Destination" .../>
<cc:local-out id="StepB" execute-when="conditionB" routes-response-to="Destination" .../>

<!-- CORRECT: mediator routes to StepA first; StepA falls through to StepB when skipped -->
<cc:sync-mediation id="LogStep" routes-to="StepA" .../>
<cc:local-out id="StepA" execute-when="conditionA" routes-response-to="StepB" .../>
<cc:local-out id="StepB" execute-when="conditionB" routes-response-to="Destination" .../>
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-05] RAAS alias must be declared in cloud:report-service before getExtrapath() works
**Category**: Assembly
**Trigger**: A new cc:workday-out-rest step using intsys.reportService.getExtrapath('MY_ALIAS') was added to assembly.xml but the alias was missing from the cloud:report-service block — the step fails at runtime with no alias found.
**Pattern**: Every string passed to intsys.reportService.getExtrapath('ALIAS') must have a matching cloud:report-alias entry inside the cloud:report-service block of the workday-in service in assembly.xml. The alias can be declared without a report-reference WID (Studio UI then prompts you to wire it), but the entry MUST exist in the XML. After adding, open the report service in the Studio Services tab to set the Report Reference WID.
**Example**:
```xml
<!-- cc:workday-out-rest referencing an alias -->
<cc:workday-out-rest id="MyRaasCall"
  extra-path="@{intsys.reportService.getExtrapath('MY_REPORT_ALIAS')}?Param=@{props['myParam']}&amp;format=simplexml"/>

<!-- Required: matching cloud:report-alias in the workday-in service block -->
<cloud:report-service name="MyReportService">
  <!-- existing aliases ... -->
  <cloud:report-alias description="Human-readable description"
    name="MY_REPORT_ALIAS"/>
  <!-- WID report-reference wired via Studio UI after XML deploy -->
</cloud:report-service>
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-05] Add standalone cc:local-out at END of assembly to avoid @mixed index cascade
**Category**: Diagram
**Trigger**: Adding a new local-out (e.g. an error handler) inline near the sub-flow elements shifted all subsequent @mixed indices by +2, requiring a full diagram audit and bulk update of every positional connection reference downstream.
**Pattern**: When adding a cc:local-out that does not need to appear in the XML adjacent to its caller (error handlers, utility steps), add it at the END of the assembly — just before </cc:assembly>. This guarantees zero @mixed index shift for all existing diagram connections. The diagram target reference uses assembly.xml#ELEMENT_ID (not an @mixed path), so physical XML position does not affect how it is referenced in connections.
**Example**:
```xml
<!-- Add at the very end of assembly — nothing above shifts -->
<cc:local-out id="MyError" endpoint="vm://MY_INT/UMsgH_Do">
    <cc:set name="UMsgH_Number" value="1"/>
    <cc:set name="UMsgH_Summary" value="'Descriptive error message for this sub-flow.'"/>
    <cc:set name="UMsgH_ToWorkday" value="true"/>
    <cc:set name="UMsgH_Detail" value="context.errorMessage"/>
</cc:local-out>
</cc:assembly>

<!-- Diagram connection targets it by ID — @mixed index of source is unaffected -->
<connections type="routesTo">
    <source href="assembly.xml#//@beans/@mixed.1/@mixed.N/@mixed.3"/>
    <target href="assembly.xml#MyError"/>
</connections>
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-05] Give each sub-flow swimlane its own local error handler
**Category**: Diagram
**Trigger**: A sub-flow's cc:async-mediation SendError routed to a global error handler in a distant swimlane, producing a long diagonal arrow spanning the entire canvas. The global handler's error message text was also wrong for the sub-flow's failure context.
**Pattern**: Every sub-flow swimlane with a cc:async-mediation that has handle-downstream-errors="true" should declare its OWN cc:local-out error handler and include it in the swimlane's elements list. Name it after the sub-flow (e.g. MySubFlowError). Add it at the END of assembly.xml to avoid @mixed shifts. The SendError arrow stays entirely within the swimlane and the error message accurately describes what failed.
**Example**:
```xml
<!-- async-mediation routes error to local handler, not a distant global one -->
<cc:async-mediation id="MySubFlow_Mediation" routes-to="MyRestCall"
    handle-downstream-errors="true">
    <cc:send-error id="SendError" routes-to="MySubFlowError"/>
</cc:async-mediation>

<!-- Error handler at end of assembly -->
<cc:local-out id="MySubFlowError" endpoint="vm://MY_INT/UMsgH_Do">
    <cc:set name="UMsgH_Summary" value="'Error in MySubFlow: describe the specific failure.'"/>
</cc:local-out>

<!-- Diagram: error handler is a member of the sub-flow swimlane -->
<swimlanes name="My Sub-Flow">
    <elements href="assembly.xml#MySubFlow_Mediation"/>
    <elements href="assembly.xml#MyRestCall"/>
    <elements href="assembly.xml#MySubFlowError"/>
</swimlanes>
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-05] XML position does not define execution order — always update routes-to when inserting a new step
**Category**: Assembly
**Trigger**: A new conditional cc:local-out was added to assembly.xml before an existing step, but the preceding cc:sync-mediation still had routes-to pointing to the OLD step. The new step was unreachable dead code — the flow bypassed it entirely regardless of its XML position.
**Pattern**: XML element order in assembly.xml does NOT define execution order. Only the explicit routes-to / routes-response-to chain does. Whenever a new step is inserted before an existing step in a flow, update the predecessor's routes-to to point to the new step. After any insertion, trace the full routing chain from the entry local-in to the exit and verify every routes-to points to the intended next step.
**Example**:
```xml
<!-- BEFORE: mediator still routes to OldStep; NewStep inserted above it but is dead code -->
<cc:sync-mediation id="EntryLog" routes-to="OldStep" .../>
<cc:local-out id="NewStep" execute-when="conditionA" .../>  <!-- never reached! -->
<cc:local-out id="OldStep" execute-when="conditionB" .../>

<!-- AFTER: mediator routes-to updated; NewStep falls through to OldStep when skipped -->
<cc:sync-mediation id="EntryLog" routes-to="NewStep" .../>
<cc:local-out id="NewStep" execute-when="conditionA" routes-response-to="OldStep" .../>
<cc:local-out id="OldStep" execute-when="conditionB" routes-response-to="FinalDestination" .../>
```
**Promote to**: patterns.md
**Status**: raw
