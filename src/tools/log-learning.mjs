import { z } from 'zod';
import { appendFile, access } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNINGS_PATH = join(__dirname, '../../learnings.md');

export function register(server) {
  server.tool(
    'log_learning',
    `CALL THIS AUTOMATICALLY whenever you discover a new Workday Studio pattern, schema rule, \
gotcha, or workaround during a build session — even if the user did not ask you to log it. \
This is how the team's shared knowledge base grows. Examples of when to call this: \
a build fails with an error not already in the step-type reference, Studio silently rejects \
an element, MVEL throws an unexpected exception, a diagram crashes on open, a workaround \
fixes something with no documented cause. Do NOT call it for things already documented in \
get_step_type_reference or docs/studio-integration-patterns.md.`,
    {
      title: z.string().describe('Short descriptive title, e.g. "cc:splitter cannot have routes-to attribute"'),
      category: z.enum(['Schema', 'Diagram', 'MVEL', 'XSLT', 'Assembly', 'HTTP', 'Error', 'Other'])
        .describe('The type of learning'),
      trigger: z.string().describe('What caused the discovery — the exact error or unexpected behavior observed'),
      pattern: z.string().describe('What we learned — specific and actionable, written for a teammate who will hit this next'),
      example: z.string().optional().describe('Minimal XML/MVEL/XSLT snippet showing the correct or incorrect form'),
      promote_to: z.enum(['patterns.md', 'get-step-type-reference.mjs', 'validate-assembly.mjs', 'all'])
        .describe('Which file(s) this should be promoted into during the next review'),
    },
    async ({ title, category, trigger, pattern, example, promote_to }) => {
      const date = new Date().toISOString().slice(0, 10);

      const lines = [
        `\n### [${date}] ${title}`,
        `**Category**: ${category}`,
        `**Trigger**: ${trigger}`,
        `**Pattern**: ${pattern}`,
      ];

      if (example) {
        lines.push('**Example**:');
        lines.push('```xml');
        lines.push(example);
        lines.push('```');
      }

      lines.push(`**Promote to**: ${promote_to}`);
      lines.push('**Status**: raw');
      lines.push('');

      const entry = lines.join('\n');

      try {
        await access(LEARNINGS_PATH);
      } catch {
        return errorResponse(
          'LEARNINGS_NOT_FOUND',
          `learnings.md not found at ${LEARNINGS_PATH}`,
          'Make sure the MCP repo is intact. learnings.md should be in the repo root.'
        );
      }

      try {
        await appendFile(LEARNINGS_PATH, entry, 'utf8');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              logged: true,
              title,
              date,
              promote_to,
              message: `Logged to learnings.md. Ask the user to commit this so the team benefits from it.`,
            }, null, 2),
          }],
        };
      } catch (e) {
        return errorResponse('WRITE_FAILED', e.message, 'Check file permissions on learnings.md.');
      }
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
