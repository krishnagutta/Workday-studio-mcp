/**
 * Studio assembly validator — checks rules that XML well-formedness alone cannot catch.
 *
 * Returns an array of { severity, code, message } objects.
 * severity: 'ERROR' (will break Studio) | 'WARNING' (will cause runtime failures) | 'INFO' (awareness)
 */

import { existsSync } from 'fs';
import { join } from 'path';

export function validateAssembly(xml, wsDir = null) {
  const issues = [];

  checkNoXmlComments(xml, issues);
  checkBrokenRoutes(xml, issues);
  checkLocalOutEndpoints(xml, issues);
  checkRequiredAttributes(xml, issues);
  checkTopLevelOnlyElements(xml, issues);
  checkSplitterRoutes(xml, issues);
  if (wsDir) checkXslFileReferences(xml, wsDir, issues);
  checkCcNote(xml, issues);
  checkTodoStubs(xml, issues);

  return issues;
}

// ─── Rule: no XML comments in assembly.xml ────────────────────────────────────
// Comments are valid XML but shift @mixed indices, breaking all diagram EMF XPath references.

function checkNoXmlComments(xml, issues) {
  const matches = [...xml.matchAll(/<!--/g)];
  if (matches.length > 0) {
    issues.push({
      severity: 'ERROR',
      code: 'XML_COMMENTS_PRESENT',
      message: `Found ${matches.length} XML comment(s). Comments shift @mixed indices and break all diagram connections. Remove every <!-- --> block from assembly.xml.`,
    });
  }
}

// ─── Rule: every routes-to / routes-response-to target must exist ─────────────

function checkBrokenRoutes(xml, issues) {
  const ids = collectIds(xml);

  for (const m of xml.matchAll(/\broutes-to="([^"]+)"/g)) {
    if (!ids.has(m[1])) {
      issues.push({
        severity: 'ERROR',
        code: 'BROKEN_ROUTES_TO',
        message: `routes-to="${m[1]}" — no element with this id exists in assembly.xml.`,
      });
    }
  }

  for (const m of xml.matchAll(/\broutes-response-to="([^"]+)"/g)) {
    if (!ids.has(m[1])) {
      issues.push({
        severity: 'ERROR',
        code: 'BROKEN_ROUTES_RESPONSE_TO',
        message: `routes-response-to="${m[1]}" — no element with this id exists in assembly.xml.`,
      });
    }
  }
}

// ─── Rule: vm:// sub-flow endpoints must point to a real cc:local-in ──────────
// Built-in wcc/* endpoints are exempt.

function checkLocalOutEndpoints(xml, issues) {
  const ids = collectIds(xml);

  for (const m of xml.matchAll(/endpoint="vm:\/\/([^/]+)\/([^"]+)"/g)) {
    const [, systemName, localInId] = m;
    if (systemName === 'wcc') continue;  // built-in platform endpoints

    if (!ids.has(localInId)) {
      issues.push({
        severity: 'WARNING',
        code: 'UNRESOLVED_LOCAL_IN',
        message: `vm://${systemName}/${localInId} — no cc:local-in with id="${localInId}" found. Either the local-in is missing or the id is misspelled.`,
      });
    }
  }
}

// ─── Rule: required attributes per step type ─────────────────────────────────

const REQUIRED_ATTRS = [
  // [tagPattern, requiredAttr, errorMessage]
  [/cc:workday-out-soap\b[^>]*(?<!extra-path="[^"]*")(?<!application="[^"]*")/,
    'application',
    'cc:workday-out-soap is missing required attribute application="..." (e.g. Human_Resources, Staffing, Talent).'],
  [/cc:workday-out-soap\b[^>]*(?<!version="[^"]*")/,
    'version',
    'cc:workday-out-soap is missing required attribute version="..." (e.g. 38.2).'],
  [/cc:workday-out-rest\b/,
    'extra-path',
    'cc:workday-out-rest is missing required attribute extra-path.'],
  [/cc:http-out\b/,
    'endpoint',
    'cc:http-out is missing required attribute endpoint.'],
  [/cc:xslt-plus\b/,
    'url',
    'cc:xslt-plus is missing required attribute url (path to .xsl file).'],
];

