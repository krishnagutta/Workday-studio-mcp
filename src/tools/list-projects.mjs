import { z } from 'zod';
import { listProjects } from '../fs.mjs';

export function register(server) {
  server.tool(
    'list_studio_projects',
    'List all Workday Studio integration projects in the Eclipse workspace. Returns project names, paths, last modified times, and transform counts.',
    {},
    async () => {
      try {
        const projects = await listProjects();
        return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
      } catch (e) {
        return errorResponse('WORKSPACE_ERROR', e.message, 'Check that the workspace path is configured correctly.');
      }
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
