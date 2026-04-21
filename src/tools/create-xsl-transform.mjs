import { z } from 'zod';
import { writeFile, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { config } from '../config.mjs';

export function register(server) {
  server.tool(
    'create_xsl_transform',
    'Scaffold a new blank XSLT 2.0 transform file in a project\'s ws/WSAR-INF/ directory. Creates the file with the correct Workday namespace declarations and a stub root template ready to edit.',
    {
      project_name: z.string().describe('The Studio project name'),
      file_name: z.string().describe('File name without path (e.g. "TransformWorkerData.xsl"). Will be placed in ws/WSAR-INF/.'),
      description: z.string().optional().describe('A comment describing what this transform does. Included in the file header.'),
      input_namespace: z.string().optional().describe('Primary input XML namespace to match. Defaults to urn:com.workday/bsvc (Workday SOAP).'),
      output_type: z.enum(['xml', 'json', 'text']).optional().describe('Output method for the transform. Defaults to "xml".'),
    },
    async ({ project_name, file_name, description, input_namespace, output_type = 'xml' }) => {
      if (!file_name.endsWith('.xsl') && !file_name.endsWith('.xslt')) {
        return errorResponse('INVALID_FILE_NAME', 'File name must end with .xsl or .xslt.', null);
      }

      const targetPath = resolve(config.workspacePath, project_name, 'ws', 'WSAR-INF', file_name);

      if (!existsSync(resolve(config.workspacePath, project_name))) {
        return errorResponse('PROJECT_NOT_FOUND', `Project '${project_name}' not found.`, 'Use list_studio_projects to see available projects.');
      }

      if (existsSync(targetPath)) {
        return errorResponse('FILE_EXISTS', `File '${file_name}' already exists in ws/WSAR-INF/.`, 'Use read_integration_file to view it, or write_integration_file to update it.');
      }

      const content = buildXslTemplate({ file_name, description, input_namespace, output_type });
      await writeFile(targetPath, content, 'utf8');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            file_path: `ws/WSAR-INF/${file_name}`,
            bytes_written: Buffer.byteLength(content, 'utf8'),
            next_steps: `Use write_integration_file to add transform logic, or add_assembly_step with type "transform" and xsl_file "${file_name}" to wire it into the assembly.`,
          }, null, 2),
        }],
      };
    }
  );
}

function buildXslTemplate({ file_name, description, input_namespace = 'urn:com.workday/bsvc', output_type }) {
  const outputMethod = output_type === 'json' ? 'text' : output_type;
  const desc = description ? `\n\t<!-- ${description} -->` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Transform: ${file_name}${description ? '\n  Description: ' + description : ''}
-->
<xsl:stylesheet version="2.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:wd="${input_namespace}"
  xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  exclude-result-prefixes="xs">

  <xsl:output method="${outputMethod}" encoding="UTF-8" indent="yes"/>
  <xsl:strip-space elements="*"/>
${desc}
  <!-- Entry point: matches the root of the input document -->
  <xsl:template match="/">
    <!-- TODO: implement transform logic -->
    <xsl:apply-templates/>
  </xsl:template>

</xsl:stylesheet>
`;
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
