import { z } from 'zod';
import { copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';
import { config } from '../config.mjs';

export function register(server) {
  server.tool(
    'copy_file_from_project',
    'Copy a file (typically an XSL transform) from one Studio project into another. The most common starting point when building a new integration based on an existing pattern.',
    {
      source_project: z.string().describe('The project to copy from'),
      source_file_path: z.string().describe('File path relative to source project root (e.g. ws/WSAR-INF/GetWorkersWS.xsl)'),
      target_project: z.string().describe('The project to copy into'),
      target_file_path: z.string().optional().describe('Destination path relative to target project root. Defaults to the same relative path as the source.'),
    },
    async ({ source_project, source_file_path, target_project, target_file_path }) => {
      const sourcePath = resolve(config.workspacePath, source_project, source_file_path);
      const destRelative = target_file_path || source_file_path;
      const destPath = resolve(config.workspacePath, target_project, destRelative);

      // Safety: both paths must stay inside workspace
      if (!sourcePath.startsWith(config.workspacePath + '/')) {
        return errorResponse('PATH_TRAVERSAL_DETECTED', 'Source path escapes workspace.', null);
      }
      if (!destPath.startsWith(config.workspacePath + '/')) {
        return errorResponse('PATH_TRAVERSAL_DETECTED', 'Target path escapes workspace.', null);
      }

      if (!existsSync(resolve(config.workspacePath, source_project))) {
        return errorResponse('PROJECT_NOT_FOUND', `Source project '${source_project}' not found.`, 'Use list_studio_projects to see available projects.');
      }
      if (!existsSync(sourcePath)) {
        return errorResponse('FILE_NOT_FOUND', `File '${source_file_path}' not found in project '${source_project}'.`, 'Use list_project_files to see available files.');
      }
      if (!existsSync(resolve(config.workspacePath, target_project))) {
        return errorResponse('PROJECT_NOT_FOUND', `Target project '${target_project}' not found.`, 'Use create_studio_project to create it first.');
      }

      const overwriting = existsSync(destPath);
      await copyFile(sourcePath, destPath);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            copied_to: destRelative,
            in_project: target_project,
            overwritten: overwriting,
          }, null, 2),
        }],
      };
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