function checkRequiredAttributes(xml, issues) {
  // Extract each self-contained step tag (opening tag only, may span multiple lines)
  const tagPattern = /<(cc:[a-z-]+)\b([^>]*(?:>(?!.*<\/cc:\1)|\/>))/gs;

  for (const tagMatch of xml.matchAll(/<cc:[a-z-]+\b[^>]*(?:\/>|>)/gs)) {
    const tagText = tagMatch[0];
    const nameMatch = tagText.match(/^<(cc:[a-z-]+)/);
    if (!nameMatch) continue;
    const tagName = nameMatch[1];

    // workday-out-soap: check application
    if (tagName === 'cc:workday-out-soap') {
      if (!tagText.includes('application=')) {
        issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_APPLICATION', message: `cc:workday-out-soap (id="${extractId(tagText)}") is missing required attribute application= (e.g. Human_Resources).` });
      }
      if (!tagText.includes('version=')) {
        issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_VERSION', message: `cc:workday-out-soap (id="${extractId(tagText)}") is missing required attribute version= (e.g. 38.2).` });
      }
    }

    // workday-out-rest: check extra-path
    if (tagName === 'cc:workday-out-rest' && !tagText.includes('extra-path=')) {
      issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_EXTRA_PATH', message: `cc:workday-out-rest (id="${extractId(tagText)}") is missing required attribute extra-path=.` });
    }

    // http-out: check endpoint (skip if it's a closing tag)
    if (tagName === 'cc:http-out' && !tagText.includes('endpoint=')) {
      issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_ENDPOINT', message: `cc:http-out (id="${extractId(tagText)}") is missing required attribute endpoint=.` });
    }

    // xslt-plus: check url
    if (tagName === 'cc:xslt-plus' && !tagText.includes('url=')) {
      issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_URL', message: `cc:xslt-plus (id="${extractId(tagText)}") is missing required attribute url= (path to .xsl file).` });
    }
  }
}

// ─── Rule: certain elements must be TOP-LEVEL, not inside cc:steps ───────────
// cc:workday-out-rest, cc:splitter, cc:http-out, cc:email-out are assembly-level
// routing elements. Studio's schema rejects them inside cc:steps.
// Confirmed from INT095, INT069, INT060, INT144.

const TOP_LEVEL_ONLY = ['cc:workday-out-rest', 'cc:splitter', 'cc:http-out', 'cc:email-out', 'cc:workday-out-soap'];

function checkTopLevelOnlyElements(xml, issues) {
  // Find every <cc:steps> block and check its content
  const stepsPattern = /<cc:steps>([\s\S]*?)<\/cc:steps>/g;
  for (const stepsMatch of xml.matchAll(stepsPattern)) {
    const stepsContent = stepsMatch[1];
    for (const tag of TOP_LEVEL_ONLY) {
      if (stepsContent.includes(`<${tag}`)) {
        // Find the id of the containing async-mediation for a useful error message
        const stepsIdx = stepsMatch.index;
        const before = xml.substring(0, stepsIdx);
        const asyncMedMatch = [...before.matchAll(/<cc:async-mediation\b[^>]*>/g)].pop();
        const containerId = asyncMedMatch ? extractId(asyncMedMatch[0]) : '?';
        issues.push({
          severity: 'ERROR',
          code: 'ELEMENT_INSIDE_STEPS',
          message: `<${tag}> found inside <cc:steps> of "${containerId}". This is a top-level assembly element — it must sit directly inside <cc:assembly>, not inside cc:steps. Move it out of the async-mediation and chain it via routes-to/routes-response-to.`,
        });
      }
    }
  }
}

// ─── Rule: cc:splitter must NOT have a routes-to attribute ───────────────────
// Studio's schema does not allow routes-to on cc:splitter. The splitter routes
// via its cc:sub-route children only. Confirmed INT095, INT144.

