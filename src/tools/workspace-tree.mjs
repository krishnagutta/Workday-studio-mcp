import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import { join, extname } from 'path';
import { findProject, listProjects } from '../fs.mjs';
import { config } from '../config.mjs';

export function register(server) {
  server.tool(
    'get_workspace_structure',
    'Get the directory tree of the workspace or a specific project. Useful for understanding the layout before reading files.',
    {
      project_name: z.string().optional().describe('Show structure for a specific project. Omit to see all projects.'),
    },
    async ({ project_name }) => {
      try {
        if (project_name) {
          const projectPath = await findProject(project_name);
          if (!projectPath) {
            return errorResponse('PROJECT_NOT_FOUND', `Project '${project_name}' not found.`, 'Use list_studio_projects to see available projects.');
          }
          const tree = await buildTree(projectPath, 0);
          return { content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }] };
        }

        const projects = await listProjects();
        const children = await Promise.all(projects.map(p => buildTree(p.path, 0)));
        const tree = { name: 'Studio Workspace', type: 'directory', children };
        return { content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }] };
      } catch (e) {
        return errorResponse('READ_ERROR', e.message, null);
      }
    }
  );
}

async function buildTree(dirPath, depth) {
  const MAX_DEPTH = 6;
  const s = await stat(dirPath);
  const name = dirPath.split('/').pop();

  if (!s.isDirectory()) {
    return { name, type: 'file', size_bytes: s.size };
  }

  const node = { name, type: 'directory' };

  if (depth >= MAX_DEPTH) {
    node.truncated = true;
    return node;
  }

  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const children = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (config.excludedDirs.has(entry.name)) continue;

    const childPath = join(dirPath, entry.name);
    const ext = extname(entry.name).toLowerCase();

    if (entry.isDirectory()) {
      children.push(await buildTree(childPath, depth + 1));
    } else {
      if (config.excludedExtensions.has(ext)) continue;
      const cs = await stat(childPath);
      children.push({ name: entry.name, type: 'file', size_bytes: cs.size });
    }
  }

  if (children.length > 0) node.children = children;
  return node;
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
