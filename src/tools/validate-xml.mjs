import { z } from 'zod';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolveSafe } from '../fs.mjs';
import { validateXml } from '../xml.mjs';

export function register(server) {
  server.tool(
    'validate_xml_file',
    'Validate an XML or XSLT file for well-formedness. Returns any parse errors with line/column numbers.',
    {
      project_name: z.string().describe('The Studio project name'),
      file_path: z.string().describe('Path to the file relative to the project root'),
    },
    async ({ project_name, file_path }) => {
      let resolved;
      try {
        resolved = resolveSafe(project_name, file_path);
      } catch (e) {
        if (e.code === 'PATH_TRAVERSAL_DETECTED') {
          return errorResponse('PATH_TRAVERSAL_DETECTED', e.message, 'Use relative paths within the project directory only.');
        }
        return errorResponse('RESOLVE_ERROR', e.message, null);
      }

      if (!existsSync(resolved.absolute)) {
        return errorResponse('FILE_NOT_FOUND', `File '${file_path}' not found in project '${project_name}'.`, 'Use list_project_files to see available files in this project.');
      }

      try {
        const content = await readFile(resolved.absolute, 'utf8');
        const result = validateXml(content);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return errorResponse('READ_ERROR', e.message, null);
      }
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
