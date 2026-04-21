import { z } from 'zod';
import { unlink, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.mjs';

// Files that must never be deleted
const PROTECTED_FILES = new Set(['assembly.xml', 'assembly-diagram.xml', '.project', '.classpath']);

export function register(server) {
  server.tool(
    'delete_file',
    'Delete a file from a Studio project. Creates a .bak backup before deleting by default. Cannot delete assembly.xml, assembly-diagram.xml, .project, or .classpath.',
    {
      project_name: z.string().describe('The Studio project name'),
      file_path: z.string().describe('File path relative to project root (e.g. ws/WSAR-INF/OldTransform.xsl)'),
      create_backup: z.boolean().optional().describe('Write a .bak copy before deleting. Defaults to true.'),
    },
    async ({ project_name, file_path, create_backup = true }) => {
      const fileName = file_path.split('/').pop();
      if (PROTECTED_FILES.has(fileName)) {
        return errorResponse('PROTECTED_FILE', `Cannot delete '${fileName}' — it is required for the project to function in Eclipse.`, null);
      }
      if (file_path.endsWith('.bak')) {
        return errorResponse('PROTECTED_FILE', 'Cannot delete .bak backup files via this tool.', null);
      }

      const absolutePath = resolve(config.workspacePath, project_name, file_path);
      if (!absolutePath.startsWith(config.workspacePath + '/')) {
        return errorResponse('PATH_TRAVERSAL_DETECTED', 'Path escapes workspace.', null);
      }
      if (!existsSync(absolutePath)) {
        return errorResponse('FILE_NOT_FOUND', `File '${file_path}' not found in project '${project_name}'.`, 'Use list_project_files to see available files.');
      }

      let backupPath = null;
      if (create_backup) {
        backupPath = absolutePath + '.bak';
        await copyFile(absolutePath, backupPath);
      }

      await unlink(absolutePath);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            deleted: file_path,
            backup_path: backupPath ? file_path + '.bak' : null,
          }, null, 2),
        }],
      };
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
