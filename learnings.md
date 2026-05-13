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
**Status**: promoted
**Promoted**: 2026-05-01

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
**Status**: promoted
**Promoted**: 2026-05-01

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
**Status**: promoted
**Promoted**: 2026-05-01

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
**Status**: promoted
**Promoted**: 2026-05-01

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
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-06] Proxy-vs-Direct API: error handling chain shifts from response-handler to send-error path
**Category**: Assembly
**Trigger**: Ported MEX's "POST → AsyncMediation20 → AsyncMediation122 → AsyncMediation124 → CallDTA1" upsert recovery pattern into Canada's direct-Dayforce assembly. Wiring compiled fine, but on real Dayforce 400 errors (HR_Employee_DuplicateXRefCodeFound) the recovery never fired. Logs showed `BadRequestException` from `HttpRetryControl` going to `AsyncMediation12` (the HIR send-error handler) — never touching the response chain.
**Pattern**: When an integration moves from a proxy that wraps everything in HTTP 200 (e.g., Boomi `<ACCOUNT>-test.boomi.cloud/...`) to direct API calls returning real status codes (e.g., `cantrainNNN.dayforcehcm.com`), error handling shifts paths entirely.

**Proxy era:** proxy returns 200 regardless of downstream outcome. Real error JSON is in the body. Studio's HTTP client never raises BadRequestException, so `cc:send-error` never fires. Errors are detected by parsing the body via `responsehandle.xsl` → setting `props['Error_Check']` → branching in the `routes-response-to` chain (e.g., `AsyncMediation20 → AsyncMediation122 → AsyncMediation124`). The `cc:send-error` handler on the wrapping async-mediation is effectively dead code.

**Direct API era:** real HTTP status. 200 → response chain fires. 400 → `BadRequestException` → `handle-downstream-errors="true"` on the wrapping `cc:async-mediation` traps the exception → its `cc:send-error` child fires, routing to the named error handler (e.g., `AsyncMediation12`). The `routes-response-to` chain only fires on HTTP 200; it is bypassed entirely on 400.

