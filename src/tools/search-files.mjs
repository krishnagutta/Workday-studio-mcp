import { z } from 'zod';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { extname } from 'path';
import { findProject, listProjects, walkDir, relativeFromProject } from '../fs.mjs';
import { resolve } from 'path';
import { config } from '../config.mjs';

export function register(server) {
  server.tool(
    'search_studio_files',
    'Full-text search across Studio project files. Searches line-by-line for a plain string (case-insensitive). Useful for finding where a specific Workday field, function, or namespace is used.',
    {
      query: z.string().describe('The string to search for (case-insensitive)'),
      project_name: z.string().optional().describe('Limit search to a specific project. Omit to search all projects.'),
      file_type: z.enum(['xsl', 'xml', 'all']).optional().describe('Filter by file type. Defaults to "all".'),
      max_results: z.number().int().min(1).max(100).optional().describe('Maximum number of matches to return. Defaults to 20.'),
    },
    async ({ query, project_name, file_type = 'all', max_results = 20 }) => {
      const queryLower = query.toLowerCase();
      const matches = [];

      let projectList;
      if (project_name) {
        const projectPath = await findProject(project_name);
        if (!projectPath) {
          return errorResponse('PROJECT_NOT_FOUND', `Project '${project_name}' not found.`, 'Use list_studio_projects to see available projects.');
        }
        projectList = [{ name: project_name, path: projectPath }];
      } else {
        const all = await listProjects();
        projectList = all.map(p => ({ name: p.name, path: p.path }));
      }

      for (const project of projectList) {
        if (matches.length >= max_results) break;

        const files = await walkDir(project.path, { fileTypeFilter: file_type });
        for (const filePath of files) {
          if (matches.length >= max_results) break;
          if (filePath.endsWith('.bak')) continue;

          const fileMatches = await searchFile(filePath, queryLower, max_results - matches.length);
          for (const m of fileMatches) {
            matches.push({
              project: project.name,
              file_path: relativeFromProject(project.path, filePath),
              line_number: m.line_number,
              line_content: m.line_content,
            });
          }
        }
      }

      return { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] };
    }
  );
}

async function searchFile(filePath, queryLower, limit) {
  return new Promise((resolve) => {
    const matches = [];
    let lineNum = 0;
    let done = false;

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (done) return;
      lineNum++;
      if (line.toLowerCase().includes(queryLower)) {
        matches.push({
          line_number: lineNum,
          line_content: line.length > 200 ? line.slice(0, 200) + '…' : line,
        });
        if (matches.length >= limit) {
          done = true;
          rl.close();
        }
      }
    });

    rl.on('close', () => resolve(matches));
    rl.on('error', () => resolve(matches));
  });
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
