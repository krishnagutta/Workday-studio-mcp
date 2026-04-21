import { z } from 'zod';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.mjs';

export function register(server) {
  server.tool(
    'list_integration_params',
    'Parse assembly.xml and return the launch parameters and integration attributes defined on the StartHere (cc:workday-in) element. Use this to map requirements to the param/attribute list without reading the full assembly.',
    {
      project_name: z.string().describe('The Studio project name'),
    },
    async ({ project_name }) => {
      const assemblyPath = resolve(config.workspacePath, project_name, 'ws', 'WSAR-INF', 'assembly.xml');
      if (!existsSync(assemblyPath)) {
        return errorResponse('FILE_NOT_FOUND', `No assembly.xml found in project '${project_name}'.`, 'Use list_studio_projects to confirm the project name.');
      }

      const xml = await readFile(assemblyPath, 'utf8');
      const result = parseParams(xml);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

function parseParams(xml) {
  // Extract the cc:workday-in block
  const workdayInMatch = xml.match(/<cc:workday-in[\s\S]*?<\/cc:workday-in>/);
  if (!workdayInMatch) return { params: [], attributes: [], integration_system: null };

  const block = workdayInMatch[0];

  // Integration system name
  const sysNameMatch = block.match(/<cc:integration-system\s+name="([^"]+)"/);
  const integrationSystem = sysNameMatch ? sysNameMatch[1] : null;

  // Launch parameters
  const params = [];
  const paramPattern = /<cloud:param\s+name="([^"]+)">([\s\S]*?)<\/cloud:param>/g;
  let m;
  while ((m = paramPattern.exec(block)) !== null) {
    const [, name, body] = m;
    params.push({
      name,
      type: extractParamType(body),
      required: /required/.test(body),
    });
  }

  // Integration attributes
  const attributes = [];
  const attrServicePattern = /<cloud:attribute-map-service\s+name="([^"]+)">([\s\S]*?)<\/cloud:attribute-map-service>/g;
  while ((m = attrServicePattern.exec(block)) !== null) {
    const [, serviceName, body] = m;
    const attrPattern = /<cloud:attribute\s+name="([^"]+)">([\s\S]*?)<\/cloud:attribute>/g;
    let am;
    while ((am = attrPattern.exec(body)) !== null) {
      const [, attrName, attrBody] = am;
      attributes.push({
        service: serviceName,
        name: attrName,
        type: extractParamType(attrBody),
      });
    }
  }

  return { integration_system: integrationSystem, params, attributes };
}

function extractParamType(body) {
  const simpleMatch = body.match(/<cloud:simple-type>([^<]+)<\/cloud:simple-type>/);
  if (simpleMatch) return simpleMatch[1];
  const classMatch = body.match(/<cloud:class-report-field\s+description="([^"]+)"/);
  if (classMatch) return `WID (${classMatch[1]})`;
  const enumMatch = body.match(/<cloud:enumeration-type\s+name="([^"]+)"/);
  if (enumMatch) {
    const values = [...body.matchAll(/<cloud:enumeration>([^<]+)<\/cloud:enumeration>/g)].map(e => e[1]);
    return `enum: ${values.join(' | ')}`;
  }
  return 'unknown';
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