**Implication for porting flows:** any error logic wired into the response-handler chain (e.g., `AsyncMediation124`) becomes dead code on real direct-API errors. Recovery logic must move into the `cc:send-error` path of the wrapping async-mediation and use `context.errorMessage` (the raw exception message containing the full Dayforce JSON with code fields) as the source of truth, NOT `props['Error_Message']` (which is only set by the response chain that didn't fire).

**How to tell which path actually ran in logs:** response-chain → `-- HIRE Error Check 0----` followed by error JSON. Send-error path → `-- Error Boomi Log---` (legacy log message in `AsyncMediation12`) preceded by `BadRequestException` from `HttpRetryControl`.
**Example**:
```xml
<![CDATA[<!-- Wrapping async-mediation that handles both happy and error paths -->
<cc:async-mediation id="AsyncMediation4" routes-to="POST_Employee" handle-downstream-errors="true">
    <cc:steps>
        <cc:copy input-variable="Process_Effective_Change"/>
        <cc:xslt-plus url="Hire_Employee.xsl" output-mimetype="application/json"/>
    </cc:steps>
    <!-- This is where errors actually land in direct-API integrations -->
    <cc:send-error id="SendError" routes-to="AsyncMediation12"/>
</cc:async-mediation>

<cc:http-out id="POST_Employee" routes-response-to="AsyncMediation20"
    endpoint="@{props['df.direct.URL']}Employees" http-method="POST"/>

<!-- Response chain — fires ONLY on HTTP 200 in direct-API integrations -->
<cc:async-mediation id="AsyncMediation20" routes-to="AsyncMediation122">
    <cc:steps>
        <cc:json-to-xml/>
        <cc:xslt-plus url="responsehandle.xsl"/>
        <cc:eval><cc:expression>props['Error_Check'] = parts[0].xpath('root/data/level')</cc:expression></cc:eval>
    </cc:steps>
</cc:async-mediation>

<!-- Error handler — this is the path on direct-API 400 -->
<cc:async-mediation id="AsyncMediation12" routes-to="CallProcessErrorHire">
    <cc:steps>
        <cc:eval>
            <!-- context.errorMessage contains the full BadRequestException message
                 including the Dayforce JSON response — match codes from here, not Error_Message -->
            <cc:expression>props['p.error.log'].append(... + 'ERROR,Hire Employee,'+context.errorMessage.toString() +'\n')</cc:expression>
        </cc:eval>
    </cc:steps>
</cc:async-mediation>]]>
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-06] POST-then-PATCH upsert recovery: gate via cc:route in send-error path, match on error code substring
**Category**: Assembly
**Trigger**: Needed to handle the case where POST /Employees fails with HR_Employee_DuplicateXRefCodeFound or HR_Search_EmployeeXRefCodeAlreadyExists (employee was created in a prior run). Wanted to fall through to PATCH for self-healing without breaking other error cases (BirthDate missing, etc.) by attempting a doomed PATCH.
**Pattern**: In a direct-API integration, code-gate recovery paths inside the `cc:send-error` handler using a `cc:route` decision node. The pattern:

1. In the wrapping async-mediation's `cc:send-error` handler, add an `<cc:eval>` step that computes a recovery flag from `context.errorMessage.toString().contains('<ErrorCode>')`. Always book-keep the original error first (append to p.error.log, increment p.error.count) — even on recoverable errors, the audit trail should show the failed attempt.
2. Change the error-handler async-mediation's `routes-to` from the terminal log local-out to a new `cc:route` decision node.
3. The `cc:route` uses `cc:mvel-strategy` with two `cc:choose-route` clauses: one matching the recovery flag, fallback `expression="true"` for terminal log.
4. Two `cc:sub-route` blocks point at recovery target (e.g., `CallDTA1` re-entering the DTA flow) and terminal log target.

**Why match on error code (`HR_Employee_DuplicateXRefCodeFound`), not message text ("Employee already exists"):** codes are stable API contract; messages can be re-worded. `context.errorMessage` contains the full JSON response text from BadRequestException, so substring-matching the `code` field value is reliable.

**Variable scope check:** `Process_Effective_Change` is set in the wrapping async-mediation's first step (the `<cc:copy input-variable="Process_Effective_Change"/>`). Studio assembly variables persist for the duration of one Effective_Change. When the recovery target re-enters the DTA flow, its body builder copies from the same variable, so the recovery PATCH operates on identical PECI data the original POST tried to use. No data refresh needed.

**Logging behavior on recovery:** error-handler still appends `ERROR,Hire Employee,...` to p.error.log BEFORE the branch decision. On successful recovery, the log shows the failed HIR attempt followed by `SUCCESS,Data Change,,` — distinguishable as a recovery pattern; ops can grep for the sequence.

**When NOT to use:** if the recovery endpoint has different validation than the failing endpoint (PATCH might reject what POST would accept), the secondary error creates noise. Test both endpoints against representative payloads before adopting.
**Example**:
```xml
<![CDATA[<cc:async-mediation id="AsyncMediation12" routes-to="HireErrorBranch">
    <cc:steps>
        <cc:log id="Log"><cc:log-message><cc:text>-- Error Log ---</cc:text><cc:message-content/></cc:log-message></cc:log>
        <cc:eval id="Eval">
            <cc:expression>props['p.error.log'].append(props['worker_id'] +','+props['Event_Code']+ ',' + 'ERROR,Hire Employee,'+context.errorMessage.toString() +'\n')</cc:expression>
            <cc:expression>props['p.error.count'] = props['p.error.count'] + 1</cc:expression>
            <cc:expression>props['Error_Event_Code'] = 'HIR'</cc:expression>
            <cc:expression>props['can_recover_hire'] = context.errorMessage.toString().contains('HR_Employee_DuplicateXRefCodeFound') || context.errorMessage.toString().contains('HR_Search_EmployeeXRefCodeAlreadyExists')</cc:expression>
        </cc:eval>
    </cc:steps>
</cc:async-mediation>

<cc:route id="HireErrorBranch">
    <cc:mvel-strategy>
        <cc:choose-route expression="props['can_recover_hire'] == true" route="Recover"/>
        <cc:choose-route expression="true" route="LogAndExit"/>
    </cc:mvel-strategy>
    <cc:sub-route name="Recover" routes-to="CallDTA1"/>
    <cc:sub-route name="LogAndExit" routes-to="CallProcessErrorHire"/>
</cc:route>

<!-- CallDTA1 re-enters the DTA flow which patches the same Process_Effective_Change -->
<cc:local-out id="CallDTA1" store-message="none" endpoint="vm://INT999_<TENANT>/DTA"/>]]>
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-06] Workday PECI event code "-R" suffix means Rescind, NOT Rehire
**Category**: Other
**Trigger**: During INT999 Canada planning, was about to wire HIR-R as if it meant "Hire Rehire" — would have produced a PATCH to set status Active, which is the wrong action. User corrected that HIR-R = "Hire Rescinded" (the hire never happened, employee never started) and TERM-R = "Termination Rescinded" (the termination is being undone, employee stays).
**Pattern**: The `-R` suffix on PECI event codes universally means **Rescind** — undo the prior action of the same root code. It does NOT mean "Rehire". A rehire is a fresh `HIR` event with `peci:Worker_Status/peci:Is_Rehire = '1'` — that's how routing distinguishes "first-time hire" from "rehire" within the same `HIR` event code.

