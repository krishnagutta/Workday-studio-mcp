import { z } from 'zod';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { config } from '../config.mjs';
import { validateAssembly } from '../assembly-validator.mjs';

export function register(server) {
  server.tool(
    'validate_assembly',
    [
      'Validates assembly.xml against Studio-specific rules beyond XML well-formedness.',
      '',
      'Checks performed:',
      '  ERROR   — XML comments present (shifts @mixed indices, breaks diagram connections)',
      '  ERROR   — Broken routes-to / routes-response-to (target id does not exist)',
      '  ERROR   — cc:workday-out-soap missing application= or version=',
      '  ERROR   — cc:workday-out-rest missing extra-path=',
      '  ERROR   — cc:http-out missing endpoint=',
      '  ERROR   — cc:xslt-plus missing url=',
      '  WARNING — vm:// endpoint references a local-in id that does not exist',
      '  WARNING — url= references an XSL file not found in WSAR-INF',
      '  INFO    — TODO stubs still present (sub-flows not yet filled in)',
      '',
      'Run this after update_sub_flow (it also runs automatically) or any manual edit.',
      'Fix all ERRORs before opening in Studio. WARNINGs block testing, not diagram load.',
    ].join('\n'),
    {
      project_name: z.string().describe('Project name, e.g. "INT145_My_Integration"'),
    },
    async ({ project_name }) => {
      const projectPath = resolve(config.workspacePath, project_name);
      const wsDir       = join(projectPath, 'ws', 'WSAR-INF');
      const assemblyPath = join(wsDir, 'assembly.xml');

      if (!existsSync(assemblyPath)) {
        return errResponse(
          'FILE_NOT_FOUND',
          `assembly.xml not found in project '${project_name}'.`,
          'Run plan_integration first.',
        );
      }

      const xml    = await readFile(assemblyPath, 'utf-8');
      const issues = validateAssembly(xml, wsDir);

      const errors   = issues.filter(i => i.severity === 'ERROR');
      const warnings = issues.filter(i => i.severity === 'WARNING');
      const infos    = issues.filter(i => i.severity === 'INFO');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            project: project_name,
            valid: errors.length === 0,
            summary: {
              errors:   errors.length,
              warnings: warnings.length,
              info:     infos.length,
            },
            issues,
          }, null, 2),
        }],
      };
    },
  );
}

function errResponse(code, message, suggestion) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error: true, code, message, suggestion }),
    }],
  };
}
