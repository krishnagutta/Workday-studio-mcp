import { z } from 'zod';
import { rename } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, extname } from 'path';
import { config } from '../config.mjs';

// Files that are structurally required — never rename these
const PROTECTED_FILES = new Set(['assembly.xml', 'assembly-diagram.xml', '.project', '.classpath']);

export function register(server) {
  server.tool(
    'rename_file',
    'Rename a file within a Studio project. Cannot rename assembly.xml, assembly-diagram.xml, .project, or .classpath.',
    {
      project_name: z.string().describe('The Studio project name'),
      old_path: z.string().describe('Current file path relative to project root (e.g. ws/WSAR-INF/OldName.xsl)'),
      new_path: z.string().describe('New file path relative to project root (e.g. ws/WSAR-INF/NewName.xsl)'),
    },
    async ({ project_name, old_path, new_path }) => {
      const fileName = old_path.split('/').pop();
      if (PROTECTED_FILES.has(fileName)) {
        return errorResponse('PROTECTED_FILE', `Cannot rename '${fileName}' — it is required for the project to function in Eclipse.`, null);
      }

      const sourcePath = resolve(config.workspacePath, project_name, old_path);
      const destPath = resolve(config.workspacePath, project_name, new_path);

      // Path traversal checks
      if (!sourcePath.startsWith(config.workspacePath + '/')) {
        return errorResponse('PATH_TRAVERSAL_DETECTED', 'Source path escapes workspace.', null);
      }
      if (!destPath.startsWith(config.workspacePath + '/')) {
        return errorResponse('PATH_TRAVERSAL_DETECTED', 'Destination path escapes workspace.', null);
      }

      if (!existsSync(sourcePath)) {
        return errorResponse('FILE_NOT_FOUND', `File '${old_path}' not found in project '${project_name}'.`, 'Use list_project_files to see available files.');
      }
      if (existsSync(destPath)) {
        return errorResponse('FILE_EXISTS', `A file already exists at '${new_path}'.`, 'Choose a different name or delete the existing file first.');
      }

      await rename(sourcePath, destPath);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            renamed_from: old_path,
            renamed_to: new_path,
            reminder: 'If this file is referenced in assembly.xml (e.g. as a cc:xslt href), update that reference with write_integration_file.',
          }, null, 2),
        }],
      };
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