| Code | Name | Action when received |
|------|------|----------------------|
| HIR | Hire | New employee starting → POST /Employees |
| **HIR-R** | **Hire Rescinded** | A hire was entered but is being undone (employee never started) → PATCH to terminate (Dayforce has no delete) |
| TERM | Termination | Employee leaves → PATCH `EmploymentStatus.XRefCode = "Inactive"` |
| **TERM-R** | **Termination Rescinded** | A prior termination is being undone — employee stays after all → PATCH `EmploymentStatus.XRefCode = "Active"` |
| DTA | Data Change | Profile update → PATCH affected fields |
| LOA / LOA-C / LOA-R | Leave / Continuation / Return | LOA lifecycle |
| RFL | Reflect | Reorg / position effective change rolls forward |
| PCI | Payroll Compensation Initiate | Comp pkg attached at hire → treat as HIR if Is_Rehire=='0', else as DTA |
| PGI / PGO | Pay Group In/Out | Pay group transfer |
| PCO | Payroll Cutoff | Period close action |

**Routing rule:** every PECI integration's `cc:route` block should have an explicit branch for each event code it handles, plus an `OTHER` fallback. Missing a code (e.g., TERM-R missing in INT999 Canada caused silent termination drops on rehired employees) means events fall through to OTHER which usually just logs and exits — Dayforce never gets the change.

**XSL implication:** HIR-R XSL emits a termination body (status=Inactive, termination reason). TERM-R XSL emits a re-activation body (status=Active, NOT a termination reason). Don't reuse TERM.xsl for TERM-R — the inversion is real.
**Promote to**: patterns.md
**Status**: raw

### [2026-05-06] @mixed positional XPath refs in assembly-diagram.xml shift by 2N when adding/removing top-level elements
**Category**: Diagram
**Trigger**: After removing the JobCreation flow from INT999 Canada (8 elements) and adding a comment, Studio loaded the diagram with multiple "floating" components and edges drawn from wrong source nodes. Specifically AsyncMediation12 looked disconnected because the diagram's `<source href="...@mixed.95"/>` (originally global-error-handler) now resolved to AsyncMediation12 itself.
**Pattern**: Many connection edges in `assembly-diagram.xml` use positional EMF XPath instead of id-based hrefs:
```
<source href="assembly.xml#//@beans/@mixed.1/@mixed.75/@mixed.3"/>
```
This is necessary for `cc:send-error` edges because every `<cc:send-error>` shares `id="SendError"` (not unique). The path means: 76th positional child of `<cc:assembly>` (the wrapping mediation), then its 4th positional child (the `<cc:send-error>` inside).

