import { z } from 'zod';
import { resolve, join, extname } from 'path';
import { stat } from 'fs/promises';
import { findProject, walkDir, relativeFromProject } from '../fs.mjs';
import { config } from '../config.mjs';

export function register(server) {
  server.tool(
    'list_project_files',
    'List all integration files in a specific Studio project. Focuses on ws/WSAR-INF/ where transforms and assembly files live.',
    {
      project_name: z.string().describe('The name of the Studio integration project (e.g. INT001_Sample_Integration)'),
      file_type: z.enum(['xsl', 'xml', 'all']).optional().describe('Filter by file type: "xsl" for transforms, "xml" for XML/assembly files, "all" for all integration files. Defaults to "all".'),
    },
    async ({ project_name, file_type = 'all' }) => {
      const projectPath = await findProject(project_name);
      if (!projectPath) {
        return errorResponse('PROJECT_NOT_FOUND', `Project '${project_name}' not found.`, 'Use list_studio_projects to see available projects.');
      }

      try {
        const files = await walkDir(projectPath, { fileTypeFilter: file_type });
        const results = await Promise.all(files.map(async (f) => {
          const s = await stat(f);
          return {
            path: relativeFromProject(projectPath, f),
            size_bytes: s.size,
            last_modified: s.mtime.toISOString(),
            extension: extname(f).toLowerCase(),
          };
        }));

        results.sort((a, b) => a.path.localeCompare(b.path));
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (e) {
        return errorResponse('READ_ERROR', e.message, null);
      }
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
