import { z } from 'zod';
import { extname, dirname } from 'path';
import { existsSync } from 'fs';
import { resolveSafe, writeFileSafe } from '../fs.mjs';
import { validateXml } from '../xml.mjs';
import { config } from '../config.mjs';

const XML_EXTENSIONS = new Set(['.xsl', '.xslt', '.xml', '.wsdl', '.xsd']);

export function register(server) {
  server.tool(
    'write_integration_file',
    'Write or update a file in a Studio project. Validates XML well-formedness before writing. Creates a .bak backup by default.',
    {
      project_name: z.string().describe('The Studio project name'),
      file_path: z.string().describe('Path to the file relative to the project root'),
      content: z.string().describe('The file content to write'),
      create_backup: z.boolean().optional().describe('Create a .bak backup of the existing file before overwriting. Defaults to the server config setting.'),
    },
    async ({ project_name, file_path, content, create_backup }) => {
      if (file_path.endsWith('.bak')) {
        return errorResponse('WRITE_FAILED', 'Writing to .bak files is not allowed.', 'Use the original file path instead.');
      }

      let resolved;
      try {
        resolved = resolveSafe(project_name, file_path);
      } catch (e) {
        if (e.code === 'PATH_TRAVERSAL_DETECTED') {
          return errorResponse('PATH_TRAVERSAL_DETECTED', e.message, 'Use relative paths within the project directory only.');
        }
        return errorResponse('RESOLVE_ERROR', e.message, null);
      }

      const parentDir = dirname(resolved.absolute);
      if (!existsSync(parentDir)) {
        return errorResponse('WRITE_FAILED', `Directory does not exist: ${dirname(file_path)}`, 'The target directory must already exist. Use list_project_files to confirm the path.');
      }

      const ext = extname(file_path).toLowerCase();
      if (XML_EXTENSIONS.has(ext)) {
        const validation = validateXml(content);
        if (!validation.valid) {
          return errorResponse('INVALID_XML', 'Content is not well-formed XML.', null, { xml_errors: validation.errors });
        }
      }

      const shouldBackup = create_backup ?? config.backupOnWrite;

      try {
        const result = await writeFileSafe(resolved.absolute, content, shouldBackup);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              bytes_written: result.bytes_written,
              backup_path: result.backup_path ? file_path + '.bak' : null,
            }, null, 2),
          }],
        };
      } catch (e) {
        return errorResponse('WRITE_FAILED', e.message, null);
      }
    }
  );
}

function errorResponse(code, message, suggestion, extra = {}) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion, ...extra }) }] };
}