**Critical counting rule:** `@mixed` indices count ALL child node types — elements, XML comments, and whitespace text nodes. Each `<cc:foo>` element is typically preceded by whitespace, so each top-level addition adds 2 slots (text + element). XML comments add another 2 (text + comment).

**Shift formula:**
- Adding N elements + their preceding whitespace → all subsequent indices shift +2N
- Adding 1 XML comment (with its preceding whitespace) → +2
- Removing N elements (with whitespace) → all subsequent indices shift -2N
- A reference at `@mixed.95` BEFORE a 6-element deletion + 1-comment add becomes `@mixed.95 - 12 + 2 = @mixed.85`

**Verification script (run after every structural edit to assembly.xml):**
```python
from lxml import etree
import re
parser = etree.XMLParser(remove_blank_text=False, remove_comments=False)
asm = etree.parse('ws/WSAR-INF/assembly.xml').getroot().find('{http://www.capeclear.com/assembly/10}assembly')
idx_map = {}
i = 0
if asm.text is not None: idx_map[i] = ('<ws>', None); i += 1
for child in asm.iterchildren():
    if isinstance(child, etree._Comment):
        idx_map[i] = ('COMMENT', None)
    else:
        tag = etree.QName(child.tag).localname
        cid = child.get('id', '')
        idx_map[i] = (f"{tag}#{cid}" if cid else tag, child)
    i += 1
    if child.tail is not None: idx_map[i] = ('<ws>', None); i += 1
diag = etree.parse('ws/WSAR-INF/assembly-diagram.xml').getroot()
for elem in diag.iter():
    href = elem.get('href')
    if not href: continue
    m = re.match(r'assembly\.xml#//@beans/@mixed\.1/@mixed\.(\d+)(?:/@mixed\.(\d+))?$', href)
    if not m: continue
    outer = int(m.group(1)); inner = m.group(2)
    label, el = idx_map.get(outer, ('???', None))
    # ... walk inner if present, compare to expected target in <target href> sibling
```
Compare each resolved label against the diagram's stated `<target href>` for that connection. If the connection says `target=AsyncMediation12` and the resolved source is `AsyncMediation4 routes-to=AsyncMediation12`, it's correct.

