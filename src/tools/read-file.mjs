import { z } from 'zod';
import { extname } from 'path';
import { existsSync } from 'fs';
import { resolveSafe, readFileSafe } from '../fs.mjs';

export function register(server) {
  server.tool(
    'read_integration_file',
    'Read the content of a specific file in a Studio project. Use list_project_files first to find the correct path.',
    {
      project_name: z.string().describe('The Studio project name (e.g. INT002_Lyft_CW_Onboarding)'),
      file_path: z.string().describe('Path to the file relative to the project root (e.g. ws/WSAR-INF/address-transform.xsl)'),
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
        const { content, size_bytes, last_modified } = await readFileSafe(resolved.absolute);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              content,
              size_bytes,
              last_modified,
              file_type: extname(file_path).toLowerCase().replace('.', ''),
            }, null, 2),
          }],
        };
      } catch (e) {
        if (e.code === 'FILE_TOO_LARGE') {
          return errorResponse('FILE_TOO_LARGE', e.message, 'Use search_studio_files to find specific sections instead.');
        }
        return errorResponse('READ_ERROR', e.message, null);
      }
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
