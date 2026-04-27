import { z } from 'zod';

const REFERENCE = {
  'workday-in': {
    description: 'Entry point of the integration. Every assembly has exactly one. Defines launch parameters (cloud:param) and the integration system declarations that control which Workday services the integration can call.\n\nCORE DECLARATIONS inside cc:integration-system:\n- cloud:report-service: Declares one or more RAAS (Report as a Service) report aliases the integration calls. Required for any workday-out-rest call that uses intsys.reportService.getExtrapath(). See XML example for alias-only vs WID-bound forms.\n- cloud:retrieval-service: Registers the integration to access documents uploaded on the integration event. Pair with vm://wcc/GetEventDocuments. Self-closing, no children.\n- cloud:listener-service: Registers the integration as a webhook/event listener. The inbound payload arrives in the wd.retrieve.variable at runtime. Self-closing, no children.\n- cloud:attribute-map-service: Credentials and config stored outside the assembly (API keys, URLs, OAuth tokens). Read at runtime via intsys.getAttribute(\'Name\'). cloud:map inside it defines bidirectional value mappings looked up via intsys.integrationMapLookup() and intsys.integrationMapReverseLookup().\n- cloud:custom-object-service: Declares Workday custom objects accessed via workday-out-rest.\n- cloud:sequence-generator-service: For auto-increment IDs via lp.getSequencedValue().\n- cloud:param: Launch parameter prompts shown when launching the integration.\n\nACCESSING LAUNCH PARAMS IN XSLT:\n1. Declare cloud:param in cc:workday-in\n2. In the first cc:async-mediation cc:steps, add cc:eval BEFORE cc:xslt-plus\n3. In cc:eval: props[\'key\'] = lp.getSimpleData(\'Param Name\') for text, lp.getDate(\'Param Name\') for dates\n4. In the XSL: declare <xsl:param name="key"/> — Studio auto-passes all props as XSL params\n\ncloud:launch-option values:\n- "required" — valid on ALL param types (text, date, boolean, enumeration, class-report-field). Forces the user to fill it in before launching.\n- "as-of-effective-date" / "as-of-entry-datetime" / "begin-effective-date" / "begin-entry-datetime" — DATE params ONLY. Auto-populates the date from the business process context. Do NOT use these on non-date params — schema validation error (confirmed Mistake #2).\n- "optional" is NOT a valid value — causes schema error.',
    routes_via: 'routes-to',
    xml_example: `<!-- ASSEMBLY.XML -->
<cc:workday-in id="StartHere" routes-to="BuildRequest">
  <cc:integration-system name="INT999_My_Integration">

    <!-- Text param: leave blank at launch to skip; fill in to filter -->
    <cloud:param name="Employee_ID">
      <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
    </cloud:param>

    <!-- Date param with launch-option (date params only) -->
    <cloud:param name="Effective Date">
      <cloud:type><cloud:simple-type>date</cloud:simple-type></cloud:type>
      <cloud:launch-option>as-of-effective-date</cloud:launch-option>
    </cloud:param>

    <!-- Attribute map: credentials and config stored outside the assembly.
         display-options: display-as-password (masks in UI), required-for-launch -->
    <cloud:attribute-map-service name="INT999_Attributes">
      <cloud:attribute name="Target API URL">
        <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
        <cloud:display-option>required-for-launch</cloud:display-option>
      </cloud:attribute>
      <cloud:attribute name="API Secret">
        <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
        <cloud:display-option>display-as-password</cloud:display-option>
        <cloud:display-option>required-for-launch</cloud:display-option>
      </cloud:attribute>
    </cloud:attribute-map-service>

    <!-- Worker / object picker param (WID reference). Read with lp.getReferenceData('Param Name', 'WID').
         The WID value in cloud:class-report-field is the Workday object type descriptor WID. -->
    <cloud:param name="Select Worker">
      <cloud:type>
        <cloud:class-report-field description="Worker" type="WID" singular="true">ec614fb7912d465cab2f18552f45ba96</cloud:class-report-field>
      </cloud:type>
    </cloud:param>

    <!-- Dropdown enumeration param. Read with lp.getSimpleData('Param Name'). Returns the selected string. -->
    <cloud:param name="Worker Type">
      <cloud:type>
        <cloud:enumeration-type name="EnumWorkerType">
          <cloud:enumeration>Contractor</cloud:enumeration>
          <cloud:enumeration>Consultant</cloud:enumeration>
          <cloud:enumeration>Board Member</cloud:enumeration>
        </cloud:enumeration-type>
      </cloud:type>
      <cloud:launch-option>required</cloud:launch-option>
    </cloud:param>

    <!-- Boolean param. Read with lp.getSimpleData() — returns 'true' or 'false' string. -->
    <cloud:param name="Needs Laptop">
      <cloud:type><cloud:simple-type>boolean</cloud:simple-type></cloud:type>
      <cloud:default/>
    </cloud:param>

    <!-- Sequencer service for auto-increment IDs. Read with lp.getSequencedValue() in cc:eval. -->
    <cloud:sequence-generator-service name="INT999_Seq_Service">
      <cloud:sequencer>INT999_Seq</cloud:sequencer>
    </cloud:sequence-generator-service>

    <!-- Custom object service for Workday custom objects. -->
    <cloud:custom-object-service name="INT999_CustomObj">
      <cloud:custom-object-alias description="IT Data Object" name="INT999_ITData">
        <cloud:custom-object-reference description="All IT Data" type="WID">b284cb25201501d464ab7d464a3127ce</cloud:custom-object-reference>
      </cloud:custom-object-alias>
    </cloud:custom-object-service>

    <!-- Integration map service: defines bidirectional external↔internal value mappings.
         Looked up at runtime with intsys.integrationMapLookup() / integrationMapReverseLookup().
         cloud:internal-type and cloud:external-type define the value types on each side. -->
    <cloud:attribute-map-service name="INT999_ReferenceMaps">
      <cloud:map name="Ethnicity Type">
        <cloud:internal-type><cloud:simple-type>text</cloud:simple-type></cloud:internal-type>
        <cloud:external-type><cloud:simple-type>text</cloud:simple-type></cloud:external-type>
      </cloud:map>
      <cloud:map name="Job Category Location">
        <cloud:internal-type><cloud:simple-type>text</cloud:simple-type></cloud:internal-type>
        <cloud:external-type><cloud:simple-type>text</cloud:simple-type></cloud:external-type>
      </cloud:map>
    </cloud:attribute-map-service>

    <!-- RAAS (Report as a Service): declare all custom reports this integration calls.
         Two forms:
         (a) alias-only — Workday resolves by matching the alias to a report with the same name
         (b) WID-bound  — alias maps to a specific report WID, portable across report renames
         Confirmed from INT060, INT072, INT086c, INT130, INT135 — ALL use cloud:report-service.
         Call the report with: intsys.reportService.getExtrapath('alias') in workday-out-rest extra-path. -->
    <cloud:report-service name="INT999_Reports">
      <cloud:report-alias description="Active workers with status fields" name="INT999_Get_Workers"/>
      <cloud:report-alias description="Location hierarchy with parent refs" name="INT999_Locations">
        <cloud:report-reference description="Location hierarchy with parent refs" type="WID">0408aa8e712a0101c0b44d0d3d2a2e9b</cloud:report-reference>
      </cloud:report-alias>
    </cloud:report-service>

    <!-- Retrieval service: accesses files uploaded by the user on the integration event.
         Confirmed from INT002. Pair with vm://wcc/GetEventDocuments to fetch the files.
         Self-closing — no child elements. -->
    <cloud:retrieval-service name="INT999_Retrieval"/>

    <!-- Listener service: registers this integration as a webhook/event receiver.
         The inbound payload arrives in the 'wd.retrieve.variable' at runtime.
         Self-closing — no child elements. -->
    <cloud:listener-service name="INT999_Listener_Service"/>
  </cc:integration-system>
</cc:workday-in>

<!-- cc:eval captures launch params into props BEFORE the cc:xslt-plus.
     Studio then passes props as XSL stylesheet parameters automatically. -->
<cc:async-mediation id="BuildRequest" routes-to="NextStep">
  <cc:steps>
    <cc:eval id="CaptureParams">
      <cc:expression>props['Employee_ID'] = lp.getSimpleData('Employee_ID')</cc:expression>
      <cc:expression>props['Effective_Date'] = lp.getDate('Effective Date')</cc:expression>
    </cc:eval>
    <cc:xslt-plus id="MyXslt" output-mimetype="text/xml" url="MyTransform.xsl"/>
  </cc:steps>
</cc:async-mediation>

<!-- MyTransform.xsl — params match props keys exactly -->
<!--
  <xsl:param name="Employee_ID" select="''"/>
  <xsl:param name="Effective_Date" select="''"/>
-->`,
  },
  'transform': {
    description: 'Applies an XSLT stylesheet to the current message. Use for XML→XML transformations (e.g. building a Workday SOAP request from a report output).',
    routes_via: 'routes-to',
    xml_example: `<cc:transform id="BuildRequest" routes-to="NextStep">
  <cc:xslt href="BuildRequest.xsl"/>
</cc:transform>`,
  },
  'xslt-plus': {
    description: 'Like cc:transform but supports non-XML outputs (JSON, CSV, text) via output-mimetype. Used inside cc:async-mediation cc:steps.\n\nKEY RULES (confirmed from production integrations):\n1. cc:xslt-plus REQUIRES the current message to be valid XML. If you need to build JSON from props (not from incoming XML), write a <request/> stub first with cc:write, then apply cc:xslt-plus.\n2. All props map entries are automatically passed to the XSL as xsl:param values. Declare matching xsl:params in the stylesheet.\n3. xsl:param names CANNOT contain dots — dots are not valid XML NCName characters. Use underscores instead: DF_XRefCode not DF.XRefCode. Props keys can have dots (they are just strings in MVEL), but the xsl:param must use underscores.\n4. output-mimetype sets the Content-Type header automatically for subsequent cc:http-out calls.',
    routes_via: 'routes-to (inline step inside cc:async-mediation)',
    xml_example: `<!-- Standard use: transform incoming XML to CSV or another XML -->
<cc:xslt-plus id="CsvXslt" output-mimetype="text/csv" url="WorkersToCsv.xsl"/>

<!-- Build JSON payload from props (not from incoming XML):
     cc:write provides a minimal valid XML input; the XSL ignores it and reads only xsl:params. -->
<cc:write id="PrepareInput">
  <cc:message><cc:text>&lt;request/&gt;</cc:text></cc:message>
</cc:write>
<cc:xslt-plus id="DayforceXslt" output-mimetype="application/json" url="WorkersToDayforce.xsl"/>

<!-- The matching XSL — note underscore param names (dots would fail at parse time): -->
<!--
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="text" encoding="UTF-8" omit-xml-declaration="yes"/>
  <xsl:param name="DF_XRefCode"  select="''"/>   <!-- props['DF_XRefCode'] -->
  <xsl:param name="DF_FirstName" select="''"/>   <!-- props['DF_FirstName'] -->
  <xsl:template match="/">
    { "EmployeeNumber": "<xsl:value-of select="$DF_XRefCode"/>", "FirstName": "<xsl:value-of select="$DF_FirstName"/>" }
  </xsl:template>
</xsl:stylesheet>
-->`,
  },
  'http-out': {
    description: 'Outbound HTTP/HTTPS call to an external REST API. The current message body is sent as the request body; the HTTP response becomes the new message. Supports GET, POST, PATCH, PUT, DELETE via http-method attribute. Basic auth via cc:http-basic-auth child element. Endpoint URL is a MVEL expression — build the full URL (including path + query string) in a preceding cc:eval step and store it in props.\n\nCRITICAL SCHEMA RULE (confirmed INT144, INT069): cc:http-out MUST be a TOP-LEVEL element — place it directly inside <cc:assembly>, NEVER inside <cc:steps>. Studio\'s schema rejects it inside steps.\n\nCONFIRMED PATTERN (from INT144 and INT_TEST_GetWorkers_CSV_STU):\n- Store credentials in cloud:attribute-map-service, read with intsys.getAttribute() in cc:eval\n- Build JSON payload with cc:xslt-plus (output-mimetype="application/json") — Content-Type is set automatically\n- For PATCH endpoints that include the entity ID in the path, build the full URL in cc:eval and store in props\n- Handle the response in a cc:async-mediation via routes-response-to (log it, write audit records, etc.)\n\nJSON PAYLOAD WITH XSLT TRICK: when building a JSON payload from props (not from incoming XML), write a minimal <request/> stub first so cc:xslt-plus has a valid XML input. The XSL declares xsl:params matching the prop keys — cc:xslt-plus passes all props as XSL parameters automatically. xsl:param names cannot contain dots; use underscores instead (DF_XRefCode not DF.XRefCode).',
    routes_via: 'routes-response-to',
    xml_example: `<!-- ASSEMBLY.XML: confirmed INT144 + INT_TEST pattern -->

<!-- Step 1: capture credentials in cc:eval (at start of assembly, inside BuildRequest) -->
<cc:eval id="CaptureCredentials">
  <cc:expression>props['DF.API_URL']      = intsys.getAttribute('DayForce API Base URL')</cc:expression>
  <cc:expression>props['DF.API_UserName'] = intsys.getAttribute('DayForce API UserName')</cc:expression>
  <cc:expression>props['DF.API_Password'] = intsys.getAttribute('DayForce API Password')</cc:expression>
  <cc:expression>props['DF.Namespace']    = intsys.getAttribute('DayForce Client Namespace')</cc:expression>
</cc:eval>

<!-- Step 2 (later, after extracting entity key into props): build full URL -->
<cc:eval id="BuildPatchURL">
  <cc:expression>props['DF_XRefCode']    = parts[0].xpath('//wd:Worker[1]/wd:Worker_Data/wd:Worker_ID')</cc:expression>
  <!-- Full PATCH URL: base + path + query -->
  <cc:expression>props['DF.PATCH_URL']   = props['DF.API_URL'] + '/V1/employees/' + props['DF_XRefCode'] + '?clientNamespace=' + props['DF.Namespace']</cc:expression>
</cc:eval>

<!-- Step 3: build JSON payload using XSLT.
     cc:write produces <request/> so cc:xslt-plus has a valid XML input.
     The XSL ignores the input and reads xsl:params from props instead.  -->
<cc:async-mediation id="BuildPayload" routes-to="PostToDayforce" handle-downstream-errors="true">
  <cc:steps>
    <cc:write id="PrepareInput">
      <cc:message><cc:text>&lt;request/&gt;</cc:text></cc:message>
    </cc:write>
    <cc:xslt-plus id="DayforceXslt" output-mimetype="application/json" url="WorkersToDayforce.xsl"/>
  </cc:steps>
  <cc:send-error id="BuildPayloadError" rethrow-error="false" routes-to="PutIntegrationMessageDF"/>
</cc:async-mediation>

<!-- Step 4: PATCH call — endpoint and creds from props -->
<cc:http-out id="PostToDayforce" routes-response-to="HandleDayforceResponse"
  endpoint="@{props['DF.PATCH_URL']}" http-method="PATCH">
  <cc:http-basic-auth password="@{props['DF.API_Password']}" username="@{props['DF.API_UserName']}"/>
</cc:http-out>

<!-- Step 5: log the HTTP response -->
<cc:async-mediation id="HandleDayforceResponse">
  <cc:steps>
    <cc:log id="LogResponse">
      <cc:log-message>
        <cc:text>--- Dayforce PATCH Response ---</cc:text>
        <cc:line-separator/>
        <cc:message-content/>
        <cc:line-separator/>
        <cc:text>--- End Dayforce Response ---</cc:text>
      </cc:log-message>
    </cc:log>
  </cc:steps>
</cc:async-mediation>

<!-- WorkersToDayforce.xsl: reads from xsl:params (populated from props by cc:xslt-plus).
     Note: xsl:param names use underscores — dots are not valid in XML NCNames. -->
<!--
<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="text" encoding="UTF-8" omit-xml-declaration="yes"/>

  <xsl:param name="DF_XRefCode"  select="''"/>
  <xsl:param name="DF_FirstName" select="''"/>
  <xsl:param name="DF_LastName"  select="''"/>
  <xsl:param name="DF_JobTitle"  select="''"/>
  <xsl:param name="DF_WorkEmail" select="''"/>

  <xsl:template match="/">
{
  "EmployeeNumber": "<xsl:value-of select="$DF_XRefCode"/>",
  "FirstName":      "<xsl:value-of select="$DF_FirstName"/>",
  "LastName":       "<xsl:value-of select="$DF_LastName"/>",
  "JobTitle":       "<xsl:value-of select="$DF_JobTitle"/>",
  "BusinessEmail":  "<xsl:value-of select="$DF_WorkEmail"/>"
}
  </xsl:template>
</xsl:stylesheet>
-->

<!-- POST example (INT144 pattern — payload comes directly from XML via xslt-plus) -->
<cc:http-out id="HttpOut" routes-response-to="HandleResponse"
  endpoint="@{props['DF.API_URL']}" http-method="POST">
  <cc:http-basic-auth password="@{props['DF.API_Password']}" username="@{props['DF.API_UserName']}"/>
</cc:http-out>`,
  },
  'workday-out-rest': {
    description: 'Calls a Workday REST endpoint — most commonly used for RAAS (Report as a Service) to fetch data FROM Workday. Also used for Workday REST custom object reads/writes.\n\nCRITICAL SCHEMA RULE (confirmed INT095, INT144): cc:workday-out-rest MUST be a TOP-LEVEL element — place it directly inside <cc:assembly>, NEVER inside <cc:steps>. Studio\'s schema rejects it inside steps.\n\nRAAS INVOCATION (confirmed from INT060, INT072, INT086c, INT130, INT135 — all use this pattern):\n- intsys.reportService.getExtrapath(\'alias\') resolves a cloud:report-alias to its report URL path at runtime. The alias must be registered in cloud:report-service in cc:workday-in.\n- Always use routes-response-to to chain to the next step after the report returns.\n\nFILTER PARAMETER SYNTAX:\n- Text param: ?Param_Name=@{props[\'value\']}\n- Object (WID) reference param: ?Worker!WID=@{props[\'workerWID\']} — the !WID suffix tells Workday this is an object reference, not a text value. Other types: !Organization_Reference_ID, !Position_ID, etc.\n- Multiple params: join with &amp; (not bare &)\n- No-filter: omit ? entirely\n\nRESPONSE STRUCTURE (confirmed from 5 integrations — both with and without format=simplexml):\n- Response root: wd:Report_Data\n- Records:       wd:Report_Data/wd:Report_Entry (one per row)\n- Fields inside each entry use wd: namespace: wd:Report_Entry/wd:Employee_ID\n- Reference type selection: wd:Report_Entry/wd:Org/wd:ID[@wd:type=&quot;WID&quot;]\n- format=simplexml: behavior is REPORT-DEPENDENT — do not assume. Some reports strip the wd: namespace prefix entirely (confirmed INT012: XPath uses Report_Data/Report_Entry/Field with no wd:). Other reports keep wd: even with format=simplexml (confirmed INT060, INT086c, INT130, INT135). Always ask for a sample XML response before writing XPath — one row is enough to determine which applies. If wd: prefixes appear in the sample, use them. If absent, use unprefixed paths.\n\nSPLITTER CHOICE (critical):\n- Large datasets (>100 records): use xml-stream-splitter — streams one entry at a time, never loads full report into memory\n- Small datasets (<100 records): use xpath-splitter — loads all entries into memory, simpler but risky for large reports\n\nEMPTY REPORT HANDLING: if the report returns zero rows, the splitter routes to no sub-routes. Wrap the workday-out-rest routes-response-to target in a cc:async-mediation with a cc:send-error to handle the "no records" case.\n\nCUSTOM OBJECT READS/WRITES: extra-path can also target intsys.customObjectService.getExtrapath() for Workday custom objects.',
    routes_via: 'routes-response-to',
    xml_example: `<!-- ── Complete RAAS → split → per-record pattern (confirmed all 5 integrations) ──

DECLARATION in cc:workday-in (must exist before calling):
  <cloud:report-service name="INT145_Reports">
    <cloud:report-alias description="Active workers" name="INT145_Get_Workers"/>
  </cloud:report-service>
-->

<!-- 1. Fetch report — routes to splitter -->
<cc:workday-out-rest id="GetWorkers" routes-response-to="Splitter"
  extra-path="@{intsys.reportService.getExtrapath('INT145_Get_Workers')}?format=simplexml"/>

<!-- 2a. Large dataset (>100 records): xml-stream-splitter — streams one entry at a time -->
<cc:splitter id="Splitter">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xml-stream-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- 2b. Small dataset (<100): xpath-splitter — loads all into memory -->
<cc:splitter id="Splitter">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xpath-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- 3. Process each record — parts[0] is one wd:Report_Entry -->
<cc:async-mediation id="ProcessRecord" routes-to="WriteToTarget" handle-downstream-errors="true">
  <cc:steps>
    <cc:eval id="ExtractFields">
      <cc:expression>props['wid']      = parts[0].xpath('wd:Report_Entry/wd:Worker_WID')</cc:expression>
      <cc:expression>props['empID']    = parts[0].xpath('wd:Report_Entry/wd:Employee_ID')</cc:expression>
      <cc:expression>props['fullName'] = parts[0].xpath('wd:Report_Entry/wd:Full_Name')</cc:expression>
    </cc:eval>
  </cc:steps>
  <cc:send-error id="RecordError" rethrow-error="false" routes-to="PutRecordError"/>
</cc:async-mediation>

<!-- Filter by Worker WID (launch param from cloud:class-report-field picker) -->
<cc:workday-out-rest id="GetFilteredData" routes-response-to="Splitter2"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Report')}?Worker!WID=@{props['Selected_Worker']}"/>

<!-- Multiple filter params — use &amp; between params -->
<cc:workday-out-rest id="GetManagerInfo" routes-response-to="ParseManager"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Manager_Info')}?manager!WID=@{props['managerWID']}&amp;Supplier_Sup_Org!WID=@{props['supOrgWID']}"/>

<!-- Read a single record (no splitter needed when report always returns 1 row) -->
<cc:workday-out-rest id="GetRecord" routes-response-to="ParseRecord"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Single_Record')}?Employee_ID=@{props['empID']}&amp;format=simplexml"/>
<cc:async-mediation id="ParseRecord" routes-to="NextStep">
  <cc:steps>
    <cc:eval id="Extract">
      <cc:expression>props['supOrgWID'] = parts[0].xpath('/wd:Report_Data/wd:Report_Entry/wd:Supervisory_Organization/wd:ID[@wd:type=&quot;WID&quot;]')</cc:expression>
    </cc:eval>
  </cc:steps>
</cc:async-mediation>`,
  },
  'local-out': {
    description: 'Sends the current message to a named endpoint (vm://) and optionally waits for a response. Two use patterns:\n\n1. BUILT-IN ENDPOINTS (Workday platform sinks):\n   - vm://wcc/PutIntegrationMessage — deliver a file or post an event message on the integration event\n   - vm://wcc/PagedGet — paginated SOAP fetching\n   - vm://wcc/GetEventDocuments — retrieve documents uploaded by the user on the integration event\n   - vm://wcc/StoreDocument — store a document to the integration deliverables list\n   Use cc:set children to pass named parameters (values are MVEL, strings need single quotes).\n\n2. SUB-FLOW DECOMPOSITION (confirmed pattern from INT_TEST_GetWorkers_CSV_STU):\n   Break a large assembly into named, independently readable sub-flows. Each sub-flow is a cc:local-in + its steps in the same assembly.xml file.\n   - Endpoint naming: vm://{IntegrationSystemName}/{LocalInId} — must match the integration-system name attribute exactly.\n   - routes-response-to PRESENT: the caller WAITS for the sub-flow to fully complete, then routes to the specified id. Use this for sequential chaining.\n   - routes-response-to ABSENT: fire-and-forget — caller fires the sub-flow but does NOT wait. Execution continues immediately on the main flow. Use only when the sub-flow result is not needed.\n   - props are SHARED across all sub-flows — values set before calling a sub-flow are readable inside it and vice versa.\n   - The message body is passed to the sub-flow unchanged; sub-flow can transform it. After sub-flow returns, message is whatever the sub-flow left it as.\n   - Diagram: each sub-flow gets its own named horizontal swimlane. Use nested VERTICAL swimlanes only for async-mediations with local send-errors.\n\nSEQUENTIAL CHAINING PATTERN: CallCSVFlow (routes-response-to=CallDayforceFlow) → CallDayforceFlow. After the CSV sub-flow finishes, execution automatically continues to CallDayforceFlow.\n\nPOST-SPLITTER CONTINUATION PATTERN: To wait for an entire splitter run to complete before proceeding, wrap the workday-out-rest + splitter inside a sub-flow. Set routes-response-to on the calling cc:local-out — it fires after ALL records are done.\n\nADDITIONAL ATTRIBUTES (confirmed from INT012):\n- unset-properties="false" — prevents the sub-flow from clearing properties set by the caller. Default behaviour may clear props not listed in cc:set; this flag preserves all caller props inside the sub-flow.\n- clone-request="true" — sends a copy of the message; the original message is not consumed. Use when delivering to PutIntegrationMessage while needing to continue processing the same content.\n- execute-when="MVEL_EXPR" — on the cc:local-out element itself (not just inside cc:steps). E.g. execute-when="context.isError() == true" fires the sub-flow only when an error occurred.',
    routes_via: 'routes-response-to (for sub-flow calls and built-in endpoints that return)',
    xml_example: `<!-- ── Sub-flow decomposition pattern (confirmed: INT_TEST_GetWorkers_CSV_STU) ──

  Main flow calls two sub-flows sequentially after CallGetWorkers:
  1. CSV sub-flow: transforms XML → CSV and delivers it
  2. Dayforce sub-flow: builds JSON payload from props, PATCHes Dayforce

  Props extracted before CallCSVFlow are available inside both sub-flows.
-->

<!-- Caller side: sequential chaining via routes-response-to -->
<cc:local-out id="CallCSVFlow" store-message="none"
  routes-response-to="CallDayforceFlow"
  endpoint="vm://INT_TEST_GetWorkers_CSV_STU/CSVFlow"/>

<cc:local-out id="CallDayforceFlow" store-message="none"
  endpoint="vm://INT_TEST_GetWorkers_CSV_STU/DayforceFlow"/>

<!-- Sub-flow entry points (cc:local-in) -->
<cc:local-in id="CSVFlow" routes-to="TransformToCSV"/>
<cc:local-in id="DayforceFlow" routes-to="BuildDayforcePayload"/>

<!-- ── Built-in endpoints ── -->

<!-- Deliver a file as a deliverable output on the integration event -->
<cc:local-out id="DeliverFile" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.document.file.name"   value="'workers.csv'"/>
  <cc:set name="is.document.deliverable" value="'true'"/>
</cc:local-out>

<!-- Post an error message to the integration event -->
<cc:local-out id="DeliverError" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity"     value="'CRITICAL'"/>
  <cc:set name="is.message.summary"      value="'Integration failed: ' + context.errorMessage"/>
  <cc:set name="is.document.deliverable" value="'false'"/>
</cc:local-out>

<!-- ── Additional attributes (confirmed INT012) ──────────────────────────

unset-properties="false" — keep all caller props alive inside the sub-flow.
Without this, some props set by the caller may be cleared before the sub-flow runs. -->
<cc:local-out id="CallEmailFlow" store-message="none"
  endpoint="vm://INT012_Greenhouse_Hire_Inbound/Email_In"
  unset-properties="false">
  <cc:set name="Email_Failure_Reason" value="context.errorMessage"/>
</cc:local-out>

<!-- clone-request="true" — deliver a copy to PutIntegrationMessage while keeping
     the original message unchanged for continued processing in this flow. -->
<cc:local-out id="AttachDocument" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage"
  clone-request="true">
  <cc:set name="is.document.variable.name" value="'doc_variable_name'"/>
  <cc:set name="is.document.deliverable"   value="'true'"/>
</cc:local-out>

<!-- execute-when on the element itself — fire only on error (error notification pattern) -->
<cc:local-out id="NotifyOnError" store-message="none"
  execute-when="context.isError() == true"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity" value="'ERROR'"/>
  <cc:set name="is.message.summary"  value="context.errorMessage"/>
</cc:local-out>

<!-- vm://wcc/GetEventDocuments — retrieve uploaded documents from the integration event.
     Pass ie.event.wid (integration event WID) to scope the request.
     routes-response-to handles the document list. -->
<cc:local-out id="GetDocs" routes-response-to="CheckFiles"
  endpoint="vm://wcc/GetEventDocuments">
  <cc:set name="ie.event.wid" value="lp.isSet() ? lp.getIntegrationEventWID() : null"/>
</cc:local-out>`,
  },
  'local-in': {
    description: 'Entry point for a named sub-flow within the same assembly. Paired with a cc:local-out that calls it via vm://{IntegrationSystemName}/{LocalInId}. The id of the cc:local-in must match the last segment of the vm:// endpoint on the calling cc:local-out.\n\nIn the diagram, each cc:local-in is the leftmost node in its own named horizontal swimlane, making each sub-flow independently navigable in Studio.',
    routes_via: 'routes-to',
    xml_example: `<!-- Naming rule: vm://IntegrationSystemName/LocalInId
     The LocalInId must match the id attribute exactly. -->

<!-- Caller (in main flow): -->
<cc:local-out id="CallCSVFlow" store-message="none"
  routes-response-to="CallDayforceFlow"
  endpoint="vm://INT_TEST_GetWorkers_CSV_STU/CSVFlow"/>

<!-- Entry point (start of CSV sub-flow swimlane): -->
<cc:local-in id="CSVFlow" routes-to="TransformToCSV"/>`,
  },
  'async-mediation': {
    description: 'Passes the message asynchronously to the next step. Used to break synchronous call chains. Can contain nested cc:steps for inline processing.',
    routes_via: 'routes-to',
    xml_example: `<!-- Simple passthrough -->
<cc:async-mediation id="Async1" routes-to="NextStep"/>

<!-- With inline steps -->
<cc:async-mediation id="Async2" routes-to="NextStep">
  <cc:steps>
    <cc:eval id="SetProps">
      <cc:expression>props['key'] = message.xpath('//value')</cc:expression>
    </cc:eval>
  </cc:steps>
</cc:async-mediation>`,
  },
  'splitter': {
    description: 'Splits an XML, JSON, or delimited message into multiple sub-messages. Each sub-message is processed independently via cc:sub-route children.\n\nCRITICAL SCHEMA RULES (confirmed INT095, INT144):\n- cc:splitter MUST be a TOP-LEVEL element — place it directly inside <cc:assembly>, NEVER inside <cc:steps>. Studio\'s schema rejects splitters nested in steps.\n- cc:splitter CANNOT have a routes-to attribute. Routing is done ONLY via cc:sub-route children. Attempting routes-to on the splitter itself causes a schema validation error.\n\nSPLITTER STRATEGY CHILDREN (choose one):\n- cc:xml-stream-splitter xpath="..."  — streams one node at a time; required for large datasets (>100 records). Never loads full payload into memory.\n- cc:xpath-splitter xpath="..."       — loads entire payload into memory first. Only for small datasets (<100 records).\n- cc:json-splitter json-path="..."    — for JSON arrays (e.g. from cc:http-out response).\n- cc:delimiter-splitter               — splits on a character delimiter.\n\nPOST-SPLITTER CONTINUATION PATTERN:\nTo continue processing after ALL records have been split, wrap the workday-out-rest + splitter inside a sub-flow called via cc:local-out. Set routes-response-to on the calling cc:local-out — that fires AFTER the entire splitter run finishes.\n\nno-split-message-error="false" — suppresses the error when the report returns zero records (good default for optional reports).',
    routes_via: 'cc:sub-route routes-to (per record). No routes-to on the splitter itself.',
    xml_example: `<!-- CRITICAL: cc:splitter is TOP-LEVEL (directly inside <cc:assembly>), never inside <cc:steps> -->
<!-- CRITICAL: no routes-to on cc:splitter — routing is via cc:sub-route only -->

<!-- Large dataset (>100 records): xml-stream-splitter -->
<cc:splitter id="SplitWorkers" no-split-message-error="false">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xml-stream-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- Small dataset (<100 records): xpath-splitter -->
<cc:splitter id="SplitWorkers" no-split-message-error="false">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xpath-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- Post-splitter continuation: wrap in sub-flow, use routes-response-to on the caller -->
<!-- The caller's routes-response-to fires after ALL records are processed -->
<cc:local-out id="CallGetAndSplit" store-message="none"
  routes-response-to="DeliverFile"
  endpoint="vm://INT145_MyInt/GetAndSplitFlow"/>

<cc:local-in id="GetAndSplitFlow" routes-to="GetWorkers"/>
<cc:workday-out-rest id="GetWorkers" routes-response-to="SplitWorkers"
  extra-path="@{intsys.reportService.getExtrapath('INT145_Get_Workers')}?format=simplexml"/>
<cc:splitter id="SplitWorkers" no-split-message-error="false">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xml-stream-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>`,
  },
  'decision': {
    description: 'Conditional routing. Evaluates conditions in order; the first matching route is taken. The last route (no condition) is the default/else branch.',
    routes_via: 'routes-to (on each cc:route)',
    xml_example: `<cc:decision id="CheckStatus">
  <cc:routes>
    <cc:route condition="message.xpath('//Status') = 'Active'" routes-to="ActiveBranch"/>
    <cc:route condition="message.xpath('//Status') = 'Terminated'" routes-to="TermBranch"/>
    <cc:route routes-to="DefaultBranch"/>
  </cc:routes>
</cc:decision>`,
  },
  'sub-assembly': {
    description: 'Delegates to another assembly file. Use for shared reusable flows packaged as a separate project.',
    routes_via: 'routes-to',
    xml_example: `<cc:sub-assembly id="CallShared" routes-to="NextStep"
  href="SharedAssembly.xml"/>`,
  },
  'note': {
    description: 'DO NOT USE cc:note anywhere in assembly.xml. The Studio schema rejects cc:note as a child of cc:assembly — confirmed from build experience (skeleton pattern).\n\nCORRECT TERMINAL PATTERN: an cc:async-mediation with NO routes-to attribute ends naturally. When execution reaches it and there is no routes-to, the sub-flow (or integration) terminates cleanly. No terminal stub element is needed.\n\nCRITICAL DIAGRAM RULE: cc:note also MUST NOT appear in assembly-diagram.xml. Studio\'s Factory.scala has no EditPart case for cc:note — adding it to <visualProperties>, swimlane <elements>, or <connections> crashes Studio with scala.MatchError at every load.\n\nSummary: cc:note is unsafe in both files. Use async-mediation with no routes-to as the terminal.',
    routes_via: 'none — do not use',
    xml_example: `<!-- WRONG — cc:note is schema-invalid in assembly.xml -->
<!-- <cc:note id="End"><cc:description>Done</cc:description></cc:note> -->

<!-- CORRECT terminal pattern: async-mediation with no routes-to ends naturally -->
<cc:async-mediation id="DoLastSubFlow" handle-downstream-errors="true">
  <cc:steps>
    <!-- real steps here -->
  </cc:steps>
  <cc:send-error id="LastSubFlowError" rethrow-error="false" routes-to="PutLastError"/>
</cc:async-mediation>
<!-- No routes-to = natural terminal. Sub-flow ends here. -->`,
  },
  'eval': {
    description: 'Executes MVEL expressions to set properties on the message. Used inside cc:async-mediation cc:steps blocks.\n\nKEY MVEL OBJECTS:\n- props: map of message properties. Values set here are automatically passed as XSL stylesheet parameters to any subsequent cc:xslt-plus in the same steps block.\n- lp: launch parameter accessor.\n  · lp.getSimpleData(\'Param Name\') — text/numeric/boolean/enumeration cloud:param. Returns String.\n  · lp.getDate(\'Param Name\') — date cloud:param. Returns formatted date string.\n  · lp.getReferenceData(\'Param Name\', \'WID\') — Worker/object picker param (cloud:class-report-field). Returns WID string.\n  · lp.getReferenceData(\'Param Name\', \'Employee_ID\') — same picker, different ID type. Multiple ID types can be tried.\n  · lp.getSequencedValue(\'Sequencer Name\', \'Sequence_ID\') — get next value from cloud:sequence-generator-service.\n  Null check pattern (always apply to getReferenceData): if(val==null||val==\'null\'||val==empty){val=\'\'}\n  Param Name must match the cloud:param name attribute exactly (spaces included).\n- parts[0].xpath(\'...\') — extract value from current message XML using XPath. Namespaces declared on assembly root are available.\n- context.errorMessage / context.getErrorMessage() — error message in send-error handlers.\n- intsys.getAttribute(\'Attr Name\') — reads a text integration attribute from cloud:attribute-map-service.\n- intsys.getAttributeReferenceData(\'Attr Name\', \'ID_Type\') — reads a reference-type integration attribute (cloud:class-report-field attribute).\n- util.currentDateTimeAsString() — current datetime as ISO string.\n- util.currentDateTimeAsString(\'PST\') — with timezone.\n- props[\'assembly.gateway.address\'] — gateway URL. Use .contains(\'impl\') to detect impl vs prod.\n- props[\'cc.customer.id\'] — the Workday tenant name.\n- props.containsKey(\'keyName\') — boolean check for prop existence; use to guard initialization logic.\n- vars[\'varName\'] — read a variable by bracket notation.\n- vars[\'varName\'].getText() — get string content of a variable (e.g. base64-encoded value).\n- vars.isVariable(\'name\') — boolean; check existence before reading to avoid null dereference.\n- vars.setVariable(\'name\', value, \'text/plain\') — create/update a variable with explicit MIME type (three-argument form).\n\nINTEGRATION MAP LOOKUPS (cloud:attribute-map-service with cloud:map entries):\n- intsys.integrationMapLookup(\'Map Name\', externalValue) — forward lookup: external → Workday internal value.\n- intsys.integrationMapReverseLookup(\'Map Name\', internalValue) — reverse lookup: internal → external.\n- intsys.getAttributeAsBoolean(\'Attr Name\') — reads a boolean integration attribute (not string).\n\nDATE ARITHMETIC (Java Calendar — canonical pattern for all date math in Studio MVEL):\n```\nprops[\'hire_date_parsed\'] = new java.text.SimpleDateFormat("yyyy-MM-dd").parse(props[\'Hire_Date\'])\nprops[\'cal\'] = java.util.Calendar.getInstance()   // static factory, no "new"\nprops[\'cal\'].setTime(props[\'hire_date_parsed\'])\nprops[\'cal\'].add(java.util.Calendar.DATE, -1)    // subtract 1 day\nprops[\'contract_end\'] = new java.text.SimpleDateFormat("yyyy-MM-dd").format(props[\'cal\'].getTime())\n```\nAlso: `Math.round(props[\'Salary\'] * 12)` for numeric rounding.\n\nCONTEXT METHODS:\n- context.isError() — boolean; use in execute-when on cc:local-out to fire sub-flows only on error or only on success.\n- context.errorCode — the error code string (not just the message).\n\nMVEL TERNARY: props[\'x\'] = (condition) ? \'valueIfTrue\' : \'valueIfFalse\'\nMVEL COMMENTS: lines starting with // are ignored at runtime.\nexecute-when ATTRIBUTE: add execute-when="MVEL_EXPRESSION" on any step inside cc:steps to conditionally skip it at runtime. Also valid on cc:local-out and cc:workday-out-soap elements (not just cc:steps children).',
    routes_via: 'none (inline step)',
    xml_example: `<!-- Capture launch params into props (before cc:xslt-plus) -->
<cc:eval id="CaptureParams">
  <cc:expression>props['Employee_ID'] = lp.getSimpleData('Employee_ID')</cc:expression>
  <cc:expression>props['Effective_Date'] = lp.getDate('Effective Date')</cc:expression>
  <cc:expression>props['Target_Org'] = lp.getSimpleData('Target_Org')</cc:expression>
  <cc:expression>props['Is_Impl'] = (props['assembly.gateway.address'].contains('impl') ? true : false)</cc:expression>
</cc:eval>

<!-- Read values from the current XML message (e.g. a report or API response) -->
<cc:eval id="ExtractFromMessage">
  <cc:expression>props['WorkerID'] = parts[0].xpath('wd:Report_Entry/wd:Worker_ID')</cc:expression>
  <cc:expression>props['Amount'] = parts[0].xpath('wd:Report_Entry/wd:Amount')</cc:expression>
</cc:eval>

<!-- Read an integration attribute -->
<cc:eval id="ReadAttribute">
  <cc:expression>props['TargetURL'] = intsys.getAttribute('Target API URL')</cc:expression>
</cc:eval>

<!-- Worker/object picker launch param (cloud:class-report-field type="WID") -->
<cc:eval id="CaptureWorkerRef">
  <cc:expression>props['Selected_Worker'] = lp.getReferenceData('Select Worker', 'WID')</cc:expression>
  <cc:expression>if (props['Selected_Worker'] == null || props['Selected_Worker'] == 'null') { props['Selected_Worker'] = '' }</cc:expression>
</cc:eval>

<!-- Detect impl vs prod + date util -->
<cc:eval id="DetectEnvironment">
  <cc:expression>props['Is_Impl']    = (props['assembly.gateway.address'].contains('impl') ? true : false)</cc:expression>
  <cc:expression>props['Tenant']     = props['cc.customer.id']</cc:expression>
  <cc:expression>props['Today']      = util.currentDateTimeAsString('PST').substring(0,10)</cc:expression>
</cc:eval>

<!-- Reference attribute (e.g. attribute whose type is a WID reference) -->
<cc:eval id="ReadRefAttribute">
  <cc:expression>props['EventSubcatWID'] = intsys.getAttributeReferenceData('Contract Type', 'Event_Classification_Subcategory_ID')</cc:expression>
</cc:eval>

<!-- Sequenced value (from cloud:sequence-generator-service) -->
<cc:eval id="GetSequence">
  <cc:expression>props['SeqID'] = lp.getSequencedValue('Integration_Sequencer_Name', 'INT002_Seq')</cc:expression>
</cc:eval>

<!-- MVEL ternary + null-safe rehire detection -->
<cc:eval id="CheckRehire">
  <cc:expression>props['WorkerWID']  = lp.getReferenceData('Select Worker', 'WID')</cc:expression>
  <cc:expression>if (props['WorkerWID'] == null || props['WorkerWID'] == 'null' || props['WorkerWID'] == empty) { props['WorkerWID'] = '' }</cc:expression>
  <cc:expression>props['Is_Rehire']  = (props['WorkerWID'] != '') ? 'Y' : 'N'</cc:expression>
</cc:eval>

<!-- execute-when: conditionally skip a step without an if/else branch -->
<!-- Add execute-when to any cc:steps child; evaluated as MVEL at runtime -->
<cc:xslt-plus execute-when="props['Is_Rehire'] == 'Y'" id="RehireXslt" url="Rehire.xsl" output-mimetype="text/xml"/>
<cc:write execute-when="props['Is_Rehire'] == 'N'" id="NewHireMsg">
  <cc:message><cc:text>No rehire record found</cc:text></cc:message>
</cc:write>

<!-- Integration map lookups (cloud:attribute-map-service with cloud:map) -->
<cc:eval id="MapValues">
  <!-- Forward lookup: external value (from Greenhouse) → internal Workday value -->
  <cc:expression>props['WD_EthnicityType'] = intsys.integrationMapLookup('Ethnicity Type', props['GH_Race'])</cc:expression>
  <!-- Reverse lookup: internal → external -->
  <cc:expression>props['GH_JobCategory'] = intsys.integrationMapReverseLookup('Job Category', props['WD_JobCategory'])</cc:expression>
  <!-- Boolean attribute -->
  <cc:expression>props['Full_Logging'] = intsys.getAttributeAsBoolean('Enable Full Logging')</cc:expression>
</cc:eval>

<!-- Date arithmetic (java.util.Calendar — only reliable date math in Studio) -->
<cc:eval id="CalcContractEndDate">
  <!-- Parse string → Date -->
  <cc:expression>props['hire_date_d'] = new java.text.SimpleDateFormat("yyyy-MM-dd").parse(props['Hire_Date'])</cc:expression>
  <!-- Calendar arithmetic: subtract 1 day -->
  <cc:expression>props['cal'] = java.util.Calendar.getInstance()</cc:expression>
  <cc:expression>props['cal'].setTime(props['hire_date_d'])</cc:expression>
  <cc:expression>props['cal'].add(java.util.Calendar.DATE, -1)</cc:expression>
  <!-- Format back to string -->
  <cc:expression>props['Contract_End_Date'] = new java.text.SimpleDateFormat("yyyy-MM-dd").format(props['cal'].getTime())</cc:expression>
  <!-- Numeric math -->
  <cc:expression>props['Annual_Salary'] = Math.round(props['Monthly_Salary'] * 12)</cc:expression>
</cc:eval>

<!-- context.isError() — fire sub-flow only on error or only on success -->
<!-- (Used on cc:local-out or any step, not just cc:eval) -->
<!-- execute-when="context.isError() == false"  → skip if error occurred -->
<!-- execute-when="context.isError() == true"   → run only when error occurred -->

<!-- vars API: save, check, read named variables -->
<cc:eval id="VarsPatterns">
  <!-- Check before reading to avoid null dereference -->
  <cc:expression>if (vars.isVariable('saved_xml')) { props['had_saved'] = 'Y' } else { props['had_saved'] = 'N' }</cc:expression>
  <!-- Read variable text content -->
  <cc:expression>props['encoded_key'] = vars['API_Key_Encoded'].getText()</cc:expression>
  <!-- Guard prop initialization -->
  <cc:expression>if (!props.containsKey('counter')) { props['counter'] = 0 }</cc:expression>
  <cc:expression>props['counter'] = props['counter'] + 1</cc:expression>
</cc:eval>`,
  },
  'workday-out-soap': {
    description: 'Calls a Workday SOAP web service. The current message body must already be a complete SOAP envelope (built by a preceding async-mediation + xslt or xslt-plus step). Specify the Workday application name (e.g. "Human_Resources") and API version (e.g. "v40.0"). The SOAP response becomes the new message and is routed via routes-response-to.\n\nADDITIONAL ATTRIBUTES (confirmed from INT012):\n- replace-with-soap-fault="true" — converts Workday SOAP error responses into actual SOAP Fault messages. This allows cc:send-error to distinguish and catch SOAP-level errors as structured faults rather than generic Studio errors.\n- execute-when="MVEL_EXPR" — on the element itself (not inside cc:steps), conditionally skips the entire outbound call. E.g. execute-when="props[\'Contingent_Worker_ID\'] != \'\'" only fires the SOAP call when a CW ID was found.',
    routes_via: 'routes-response-to',
    xml_example: `<!-- Workday HR Get_Workers SOAP call -->
<cc:workday-out-soap id="CallGetWorkers"
  routes-response-to="TransformResponse"
  application="Human_Resources"
  version="v40.0"/>

<!-- Common application values:
     Staffing, Compensation, Payroll, Benefits,
     Talent, Time_Tracking, Recruiting, Financial_Management -->

<!-- replace-with-soap-fault: convert SOAP errors to catchable SOAP Faults -->
<cc:workday-out-soap id="HireEmployee"
  routes-response-to="HandleHireResponse"
  application="Staffing"
  version="v40.0"
  replace-with-soap-fault="true"/>

<!-- execute-when: skip the call entirely when condition is false -->
<cc:workday-out-soap id="ConvertCW"
  execute-when="props['Contingent_Worker_ID'] != ''"
  routes-response-to="HandleConvertResponse"
  application="Staffing"
  version="v40.0"/>`,
  },
  'send-error': {
    description: 'Error handler that processes errors using standard assembly components. Routes to a step (typically a PutIntegrationMessage local-out) for structured error reporting. Use as a global handler on the assembly or a local handler inside a mediation component. Set rethrow-error="true" to pass the error upstream after handling.\n\nBEST PRACTICE — per-handler delivery: give each local send-error its own cc:local-out with a step-specific error message (routes-to="StepNameError"). Use a shared DeliverError only for the GlobalErrorHandler. This allows distinct summaries per failure point.\n\nDIAGRAM RULES — violations crash Studio with scala.MatchError:\n1. NEVER reference cc:send-error by XML id anywhere in the diagram. Always use EMF XPath.\n2. Assembly-level cc:send-error (GlobalErrorHandler): use empty <visualProperties> (no x/y), include in swimlane <elements> via EMF XPath, and add a <connections> entry. No closed="true" needed.\n3. Local cc:send-error inside cc:async-mediation: add ONLY a <connections> entry with EMF XPath source — Studio renders it inside the parent box. Never add to visualProperties or swimlane elements.\n4. EMF XPath (@mixed index) counts ALL child nodes: whitespace text nodes (nodeType=3), element nodes (nodeType=1), AND XML comment nodes (nodeType=8). Use python3 xml.dom.minidom to count precisely.\n5. PREDICTABILITY RULE: if you write assembly.xml with NO XML comments, all element nodes fall on odd indices (1, 3, 5, 7...) because whitespace text nodes fill the even slots. This makes indices trivially calculable without running Python. Adding even one comment breaks this regularity — run the Python counter whenever comments are present.\n6. STUDIO AUTO-CORRECTS @mixed INDICES — DO NOT HAND-EDIT AFTER STUDIO WRITES: When Studio serializes the diagram (after the user moves nodes, adds steps, or reorganizes swimlanes), it recalculates all @mixed.N indices itself. The result is always correct. Do NOT re-run the Python counter or manually update source href values after Studio has touched the file — Studio\'s output supersedes any hand-computed values. (Confirmed INT144: GlobalErrorHandler shifted from @mixed.69 to @mixed.95 after a 12-element insertion; Studio auto-corrected all connection source references when the user reorganized.)\n\nDIAGRAM ERROR PLACEMENT (confirmed INT144 GetManager pattern, April 2026):\n- Do NOT isolate error-branch nodes in a separate "Errors" outer band. Co-locate each error branch adjacent to its decision point inside the same VERTICAL inner band. This eliminates long cross-band arrows and is the pattern Studio itself uses when it auto-generates connections.\n- Nesting 3 levels of VERTICAL bands is acceptable for complex sub-flows (outer band → VERTICAL container → inner band).\n- Error mediations (AsyncMediation_XxxNotFound, AsyncMediation_XxxError) go in the same VERTICAL band as the step that generates them — stacked vertically below the happy-path node.',
    routes_via: 'routes-to',
    xml_example: `<!-- ASSEMBLY.XML: per-handler delivery pattern (recommended) -->
<cc:async-mediation id="BuildRequest" routes-to="CallNext" handle-downstream-errors="true">
  <cc:steps>
    <cc:xslt-plus id="MyXslt" output-mimetype="text/xml" url="Build.xsl"/>
  </cc:steps>
  <!-- Routes to its own delivery step, not shared DeliverError -->
  <cc:send-error id="BuildRequestError" rethrow-error="false" routes-to="BuildRequestFailed"/>
</cc:async-mediation>

<!-- Per-handler delivery: step-specific error message -->
<cc:local-out id="BuildRequestFailed" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity"   value="'ERROR'"/>
  <cc:set name="is.message.summary"    value="'Error building SOAP request'"/>
  <cc:set name="is.message.detail"     value="context.errorMessage"/>
  <cc:set name="is.document.deliverable" value="'false'"/>
</cc:local-out>

<!-- Global catch-all — routes to shared DeliverError -->
<cc:send-error id="GlobalErrorHandler" routes-to="DeliverError" rethrow-error="false"/>

<cc:local-out id="DeliverError" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity"   value="'CRITICAL'"/>
  <cc:set name="is.message.summary"    value="'Integration failed: ' + context.errorMessage"/>
  <cc:set name="is.document.deliverable" value="'false'"/>
</cc:local-out>

<!-- ASSEMBLY-DIAGRAM.XML: confirmed safe patterns from Studio serialization.

     GlobalErrorHandler — 3 required entries (all EMF XPath, never XML id):
       1. Empty <visualProperties> (no x/y = auto-positioned by Studio)
       2. <connections> source entry
       3. <swimlane> <elements> entry

     Local send-error — 1 entry only:
       <connections> source entry only. Never in visualProperties or swimlane elements.

     Index calculation: count ALL child nodes after <cc:assembly> (0-based):
       text nodes (nodeType=3), element nodes (nodeType=1), comment nodes (nodeType=8).
     Use python3:
       import xml.dom.minidom
       doc = xml.dom.minidom.parse('assembly.xml')
       asm = doc.getElementsByTagNameNS('*','assembly')[0]
       for i,n in enumerate(asm.childNodes):
           print(i, n.nodeType, getattr(n,'tagName','[text/comment]'))
     The local send-error inside an async-mediation is always @mixed.3 of its parent.
-->

<!-- GlobalErrorHandler (assume @mixed.N is the correct index for your file) -->
<visualProperties>
  <element href="assembly.xml#//@beans/@mixed.1/@mixed.N"/>
</visualProperties>
<connections type="routesTo">
  <source href="assembly.xml#//@beans/@mixed.1/@mixed.N"/>
  <target href="assembly.xml#DeliverError"/>
</connections>

<!-- Local send-error — connections only, no visualProperties -->
<connections type="routesTo">
  <source href="assembly.xml#//@beans/@mixed.1/@mixed.7/@mixed.3"/>
  <target href="assembly.xml#BuildRequestFailed"/>
</connections>

<!-- Swimlanes: GlobalErrorHandler in Error Handler lane via EMF XPath (no closed="true") -->
<swimlanes x="30" y="30" name="Error Handler" alignment="END" labelAlignment="LEFT">
  <elements href="assembly.xml#//@beans/@mixed.1/@mixed.N"/>
  <elements href="assembly.xml#DeliverError"/>
</swimlanes>`,
  },
  'log-error': {
    description: 'Error handler that logs the current error (message + Java stack trace) to the Studio output log. Use when you want diagnostic data in the log without exposing individual errors on the integration event. Avoid logging large messages — they can be truncated. Set rethrow-error="true" to also propagate to the next upstream handler. IMPORTANT: NOT renderable in assembly-diagram.xml — do not add to visualProperties or swimlane elements.',
    routes_via: 'none (terminal error handler)',
    xml_example: `<!-- Simplest global error handler: just log it -->
<cc:log-error id="GlobalErrorHandler" level="error" rethrow-error="false"/>

<!-- Local error handler inside async-mediation, then rethrow -->
<cc:async-mediation id="ProcessData" routes-to="NextStep"
  handle-downstream-errors="true">
  <cc:error-handlers>
    <cc:log-error id="LocalLog" level="warn" rethrow-error="true"/>
  </cc:error-handlers>
  <cc:steps>
    <!-- ... -->
  </cc:steps>
</cc:async-mediation>

<!-- Valid log levels: debug, info, warn, error, fatal -->`,
  },
  'xml-to-csv': {
    description: 'Streams an XML document to CSV format with a low memory footprint. The XML structure must have a repeating row element whose sequential child elements map to CSV columns. Set writeHeaderLine="true" to emit column names on the first line. Use format="rfc4180" for standards-compliant quoting; "simple" (default) also accepts apostrophe quotes and trims whitespace.',
    routes_via: 'routes-to (inline step inside async-mediation)',
    xml_example: `<!-- Inside cc:async-mediation cc:steps block -->
<cc:xml-to-csv id="ConvertToCsv"
  separator=","
  line-separator="LF"
  writeHeaderLine="true"
  format="rfc4180"/>

<!-- With explicit input/output locations (default: rootpart → rootpart) -->
<cc:xml-to-csv id="ConvertToCsv"
  input="rootpart"
  output="rootpart"
  separator=","
  line-separator="LF"
  writeHeaderLine="true"
  format="rfc4180"/>`,
  },
  'csv-to-xml': {
    description: 'Streams a CSV document to XML format. Use useFirstLineAsHeader="true" to derive column names from the header row, or supply colNames as a comma-separated list. Specify rootName and rowName for the output XML element names. Use format="rfc4180" for standards-compliant input parsing.',
    routes_via: 'routes-to (inline step inside async-mediation)',
    xml_example: `<!-- Inside cc:async-mediation cc:steps block -->
<cc:csv-to-xml id="ParseCsv"
  separator=","
  useFirstLineAsHeader="true"
  rootName="Workers"
  rowName="Worker"
  format="rfc4180"/>

<!-- With explicit column names instead of header row -->
<cc:csv-to-xml id="ParseCsv"
  separator=","
  colNames="Employee_ID,First_Name,Last_Name,Job_Title"
  rootName="Workers"
  rowName="Worker"/>`,
  },
  'xml-stream-splitter': {
    description: 'Streaming splitter for large XML documents — processes records one at a time without loading the entire document into memory. Critical for large Workday reports (thousands of rows). Used as the strategy child inside cc:splitter, alongside a cc:sub-route pointing to the step that processes each record.\n\nKEY DIFFERENCE FROM cc:xpath-splitter: cc:xpath-splitter loads the full document into memory and OOMs on large reports. cc:xml-stream-splitter streams records — prefer it for any report with > a few hundred rows. It is used in 8 of 12 production integrations at Lyft.\n\nPattern: cc:splitter (container) → cc:sub-route (per-record route) + cc:xml-stream-splitter (streaming strategy). The sub-route chains into per-record async processing. Use cc:aggregator downstream to recombine results.\n\nno-split-message-error="true" throws an error if the document has zero matching records.',
    routes_via: 'sub-route routes-to (per record); parent cc:splitter routes-to (after all records complete)',
    xml_example: `<!-- cc:splitter is the container — cc:xml-stream-splitter is the strategy inside it. -->

<!-- Workday report split by Report_Entry (Workday namespace required) -->
<cc:splitter id="SplitWorkers">
  <cc:sub-route name="SubRoute" routes-to="ProcessWorker"/>
  <cc:xml-stream-splitter xpath="/wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- CSV rows from cc:csv-to-xml output (no namespace needed) -->
<cc:splitter id="SplitCsvRows">
  <cc:sub-route name="SubRoute" routes-to="ProcessRow"/>
  <cc:xml-stream-splitter xpath="root/row"/>
</cc:splitter>

<!-- In-memory alternative (small docs only — loads all into memory): -->
<cc:splitter id="SplitSmall" no-split-message-error="false">
  <cc:sub-route name="SubRoute" routes-to="ProcessItem"/>
  <cc:xpath-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>`,
  },
  'copy': {
    description: 'Copies or restores the current message. Five use patterns:\n\n1. SAVE TO VARIABLE: output="variable" + output-variable="varName" — saves current message into a named variable. Useful for preserving XML before it gets transformed.\n\n2. RESTORE FROM VARIABLE: input="variable" + input-variable="varName" — loads a previously saved variable back as the current message.\n\n3. RETYPE MESSAGE: output-mimetype="text/plain" + input="variable" + input-variable="varName" — reads from a variable and re-types the content (useful when a stored doc was retrieved with wrong Content-Type).\n\n4. PLAIN COPY: no attributes — passes the current message through. Used structurally before cc:aggregator.\n\n5. APPEND TO XML VARIABLE: output="variable" + output-variable + append-to-output-element="true" + output-xpath="/root" — appends the current message as a child of the specified XPath node inside the output variable, instead of overwriting. Confirmed from INT012: used to build an XML log file incrementally across iterations.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- Save current message to a variable (before transforming it) -->
<cc:copy id="SaveWorkerXml" output="variable" output-variable="Worker_Split" input="message"/>

<!-- Restore the variable back to the current message later -->
<cc:copy id="RestoreWorkerXml" input="variable" input-variable="Worker_Split"/>

<!-- Retype a stored variable (e.g. doc retrieved as bytes, cast to text) -->
<cc:copy id="CastToText" output-mimetype="text/plain" input="variable" input-variable="wd.retrieve.variable"/>

<!-- Save aggregated output to variable before persisting -->
<cc:copy id="SaveCsv" output="variable" output-variable="csv"/>

<!-- Restore aggregated output from variable to current message -->
<cc:copy id="RestoreCsv" output="message"/>

<!-- Plain copy — passes message through (structural step before aggregator) -->
<cc:copy id="Copy"/>

<!-- Append to XML variable — build an XML log file incrementally.
  Each call appends the current message as a child of /message_log in the variable. -->
<cc:copy id="AppendLogEntry"
  output="variable" output-mimetype="text/xml" output-variable="audit_log"
  input="variable" input-variable="this_log_entry"
  append-to-output-element="true"
  output-xpath="/message_log"/>`,
  },
  'route': {
    description: 'Conditional or loop routing with three strategy variants:\n\n1. cc:loop-strategy — repeats the sub-route until the condition MVEL expression evaluates false. Use for pagination loops (fetch pages until all records are retrieved). Set increment to advance the offset counter after each iteration. Loop also exits immediately when a downstream step sets props[\'loop_break\'] = true.\n\n2. cc:mvel-strategy + cc:choose-route — evaluates MVEL expressions in order; takes the first sub-route whose expression is true. Works like if/else-if/else. Use expression="true" as the last cc:choose-route for a default branch.\n\n3. cc:doc-iterator — iterates over uploaded documents (attachments on the integration event). Each document becomes the current message in the sub-route.\n\nAll routes must have matching cc:sub-route elements with name attributes that match the route/choose-route names exactly.',
    routes_via: 'sub-route routes-to (for each branch)',
    xml_example: `<!-- ── Pagination loop (cc:loop-strategy) ─────────────────────────────────
  Repeats sub-route until condition = false or props['loop_break'] = true.
  increment is evaluated after each sub-route call completes.
  Common init before the route: props['offset'] = 0, props['response_count'] = very_large -->
<cc:route id="PagedFetch">
  <cc:loop-strategy
    condition="props['offset'] &lt;= props['response_count']"
    increment="props['offset'] = props['offset'] + 6000"/>
  <cc:sub-route name="SubRoute" routes-to="FetchOneBatch"/>
</cc:route>
<!-- FetchOneBatch sets props['loop_break'] = true when the last page is empty -->

<!-- Loop without increment — terminates when downstream changes stop condition -->
<cc:route id="ActivityLoop">
  <cc:loop-strategy condition="props['data_count'] != 0"/>
  <cc:sub-route name="SubRoute" routes-to="FetchActivityBatch"/>
</cc:route>

<!-- ── Conditional routing (cc:mvel-strategy + cc:choose-route) ────────────
  First expression that evaluates true takes that sub-route.
  Use expression="true" as the default/else branch (must be last). -->
<cc:route id="HireType">
  <cc:mvel-strategy>
    <cc:choose-route expression="props['Is_Rehire'] == 'Y'" route="Rehire"/>
    <cc:choose-route expression="props['Is_Rehire'] == 'N'" route="New Hire"/>
  </cc:mvel-strategy>
  <cc:sub-route name="New Hire" routes-to="NewHireFlow"/>
  <cc:sub-route name="Rehire"   routes-to="RehireFlow"/>
</cc:route>

<!-- Three-way branch (expression="true" = default else) -->
<cc:route id="CheckManagerOrgs">
  <cc:mvel-strategy>
    <cc:choose-route expression="props['Sup_Org'] == ''"  route="Manager - No Sup Org"/>
    <cc:choose-route expression="props['Sup_Org'] != ''"  route="Manager - Active Sup Org"/>
    <cc:choose-route expression="true"                    route="Manager - Inactive Sup Org"/>
  </cc:mvel-strategy>
  <cc:sub-route name="Manager - Active Sup Org"   routes-to="ActiveOrgFlow"/>
  <cc:sub-route name="Manager - No Sup Org"       routes-to="NoOrgFlow"/>
  <cc:sub-route name="Manager - Inactive Sup Org" routes-to="InactiveOrgFlow"/>
</cc:route>

<!-- ── Document iteration (cc:doc-iterator) ──────────────────────────────
  Iterates over uploaded documents on the integration event.
  Each document becomes the current message for one pass of the sub-route. -->
<cc:route id="DocIterator">
  <cc:doc-iterator/>
  <cc:sub-route name="ProcessFile" routes-to="ProcessDocument"/>
</cc:route>`,
  },
  'set-headers': {
    description: 'Sets HTTP headers on the current message before a cc:http-out call. Three child elements work together:\n\n- cc:remove-headers (empty) — clears ALL existing headers. Always include first to prevent stale headers from a previous response leaking into the next request.\n- cc:add-headers — container for cc:add-header children.\n- cc:add-header name="..." value="..." — adds one header. Values support @{} MVEL interpolation.\n\nFULL OAUTH2 TOKEN REFRESH PATTERN (confirmed from INT121 Brivo):\n1. POST to token endpoint with cc:http-out\n2. cc:json-to-xml to parse the token response\n3. cc:eval to extract access_token and build "Bearer {token}" string into props\n4. cc:write (empty message body) to clear the token response body\n5. cc:set-headers to inject Authorization and other headers\n6. All subsequent cc:http-out calls in the same flow carry those headers\n\nFor simple Basic auth use cc:http-basic-auth child on cc:http-out instead — no set-headers needed.\n\nADDITIONAL ATTRIBUTE (confirmed INT012): clear-all="true" on cc:set-headers itself clears all existing headers before processing children — equivalent to cc:remove-headers but at the element level.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Full OAuth2 token refresh pattern (confirmed: INT121 Brivo) ────────

Step 1: POST to OAuth token endpoint -->
<cc:http-out id="GetAccessToken" routes-response-to="InjectToken"
  endpoint="https://auth.example.com/oauth/token?grant_type=refresh_token&amp;refresh_token=@{props['refresh_token']}"
  http-method="POST"/>

<!-- Step 2: Parse token response, build header, inject into message -->
<cc:async-mediation id="InjectToken" routes-to="CallApi" handle-downstream-errors="true">
  <cc:steps>
    <!-- Parse JSON token response to XML for xpath -->
    <cc:json-to-xml id="ParseToken" nested-array-name="row" root-element-name="root"/>
    <!-- Extract token and build "Bearer {token}" string -->
    <cc:eval id="ExtractToken">
      <cc:expression>props['access_token'] = parts[0].xpath('root/data/access_token')</cc:expression>
      <cc:expression>props['auth_header']   = 'Bearer ' + props['access_token']</cc:expression>
    </cc:eval>
    <!-- Clear response body — otherwise the token JSON body flows into the next API call -->
    <cc:write id="ClearBody"><cc:message></cc:message></cc:write>
    <!-- Inject Authorization and other headers (cc:remove-headers clears stale ones first) -->
    <cc:set-headers id="SetAuthHeaders">
      <cc:remove-headers/>
      <cc:add-headers>
        <cc:add-header name="Authorization"   value="@{props['auth_header']}"/>
        <cc:add-header name="Accept-Encoding" value="gzip, deflate, br"/>
        <cc:add-header name="x-api-key"       value="@{props['api_key']}"/>
      </cc:add-headers>
    </cc:set-headers>
  </cc:steps>
  <cc:send-error id="TokenError" rethrow-error="false" routes-to="PutIntegrationMessage"/>
</cc:async-mediation>

<!-- Step 3: API call — Authorization header is already on the message -->
<cc:http-out id="CallApi" routes-response-to="HandleResponse"
  endpoint="@{props['api_base_url']}/v1/resource"
  http-method="GET"/>

<!-- ── Basic Auth alternative — no set-headers needed: -->
<cc:http-out id="BasicAuthCall" routes-response-to="HandleResponse"
  endpoint="@{props['url']}" http-method="PATCH">
  <cc:http-basic-auth username="@{props['username']}" password="@{props['password']}"/>
</cc:http-out>`,
  },
  'json-to-xml': {
    description: 'Converts a JSON HTTP response body to XML so XPath can extract values. Use immediately after cc:http-out (inside the routes-response-to async-mediation) before any cc:eval that calls parts[0].xpath(). Without this step, parts[0].xpath() returns empty on JSON payloads.\n\nTHREE KEY ATTRIBUTE COMBINATIONS (confirmed from INT121 and INT002):\n\n1. nested-array-name="row" root-element-name="root" — for responses where the payload is a top-level array. Each array item becomes a <row> child of the root element.\n   JSON: {"data": [{"access_token": "abc"}]} → <root><data><access_token>abc</access_token></data></root>\n\n2. nested-object-name="record" — for paginated list responses wrapped in an outer object. The outer object and its fields become children of <record>.\n   JSON: {"count": 100, "data": [...]} → <root><record><count>100</count><data>...</data></record></root>\n\n3. No attributes — minimal conversion for flat JSON objects.\n   JSON: {"key": "value"} → <root><key>value</key></root>\n\nALWAYS extract needed values with cc:eval + parts[0].xpath() immediately after cc:json-to-xml. If you subsequently call cc:xslt-plus or cc:write, the message changes and xpath no longer works.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Pattern 1: array response (e.g. OAuth token with data array) ─────
  JSON: {"data": [{"access_token": "abc123", ...}]}
  Use: nested-array-name + root-element-name -->
<cc:json-to-xml id="ParseTokenResponse" nested-array-name="row" root-element-name="root"/>
<!-- XPath: parts[0].xpath('root/data/access_token') -->

<!-- ── Pattern 2: paginated list with metadata wrapper ───────────────────
  JSON: {"count": 100, "data": [{record 1}, {record 2}]}
  Use: nested-object-name to unwrap the outer object -->
<cc:json-to-xml id="ParseListResponse" nested-object-name="record"/>
<!-- XPath count: parts[0].xpath('root/record/count') -->
<!-- XPath items: parts[0].xpath('count(/root/record/data)') -->

<!-- ── Pattern 3: flat JSON object ──────────────────────────────────────
  JSON: {"employeeId": "E123", "status": "Active"}
  No attributes needed -->
<cc:json-to-xml id="ParseSimpleResponse"/>
<!-- XPath: parts[0].xpath('root/employeeId') -->

<!-- ── Full context: extract BEFORE any transform ────────────────────────
  Always follow with cc:eval to pull values into props while message is XML.
  After cc:xslt-plus or cc:write, parts[0].xpath() will not work. -->
<cc:async-mediation id="ProcessApiResponse" routes-to="NextStep">
  <cc:steps>
    <cc:json-to-xml id="JsonToXml" nested-object-name="record"/>
    <cc:eval id="ExtractValues">
      <cc:expression>props['result_count'] = parts[0].xpath('root/record/count')</cc:expression>
      <cc:expression>props['data_count']   = parts[0].xpath('count(/root/record/data)')</cc:expression>
    </cc:eval>
    <cc:xslt-plus id="MapToOutput" output-mimetype="text/csv" url="MapOutput.xsl"/>
  </cc:steps>
</cc:async-mediation>`,
  },
  'validate-exp': {
    description: 'Throws a runtime error with a custom message if the MVEL expression evaluates false. Use inside cc:async-mediation cc:steps to guard against invalid states before processing. The error propagates to the nearest cc:send-error handler on the same or parent async-mediation.\n\nSyntax: MVEL expression is the text content of cc:expression. The failure-message attribute on cc:expression is the error text delivered to the integration event.\n\nCOMMON PATTERNS:\n- da.size() > 0 — validate uploaded file exists (da = document attachments collection)\n- props[\'count\'] > 0 — validate parsed CSV has rows\n- props[\'record_count\'] > 0 — validate API response has data\n- props[\'worker_id\'] != \'\' — validate a required value extracted from XPath is not empty\n\nAlways pair with handle-downstream-errors="true" and a cc:send-error on the same async-mediation.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps; throws error on false)',
    xml_example: `<!-- Validate uploaded documents exist -->
<cc:validate-exp id="ValidateFileUploaded">
  <cc:expression failure-message="There are no files uploaded">da.size() > 0</cc:expression>
</cc:validate-exp>

<!-- Validate parsed CSV has data rows -->
<cc:validate-exp id="ValidateFileNotEmpty">
  <cc:expression failure-message="The uploaded file is empty">props['count'] > 0</cc:expression>
</cc:validate-exp>

<!-- Validate API response returned records -->
<cc:validate-exp id="ValidateApiHasData">
  <cc:expression failure-message="No records returned from API">props['record_count'] > 0</cc:expression>
</cc:validate-exp>

<!-- Validate required prop is non-empty after extraction -->
<cc:validate-exp id="ValidateWorkerID">
  <cc:expression failure-message="Worker ID not found in response">props['worker_id'] != '' &amp;&amp; props['worker_id'] != null</cc:expression>
</cc:validate-exp>

<!-- Full context: inside async-mediation with send-error handler -->
<cc:async-mediation id="CheckAndProcess" routes-to="SplitRows" handle-downstream-errors="true">
  <cc:steps>
    <cc:validate-exp id="ValidateHasRows">
      <cc:expression failure-message="File has no data rows">props['row_count'] > 0</cc:expression>
    </cc:validate-exp>
    <!-- Only reached if validation passes -->
    <cc:xslt-plus id="TransformRows" output-mimetype="text/xml" url="MapRows.xsl"/>
  </cc:steps>
  <cc:send-error id="ValidateError" rethrow-error="false" routes-to="PutValidationError"/>
</cc:async-mediation>`,
  },
  'cloud-log': {
    description: 'Writes an entry to the Workday integration event log — the audit trail visible in the Workday UI under Integration Events. DIFFERENT from cc:log, which writes to the Studio console only.\n\nUse cc:cloud-log for business-level milestones that operators and auditors need to see: worker hired, position created, API call succeeded, fatal error occurred.\n\nAttributes (all support @{} MVEL interpolation):\n- level — severity. Confirmed values from production: info, fatal. (Presumably also: error, warn, debug.)\n- message — short summary string. Required.\n- message-details — longer detail string. Optional but recommended for context.\n- reference-id — a Workday object WID or business ID for a traceable audit link. Optional. Can be a bare expression without @{}: reference-id="props[\'p.WorkdayID\']"\n\nPATTERN: place cc:cloud-log immediately after the step that creates/updates an object. On fatal errors, place inside the error handler. A strong audit trail uses reference-id to link each log entry to the Workday object it describes.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- Log a successful hire with full audit context -->
<cc:cloud-log id="LogHireSuccess"
  level="info"
  message="Contingent Worker Successfully Hired"
  message-details="Applicant ID: @{props['p.applicant.id']} | CW ID: @{props['p.Contingent.Worker.id']}"
  reference-id="props['p.Contingent.Worker.wid']"/>

<!-- Log a created position (minimal form) -->
<cc:cloud-log id="LogPositionCreated"
  level="info"
  message="Position Successfully Created"
  message-details="@{props['p.Position.id']}"
  reference-id="props['p.Position.wid']"/>

<!-- Log a fatal error with full error context -->
<cc:cloud-log id="LogFatalError"
  level="fatal"
  message="@{props['error_message']}"
  message-details="@{props['error_message_details']}"
  reference-id="props['p.WorkdayID']"/>

<!-- Log a role assignment (no details needed) -->
<cc:cloud-log id="LogRoleAssigned"
  level="info"
  message="Assigned Manager Role Successfully"
  reference-id="props['p.Created.Supervisory.Org.wid']"/>

<!-- COMPARISON:
     cc:cloud-log → Workday UI > Integration Events (business audit trail)
     cc:log       → Studio console / server log only (developer debug) -->`,
  },
  'aggregator': {
    description: 'Recombines split messages into one after a cc:splitter has processed records individually. Collects each processed message and concatenates them when the batch condition fires.\n\nKEY ATTRIBUTES on cc:aggregator:\n- routes-to — where to route after aggregation releases the batch\n- force-batch-when — MVEL expression evaluated after each incoming message; batch fires when it evaluates true. Typical patterns: pagination complete (props[\'offset\'] >= props[\'total\']), data exhausted (props[\'data_count\'] == 0)\n- force-batch-on-last-message — set to false when using force-batch-when for explicit control\n\nCHILD ELEMENTS:\n- cc:size-batch-strategy batch-size="-1" — collect ALL messages (required when using force-batch-when)\n- cc:message-content-collater — concatenates the body of each collected message. Add cc:header-text child to prepend a CSV header line before all rows.\n\nPAGINATION PATTERN: each loop iteration fetches a page → splitter splits rows → each row is processed + routes to aggregator → when pagination ends, aggregator releases the full document.',
    routes_via: 'routes-to (after batch fires)',
    xml_example: `<!-- ── Basic aggregator (no CSV header) ─────────────────────────────────
  Fires when pagination offset has passed total count. -->
<cc:aggregator id="CollectUsers" routes-to="SaveFile"
  force-batch-on-last-message="false"
  force-batch-when="props['offset'] >= props['response_count']">
  <cc:size-batch-strategy batch-size="-1"/>
  <cc:message-content-collater/>
</cc:aggregator>

<!-- ── Aggregator with CSV column header ─────────────────────────────────
  cc:header-text is prepended as the first line of the collected output.
  Match the separator (|) and column order to your XSL output. -->
<cc:aggregator id="CollectActivity" routes-to="SaveActivityFile"
  force-batch-on-last-message="false"
  force-batch-when="props['data_count'] == 0">
  <cc:size-batch-strategy batch-size="-1"/>
  <cc:message-content-collater>
    <cc:header-text>EmployeeID|FirstName|LastName|Department|Location|EventDate</cc:header-text>
  </cc:message-content-collater>
</cc:aggregator>

<!-- ── After aggregator: save to variable then persist ───────────────────
  cc:copy snapshots aggregated content; cc:store delivers it as a file on the event. -->
<cc:async-mediation id="SaveFile" routes-to="DeliverFile">
  <cc:steps>
    <cc:copy id="SaveCsv" output="variable" output-variable="output_csv"/>
    <cc:store id="StoreFile" createDocumentReference="true" expiresIn="P30D" title="report.csv"/>
    <cc:eval id="SignalLoopDone">
      <cc:expression>props['loop_break'] = true</cc:expression>
    </cc:eval>
  </cc:steps>
</cc:async-mediation>`,
  },
  'xslt': {
    description: 'Applies an XSLT stylesheet producing XML output. Unlike cc:xslt-plus (which supports any output-mimetype), cc:xslt always produces XML and does not set a Content-Type header. Use for XML→XML transforms: building Workday SOAP request envelopes, restructuring data between Workday services, or extracting sub-documents.\n\ncc:xslt is an inline step inside cc:async-mediation cc:steps. The url attribute is relative to ws/WSAR-INF/.\n\nWHEN TO USE WHICH:\n- cc:xslt — XML in, XML out. No Content-Type change. Use for SOAP request building.\n- cc:xslt-plus — XML in, any format out (CSV, JSON, text). Required for non-XML output. Sets Content-Type automatically.\n- cc:transform — legacy top-level step (not inside async-mediation). Use cc:xslt instead.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- Build a Workday SOAP envelope from the current message -->
<cc:xslt id="BuildGetWorkersRequest" url="GetWorkersRequest.xsl"/>

<!-- Restructure XML between two Workday SOAP calls -->
<cc:xslt id="MapManagerInfo" url="GETManagerInfo.xsl"/>

<!-- Build a SOAP hire request from extracted props -->
<cc:xslt id="BuildHireRequest" url="PutApplicant.xsl"/>

<!-- Full context: inside async-mediation before a SOAP call -->
<cc:async-mediation id="BuildSoapEnvelope" routes-to="CallWorkday" handle-downstream-errors="true">
  <cc:steps>
    <cc:eval id="SetParams">
      <cc:expression>props['Worker_ID'] = lp.getSimpleData('Employee_ID')</cc:expression>
    </cc:eval>
    <!-- cc:xslt reads current message + any xsl:params from props -->
    <cc:xslt id="BuildRequest" url="GetWorkersRequest.xsl"/>
  </cc:steps>
  <cc:send-error id="XsltError" rethrow-error="false" routes-to="PutBuildError"/>
</cc:async-mediation>
<cc:workday-out-soap id="CallWorkday" routes-response-to="ProcessResponse"
  application="Human_Resources" version="v40.0"/>`,
  },
  'write': {
    description: 'Replaces the current message body with the content of its embedded cc:message block. Used to build SOAP/REST request bodies from literal XML + MVEL @{...} interpolation, clear the message body before setting headers, or write a stub XML input for cc:xslt-plus.\n\nKEY ATTRIBUTE: output-mimetype — sets the Content-Type of the written content (e.g. "text/xml", "text/plain", "application/json"). Default is text/xml.\n\noutput="variable" + output-variable="varName" form writes into a named variable instead of the current message context.\n\ncc:message children:\n- cc:text — literal string content. Use &lt; and &gt; for XML tags inside it, or just write plain text.\n- cc:message-content — inserts current message body at this position.\n\nCOMMON PATTERNS:\n1. Stub XML for cc:xslt-plus: write <request/>, then xslt-plus reads only xsl:params from props\n2. Clear body after token fetch: write empty cc:message before cc:set-headers so the OAuth response body does not flow into the next API call\n3. Build SOAP envelope inline: write complete XML string with @{props[...]} interpolation inside cc:text',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Build a SOAP request inline (no XSL file needed) ──────────────────
  Write a complete XML string with MVEL interpolation. -->
<cc:write id="BuildSoapBody" output-mimetype="text/xml">
  <cc:message>
    <cc:text>&lt;?xml version="1.0" encoding="UTF-8"?&gt;
&lt;env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wd="urn:com.workday/bsvc"&gt;
  &lt;env:Body&gt;
    &lt;wd:Get_Workers_Request wd:version="v40.0"&gt;
      &lt;wd:Request_References&gt;
        &lt;wd:Worker_Reference&gt;
          &lt;wd:ID wd:type="Employee_ID"&gt;@{props['Employee_ID']}&lt;/wd:ID&gt;
        &lt;/wd:Worker_Reference&gt;
      &lt;/wd:Request_References&gt;
    &lt;/wd:Get_Workers_Request&gt;
  &lt;/env:Body&gt;
&lt;/env:Envelope&gt;</cc:text>
  </cc:message>
</cc:write>

<!-- ── Stub XML for cc:xslt-plus (input must be valid XML) ───────────────
  The XSL ignores <request/> and reads only xsl:params populated from props. -->
<cc:write id="PrepareStub">
  <cc:message><cc:text>&lt;request/&gt;</cc:text></cc:message>
</cc:write>
<cc:xslt-plus id="BuildJson" output-mimetype="application/json" url="Build.xsl"/>

<!-- ── Clear message body after OAuth token fetch ────────────────────────
  Prevents the token response JSON from flowing into the next http-out call. -->
<cc:write id="ClearBody"><cc:message></cc:message></cc:write>

<!-- ── Write into a variable (for test injection or log building) ─────────
  output="variable" + output-variable routes output to a named variable. -->
<cc:write id="InjectTestData" output="variable" output-mimetype="text/plain" output-variable="wd.retrieve.variable">
  <cc:message>
    <cc:text>{"candidate_id": 12345, "first_name": "Jane"}</cc:text>
  </cc:message>
</cc:write>

<!-- ── HTML email body ────────────────────────────────────────────────────
  output-mimetype must be set; the following cc:email-out reads this as body. -->
<cc:write id="BuildEmailBody" output-mimetype="text/html">
  <cc:message>
    <cc:text>Hello @{props['Recruiter_Name']},&lt;br&gt;&lt;br&gt;
The hire of &lt;b&gt;@{props['First_Name']} @{props['Last_Name']}&lt;/b&gt; failed.&lt;br&gt;
Reason: @{props['Error_Message']}&lt;br&gt;&lt;br&gt;
Please contact HR Ops.&lt;br&gt;</cc:text>
  </cc:message>
</cc:write>`,
  },
  'store': {
    description: 'Persists the current message (or a variable) as a named document that can later be attached to the integration event via vm://wcc/PutIntegrationMessage. The stored document is referenced by setting is.document.variable.name to the output-variable name on the PutIntegrationMessage call.\n\nKEY ATTRIBUTES:\n- output="variable" + output-variable="varName" — stores the document reference into a named variable\n- input="message" or input="variable" + input-variable — source of content to store\n- createDocumentReference="true/false" — whether to create a Workday document reference\n- expiresIn — ISO-8601 duration string for document retention (e.g. "P30D" = 30 days)\n- title — display name of the document (filename)\n- contentDisposition — sets the attachment filename, e.g. attachment;filename="report.csv"\n- schema="http://www.w3.org/2005/Atom" + summary + title — Atom entry metadata for WD document taxonomy\n\nPATTERN: cc:store is always followed by a cc:local-out to vm://wcc/PutIntegrationMessage with is.document.variable.name set to the same variable name.\n\nAlso used as cc:store (simpler form, no output-variable) to persist a file directly as a deliverable to the integration event.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Store a CSV file to the integration event (INT121 pattern) ─────────
  After cc:aggregator releases collected CSV rows: -->
<cc:async-mediation id="PersistFile" routes-to="DeliverFile">
  <cc:steps>
    <cc:copy id="Snapshot" output="variable" output-variable="output_csv"/>
    <!-- createDocumentReference=true → makes it a deliverable attachment -->
    <cc:store id="StoreFile" createDocumentReference="true" expiresIn="P30D" title="report.csv"/>
  </cc:steps>
</cc:async-mediation>

<!-- ── Store a document with full Atom metadata (INT012 pattern) ──────────
  The document is stored in a variable; PutIntegrationMessage delivers it. -->
<cc:store id="StoreDoc"
  output="variable" output-mimetype="text/plain" output-variable="UFileOut_FileReference"
  input="message"
  contentDisposition="attachment;filename=&quot;@{props['UFileOut_FileName']}&quot;"
  createDocumentReference="false"
  expiresIn="@{props['UFileOut_TmpRetention']}"
  schema="http://www.w3.org/2005/Atom"
  summary="@{'File: ' + props['UFileOut_FileName']}"
  title="@{props['UFileOut_FileName']}"/>

<!-- Deliver the stored document as an attachment on the event -->
<cc:local-out id="AttachToEvent" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage"
  clone-request="true">
  <cc:set name="is.document.variable.name" value="'UFileOut_FileReference'"/>
  <cc:set name="is.document.deliverable"   value="'true'"/>
</cc:local-out>

<!-- ── Store from a variable (not from message) ──────────────────────────
  Use when content was already captured in a variable earlier in the flow. -->
<cc:store id="StoreFromVar"
  output="variable" output-mimetype="text/plain" output-variable="doc_ref"
  input="variable" input-variable="UFileOut_Tmp"
  createDocumentReference="false"
  expiresIn="P30D"
  title="audit_log.csv"/>`,
  },
  'base64-encode': {
    description: 'Base64-encodes the current message (or a variable) and writes the result into a named output variable or back to the message. Used for two main purposes:\n\n1. BUILDING BASIC AUTH HEADERS: write "ApiKey:" to message → cc:base64-encode → use output variable as the Authorization header value: "Basic {encoded}"\n\n2. ENCODING BINARY FILES FOR SOAP: fetch a binary file (PDF, image) from an API → cc:base64-encode into a variable → embed the encoded string in a wd:Worker_Document SOAP request body\n\nKEY ATTRIBUTES:\n- output="variable" + output-variable="varName" — writes encoded content to a variable\n- output-mimetype — sets MIME type of the output (usually "text/plain")\n- input="message" — reads from current message (default); omit when current message is the implicit source',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Basic Auth header from API key (INT012 Greenhouse pattern) ──────────
  Step 1: write "APIKey:" to message (colon makes it a Basic auth credential) -->
<cc:write id="PrepareKey" output-mimetype="text/plain">
  <cc:message><cc:text>@{props['GH_API_Key']}:</cc:text></cc:message>
</cc:write>
<!-- Step 2: base64-encode the message, store in variable -->
<cc:base64-encode id="EncodeKey"
  output="variable" output-mimetype="text/plain"
  output-variable="API_Key_Encoded"
  input="message"/>
<!-- Step 3: inject as Authorization header on the next http-out -->
<cc:set-headers id="SetBasicAuth">
  <cc:remove-headers/>
  <cc:add-headers>
    <cc:add-header name="Authorization" value="Basic @{vars['API_Key_Encoded'].getText()}"/>
  </cc:add-headers>
</cc:set-headers>

<!-- ── Encode a binary file fetched from REST API ────────────────────────
  After cc:http-out GET returns a PDF blob: -->
<cc:base64-encode id="EncodePdf"
  output="variable"
  output-variable="filebase64"/>
<!-- Then embed vars['filebase64'].getText() in a wd:Put_Worker_Document SOAP body -->`,
  },
  'email-out': {
    description: 'Sends the current message body as an email via SMTP. The message body must already be set (typically by a preceding cc:write with output-mimetype="text/html" or "text/plain"). Used for error notification emails to business users (recruiters, HR ops) when processing fails.\n\nKEY ATTRIBUTES:\n- endpoint — "mailto:{recipient}" URI. Supports @{} interpolation.\n- subject — email subject line. Supports @{} interpolation.\n- host — SMTP host (Lyft uses AWS SES: email-smtp.us-east-1.amazonaws.com)\n- port — SMTP port (587 for STARTTLS)\n- starttls — "true" for STARTTLS\n- user / password — SMTP credentials (typically stored in integration attributes)\n- from, reply-to — sender headers\n- bcc, cc — additional recipients (semicolon-delimited)\n- execute-when — MVEL condition to skip on impl environments\n\nENVIRONMENT ROUTING PATTERN: Use two cc:email-out elements with mutually exclusive execute-when conditions:\n- Prod instance: sends to actual recruiter, execute-when="props[\'Is_Impl\'] == false"\n- Impl instance: sends only to internal test address, execute-when="props[\'Is_Impl\'] == true"\n\nRequires a cc:custom-headers child (empty element).',
    routes_via: 'routes-response-to (optional)',
    xml_example: `<!-- ── Full error notification pattern (INT012 Greenhouse) ──────────────
  Step 1: build HTML body -->
<cc:write id="BuildErrorEmail" output-mimetype="text/html">
  <cc:message>
    <cc:text>Hello @{props['GH_Recruiter_Name']},&lt;br&gt;&lt;br&gt;
Failed processing hire for &lt;b&gt;@{props['First_Name']} @{props['Last_Name']}&lt;/b&gt;.&lt;br&gt;
Reason: @{props['Email_Failure_Reason']}&lt;br&gt;&lt;br&gt;
Contact HR Ops to resolve.&lt;br&gt;</cc:text>
  </cc:message>
</cc:write>

<!-- Step 2: send to recruiter (prod only) -->
<cc:email-out id="EmailOut_Prod"
  execute-when="props['Is_Impl'] == false"
  routes-response-to="EmailOut_Impl"
  endpoint="mailto:@{props['GH_Recruiter_Email']}"
  bcc="hropsint@lyft.com"
  cc="@{props['cc_address']}"
  from="prehire@lyft.com"
  reply-to="prehire@lyft.com"
  host="email-smtp.us-east-1.amazonaws.com"
  port="587"
  starttls="true"
  user="@{props['SMTP_Username']}"
  password="@{props['SMTP_Password']}"
  subject="Hire failed: @{props['First_Name']} @{props['Last_Name']}">
  <cc:custom-headers/>
</cc:email-out>

<!-- Step 3: send to internal test only (impl only) -->
<cc:email-out id="EmailOut_Impl"
  execute-when="props['Is_Impl'] == true"
  endpoint="mailto:int-dev-testing@lyft.com"
  from="prehire@lyft.com"
  host="email-smtp.us-east-1.amazonaws.com"
  port="587"
  starttls="true"
  user="@{props['SMTP_Username']}"
  password="@{props['SMTP_Password']}"
  subject="[IMPL] Hire failed: @{props['First_Name']} @{props['Last_Name']}">
  <cc:custom-headers/>
</cc:email-out>`,
  },
  'json-splitter': {
    description: 'Splits a raw JSON message on a JSONPath expression without first converting it to XML. Each matched element becomes a separate message routed through the sub-route. Use when you want to iterate over a JSON array returned directly from an API, before or instead of cc:json-to-xml.\n\nUsed as the split strategy child inside cc:splitter, alongside cc:sub-route.\n\nKEY ATTRIBUTE:\n- json-path — JSONPath expression selecting the array to split on. E.g. "$.attachments" selects the top-level "attachments" array.\n\nCONTRAST WITH cc:xml-stream-splitter / cc:xpath-splitter:\n- cc:json-splitter — works on raw JSON, no prior conversion needed\n- cc:xml-stream-splitter — streaming XML split (large docs)\n- cc:xpath-splitter — in-memory XML split (small docs; often used after cc:json-to-xml)\n\nTypical pipeline: http-out GET → json-splitter($.arrayField) → per-record async-mediation → json-to-xml → eval (extract fields) → downstream processing',
    routes_via: 'sub-route routes-to (per element)',
    xml_example: `<!-- Split raw JSON on $.attachments array (INT012 Greenhouse pattern)
  Prior step: cc:http-out GET to a Greenhouse API endpoint returns a JSON body
  like: {"id": 123, "attachments": [{...}, {...}]} -->

<cc:splitter id="SplitAttachments">
  <cc:sub-route name="SubRoute" routes-to="ProcessAttachment"/>
  <cc:json-splitter json-path="$.attachments"/>
</cc:splitter>

<!-- Each split message is one JSON attachment object.
     Inside ProcessAttachment: convert to XML to use XPath. -->
<cc:async-mediation id="ProcessAttachment" routes-to="Aggregator">
  <cc:steps>
    <!-- Now convert the single JSON record to XML for XPath -->
    <cc:json-to-xml id="JsonToXml" nested-object-name="record"/>
    <cc:eval id="ExtractUrl">
      <cc:expression>props['attachment_url'] = parts[0].xpath('root/record/url')</cc:expression>
      <cc:expression>props['attachment_type'] = parts[0].xpath('root/record/type')</cc:expression>
    </cc:eval>
    <!-- Fetch and process the attachment -->
    <cc:xslt-plus id="MapAttachment" output-mimetype="text/xml" url="MapAttachment.xsl"/>
  </cc:steps>
</cc:async-mediation>

<!-- Compare: split after cc:json-to-xml has converted to XML (xpath-splitter) -->
<cc:splitter id="SplitEntries">
  <cc:sub-route name="SubRoute" routes-to="ProcessEntry"/>
  <cc:xpath-splitter xpath="root/entry"/>
</cc:splitter>`,
  },
};

export function register(server) {
  server.tool(
    'get_step_type_reference',
    'Returns documentation and XML examples for Workday Studio assembly step types. Use this before writing or modifying assembly.xml to get the correct XML schema for each step type.',
    {
      step_type: z.string().optional().describe('Specific step type to look up (e.g. "transform", "http-out", "splitter"). Omit to get the full reference.'),
    },
    async ({ step_type }) => {
      if (step_type) {
        const entry = REFERENCE[step_type];
        if (!entry) {
          const known = Object.keys(REFERENCE).join(', ');
          return errorResponse('UNKNOWN_STEP_TYPE', `Unknown step type: '${step_type}'.`, `Known types: ${known}`);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ [step_type]: entry }, null, 2) }] };
      }

      // Return summary of all types
      const summary = Object.entries(REFERENCE).map(([type, info]) => ({
        type: `cc:${type}`,
        description: info.description,
        routes_via: info.routes_via,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