**Strategy when removing elements that are referenced by `#//@swimlanes.N` indices:** don't delete the `<swimlanes>` container — empty it instead. Removing a swimlane shifts every `#//@swimlanes.N` reference and breaks unrelated parts of the diagram. An empty `<swimlanes x="..." name="..."/>` keeps the index slot live.
**Example**:
```xml
<![CDATA[<!-- BEFORE 6-element JobCreation flow deletion + 1-comment insert: -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.95"/>  <!-- resolves to global-error-handler -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.129/@mixed.3"/>  <!-- AsyncMediation60 send-error → AsyncMediation1210 -->

<!-- AFTER (shift = -12 + 2 = -10 for indices ≥ 95): -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.85"/>  <!-- now resolves to global-error-handler -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.115/@mixed.3"/>  <!-- now AsyncMediation60 (-14 because also removed AsyncMediation123 later) -->]]>
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-06] Studio's IWorkbenchWindow.getSelectionService() NPE only fixable by full Studio restart
**Category**: Diagram
**Trigger**: After a `scala.MatchError` during diagram render (caused by stale `eProxyURI` references to deleted elements), Studio displayed a "Problem Occurred" dialog: `Cannot invoke "org.eclipse.ui.IWorkbenchWindow.getSelectionService()" because the return value of "org.eclipse.ui.IWorkbenchPartSite.getWorkbenchWindow()" is null`. The dialog kept reappearing on every focus change. Even after fixing assembly-diagram.xml so all references resolved correctly, the NPE kept firing on subsequent editor opens.
**Pattern**: When the editor part fails to initialize (because of an upstream MatchError or any other initialization exception), its `WorkbenchPartSite` ends up half-constructed with a null `IWorkbenchWindow` reference. Eclipse caches this broken site at the workbench level and continues asking it for the selection service on every focus change → cascading NPEs.

**There is no in-Studio recovery API for this NPE.** Once it appears, save your work and restart Studio. The following sequence is what the harness tries before recommending restart, and it works ~70% of the time when the corruption is editor-local:

1. **Close the broken editor tab** — click the × on the assembly.xml editor tab. Forces Studio to dispose the broken IEditorPart.
2. **F5 on the project** in Project Explorer (right-click → Refresh) — re-syncs filesystem.
3. **Project menu → Clean…** → pick the project, OK. Forces a rebuild and re-validation.
4. **Re-open assembly.xml** by double-clicking. Studio creates a fresh editor part with a clean part site.
5. **Window → Show View → Error Log**, click the trash-can icon to clear stale errors.

If the dialog still appears after step 4, the broken part is cached at the workbench level — only a full Studio restart clears it.

**Prevention:** the NPE is a symptom; the cause is the underlying MatchError or initialization failure. Address those first:
- Don't make structural assembly edits without committing a recovery point first (project-local git tag)
- Validate every diagram positional ref BEFORE letting the user open Studio (use the verification Python script — see "@mixed positional XPath refs" learning)
- Run `xmllint --noout` on both assembly.xml and assembly-diagram.xml after any edit
**Promote to**: patterns.md
**Status**: raw

### [2026-05-06] Preferred visual layout for cc:route code-gated recovery: three-lane left-to-right
**Category**: Diagram
**Trigger**: User reviewed a freshly-built code-gated recovery flow (POST→PATCH upsert) and confirmed the resulting Studio diagram layout was the preferred shape. Captured here as the visual template for any future "log error then branch to recovery vs terminal" pattern so subsequent builds emulate it.
**Pattern**: Three swimlanes left-to-right, one concern per lane:

```
[error-handler swimlane]              [decision swimlane]                [terminal swimlane]
┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────┐
│  AsyncMediation12        │    │  HireErrorBranch         │    │  CallDTA1            │
│  ┌─────┐  ┌──────┐       │───▶│  (cc:route)              │───▶│  (recovery target)   │
│  │ Log │─▶│ Eval │       │    │  ┌─ MVEL Strategy ─┐     │    └──────────────────────┘
│  └─────┘  └──────┘       │    │  │  Recover         │     │    ┌──────────────────────┐
│  (logs error,            │    │  │  LogAndExit      │     │───▶│  CallProcessErrorHire│
│   sets can_recover_*)    │    │  └─ Sub Routes ────┘     │    │  (terminal log)      │
└──────────────────────────┘    └──────────────────────────┘    └──────────────────────┘
```

**Layout rules:**
1. Three swimlanes — error handler → decision → terminal targets. Each lane is a single concern.
2. The error-handler async-mediation always shows its inner steps (Log + Eval) inline. Studio renders them automatically when the mediation is collapsed; don't fight the rendering.
3. The `cc:route` decision node renders three sub-blocks Studio creates automatically: `Strategy` (with the strategy type chip — `MVEL` or `XPath`), `Sub Routes` (each named branch as a child block). Place the route in its own swimlane; don't share with mediations.
4. Two outgoing arrows from the route, one per sub-route. Studio draws them parallel to each terminal lane.
5. Terminal targets stack vertically in a single swimlane: recovery on top, terminal log below — reads top-down in order of preference.

**Coordinate convention:**
- Error-handler async-mediation: x ≈ 460–500
- `cc:route` decision: x ≈ 640 (180px right of error handler)
- Terminal targets: x ≈ 800 (160px right of route), y-coords ~100px apart so arrows don't overlap
- Route node sits at the y-coordinate of the upstream error handler

**Reusable XML scaffolding (template; rename ids, recovery flag, and codes per use case):**
```xml
<cc:async-mediation id="<ErrorHandler>" routes-to="<DecisionRoute>">
    <cc:steps>
        <cc:log .../>
        <cc:eval>
            <!-- always book-keep the original error first -->
            <cc:expression>props['p.error.log'].append(... + 'ERROR,<Step>,'+context.errorMessage.toString() +'\n')</cc:expression>
            <cc:expression>props['can_<recover_flag>'] = context.errorMessage.toString().contains('<RecoverableCode1>') || context.errorMessage.toString().contains('<RecoverableCode2>')</cc:expression>
        </cc:eval>
    </cc:steps>
