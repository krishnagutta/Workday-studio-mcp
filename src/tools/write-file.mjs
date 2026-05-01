import { z } from 'zod';
import { extname, dirname, basename, join } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolveSafe, writeFileSafe } from '../fs.mjs';
import { validateXml } from '../xml.mjs';
import { validateAssembly, checkDiagramDrift } from '../assembly-validator.mjs';
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

      let writeResult;
      try {
        writeResult = await writeFileSafe(resolved.absolute, content, shouldBackup);
      } catch (e) {
        return errorResponse('WRITE_FAILED', e.message, null);
      }

      const response = {
        success: true,
        bytes_written: writeResult.bytes_written,
        backup_path: writeResult.backup_path
          ? writeResult.backup_path.replace(resolved.projectRoot + '/', '')
          : null,
      };

      // Run Studio-specific validation + diagram drift check whenever assembly.xml is written
      if (basename(resolved.absolute) === 'assembly.xml') {
        const wsDir = dirname(resolved.absolute);
        const issues = validateAssembly(content, wsDir);
        const errors   = issues.filter(i => i.severity === 'ERROR');
        const warnings = issues.filter(i => i.severity === 'WARNING');
        response.validation = {
          clean: issues.length === 0,
          errors: errors.length,
          warnings: warnings.length,
          issues: issues.length > 0 ? issues : undefined,
        };

        const diagramPath = join(wsDir, 'assembly-diagram.xml');
        if (existsSync(diagramPath)) {
          const diagramXml = await readFile(diagramPath, 'utf8').catch(() => null);
          if (diagramXml) {
            const drifted = checkDiagramDrift(content, diagramXml);
            if (drifted.length > 0) {
              response.diagram_drift = {
                warning: `${drifted.length} element(s) in assembly.xml have no matching entry in assembly-diagram.xml. Open Studio to verify the diagram, or update assembly-diagram.xml before the next Studio open.`,
                missing_from_diagram: drifted.map(d => `${d.tag} id="${d.id}"`),
              };
            }
          }
        }

        if (errors.length > 0) {
          response.next_step = 'Fix the ERRORs above before opening in Studio.';
        } else if (response.diagram_drift) {
          response.next_step = 'Assembly XML is valid. Update assembly-diagram.xml to add the missing diagram entries.';
        } else {
          response.next_step = 'Assembly XML is valid. Open in Studio to verify.';
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}

function errorResponse(code, message, suggestion, extra = {}) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion, ...extra }) }] };
}
