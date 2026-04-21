import { z } from 'zod';
import { readFile, writeFile, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.mjs';
import { validateXml } from '../xml.mjs';

const STEP_TYPE_SCHEMAS = {
  'transform': (id, routesTo, opts) => `\n\t\t<cc:transform id="${id}" routes-to="${routesTo}">\n\t\t\t<cc:xslt href="${opts.xsl_file || id + '.xsl'}"/>\n\t\t</cc:transform>`,
  'xslt-plus': (id, routesTo, opts) => `\n\t\t<cc:xslt-plus id="${id}" routes-to="${routesTo}" output-mimetype="${opts.output_mimetype || 'text/xml'}" url="${opts.xsl_file || id + '.xsl'}"/>`,
  'http-out': (id, routesTo, opts) => `\n\t\t<cc:http-out id="${id}" routes-response-to="${routesTo}">\n\t\t\t<cc:url>${opts.url || 'https://example.com/api'}</cc:url>\n\t\t\t<cc:method>${opts.method || 'POST'}</cc:method>\n\t\t</cc:http-out>`,
  'local-out': (id, routesTo, opts) => `\n\t\t<cc:local-out id="${id}" store-message="none" routes-response-to="${routesTo}" endpoint="${opts.endpoint || 'vm://ENDPOINT'}">${opts.file_name ? `\n\t\t\t<cc:set name="is.document.file.name"   value="'${opts.file_name}'"/>\n\t\t\t<cc:set name="is.document.deliverable" value="'true'"/>` : ''}\n\t\t</cc:local-out>`,
  'local-in': (id, routesTo, _opts) => `\n\t\t<cc:local-in id="${id}" routes-to="${routesTo}"/>`,
  'workday-out-rest': (id, routesTo, opts) => `\n\t\t<cc:workday-out-rest id="${id}" routes-response-to="${routesTo}" extra-path="${opts.extra_path || ''}"/>`,
  'workday-out-soap': (id, routesTo, opts) => `\n\t\t<cc:workday-out-soap id="${id}" routes-response-to="${routesTo}" application="${opts.application || 'Human_Resources'}" version="${opts.version || 'v40.0'}"/>`,
  'async-mediation': (id, routesTo, _opts) => `\n\t\t<cc:async-mediation id="${id}" routes-to="${routesTo}"/>`,
  'decision': (id, _routesTo, opts) => {
    const branches = (opts.branches || [{ condition: "/* condition */", routes_to: 'NextStep' }]);
    const routes = branches.map(b =>
      b.condition
        ? `\n\t\t\t\t<cc:route condition="${b.condition}" routes-to="${b.routes_to}"/>`
        : `\n\t\t\t\t<cc:route routes-to="${b.routes_to}"/>`
    ).join('');
    return `\n\t\t<cc:decision id="${id}">\n\t\t\t<cc:routes>${routes}\n\t\t\t</cc:routes>\n\t\t</cc:decision>`;
  },
  'splitter': (id, routesTo, opts) => `\n\t\t<cc:splitter id="${id}" no-split-message-error="false">\n\t\t\t<cc:sub-route name="SubRoute" routes-to="${routesTo}"/>\n\t\t\t<cc:xpath-splitter xpath="${opts.xpath || 'wd:Report_Data/wd:Report_Entry'}"/>\n\t\t</cc:splitter>`,
  'sub-assembly': (id, routesTo, opts) => `\n\t\t<cc:sub-assembly id="${id}" routes-to="${routesTo}" href="${opts.href || 'sub-assembly.xml'}"/>`,
  'workday-report': (id, routesTo, opts) => `\n\t\t<cc:workday-out-rest id="${id}" routes-response-to="${routesTo}" extra-path="${opts.extra_path || ''}"/>`,
  'note': (id, _routesTo, opts) => `\n\t\t<cc:note id="${id}">\n\t\t\t<cc:description>${opts.description || 'TODO'}</cc:description>\n\t\t</cc:note>`,
  'send-error': (id, routesTo, opts) => `\n\t\t<cc:send-error id="${id}" routes-to="${routesTo}" rethrow-error="${opts.rethrow_error || 'false'}"/>`,
  'log-error': (id, _routesTo, opts) => `\n\t\t<cc:log-error id="${id}" level="${opts.level || 'error'}" rethrow-error="${opts.rethrow_error || 'false'}"/>`,
  'xml-to-csv': (id, _routesTo, opts) => `\n\t\t<cc:xml-to-csv id="${id}" separator="${opts.separator || ','}" line-separator="${opts.line_separator || 'LF'}" writeHeaderLine="${opts.write_header_line || 'true'}" format="${opts.format || 'rfc4180'}"/>`,
  'csv-to-xml': (id, _routesTo, opts) => `\n\t\t<cc:csv-to-xml id="${id}" separator="${opts.separator || ','}" useFirstLineAsHeader="${opts.use_first_line_as_header || 'true'}" rootName="${opts.root_name || 'Root'}" rowName="${opts.row_name || 'Row'}" format="${opts.format || 'rfc4180'}"/>`,
};

export function register(server) {
  server.tool(
    'add_assembly_step',
    'Insert a new step into assembly.xml. Optionally wire it after an existing step (updates the predecessor\'s routes-to automatically). The new step inherits the predecessor\'s original routes-to as its own routes-to.',
    {
      project_name: z.string().describe('The Studio project name'),
      step_id: z.string().describe('Unique ID for the new step (e.g. "TransformWorkerData")'),
      step_type: z.enum([
        'transform', 'xslt-plus', 'http-out', 'local-out', 'local-in',
        'workday-out-rest', 'workday-out-soap', 'async-mediation', 'decision', 'splitter',
        'sub-assembly', 'workday-report', 'note', 'send-error', 'log-error',
        'xml-to-csv', 'csv-to-xml',
      ]).describe('The cc: step type to add'),
      after_step_id: z.string().optional().describe('Insert after this existing step and rewire its routes-to. Omit to append before </cc:assembly>.'),
      routes_to: z.string().optional().describe('Override what this step routes to. If after_step_id is set, defaults to the predecessor\'s current routes-to.'),
      options: z.record(z.string()).optional().describe('Step-specific options. Common: xsl_file, url, method, xpath, href, endpoint, description, output_mimetype, extra_path, branches (JSON array). workday-out-soap: application, version. send-error/log-error: rethrow_error, level. xml-to-csv: separator, line_separator, write_header_line, format. csv-to-xml: separator, use_first_line_as_header, root_name, row_name, format.'),
    },
    async ({ project_name, step_id, step_type, after_step_id, routes_to, options = {} }) => {
      const assemblyPath = resolve(config.workspacePath, project_name, 'ws', 'WSAR-INF', 'assembly.xml');
      if (!existsSync(assemblyPath)) {
        return errorResponse('FILE_NOT_FOUND', `No assembly.xml found in project '${project_name}'.`, null);
      }

      let xml = await readFile(assemblyPath, 'utf8');

      // Check for duplicate ID
      if (new RegExp(`id="${step_id}"`).test(xml)) {
        return errorResponse('DUPLICATE_ID', `A step with id="${step_id}" already exists in the assembly.`, 'Choose a different step ID.');
      }

      let effectiveRoutesTo = routes_to || 'End';

      // Wire after predecessor
      if (after_step_id) {
        const predecessorRouteMatch = xml.match(new RegExp(`(<cc:[\\w-]+[^>]*id="${after_step_id}"[^>]*?)(routes-to|routes-response-to)="([^"]+)"`));
        if (!predecessorRouteMatch) {
          return errorResponse('STEP_NOT_FOUND', `Step with id="${after_step_id}" not found or has no routes-to attribute.`, 'Use list_assembly_steps to see valid step IDs.');
        }
        const routingAttr = predecessorRouteMatch[2];
        effectiveRoutesTo = routes_to || predecessorRouteMatch[3];
        // Rewire predecessor to point to new step
        xml = xml.replace(
          new RegExp(`(id="${after_step_id}"[^>]*?)${routingAttr}="[^"]+"`),
          `$1${routingAttr}="${step_id}"`
        );
      }

      // Generate new step XML
      const builder = STEP_TYPE_SCHEMAS[step_type];
      const newStepXml = builder(step_id, effectiveRoutesTo, options);

      // Insert before closing </cc:assembly>
      xml = xml.replace('</cc:assembly>', `${newStepXml}\n\t</cc:assembly>`);

      // Validate before writing
      const validation = validateXml(xml);
      if (!validation.valid) {
        return errorResponse('INVALID_XML', 'Generated assembly XML failed validation.', null, { xml_errors: validation.errors });
      }

      // Backup and write
      if (config.backupOnWrite) {
        await copyFile(assemblyPath, assemblyPath + '.bak');
      }
      await writeFile(assemblyPath, xml, 'utf8');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            step_added: { id: step_id, type: `cc:${step_type}`, routes_to: effectiveRoutesTo },
            predecessor_rewired: after_step_id || null,
          }, null, 2),
        }],
      };
    }
  );
}

function errorResponse(code, message, suggestion, extra = {}) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion, ...extra }) }] };
}