</cc:async-mediation>
<cc:route id="<DecisionRoute>">
    <cc:mvel-strategy>
        <cc:choose-route expression="props['can_<recover_flag>'] == true" route="Recover"/>
        <cc:choose-route expression="true" route="LogAndExit"/>
    </cc:mvel-strategy>
    <cc:sub-route name="Recover" routes-to="<RecoveryTarget>"/>
    <cc:sub-route name="LogAndExit" routes-to="<TerminalLogTarget>"/>
</cc:route>
```

This shape is the template for any "log error then branch to recovery vs terminal" pattern. Reuse it for: manager-not-found → auto-create manager flow, leave-status-conflict → re-fetch flow, missing-XSL-mapping → fallback default flow, etc.
**Promote to**: patterns.md
**Status**: raw

### [2026-05-12] Multiple cc:send-error → single terminal creates diagram spaghetti in direct-chain assemblies
**Category**: Diagram
**Trigger**: Every async-mediation had its own cc:send-error routes-to="PutError". Studio drew one crossing arrow per mediation, resulting in 7+ lines converging on PutError — unreadable diagram.
**Pattern**: In a direct async-mediation chain (no local-in/local-out sub-flows), put handle-downstream-errors="true" and cc:send-error on the FIRST mediation ONLY. That single handler catches errors from all downstream components transitively — every http-out, workday-out-soap, and subsequent async-mediation in the chain. All other mediations need neither handle-downstream-errors nor cc:send-error. Result: one clean arrow to the error terminal.
**Example**:
```xml
<![CDATA[
<!-- CORRECT: error handler on first mediation only -->
<cc:async-mediation id="LoadAttrs" routes-to="PrepareAzureToken" handle-downstream-errors="true">
  <cc:steps>...</cc:steps>
  <cc:send-error id="LoadAttrsError" rethrow-error="false" routes-to="PutError"/>
</cc:async-mediation>

<!-- All subsequent mediations: no send-error, no handle-downstream-errors -->
<cc:async-mediation id="PrepareAzureToken" routes-to="GetAzureTokenHttp">
  <cc:steps>...</cc:steps>
</cc:async-mediation>

<cc:http-out id="GetAzureTokenHttp" routes-response-to="ParseAzureToken" .../>

<cc:async-mediation id="ParseAzureToken" routes-to="PrepareGraphRequest">
  <cc:steps>...</cc:steps>
</cc:async-mediation>

<!-- WRONG: individual send-error on every mediation -->
<!-- produces N crossing arrows to the same terminal -->
]]>
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-12] CORRECTION: each cc:async-mediation must have its own cc:send-error — do NOT consolidate to one handler
**Category**: Assembly
**Trigger**: Previously logged the opposite: "put handle-downstream-errors on first mediation only." User corrected: each async-mediation needs its own send-error so errors are caught at the right scope with the right context. Consolidating to one handler loses per-step error context and is the wrong pattern.
**Pattern**: Every cc:async-mediation must have its own cc:send-error child. The multiple arrows converging on PutError in the diagram are normal Studio rendering — not a problem to fix. Do NOT remove individual send-error elements to "clean up" the diagram.
**Example**:
```xml
<![CDATA[
<!-- CORRECT: each mediation has its own handler -->
<cc:async-mediation id="PrepareAzureToken" routes-to="GetAzureTokenHttp" handle-downstream-errors="true">
  <cc:steps>...</cc:steps>
  <cc:send-error id="PrepareTokenError" rethrow-error="false" routes-to="PutError"/>
</cc:async-mediation>

<cc:async-mediation id="ParseAzureToken" routes-to="PrepareGraphRequest" handle-downstream-errors="true">
  <cc:steps>...</cc:steps>
  <cc:send-error id="ParseTokenError" rethrow-error="false" routes-to="PutError"/>
</cc:async-mediation>
]]>
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-13] JSON null values become the string "null" in Studio XPath results
**Category**: MVEL
**Trigger**: prop set from XPath on a null JSON field printed as "null" in logs, and MVEL condition `== null` evaluated false — the value was the string "null" not Java null
**Pattern**: When Workday Studio converts a JSON payload to XML, null JSON values (e.g. `"value": null`) become the text node `null` in the XML element. XPath on that element returns the string "null", not Java null. Conditions like `== null`, `== empty`, and `== ''` all evaluate false against the string "null". Always normalize at the extraction point using the 3-line pattern already established in the codebase.
**Example**:
```xml
// Safe 3-line initialization pattern
props['myProp'] = ''
props['myProp'] = parts[0].xpath('/path/to/value')
if (props['myProp'] == 'null') { props['myProp'] = '' }
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-13] cc:local-out passthrough chain: skipped steps still fire routes-response-to
**Category**: Assembly
**Trigger**: Two sequential conditional cc:local-out steps were both skipped, causing the flow to jump two steps forward silently with no log output — appeared as if an entire sub-flow was never called
**Pattern**: When a conditional `cc:local-out` is skipped (execute-when evaluates false), Studio still fires its `routes-response-to` as a passthrough. Two skipped steps in sequence produce a silent double passthrough. If both steps in a mutually-exclusive pair are skipped (e.g. due to a value that matches neither condition), the flow jumps ahead with no RAAS call, no SOAP call, and no log output. Add a debug cc:log before the conditional pair logging the raw prop value AND the boolean result of each execute-when expression to diagnose this quickly.
**Example**:
```xml
// Debug log pattern — add before conditional cc:local-out pair
props['myProp']: @{props['myProp']}
Condition A (will fire StepA): @{props['myProp'] != ''}
Condition B (will fire StepB): @{props['myProp'] == ''}
```
**Promote to**: patterns.md
**Status**: raw

### [2026-05-13] Use string comparison == '' not null/empty checks in cc:local-out execute-when
**Category**: MVEL
**Trigger**: execute-when conditions using == null, == empty, != null, != empty behaved inconsistently when prop contained the string "null" vs Java null vs empty string — caused both conditions in a mutually-exclusive pair to evaluate false simultaneously
**Pattern**: In Workday Studio execute-when and @{} MVEL contexts, null/empty comparisons are unreliable when props may hold the string "null". After normalizing the prop to empty string at extraction (3-line pattern), use only simple string equality for branching: `!= ''` to detect a real value, `== ''` to detect absent/empty. This is unambiguous and works consistently across all MVEL evaluation contexts in Studio.
**Example**:
```xml
// After normalization at source, conditions are simple and reliable:
// Fires when prop has a real value
execute-when="props['myProp'] != ''"

// Fires when prop is absent or empty  
execute-when="props['myProp'] == ''"
```
**Promote to**: patterns.md
**Status**: raw
