# Workday Studio Integration Patterns

A reference of confirmed patterns, schema rules, and runtime gotchas for building integrations in Workday Studio. Every entry below was verified against a working integration before being recorded.

---

## Table of Contents

1. [Mandatory Build Process](#mandatory-build-process)
2. [Studio Schema Gotchas](#studio-schema-gotchas)
3. [Diagram (assembly-diagram.xml) Rules](#diagram-rules)
4. [MVEL Idioms and Gotchas](#mvel-idioms-and-gotchas)
5. [Custom Java Beans](#custom-java-beans)
6. [Sub-flow Decomposition Patterns](#sub-flow-decomposition)
7. [Outbound HTTP Patterns](#outbound-http-patterns)
8. [XSLT Patterns](#xslt-patterns)
9. [RAAS (Report as a Service) Patterns](#raas-patterns)
10. [REST API Patterns](#rest-api-patterns)
11. [Document Storage Patterns](#email-and-documents)
12. [Server Log Diagnosis Recipes](#server-log-diagnosis)
13. [Common Error Patterns and Fixes](#common-errors)
14. [Backup Workflow Before Structural Edits](#backup-workflow)
15. [Studio Starter Kit (SSK) Patterns](#ssk-patterns)
16. [How to Contribute](#how-to-contribute)

---

## Mandatory Build Process

Skipping the planning phase leads to diagram rewrites, swimlane surgery, and broken EMF XPath indices.

### Step 1 — Gather requirements

| Question | Examples |
|---|---|
| What triggers the integration? | Schedule / Event / Webhook / Manual |
| What does it read from Workday? | SOAP operations, RAAS reports, custom objects |
| What external systems does it call? | REST APIs, SMTP, SFTP |
| What does it produce? | Deliverable file, Workday write-back, email, API call |
| Are there conditional branches? | Rehire vs new hire, impl vs prod |
| What can fail independently? | Each distinct step that needs its own error message |
| What launch params are needed? | Names, types, required/optional |

### Step 2 — Plan sub-assemblies

Decompose into named sub-flows. Each sub-flow = one `cc:local-in` plus its async-mediation steps.

- One responsibility per sub-flow. `GetWorkers`, `TransformToCSV`, `PostToDayforce` — never `DoEverything`.
- Name sub-flows by what they produce, not by what they call. `BuildHireRequest` not `CallSOAP`.
- Identify the props contract: what each sub-flow READS and WRITES.
- Sequential chains use `routes-response-to` on the calling `cc:local-out`.
- Parallel paths each get their own chain starting from the same branch point.

### Step 3 — Write the skeleton assembly first

Create `assembly.xml` with all entry/exit points connected, steps left as `cc:log` stubs. Validate routing before writing any logic. Then fill in each sub-flow one at a time.

```xml
<!-- Main flow: entry then stub mediations then local-out chains -->
<cc:workday-in id="StartHere" routes-to="Init"/>
<cc:async-mediation id="Init" routes-to="CallSubFlow1">
  <cc:steps>
    <cc:log id="TODO_Init"><cc:log-message><cc:text>TODO: Init params</cc:text></cc:log-message></cc:log>
  </cc:steps>
</cc:async-mediation>
<cc:local-out id="CallSubFlow1" store-message="none"
  routes-response-to="CallSubFlow2"
  endpoint="vm://INT999_Name/SubFlow1"/>
<cc:local-out id="CallSubFlow2" store-message="none"
  endpoint="vm://INT999_Name/SubFlow2"/>

<!-- Sub-flow stubs: each local-in plus a TODO log -->
<cc:local-in id="SubFlow1" routes-to="DoSubFlow1"/>
<cc:async-mediation id="DoSubFlow1" handle-downstream-errors="true">
  <cc:steps>
    <cc:log id="TODO_SubFlow1"><cc:log-message><cc:text>TODO: SubFlow1 logic</cc:text></cc:log-message></cc:log>
  </cc:steps>
  <cc:send-error id="SubFlow1Error" rethrow-error="false" routes-to="PutSubFlow1Error"/>
</cc:async-mediation>

<!-- Error handlers -->
<cc:send-error id="GlobalErrorHandler" rethrow-error="false" routes-to="DeliverError"/>
<cc:local-out id="DeliverError" store-message="none" endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity" value="'CRITICAL'"/>
  <cc:set name="is.message.summary" value="'INT999 failed: ' + context.errorMessage"/>
  <cc:set name="is.document.deliverable" value="'false'"/>
</cc:local-out>
```

A sub-flow ends naturally when its async-mediation has no `routes-to`. **Do not add `cc:note` as a terminal marker** — `cc:note` is schema-invalid inside `cc:assembly`.

### Step 4 — Write the skeleton diagram second

Write `assembly-diagram.xml` matching the skeleton above. All swimlanes, all connections, all placeholder nodes. Fix EMF XPath indices at this step, not after adding logic.

### Step 5 — Fill in sub-flows one at a time

Replace each `TODO` log with real steps. Open Studio after each sub-flow to verify the diagram renders correctly before moving to the next.

---

## Studio Schema Gotchas

### `cc:note` is schema-invalid in `assembly.xml`

Studio rejects `cc:note` as a `cc:assembly` child. It also crashes Studio if present in `assembly-diagram.xml`. The correct terminal pattern for a sub-flow is an `cc:async-mediation` with no `routes-to` attribute — execution ends naturally when there is nowhere to route.

For colored annotations on swimlanes, use `decorations` in `assembly-diagram.xml` instead (see [SSK Patterns](#ssk-patterns)).

### `cloud:launch-option` valid values

Two distinct categories:

- `"required"` — valid on ALL param types (text, date, boolean, enumeration, class-report-field). Forces the user to fill in the param before launching.
- `"as-of-effective-date"` / `"as-of-entry-datetime"` / `"begin-effective-date"` / `"begin-entry-datetime"` — DATE params ONLY. Auto-populates the date from the business process context.
- `"optional"` is NOT a valid value — schema error.

Text params that are truly optional simply omit `cloud:launch-option` entirely.

### `xsl:param` names cannot contain dots

Props key `DF.XRefCode` declared as `<xsl:param name="DF.XRefCode"/>` produces an XML parse error since dots are not valid in XML NCNames. Use underscores in prop keys that will be XSL params: `DF_XRefCode`. Props accessed only via MVEL (eval, http-out endpoint) can keep dots.

### Top-level vs nested elements

These are TOP-LEVEL `cc:assembly` children only — they cannot be placed inside `cc:async-mediation cc:steps`:

- `cc:workday-out-rest`, `cc:workday-out-soap`
- `cc:http-out`, `cc:email-out`
- `cc:splitter`, `cc:aggregator`, `cc:route`
- `cc:workday-in`, `cc:local-in`, `cc:local-out`
- `cc:send-error` (only as a child of `cc:async-mediation`, never inside `cc:steps`)

Steps that go INSIDE `cc:async-mediation cc:steps`: `cc:log`, `cc:cloud-log`, `cc:eval`, `cc:write`, `cc:store`, `cc:set-headers`, `cc:json-to-xml`, `cc:base64-encode`, `cc:validate-exp`, `cc:custom`, `cc:xslt-plus`.

### `cc:splitter` has no `routes-to` attribute

Adding `routes-to` on `cc:splitter` is a schema validation error. The splitter dispatches per-record sub-routes; the per-record `cc:local-out` returns to the splitter, which advances to the next record automatically.

### Per-record `cc:local-out` from a splitter has no `routes-response-to`

The splitter waits for the sub-flow to finish, then advances to the next record automatically. Do not add `routes-response-to` on the local-out inside a splitter sub-route.

### `cloud:attribute` display options

Two confirmed values for `cloud:display-option`:

```xml
<cloud:attribute name="API Password">
  <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
  <cloud:display-option>display-as-password</cloud:display-option>   <!-- masks in UI -->
</cloud:attribute>
<cloud:attribute name="Client Namespace">
  <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
  <cloud:display-option>required-for-launch</cloud:display-option>   <!-- mandatory on launch -->
</cloud:attribute>
```

---

## Diagram Rules

### EMF XPath indices count whitespace and comments

Studio's `assembly-diagram.xml` uses positional XPath like:

```xml
<source href="assembly.xml#//@beans/@mixed.1/@mixed.75/@mixed.3"/>
```

The `@mixed` index counts elements AND whitespace text nodes AND XML comments. Each `<cc:foo>` element typically occupies 2 slots: whitespace then element.

To count correctly:

```python
import xml.dom.minidom
doc = xml.dom.minidom.parse('assembly.xml')
asm = doc.getElementsByTagNameNS('*','assembly')[0]
for i, n in enumerate(asm.childNodes):
    print(i, n.nodeType, getattr(n,'tagName','[text/comment]'))
```

**Shortcut:** Write `assembly.xml` with NO XML comments — then all elements fall on odd indices (1, 3, 5...) and you can compute without Python.

### Insertion shift rule

Inserting N new top-level elements anywhere inside `cc:assembly` shifts ALL subsequent `@mixed` indices by `2×N`. When you add one element at position P, every `@mixed.X` where X > P becomes `@mixed.(X+2)`.

- Removing N top-level elements (with their preceding whitespace) decreases all subsequent indices by `2×N`.
- Adding 1 XML comment block increases subsequent indices by `2`.
- Adding N elements increases subsequent indices by `2×N`.

A reference at `@mixed.95` BEFORE a 6-element deletion + 1-comment add becomes `@mixed.95 - 12 + 2 = @mixed.85`.

Update the diagram's error connection `<source href>` values and any index-map comment in `assembly-diagram.xml` before opening in Studio.

### Verification script — run after every structural edit

Confirms every diagram positional ref still resolves to its intended target:

```python
from lxml import etree
import re
parser = etree.XMLParser(remove_blank_text=False, remove_comments=False)
asm = etree.parse('ws/WSAR-INF/assembly.xml').getroot().find(
    '{http://www.capeclear.com/assembly/10}assembly')

# Build index map
idx_map = {}
i = 0
if asm.text is not None:
    idx_map[i] = ('<ws>', None); i += 1
for child in asm.iterchildren():
    if isinstance(child, etree._Comment):
        idx_map[i] = ('COMMENT', None)
    else:
        tag = etree.QName(child.tag).localname
        cid = child.get('id', '')
        idx_map[i] = (f"{tag}#{cid}" if cid else tag, child)
    i += 1
    if child.tail is not None:
        idx_map[i] = ('<ws>', None); i += 1

diag = etree.parse('ws/WSAR-INF/assembly-diagram.xml').getroot()
for elem in diag.iter():
    href = elem.get('href')
    if not href:
        continue
    m = re.match(r'assembly\.xml#//@beans/@mixed\.1/@mixed\.(\d+)(?:/@mixed\.(\d+))?$', href)
    if not m:
        continue
    outer = int(m.group(1))
    inner = m.group(2)
    label, el = idx_map.get(outer, ('???', None))
    if inner is None:
        print(f"@mixed.{outer:3d}                 = {label}")
    else:
        sub_i = 0
        sub_label = '???'
        if el is not None and el.text is not None:
            if sub_i == int(inner):
                sub_label = '<ws>'
            sub_i += 1
        for sub in (el.iterchildren() if el is not None else []):
            if sub_i == int(inner):
                sub_label = etree.QName(sub.tag).localname
                rt = sub.get('routes-to', '')
                if rt:
                    sub_label += f" routes-to={rt}"
                break
            sub_i += 1
            if sub.tail is not None:
                if sub_i == int(inner):
                    sub_label = '<ws>'; break
                sub_i += 1
        print(f"@mixed.{outer:3d}/@mixed.{inner}      = inside {label}: {sub_label}")
```

Compare each output line against the diagram's `<target>` for that connection. If the target says `AsyncMediation12` and the resolved source is `AsyncMediation4 routes-to=AsyncMediation12`, it's correct.

### `cc:send-error` cannot be a diagram node

Adding ANY `cc:send-error` element as a `<visualProperties>` block OR as a swimlane `<elements>` entry crashes Studio with `scala.MatchError` at every load. This applies equally to:

- Inline send-errors referenced via EMF XPath (`#//@beans/@mixed.1/@mixed.43`)
- Named top-level send-errors referenced by id (`#GlobalErrorHandler`)

Studio's `Factory.scala:19` has no `EditPart` case for `cc:send-error`. The element type is not renderable.

**Fix:** `cc:send-error` is ONLY safe as a `<source>` in a `<connections>` block — resolved as a reference, not rendered as a node. The Error Handler swimlane should contain only `cc:local-out` targets (e.g. `DeliverError`), never the `cc:send-error` itself.

### Confirmed safe diagram node types

Only these elements can appear in `visualProperties` or as swimlane `elements`:

`cc:workday-in`, `cc:local-out`, `cc:local-in`, `cc:async-mediation`, `cc:route`, `cc:splitter`, `cc:aggregator`, `cc:http-out`, `cc:workday-out-rest`, `cc:workday-out-soap`, `cc:email-out`.

Steps inside `cc:async-mediation` (like `cc:store`, `cc:write`, `cc:eval`) are NOT top-level — they have no diagram entry.

### Adding components: three required diagram entries

Every new top-level element added to `assembly.xml` MUST have three corresponding entries in `assembly-diagram.xml` before the next Studio open:

1. **`visualProperties`** — coordinates:

```xml
<visualProperties x="400" y="810">
  <element href="assembly.xml#NewComponentId"/>
</visualProperties>
```

2. **`connections`** — one `routesTo` or `routesResponseTo` per arrow:

```xml
<connections type="routesTo">
  <source href="assembly.xml#PreviousComponent"/>
  <target href="assembly.xml#NewComponentId"/>
</connections>
```

3. **`swimlanes` membership** — add to the appropriate outer swimlane `<elements>` list:

```xml
<swimlanes x="30" y="770" name="BuildAuditFile Sub-flow" ...>
  <elements href="assembly.xml#BuildAuditFile"/>
  <elements href="#//@swimlanes.10"/>
  <elements href="assembly.xml#NewComponentId"/>
</swimlanes>
```

Coordinate placement rule: x/y should place the component inline with its upstream node — same y as the flow row, x = upstream_x + ~140px.

### Removing components: mirror the three entries

When removing a top-level element from `assembly.xml`, drop all three corresponding diagram entries in the same change:

1. Drop the `<visualProperties>` block that wraps `<element href="assembly.xml#DeletedId"/>`
2. Drop every `<connections>` block where source OR target href points at the deleted id
3. Drop the matching `<elements href="assembly.xml#DeletedId"/>` line from any swimlane

If you skip step 1-3, Studio shows: `scala.MatchError: org.eclipse.emf.ecore.impl.EObjectImpl@... (eProxyURI: ...assembly.xml#DeletedId)`. Each unresolved href returns an `EObjectImpl` with only `eProxyURI` set; Studio's `Factory.scala:19` has no match case for unresolved proxies, so the editor part fails to initialize and a cascading `IWorkbenchWindow` NPE follows.

### Don't remove swimlanes — empty them

Removing a `<swimlanes>` container shifts every `#//@swimlanes.N` reference and breaks unrelated parts of the diagram. Empty the container instead:

```xml
<!-- Before -->
<swimlanes x="..." name="...">
  <elements href="assembly.xml#DeletedItem"/>
</swimlanes>

<!-- After: keep container with no children, indices unchanged -->
<swimlanes x="..." name="..."/>
```

### Swimlane layout template

```
swimlanes.0   Error Handler        (alignment=END)     — DeliverError local-out only
swimlanes.1   Main Flow            (alignment=MIDDLE)  — entry node + local-out chain
swimlanes.2   SubFlow1 outer       (alignment=MIDDLE)  — local-in + #//@swimlanes.3 + optional success-exit node
swimlanes.3   SubFlow1 inner       (orientation=VERTICAL) — async step (top) + PutXxxError (bottom)
swimlanes.4   SubFlow2 outer       (alignment=MIDDLE)  — same pattern
swimlanes.5   SubFlow2 inner       (orientation=VERTICAL)
...
swimlanes.N   MASTER CONTAINER     (orientation=VERTICAL, labelAlignment=LEFT)
              — added LAST so no refs shift; references all outer bands
```

For sub-flows that contain a RAAS plus splitter, use TWO inner vertical lanes inside the outer band:

```
swimlanes.2   GetWorkers outer: local-in, workday-out-rest, #/swimlanes.3,
                                splitter, #/swimlanes.4, CallProcessOneWorker
swimlanes.3   GetWorkers Inner A VERTICAL: pre-fetch async (top) + PutFetchError (bottom)
swimlanes.4   GetWorkers Inner B VERTICAL: per-record extract async (top) + HandleExtractError (bottom)
```

Splitter node lives inline in the outer band, between the two inner boxes.

### Inner swimlane design rule (success path exits, error stays)

- Inner VERTICAL swimlane: the async-mediation step ON TOP, its `cc:local-out` error handler ON BOTTOM — stacked vertically, same x, different y.
- If the step has a success continuation, that node goes in the OUTER band to the right of the inner swimlane box.
- If the step is terminal, the inner swimlane contains only step + error handler.

### Error handler proximity rule

- Two async-mediations in the SAME sub-flow band can share one error handler if they are adjacent.
- Two async-mediations in DIFFERENT bands must have SEPARATE error handlers — avoids long cross-band arrows.
- Name them after their source: `HandleExtractError` for errors from `ExtractFields`.

### Co-located errors with nested VERTICAL bands

For complex sub-flows with multiple decision points, do NOT isolate errors in a separate "Errors" outer band. Place error branch nodes adjacent to their decision point inside the same VERTICAL inner band. Nesting 3 levels deep is acceptable.

```
SubFlow (outer, default horizontal):
  EntryPoint (local-in)
  swimlanes.A — Decision/branch group (VERTICAL):
      AsyncMediation_1            # initial log/step
      AsyncMediation_NotFound     # not-found branch, co-located
      AsyncMediation_WD_Error     # WD error, co-located near its source
  swimlanes.B — API calls group (VERTICAL container):
      swimlanes.C — GET check band:
          GET_Resource
          AsyncMediation_Found
      swimlanes.D — WD+POST chain band:
          WorkdayOutRest_Resource
          swimlanes.E — Response/error inner (VERTICAL):
              AsyncMediation_WD_Response
              AsyncMediation_POST_Error
          POST_Resource
          AsyncMediation_POST_Success
```

When Studio recalculates `@mixed.N` indices after node moves, let it. Do NOT hand-edit those references — Studio-written connection sources are always correct.

---

## MVEL Idioms and Gotchas

### CDATA for comparison operators and multi-statement blocks

`>`, `<`, `if/else`, and multi-statement blocks must be wrapped in CDATA, since `>` and `<` are markup characters in XML:

```xml
<cc:expression><![CDATA[
  if (props['status'] == 'Active' && props['count'] > 0) {
    props['result'] = props['val'] + ',MATCH'
  } else {
    props['result'] = props['val'] + ',MISMATCH'
  }
]]></cc:expression>
```

Single-assignment expressions that only use `=`, `+`, string literals, and `props['key']` accesses don't need CDATA. Any `if`, `else`, `>`, `<`, `>=`, `<=`, `&&`, `||`, or multi-statement logic does.

`&&` in `cc:expression` (without CDATA) must be written as `&amp;&amp;`. The XML parser converts it back to `&&` before MVEL sees it.

### `props['map'].method(complexExpr)` fails inside if/else

MVEL 1.3.13 cannot compile a method call on a map-accessed object when the argument is a complex expression AND the call is inside an if/else block. Fails with:

```
org.mvel.ParseException: unknown class: props['csv.builder'].append(props['WD_Employee_ID'] + ',' + ...)
```

- `props['map'].methodCall(localVar)` inside if/else — works.
- `props['map'].methodCall(complexExpr)` at the top level of `cc:expression` — works.
- `props['map'].methodCall(complexExpr)` inside an if/else block — fails.

**Fix:** Replace if/else with sequential `cc:expression` elements using ternary operators. Pre-compute the value, then call the method at the top level:

```xml
<!-- BAD: if/else with method call on complex arg -->
<cc:eval id="AppendErrorRow">
    <cc:expression>
if (condition) {
    props['csv.builder'].append(props['A'] + ',' + props['B'] + ',label1,\n')
    props['count.x'] = props['count.x'] + 1
} else {
    props['csv.builder'].append(props['A'] + ',' + props['B'] + ',label2,\n')
    props['count.y'] = props['count.y'] + 1
}
    </cc:expression>
</cc:eval>

<!-- GOOD: sequential expressions, ternary for branching -->
<cc:eval id="AppendErrorRow">
    <cc:expression>props['_flag'] = condition</cc:expression>
    <cc:expression>props['_label'] = props['_flag'] ? 'label1' : 'label2'</cc:expression>
    <cc:expression>props['csv.builder'].append(props['A'] + ',' + props['B'] + ',' + props['_label'] + ',\n')</cc:expression>
    <cc:expression>props['count.x'] = props['count.x'] + (props['_flag'] ? 1 : 0)</cc:expression>
    <cc:expression>props['count.y'] = props['count.y'] + (props['_flag'] ? 0 : 1)</cc:expression>
</cc:eval>
```

### Date arithmetic via Java Calendar (only reliable way)

```java
props['d']   = new java.text.SimpleDateFormat("yyyy-MM-dd").parse(props['Hire_Date'])
props['cal'] = java.util.Calendar.getInstance()
props['cal'].setTime(props['d'])
props['cal'].add(java.util.Calendar.DATE, -1)
props['end'] = new java.text.SimpleDateFormat("yyyy-MM-dd").format(props['cal'].getTime())
```

### Basic auth via MVEL (when `cc:http-basic-auth` doesn't fit)

```java
props['Auth'] = 'Basic ' + new String(java.util.Base64.getEncoder().encode(
    (props['user'] + ':' + props['pass']).getBytes()))
```

Then inject: `<cc:add-header name="Authorization" value="@{props['Auth']}"/>`.

### Integration map lookup

```java
props['target_val'] = intsys.integrationMapLookup('Ethnicity Type', props['source_val'])
props['source_val'] = intsys.integrationMapReverseLookup('Ethnicity Type', props['target_val'])
```

Requires `cloud:map` in `cloud:attribute-map-service` in `cc:workday-in`.

### `vars.isVariable` guard before read

```java
if (vars.isVariable('saved_xml')) { props['val'] = vars['saved_xml'].getText() }
if (!props.containsKey('counter')) { props['counter'] = 0 }
```

### `context.containsProperty()` vs `props.containsKey()`

In `cc:parameter` defaults, use `context.containsProperty()` — it's the null-safe check Studio supports for typed-parameter defaults.

```xml
<cc:parameter name="apiVersion" type="string"
  default="context.containsProperty('apiVersion') ? props['apiVersion'] : '43.0'">
```

### `#` is concatenation in attribute values

Inside `assembly.xml` attribute values (`cc:set value`, `cc:description text`), `#` is the string concatenation operator. This is different from `cc:eval` MVEL where `+` is used.

```xml
<!-- # in attribute value (assembly.xml) -->
<cc:set name="is.message.summary"
  value="props['inWebServiceApplication'] #' application HTTP request error'"/>

<!-- + in cc:eval MVEL -->
<cc:expression>props['msg'] = props['app'] + ' application HTTP request error'</cc:expression>
```

### Launch params

```xml
<cloud:param name="Pay Period End Date">
  <cloud:type><cloud:simple-type>date</cloud:simple-type></cloud:type>
  <cloud:launch-option>required</cloud:launch-option>
</cloud:param>
<cloud:param name="Pay Group WID">
  <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
</cloud:param>
```

Access in MVEL: `lp.getDate('Pay Period End Date')` for date, `lp.getSimpleData('Pay Group WID')` for text.

### `cc:cloud-log` vs `cc:log`

- `cc:cloud-log` — Workday UI (Integration Events tab, audit trail). Use for business milestones.
- `cc:log` — Studio console only. Use for developer debugging.

```xml
<cc:cloud-log id="LogSuccess" level="info"
  message="Worker Hired" message-details="@{props['worker.id']}" reference-id="props['worker.wid']"/>
```

### `cc:validate-exp` and `cc:send-error`

```xml
<cc:validate-exp id="ValidateHasData">
  <cc:expression failure-message="No records returned">props['count'] > 0</cc:expression>
</cc:validate-exp>
```

Use inside `async-mediation` with `handle-downstream-errors="true"` and a `cc:send-error`.

### `context.isError()` for conditional sub-flows

```xml
<cc:local-out id="NotifyOnError" execute-when="context.isError() == true"
  endpoint="vm://INT012/Email_In" unset-properties="false">
  <cc:set name="Email_Failure_Reason" value="context.errorMessage"/>
</cc:local-out>
```

### `replace-with-soap-fault` on `cc:workday-out-soap`

```xml
<cc:workday-out-soap id="HireEmployee" routes-response-to="HandleHire"
  application="Staffing" version="v40.0" replace-with-soap-fault="true"/>
```

Makes Workday SOAP errors catchable as structured faults by `cc:send-error`.

---

## Custom Java Beans

Studio projects are Eclipse JDT projects. Custom Java code can be compiled and bundled in the CLAR.

### Project structure

```
project/
  src/main/java/com/example/integration/MyBean.java   # source
  build/classes/                                      # Eclipse output (auto-compiled)
  ws/WSAR-INF/assembly.xml
  .classpath     # includes src/main/java + runtime JARs
  .project       # includes org.eclipse.jdt.core.javabuilder
```

### Pattern A: `@Component` + `@ComponentMethod` called via `cc:custom`

Use when the bean needs to read/write props (the `MediationContext`).

```java
import com.capeclear.assembly.annotation.Component;
import com.capeclear.assembly.annotation.ComponentMethod;
import static com.capeclear.assembly.annotation.Component.Type.*;

@Component(name="MyComponent", type=mediation, scope="prototype",
           toolTip="...", smallIconPath="icons/x_16.png", largeIconPath="icons/x_24.png")
public class MyComponent {
    @ComponentMethod
    public void process(com.capeclear.mediation.MediationContext ctx) {
        String input = ctx.getProperty("my.input.prop").toString();
        // do work
        ctx.setProperty("my.output.prop", result);
    }
}
```

Assembly XML — called as a step inside `cc:steps`:

```xml
<cc:custom id="RunMyComponent" ref="MyComponent"/>
```

Spring bean declaration — outside `<cc:assembly>`, inside `<beans>`, with `scope="prototype"`:

```xml
<beans ...>
  <cc:assembly ...> ... </cc:assembly>
  <bean id="MyComponent" class="com.example.integration.MyComponent" scope="prototype"/>
</beans>
```

### Pattern B: Plain POJO called via MVEL

Use for pure helper logic that doesn't need props access.

```java
public class MyHelper {
    public String compute(String input) { return input.toUpperCase(); }
}
```

```xml
<bean id="myHelper" class="com.example.integration.MyHelper" scope="prototype"/>
```

```java
// MVEL call: Spring registers the bean ID as a direct MVEL variable
props['result'] = myHelper.compute(props['someInput']);
```

### Why this works (the DelegatingClassLoader bypass)

MVEL's `DelegatingClassLoader` blocks `Class.forName('org.apache.http.*')` — too restricted to load new classes at runtime. BUT: Spring beans are instantiated by the Studio CONTAINER classloader at startup time. MVEL can then call methods on that already-alive object without any class loading. This sidesteps the restriction entirely.

### `scope="prototype"` is required

`scope="prototype"` is required on the Spring bean for `@ComponentMethod` beans — singleton scope causes state leakage across integration runs.

### Studio runtime HttpClient — critical version note

Studio 2025.24 runtime ships Apache HttpClient **4.2.3** — NOT the modern 4.5+ API.

Add these three JARs to `.classpath` (path on macOS):

```xml
<classpathentry kind="lib" path="/Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_2025.24.132/lib/httpclient-4.2.3.jar"/>
<classpathentry kind="lib" path="/Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_2025.24.132/lib/httpcore-4.2.2.jar"/>
<classpathentry kind="lib" path="/Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_2025.24.132/lib/commons-logging-1.1.1.jar"/>
```

**Do NOT use the 4.5+ API** (`CloseableHttpClient`, `HttpClients.custom()`, `CloseableHttpResponse`).
**DO use the 4.2.x API:** `DefaultHttpClient`, `httpClient.getConnectionManager().shutdown()`, `LaxRedirectStrategy`.

### Build process

1. Write `.java` file in `src/main/java/`.
2. Add required JARs to `.classpath`.
3. Eclipse auto-compiles on save (or Project → Build Project).
4. Studio's assembly builder packages compiled `.class` files into the CLAR on deploy.
5. After adding new `.java` file: Right-click project → Refresh (F5).

### Example: Resolving a 302 redirect that drops Basic auth

The Dayforce `train.dayforcehcm.com` host returns HTTP 302 to a tenant-specific hostname. Studio's `cc:http-basic-auth` drops credentials on redirect, producing 401.

**Strategy:** Run a one-time probe at integration init. Follow the redirect with auth, capture the final hostname, store it as the resolved base URL. All subsequent per-record `cc:http-out` calls use the resolved URL directly.

Three traps:

1. **HEAD requests don't trigger the 302** — only GET. Use `HttpGet`.
2. **Unauthenticated GET also doesn't redirect** — must include `Authorization: Basic ...` on the probe.
3. **Base URL returns HTTP 400, no redirect** — only real API endpoints (e.g. `/Employees`) trigger the 302. Probe URL must be `baseUrl + "Employees"`, not the bare base URL.

```java
@Component(name="DayforceUrlResolver", type=mediation, scope="prototype",
           toolTip="Resolves train.dayforcehcm.com 302 redirect to the concrete hostname",
           smallIconPath="icons/DayforceHttp_16.png", largeIconPath="icons/DayforceHttp_24.png")
public class DayforceUrlResolverComponent {

    @ComponentMethod
    public void process(com.capeclear.mediation.MediationContext ctx) {
        String trainUrl = ctx.getProperty("df.url").toString();
        String username = ctx.getProperty("df.username").toString();
        String password = ctx.getProperty("df.password").toString();
        final String authHeader = "Basic " + Base64.getEncoder().encodeToString(
            (username + ":" + password).getBytes(StandardCharsets.UTF_8));

        DefaultHttpClient httpClient = new DefaultHttpClient();
        httpClient.setRedirectStrategy(new LaxRedirectStrategy());
        // Preemptive auth: resend Authorization on every request including post-redirect
        httpClient.addRequestInterceptor(new HttpRequestInterceptor() {
            @Override
            public void process(HttpRequest req, HttpContext context)
                    throws HttpException, IOException {
                if (!req.containsHeader("Authorization")) {
                    req.addHeader("Authorization", authHeader);
                }
            }
        }, 0);

        try {
            String probeUrl = trainUrl.endsWith("/") ? trainUrl + "Employees" : trainUrl + "/Employees";
            HttpGet request = new HttpGet(probeUrl);
            BasicHttpContext localCtx = new BasicHttpContext();
            HttpResponse response = httpClient.execute(request, localCtx);
            EntityUtils.consume(response.getEntity());

            HttpHost finalHost = (HttpHost) localCtx.getAttribute(ExecutionContext.HTTP_TARGET_HOST);

            if (finalHost != null) {
                URI originalUri = new URI(trainUrl);
                if (!finalHost.getHostName().equalsIgnoreCase(originalUri.getHost())) {
                    String path = originalUri.getPath();
                    if (!path.endsWith("/")) { path = path + "/"; }
                    String resolved = finalHost.getSchemeName() + "://" + finalHost.getHostName() + path;
                    ctx.setProperty("df.resolved.url", resolved);
                    return;
                }
            }
            ctx.setProperty("df.resolved.url", trainUrl);
        } catch (Exception e) {
            ctx.setProperty("df.resolved.url", trainUrl);
        } finally {
            httpClient.getConnectionManager().shutdown();
        }
    }
}
```

Assembly wiring — call once during init, write resolved URL back to your URL prop:

```xml
<cc:eval id="MapUrlResolverProps">
    <cc:expression>props['df.url']      = props['df.direct.URL']</cc:expression>
    <cc:expression>props['df.username'] = props['df.direct.Username']</cc:expression>
    <cc:expression>props['df.password'] = props['df.direct.Password']</cc:expression>
</cc:eval>
<cc:custom id="ResolveDayforceUrl" ref="DayforceUrlResolver"/>
<cc:eval id="ApplyResolvedUrl">
    <cc:expression>props['df.direct.URL'] = props['df.resolved.url']</cc:expression>
</cc:eval>
```

---

## Sub-flow Decomposition

Break large assemblies into named sub-flows: `cc:local-out` calls a `cc:local-in` entry point.

- vm:// naming: `vm://{IntegrationSystemName}/{LocalInId}` — system name must match exactly.
- Sequential chaining: use `routes-response-to` on the caller local-out.
- Props are SHARED across all sub-flows.
- Each sub-flow gets its own named horizontal swimlane in the diagram.

### `cc:local-out`: `routes-response-to` present vs absent

- **Present** (`routes-response-to="NextStep"`): caller WAITS for the sub-flow to fully complete. Use for sequential pipelines.
- **Absent**: fire-and-forget — main chain does NOT wait. Use for per-record `cc:local-out` inside a splitter sub-route so the splitter can advance immediately after dispatch.

### Post-splitter continuation pattern

To do something AFTER all records are processed, wrap the RAAS fetch + splitter inside a local-in/local-out sub-flow. The sub-flow ends naturally when the splitter finishes all records. The calling `cc:local-out`'s `routes-response-to` then fires.

```
Main chain: CallInit (routes-response-to=CallGetWorkers) ->
            CallGetWorkers (local-out, routes-response-to=CallBuildAuditFile,
                            endpoint=vm://IntegrationName/GetWorkers)

GetWorkers sub-flow:
  GetWorkers (local-in, routes-to=FetchWorkers) ->
  FetchWorkers (workday-out-rest) ->
  PreSplitLog (async-med) ->
  SplitWorkers (cc:splitter, NO routes-to)
                       (per-record sub-route)
                  ExtractWdFields -> CallProcessOneWorker
```

### Extracting XML data before message transformation

After `cc:xslt-plus` transforms XML to CSV, the message is CSV and `xpath()` no longer works. Add `cc:eval` with `parts[0].xpath()` calls as the FIRST step in the async-mediation, before any xslt-plus. Store values in props.

---

## Outbound HTTP Patterns

### Top-level rule

`cc:http-out` is a TOP-LEVEL element. It cannot be placed inside `cc:async-mediation cc:steps`. Chain via `routes-response-to`.

### Basic POST/PATCH with credentials

```xml
<cc:http-out id="CallApi" routes-response-to="HandleResponse"
  endpoint="@{props['URL']}" http-method="PATCH"
  output-mimetype="application/json">
  <cc:http-basic-auth username="@{props['user']}" password="@{props['pass']}"/>
</cc:http-out>
```

### Dynamic URL building

```xml
<!-- Build the URL in an eval step first, then reference via @{...} -->
<cc:expression>props['URL'] = props['base'] + '/V1/employees/' + props['id']
                            + '?clientNamespace=' + props['ns']</cc:expression>
```

This avoids complex `@{...}` expressions inside the `endpoint` attribute itself.

### JSON payload via `cc:xslt-plus`

```xml
<cc:xslt-plus id="BuildJson" output-mimetype="application/json" url="WorkersToTarget.xsl"/>
```

`output-mimetype="application/json"` sets `Content-Type` automatically.

### OAuth2 token refresh pattern

```xml
<!-- 1. POST to token endpoint -->
<cc:http-out id="GetToken" routes-response-to="InjectToken"
  endpoint="https://auth.example.com/token?grant_type=refresh_token&amp;refresh_token=@{props['rt']}"
  http-method="POST"/>

<!-- 2. Parse JSON, extract token, set headers -->
<cc:async-mediation id="InjectToken" routes-to="CallApi">
  <cc:steps>
    <cc:json-to-xml id="Parse" nested-array-name="row" root-element-name="root"/>
    <cc:eval id="Extract">
      <cc:expression>props['access_token'] = parts[0].xpath('root/data/access_token')</cc:expression>
      <cc:expression>props['auth_header']  = 'Bearer ' + props['access_token']</cc:expression>
    </cc:eval>
    <cc:write id="ClearBody"><cc:message></cc:message></cc:write>
    <cc:set-headers id="Inject">
      <cc:remove-headers/>
      <cc:add-headers>
        <cc:add-header name="Authorization" value="@{props['auth_header']}"/>
        <cc:add-header name="x-api-key"     value="@{props['api_key']}"/>
      </cc:add-headers>
    </cc:set-headers>
  </cc:steps>
</cc:async-mediation>

<!-- 3. All subsequent cc:http-out calls carry the headers automatically -->
```

### Pagination loop pattern

```xml
<!-- Init: props['offset'] = 0, props['response_count'] = 999999, props['loop_break'] = false -->
<cc:route id="PagedFetch">
  <cc:loop-strategy condition="props['offset'] &lt;= props['response_count']"
    increment="props['offset'] = props['offset'] + 6000"/>
  <cc:sub-route name="SubRoute" routes-to="FetchBatch"/>
</cc:route>

<!-- FetchBatch: GET API -> json-to-xml -> extract count -> xslt-plus -> send to aggregator
     When last page: set props['loop_break'] = true to exit early
     Aggregator fires when: force-batch-when="props['offset'] >= props['response_count']" -->
```

### `cc:json-to-xml` then xpath

Always extract before any transform — after `xslt-plus` or `write`, xpath stops working.

```xml
<cc:json-to-xml id="JsonToXml" nested-object-name="record"/>             <!-- paginated list -->
<cc:json-to-xml id="JsonToXml" nested-array-name="row" root-element-name="root"/>  <!-- array response -->
<cc:eval id="Extract">
  <cc:expression>props['count'] = parts[0].xpath('root/record/count')</cc:expression>
</cc:eval>
```

### Routing on conditions: `cc:mvel-strategy`

```xml
<cc:route id="HireType">
  <cc:mvel-strategy>
    <cc:choose-route expression="props['Is_Rehire'] == 'Y'" route="Rehire"/>
    <cc:choose-route expression="true" route="New Hire"/>  <!-- default else -->
  </cc:mvel-strategy>
  <cc:sub-route name="New Hire" routes-to="NewHireFlow"/>
  <cc:sub-route name="Rehire"   routes-to="RehireFlow"/>
</cc:route>
```

### `cc:aggregator` with CSV header

```xml
<cc:aggregator id="Collect" routes-to="Save"
  force-batch-on-last-message="false" force-batch-when="props['data_count'] == 0">
  <cc:size-batch-strategy batch-size="-1"/>
  <cc:message-content-collater>
    <cc:header-text>Col1|Col2|Col3</cc:header-text>
  </cc:message-content-collater>
</cc:aggregator>
```

### Email out

```xml
<!-- 1. Build HTML body -->
<cc:write id="BuildEmail" output-mimetype="text/html">
  <cc:message><cc:text>Hello @{props['name']},&lt;br&gt;Error: @{props['Reason']}</cc:text></cc:message>
</cc:write>

<!-- 2. Send (prod vs impl split via execute-when) -->
<cc:email-out id="EmailProd" execute-when="props['Is_Impl'] == false"
  endpoint="mailto:@{props['Recruiter_Email']}" subject="..."
  host="email-smtp.us-east-1.amazonaws.com" port="587" starttls="true"
  user="@{props['smtp_user']}" password="@{props['smtp_pass']}"
  from="prehire@example.com">
  <cc:custom-headers/>
</cc:email-out>
<cc:email-out id="EmailImpl" execute-when="props['Is_Impl'] == true"
  endpoint="mailto:int-dev@example.com" ...>
  <cc:custom-headers/>
</cc:email-out>
```

---

## XSLT Patterns

### `xsl:param` dot-rename rule

XSL params can't have dots in their names (NCName rule). If your prop is `DF.XRefCode`, rename it to `DF_XRefCode` before passing to XSL. Props accessed only via MVEL can keep dots.

### `cc:xslt-plus` requires valid XML input

```xml
<!-- Write a stub message first if the current message is non-XML -->
<cc:write id="PrepareInput">
  <cc:message><cc:text>&lt;request/&gt;</cc:text></cc:message>
</cc:write>
<cc:xslt-plus id="BuildPayload" output-mimetype="application/json" url="WorkersToTarget.xsl"/>
```

The XSL ignores `<request/>` and reads only its `xsl:param` values from props.

### XSL file location

All XSL files referenced by `url=` in `cc:xslt-plus` must live in `ws/WSAR-INF/` — the same directory as `assembly.xml`. The `url=` value is a bare filename, not a path. Studio resolves it relative to `WSAR-INF/`.

After adding any XSL file outside Studio:

1. Right-click the project then Refresh (F5). Eclipse does not watch the filesystem — files created by external tools are invisible until refreshed.
2. Click the `cc:xslt-plus` step in the diagram to open its Properties panel.
3. Click the lookup button (magnifying glass) next to the Url field.
4. Browse and select the XSL file from the dialog.

Studio re-registers the reference and clears the validation error. Writing `url="filename.xsl"` in `assembly.xml` is necessary but not sufficient — Studio needs the UI registration step too.

### Launch params then XSL params pipeline

1. Declare `cloud:param` in `cc:workday-in`.
2. Add a `cc:eval` step BEFORE `cc:xslt-plus`: `props['key'] = lp.getSimpleData('Param Name')`.
3. XSL declares `<xsl:param name="key" select="''"/>` — `cc:xslt-plus` passes all props as params automatically.

### `cc:json-to-xml` adds a synthetic `<root>` wrapper

`cc:json-to-xml` wraps the entire JSON object in a synthetic `<root>` element. So `{"Data": {"EmployeeNumber": "123"}}` becomes `<root><Data><EmployeeNumber>123</EmployeeNumber></Data></root>`.

XSL paths MUST be `/*/Data/FieldName` — NOT `/*/FieldName`. Using `/*/FieldName` silently matches nothing.

### `format=simplexml` removes namespace prefixes

```xml
<cc:workday-out-rest id="GetPos" routes-response-to="Process"
  extra-path="@{intsys.reportService.getExtrapath('positionRAAS')}?Position_ID=@{props['pid']}&amp;format=simplexml"/>
<!-- XPath: parts[0].xpath('Report_Data/Report_Entry/Field') with no wd: prefix -->
```

Without `format=simplexml`, RAAS responses use the `wd:` namespace on every element.

### Streaming XSLT 3.0 (large datasets)

```xml
<xsl:mode streamable="yes" on-no-match="shallow-skip"/>
<xsl:mode name="in-memory" streamable="no" on-no-match="shallow-skip"/>

<!-- Stream one entry at a time, carry state across iterations -->
<xsl:iterate select="wd:Report_Data/wd:Report_Entry">
  <xsl:param name="counter" as="xs:integer" select="0"/>
  <xsl:try>
    <xsl:apply-templates select="copy-of()" mode="in-memory"/>
    <xsl:catch errors="*">
      <xsl:value-of select="$err:description"/>
    </xsl:catch>
  </xsl:try>
  <xsl:next-iteration>
    <xsl:with-param name="counter" select="$counter + 1"/>
  </xsl:next-iteration>
</xsl:iterate>
```

### `snapshot()` for in-memory key lookups inside streaming XSLT

```xml
<xsl:param name="lookupData1" as="document-node()" select="snapshot()"/>
<xsl:key name="lookupKey1" match="row" use="@id"/>

<!-- Later inside xsl:iterate: -->
<xsl:variable name="match" select="key('lookupKey1', $id, $lookupData1)"/>
```

### Dynamic library include via Studio prop

```xml
<xsl:param name="libMessage" static="yes"
  select="ctx:getProperty(tube:getCurrentMediationContext(), 'libMessage')"/>
<xsl:include _href="{$libMessage}"/>
```

`static="yes"` allows the include path to be resolved at compile time from a prop.

---

## RAAS Patterns

RAAS (Report as a Service) is the dominant pattern for reading bulk data FROM Workday. Preferred over `Get_*` SOAP for any list-of-records query.

### Step 1 — Declare report aliases in `cc:workday-in`

```xml
<cloud:report-service name="INT999_Reports">
  <!-- Alias-only: Workday matches alias to a report with the same name in the tenant -->
  <cloud:report-alias description="Active workers" name="INT999_Get_Workers"/>

  <!-- WID-bound: portable across report renames -->
  <cloud:report-alias description="Location tree" name="INT999_Locations">
    <cloud:report-reference description="Location tree" type="WID">0408aa8e712a0101c0b44d0d3d2a2e9b</cloud:report-reference>
  </cloud:report-alias>
</cloud:report-service>
```

### Step 2 — Call the report

Build the query string in an eval step (where MVEL `+` concatenation is easy) and store as a prop. Reference it in `extra-path` using `@{...}` interpolation:

```xml
<cc:expression>props['raas_params'] = '?Worker!WID=' + props['workerWID'] + '&amp;format=simplexml'</cc:expression>

<cc:workday-out-rest id="FetchWorkers" routes-response-to="PreSplitLog"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Workers') + props['raas_params']}"/>
```

Filter syntax — use `!WID` suffix for object reference filters:

```xml
<cc:workday-out-rest id="GetByWorker"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Get_Workers')}?Worker!WID=@{props['workerWID']}"/>

<!-- Multiple filters: join with &amp; -->
<cc:workday-out-rest id="GetByMgrOrg"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Report')}?manager!WID=@{props['mgr']}&amp;Sup_Org!WID=@{props['supOrgWID']}"/>
```

### Step 3 — Split into records

Choice depends on expected record count:

```xml
<!-- Large datasets (>100 records): MUST use xml-stream-splitter -->
<cc:splitter id="Splitter">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xml-stream-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- Small datasets (<100 records): xpath-splitter loads all into memory -->
<cc:splitter id="Splitter">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xpath-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>
```

`xml-stream-splitter` processes records SEQUENTIALLY. Props accumulation (StringBuilder, counters) is safe.

### Step 4 — Extract fields per record

```xml
<!-- Inside async-mediation: parts[0] is one wd:Report_Entry node -->
<cc:eval id="ExtractFields">
  <cc:expression>props['wid']    = parts[0].xpath('wd:Report_Entry/wd:Worker_WID')</cc:expression>
  <cc:expression>props['empID']  = parts[0].xpath('wd:Report_Entry/wd:Employee_ID')</cc:expression>
  <!-- Typed reference lookup: attribute predicate -->
  <cc:expression>props['orgWID'] = parts[0].xpath('wd:Report_Entry/wd:Org/wd:ID[@wd:type=&quot;WID&quot;]')</cc:expression>
  <cc:expression>props['orgRef'] = parts[0].xpath('wd:Report_Entry/wd:Org/wd:ID[@wd:type=&quot;Organization_Reference_ID&quot;]')</cc:expression>
</cc:eval>
```

### Response structure

Both with and without `format=simplexml`, the structure is:

- Root: `wd:Report_Data`
- Records: `wd:Report_Data/wd:Report_Entry`
- All fields inside `Report_Entry` are in the `wd:` namespace.

Single-record reports (no splitter needed) use absolute XPath:

```java
props['val'] = parts[0].xpath('/wd:Report_Data/wd:Report_Entry/wd:Field')
```

### Handling zero-record reports

When the report returns 0 rows, the splitter fires no sub-routes. Wrap the target of `routes-response-to` in an async-mediation with a send-error to handle the empty-report case:

```xml
<cc:workday-out-rest id="GetData" routes-response-to="CheckData" .../>
<cc:async-mediation id="CheckData" routes-to="Splitter" handle-downstream-errors="true">
  <cc:steps>
    <cc:eval id="SetFlag"><cc:expression>props['hasData'] = 1</cc:expression></cc:eval>
  </cc:steps>
  <cc:send-error id="NoDataError" routes-to="PutNoDataMessage"/>
</cc:async-mediation>
```

### Ask the user for sample XML during build

RAAS report schema (field names, nesting, namespace attributes) is defined in the Workday tenant, not in Studio. During the BUILD phase, ask the user:

> "Can you run this report in Workday and paste a few rows of the XML response? I'll use that to write the correct XPath expressions."

Even 1-2 rows is enough. Don't guess field names from report aliases alone — they can be anything (`wd:workdayID`, `wd:Employee`, `wd:Supervisory_Organization`). Accurate XPath requires seeing the actual XML.

---

## REST API Patterns

OAuth2 token refresh, pagination, and `cc:json-to-xml` extraction are covered in [Outbound HTTP Patterns](#outbound-http-patterns).

### Basic auth via `cc:base64-encode` (XML step alternative)

```xml
<cc:write id="PrepKey"><cc:message><cc:text>@{props['api_key']}:</cc:text></cc:message></cc:write>
<cc:base64-encode id="Encode" output="variable" output-variable="api_key_b64" input="message"/>
<!-- Inject: <cc:add-header name="Authorization" value="Basic @{vars['api_key_b64'].getText()}"/> -->
```

XML-step alternative to the pure-MVEL Base64 approach.

### `cloud:retrieval-service` — inbound file integrations

For integrations where the user uploads a file with the integration event:

```xml
<cloud:retrieval-service name="INT999_Retrieval"/>

<cc:local-out id="GetDocs" routes-response-to="ProcessFiles"
  endpoint="vm://wcc/GetEventDocuments">
  <cc:set name="ie.event.wid" value="lp.isSet() ? lp.getIntegrationEventWID() : null"/>
</cc:local-out>
```

---

## Document Storage Patterns

### Store document then attach to event — two patterns

**Pattern 1: Store to variable, then deliver explicitly**

Use when you need to pass the document reference around or attach it conditionally.

```xml
<cc:store id="StoreFile" output="variable" output-variable="doc_ref"
  input="message" createDocumentReference="false" expiresIn="P30D"
  title="@{props['filename']}" contentDisposition="attachment;filename=&quot;@{props['filename']}&quot;"
  schema="http://www.w3.org/2005/Atom"/>
<cc:local-out id="AttachDoc" endpoint="vm://wcc/PutIntegrationMessage" clone-request="true">
  <cc:set name="is.document.variable.name" value="'doc_ref'"/>
  <cc:set name="is.document.deliverable" value="'true'"/>
</cc:local-out>
```

**Pattern 2: Inline store, auto-attached (simpler)**

Use when the file is always delivered and no conditional logic is needed. `cc:store` is placed as the LAST step inside `cc:async-mediation cc:steps`, after `cc:write`. `is.document.deliverable` is NOT needed on the subsequent `PutIntegrationMessage` call — `cc:store` handles the attachment directly.

```xml
<!-- Inside DoBuildAuditFile cc:steps, after cc:write: -->
<cc:store id="Store" expiresIn="P30D" title="Audit_@{props['Pay_Period_End_Date']}.csv"/>

<!-- Then route to: -->
<cc:local-out id="DeliverAuditFile" endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.document.name" value="'Audit_' + props['Pay_Period_End_Date'] + '.csv'"/>
  <cc:set name="is.document.encoding" value="'UTF-8'"/>
  <cc:set name="is.message.summary" value="'Audit complete: Total: ' + props['count.total']"/>
  <!-- DO NOT add is.document.deliverable here: cc:store already attached the file -->
</cc:local-out>
```

---

## Server Log Diagnosis

When integrations fail in deployment, fetch the Workday server log and grep for these signatures:

| Signature | Meaning |
|---|---|
| `scala.MatchError` | Bad node type in `assembly-diagram.xml` (`cc:send-error`, `cc:note`, or unresolved `eProxyURI`) |
| `IWorkbenchWindow.getSelectionService()` is null | Editor part initialization failed; restart Studio |
| `org.mvel.ParseException: unknown class` | MVEL hit a `props['map'].method(complexExpr)` inside if/else; restructure with ternary |
| `Resource '/.../filename.xsl' does not exist` | XSL file missing from `ws/WSAR-INF/` or Eclipse not refreshed (F5) |
| `XSLTC: Param ... not declared` | `xsl:param` name has dots (NCName violation); rename prop with underscores |
| `401 Unauthorized` post-redirect | Basic auth credentials dropped on 302; need preemptive auth interceptor or one-time URL resolution |
| HTTP 400 on bare base URL | The base URL alone may not redirect — probe a real endpoint to capture the post-redirect host |

Look for the FIRST exception in the log. Subsequent exceptions are usually cascades from the first one.

---

## Common Errors

### `scala.MatchError` on Studio open

**Cause:** Either a `cc:send-error` or `cc:note` is referenced as a diagram node, OR a deleted `assembly.xml` element is still referenced from `assembly-diagram.xml` via unresolved `eProxyURI`.

**Fix:** Find every diagram href that points at a non-existent assembly id, and either remove it or repoint it. See [Removing components](#removing-components-mirror-the-three-entries) above.

### `IWorkbenchWindow.getSelectionService()` NPE persists until restart

After a `MatchError` during diagram render, Studio shows:

```
Cannot invoke "org.eclipse.ui.IWorkbenchWindow.getSelectionService()"
because the return value of "org.eclipse.ui.IWorkbenchPartSite.getWorkbenchWindow()" is null
```

The dialog reappears on every focus change. Even after fixing `assembly-diagram.xml`, the NPE keeps firing.

**Cause:** When the editor part fails to initialize (because of the upstream `MatchError`), its `WorkbenchPartSite` ends up half-constructed with a null window reference. Eclipse caches this broken site and continues asking for selection-service from it. There is no Studio API to reset a broken part site at runtime.

**Fix:** Full Studio restart is the only reliable way to clear it. There is no in-Studio recovery path for this specific NPE. Once it appears, save your work and restart.

**Prevention:** Always commit a known-good state to project-local git before structural assembly edits. Validate every diagram positional ref BEFORE letting Studio open the file.

### `cc:xslt-plus` "Resource does not exist" after F5

Even after F5 refresh, Studio may still report "cannot be found" for a `cc:xslt-plus` URL. Studio validates XSL references through its own workspace registry, not just filesystem presence.

**Fix:**
1. Click the `cc:xslt-plus` step in the diagram to open its Properties panel.
2. Click the lookup button (magnifying glass) next to the Url field.
3. Browse and select the XSL file from the dialog.
4. Studio re-registers the reference and clears the validation error.

### `cc:expression` XML parse error on `>`, `<`, or `if/else`

Wrap the entire expression in CDATA. See [MVEL Idioms](#cdata-for-comparison-operators-and-multi-statement-blocks).

### `cloud:launch-option>optional` schema error

`"optional"` is not a valid value. Omit `cloud:launch-option` entirely for optional params, or use `"required"` for mandatory ones.

---

## Backup Workflow

Always commit a known-good state to project-local git before editing `assembly.xml` or `assembly-diagram.xml` structurally. Single-attribute edits in XSL files don't need this. Structural assembly edits absolutely do.

### One-time setup per project

```bash
cd <project-root>
[ -d .git ] || git init -b main
cat > .gitignore <<'EOF'
build/
.DS_Store
*.bak
*.swp
EOF
git add -A
git commit -m "snapshot: <description of current state>"
git tag known-good-<short-name>
```

### Before any risky edit

```bash
git commit -am "snapshot: before <description>"
git tag known-good-before-<short-name>
```

### If Studio crashes

```bash
# Reset assembly + diagram to last known-good state (does NOT touch other files)
git checkout known-good-<short-name> -- ws/WSAR-INF/assembly.xml ws/WSAR-INF/assembly-diagram.xml

# OR full project reset to the tag:
git reset --hard known-good-<short-name>
```

### Rule

Before making more than a one-line structural change to `assembly.xml`, propose a commit with a clear message: `snapshot: before <what we're about to do>`. After the change is verified working in Studio, propose another commit with `snapshot: after <what we did>` and a tag.

---

## SSK Patterns

Studio Starter Kit (SSK) is the official Workday framework (v2025r1.02 confirmed). Its conventions are useful even outside SSK projects.

### `cc:parameter` and `cc:out-parameter` typed API contract

SSK sub-flow entry points use `cc:parameter` to declare typed, documented inputs and `cc:out-parameter` to document outputs.

```xml
<cc:local-in id="CallSoap" access="public" use-global-error-handlers="true"
  icon="icons/callSoap.png" routes-to="BuildSoapRequest">
  <cc:parameter name="soapRequestXml" type="xml" required="true">
    Complete SOAP envelope to send.
  </cc:parameter>
  <cc:parameter name="globalApiVersion" type="string"
    default="context.containsProperty('globalApiVersion') ? props['globalApiVersion'] : '43.0'">
    Workday API version (e.g. 43.0).
  </cc:parameter>
  <cc:out-parameter name="callStatus" type="string">
    "SUCCESS" or "FAULT" after the call returns.
  </cc:out-parameter>
</cc:local-in>
```

### `Finally_*` teardown pattern

Every SSK component has a paired `Finally_{ComponentName}` sub-flow called unconditionally after the component (both success and error paths). It resets component-scoped props and logs completion.

```xml
<!-- Call component -->
<cc:local-out id="CallSoap_1" store-message="none"
  routes-response-to="Finally_CallSoap_1" endpoint="vm://INT_SSK/CallSoap">
  <cc:set name="soapRequestXml" value="message"/>
  <cc:set name="globalApiVersion" value="props['globalApiVersion']"/>
</cc:local-out>

<!-- Unconditional cleanup (also called on error paths) -->
<cc:local-out id="Finally_CallSoap_1" store-message="none"
  routes-response-to="NextStep" endpoint="vm://INT_SSK/Finally_CallSoap"/>
```

### `ssk:createMessage()` structured CloudLog logging

```xml
<!-- Namespace: xmlns:ssk="urn:com.workday.custom.ssk.common" -->
<!-- Loaded via dynamic _href include from libMessage prop -->
<xsl:value-of select="ssk:createMessage('INFO', 'Worker processed', $workerId)"/>
<!-- Returns: <lm><l>INFO</l><m>Worker processed</m><id>12345</id></lm> -->
<!-- Overloaded: 2-8 params: (level, msg), (level, msg, id), (level, msg, id, detail), etc. -->
```

### `decorations` in `assembly-diagram.xml`

Colored text annotations on swimlanes. Use instead of `cc:note` (schema-invalid in `assembly.xml`).

```xml
<swimlanes x="30" y="800" name="CallSoap" alignment="START">
  <elements href="assembly.xml#CallSoap"/>
  <decorations bgColor="#E3F2FD" fontColor="#0D47A1" type="NOTE">
    Calls Workday SOAP. Inputs: soapRequestXml. Outputs: soapResponseXml, callStatus.
  </decorations>
</swimlanes>
```

### Framework globals

Set once at assembly entry; read by all SSK components automatically:

```java
props['sskIsDebugMode']   = intsys.getAttributeAsBoolean('SSK Debug Mode')
props['globalApiVersion'] = intsys.getAttribute('API Version')

// Auto-set by Studio (read-only):
props['cc.customer.id']   // Workday tenant name
```

### `cc:local-in` attributes

- `access="public"` — default; callable from other integrations.
- `access="private"` — internal use only.
- `use-global-error-handlers="true"` — connects this sub-flow to assembly-level global error handlers.
- `icon="icons/iconName.png"` — diagram icon.

---

## How to Contribute

This document captures patterns confirmed against working integrations. To add a new pattern:

1. Verify the pattern works in at least one running integration. Patterns from documentation alone are not sufficient — Studio's behavior often differs from its docs.
2. Strip any tenant-identifying details (hostnames, ISU usernames, project numbers tied to specific business logic, internal package names).
3. Open a PR against `https://github.com/krishnagutta/Workday-studio-mcp` with:
   - The pattern in the appropriate section
   - A minimal code example
   - The error or symptom it fixes (if applicable)
   - The Studio version where it was confirmed

Patterns that crashed Studio or produced subtle bugs are especially welcome — those are the lessons that save other developers the most time.