function checkSplitterRoutes(xml, issues) {
  for (const m of xml.matchAll(/<cc:splitter\b[^>]*>/g)) {
    if (m[0].includes('routes-to=')) {
      issues.push({
        severity: 'ERROR',
        code: 'SPLITTER_HAS_ROUTES_TO',
        message: `cc:splitter (id="${extractId(m[0])}") has a routes-to attribute — the Studio schema does not allow this. Remove routes-to from the splitter. Routing is done via cc:sub-route children only.`,
      });
    }
  }
}

// ─── Rule: XSL files referenced by url= must exist in WSAR-INF ───────────────

function checkXslFileReferences(xml, wsDir, issues) {
  for (const m of xml.matchAll(/\burl="([^"]+\.xslt?)"/g)) {
    const xslFile = m[1];
    if (!existsSync(join(wsDir, xslFile))) {
      issues.push({
        severity: 'WARNING',
        code: 'MISSING_XSL_FILE',
        message: `url="${xslFile}" — file not found in WSAR-INF. Create it with create_xsl_transform before testing.`,
      });
    }
  }
}

// ─── Rule: cc:note is schema-invalid in assembly.xml ─────────────────────────
// Studio's schema rejects cc:note as a cc:assembly child. The correct terminal
// pattern is an cc:async-mediation with no routes-to attribute.
// Also: cc:note in assembly-diagram.xml crashes Studio (scala.MatchError).

function checkCcNote(xml, issues) {
  const matches = [...xml.matchAll(/<cc:note\b/g)];
  if (matches.length > 0) {
    issues.push({
      severity: 'ERROR',
      code: 'CC_NOTE_IN_ASSEMBLY',
      message: `Found ${matches.length} <cc:note> element(s). cc:note is schema-invalid in assembly.xml and crashes Studio if added to assembly-diagram.xml. Replace with an cc:async-mediation that has no routes-to attribute — that is the correct terminal pattern.`,
    });
  }
}

// ─── Rule: flag remaining TODO stubs ─────────────────────────────────────────

function checkTodoStubs(xml, issues) {
  const todos = [...xml.matchAll(/id="TODO_([^"]+)"/g)].map(m => m[1]);
  if (todos.length > 0) {
    issues.push({
      severity: 'INFO',
      code: 'TODO_STUBS_REMAINING',
      message: `${todos.length} sub-flow(s) still contain TODO stubs: ${todos.join(', ')}. Fill these in with update_sub_flow before testing.`,
    });
  }
}

// ─── Diagram drift detection ──────────────────────────────────────────────────
// Returns top-level assembly element ids that have NO reference in the diagram.
// Only checks renderable node types — cc:send-error, cc:log-error, and inline
// steps (cc:eval, cc:xslt-plus, etc.) are intentionally excluded because Studio
// never places them as standalone diagram nodes.

const RENDERABLE_TAGS = new Set([
  'cc:workday-in', 'cc:local-out', 'cc:local-in', 'cc:async-mediation',
  'cc:route', 'cc:splitter', 'cc:aggregator', 'cc:http-out',
  'cc:workday-out-rest', 'cc:workday-out-soap', 'cc:email-out',
]);

export function checkDiagramDrift(assemblyXml, diagramXml) {
  const missing = [];

  for (const m of assemblyXml.matchAll(/<(cc:[a-z-]+)\b[^>]*\bid="([^"]+)"/g)) {
    const [, tag, id] = m;
    if (!RENDERABLE_TAGS.has(tag)) continue;
    // Diagram references an id either as href="assembly.xml#Id" or href="#Id"
    if (!diagramXml.includes(`#${id}`)) {
      missing.push({ tag, id });
    }
  }

  return missing;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectIds(xml) {
  return new Set([...xml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
}

function extractId(tagText) {
  const m = tagText.match(/\bid="([^"]+)"/);
  return m ? m[1] : '?';
}
