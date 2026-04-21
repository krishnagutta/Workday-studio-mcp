import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.mjs';

import { register as registerListProjects } from './tools/list-projects.mjs';
import { register as registerListFiles } from './tools/list-files.mjs';
import { register as registerReadFile } from './tools/read-file.mjs';
import { register as registerWriteFile } from './tools/write-file.mjs';
import { register as registerSearchFiles } from './tools/search-files.mjs';
import { register as registerWorkspaceTree } from './tools/workspace-tree.mjs';
import { register as registerValidateXml } from './tools/validate-xml.mjs';
import { register as registerCreateProject } from './tools/create-project.mjs';
import { register as registerListAssemblySteps } from './tools/list-assembly-steps.mjs';
import { register as registerListIntegrationParams } from './tools/list-integration-params.mjs';
import { register as registerAddAssemblyStep } from './tools/add-assembly-step.mjs';
import { register as registerCreateXslTransform } from './tools/create-xsl-transform.mjs';
import { register as registerCopyFileFromProject } from './tools/copy-file-from-project.mjs';
import { register as registerRenameFile } from './tools/rename-file.mjs';
import { register as registerDeleteFile } from './tools/delete-file.mjs';
import { register as registerGetStepTypeReference } from './tools/get-step-type-reference.mjs';
import { register as registerPlanIntegration } from './tools/plan-integration.mjs';
import { register as registerUpdateSubFlow } from './tools/update-sub-flow.mjs';
import { register as registerValidateAssembly } from './tools/validate-assembly.mjs';

const server = new McpServer({
  name: 'studio-file-mcp',
  version: '1.1.0',
});

// File navigation
registerListProjects(server);
registerListFiles(server);
registerReadFile(server);
registerWriteFile(server);
registerSearchFiles(server);
registerWorkspaceTree(server);
registerValidateXml(server);

// Project & file management
registerCreateProject(server);
registerCreateXslTransform(server);
registerCopyFileFromProject(server);
registerRenameFile(server);
registerDeleteFile(server);

// Assembly operations
registerListAssemblySteps(server);
registerListIntegrationParams(server);
registerAddAssemblyStep(server);

// Reference
registerGetStepTypeReference(server);

// Planning (call this before any assembly XML work)
registerPlanIntegration(server);

// Assembly editing
registerUpdateSubFlow(server);
registerValidateAssembly(server);

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(`[studio-mcp] Server started. Workspace: ${config.workspacePath}\n`);
