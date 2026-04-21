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
  if (wsDir) checkXslFileReferences(xml, wsDir, issues);
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectIds(xml) {
  return new Set([...xml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
}

function extractId(tagText) {
  const m = tagText.match(/\bid="([^"]+)"/);
  return m ? m[1] : '?';
}
