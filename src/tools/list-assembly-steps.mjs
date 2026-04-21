import { z } from 'zod';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { config } from '../config.mjs';

// All cc: element types that represent assembly steps
const STEP_TYPES = new Set([
  'workday-in', 'workday-out', 'workday-out-soap', 'workday-out-rest', 'workday-api',
  'workday-report', 'transform', 'xslt-plus', 'http-out', 'http-in',
  'local-in', 'local-out', 'async-mediation', 'splitter', 'decision',
  'sub-assembly', 'note', 'sequence', 'branch', 'eval', 'log',
  'file-out', 'sftp-out', 'email-out',
  'send-error', 'log-error', 'custom-error-handler',
  'xml-to-csv', 'csv-to-xml', 'xml-to-json', 'json-to-xml', 'json-transformer',
  'text-excel', 'wrap-soap', 'character-conversion',
]);

export function register(server) {
  server.tool(
    'list_assembly_steps',
    'Parse assembly.xml and return all steps with their IDs, types, and routing. Much faster than reading the full file when you just need to understand the integration flow.',
    {
      project_name: z.string().describe('The Studio project name'),
      include_nested: z.boolean().optional().describe('Include steps nested inside cc:async-mediation and cc:splitter. Defaults to false (top-level only).'),
    },
    async ({ project_name, include_nested = false }) => {
      const assemblyPath = resolve(config.workspacePath, project_name, 'ws', 'WSAR-INF', 'assembly.xml');
      if (!existsSync(assemblyPath)) {
        return errorResponse('FILE_NOT_FOUND', `No assembly.xml found in project '${project_name}'.`, 'Use list_studio_projects to confirm the project name.');
      }

      const xml = await readFile(assemblyPath, 'utf8');
      const steps = parseSteps(xml, include_nested);
      return { content: [{ type: 'text', text: JSON.stringify(steps, null, 2) }] };
    }
  );
}

function parseSteps(xml, includeNested) {
  const steps = [];

  // Match any <cc:STEP_TYPE ...> opening tag (handles multi-line attributes)
  const tagPattern = /<cc:([\w-]+)((?:\s[^>]*)?)\/?>/gs;
  let match;

  while ((match = tagPattern.exec(xml)) !== null) {
    const [, stepType, attrs] = match;
    if (!STEP_TYPES.has(stepType)) continue;

    const id = extractAttr(attrs, 'id');
    if (!id) continue; // skip anonymous/inline elements

    const routesTo = extractAttr(attrs, 'routes-to');
    const routesResponseTo = extractAttr(attrs, 'routes-response-to');
    const name = extractAttr(attrs, 'name');
    const href = extractAttr(attrs, 'href');
    const endpoint = extractAttr(attrs, 'endpoint');

    const step = { id, type: `cc:${stepType}` };
    if (routesTo) step.routes_to = routesTo;
    if (routesResponseTo) step.routes_response_to = routesResponseTo;
    if (name) step.name = name;
    if (href) step.href = href;
    if (endpoint) step.endpoint = endpoint;

    // Skip steps that live inside a <cc:steps> block (nested in async-mediation/splitter)
    if (!includeNested && !isTopLevelStep(xml, match.index)) continue;

    steps.push(step);
  }

  return steps;
}

function extractAttr(attrs, name) {
  const m = attrs.match(new RegExp(`${name}="([^"]+)"`));
  return m ? m[1] : null;
}

function isTopLevelStep(xml, matchIndex) {
  // A step is top-level when it is NOT inside a <cc:steps> block.
  // Count opens/closes of <cc:steps> up to this position — equal means we're outside.
  const before = xml.slice(0, matchIndex);
  const opens = (before.match(/<cc:steps>/g) || []).length;
  const closes = (before.match(/<\/cc:steps>/g) || []).length;
  return opens === closes;
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
