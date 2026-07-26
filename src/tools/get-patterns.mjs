import { z } from 'zod';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATTERNS_PATH = join(__dirname, '../../docs/studio-integration-patterns.md');

// ─── Public tool registration ─────────────────────────────────────────────────

export function register(server) {
  server.tool(
    'get_patterns',
    [
      'Serves the curated Studio knowledge base (docs/studio-integration-patterns.md) —',
      'hard-won cross-integration patterns that are NOT tied to a single step type.',
      '',
      'CALL THIS PROACTIVELY before:',
      '  • hand-editing assembly-diagram.xml (swimlanes, @mixed EMF XPath indices,',
      '    adding/removing/renaming diagram nodes, send-error placement) — the',
      '    "Diagram Rules" section is the single largest body of gotchas and every',
      '    rule prevents a scala.MatchError crash on diagram open',
      '  • writing MVEL, XSLT, RAAS, outbound-HTTP, or document-storage logic',
      '  • diagnosing a server log or a Common Error',
      '',
      'get_step_type_reference covers a SINGLE element; get_patterns covers the',
      'cross-cutting rules that span elements (diagram index math, swimlane layout,',
      'the three-entry add/remove rule, the verification script, MVEL idioms, etc.).',
      '',
      'USAGE:',
      '  • No arguments      → an index of every section and subsection (titles only).',
      '                        Start here, then drill in.',
      '  • topic="Diagram Rules"        → the full section (## or ### heading, partial',
      '                        match ok, case-insensitive).',
      '  • topic="Insertion shift rule" → a single subsection.',
      '  • search="swimlane"  → every subsection whose heading or body mentions the term.',
    ].join('\n'),
    {
      topic: z.string().optional()
        .describe('A section or subsection title to retrieve (e.g. "Diagram Rules", "Swimlane layout template"). Partial, case-insensitive. Omit to get the index.'),
      search: z.string().optional()
        .describe('Keyword to find across the whole knowledge base — returns each matching subsection. Takes precedence over topic when both are given.'),
    },
    async ({ topic, search } = {}) => {
      if (!existsSync(PATTERNS_PATH)) {
        return errorResponse(
          'PATTERNS_NOT_FOUND',
          `docs/studio-integration-patterns.md not found at ${PATTERNS_PATH}`,
          'The curated knowledge base ships with the repo. Ensure the studio-mcp clone is intact.',
        );
      }

      const md = await readFile(PATTERNS_PATH, 'utf8');
      const doc = parseDoc(md);

      if (search && search.trim()) {
        return successText(runSearch(doc, search.trim()));
      }
      if (topic && topic.trim()) {
        return successText(runTopic(doc, topic.trim()));
      }
      return successText(renderIndex(doc));
    },
  );
}

// ─── Markdown model ───────────────────────────────────────────────────────────
//
// Parse the doc into level-2 sections, each with level-3 subsections. Headings
// inside fenced code blocks are ignored so a `#` comment in a bash/xml example
// is never mistaken for a heading.

export function parseDoc(md) {
  const lines = md.split('\n');
  const nodes = []; // flat list of { level, title, line }
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(##|###)\s+(.*\S)\s*$/.exec(line);
    if (m) nodes.push({ level: m[1].length, title: m[2].trim(), line: i });
  }

  const sections = [];
  for (let k = 0; k < nodes.length; k++) {
    const node = nodes[k];
    const bodyEnd = k + 1 < nodes.length ? nodes[k + 1].line : lines.length;
    node.bodyEnd = bodyEnd;
    if (node.level === 2) {
      sections.push({ ...node, subsections: [] });
    } else if (sections.length) {
      sections[sections.length - 1].subsections.push(node);
    }
  }
  return { lines, nodes, sections };
}

// End of a heading's own span (up to the next heading of same-or-higher level).
function spanEnd(doc, node) {
  for (const n of doc.nodes) {
    if (n.line > node.line && n.level <= node.level) return n.line;
  }
  return doc.lines.length;
}

function slice(doc, node) {
  return doc.lines.slice(node.line, spanEnd(doc, node)).join('\n').trim();
}

const norm = (s) => s.toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();

// ─── Index ────────────────────────────────────────────────────────────────────

export function renderIndex(doc) {
  const out = ['# Studio patterns — index', '',
    'Curated cross-integration knowledge base. Call `get_patterns` again with',
    '`topic="<section or subsection title>"` for the full text, or `search="<term>"`.',
    ''];
  for (const s of doc.sections) {
    if (norm(s.title) === 'table of contents') continue;
    out.push(`## ${s.title}`);
    for (const sub of s.subsections) out.push(`  - ${sub.title}`);
    out.push('');
  }
  return out.join('\n');
}

// ─── Topic retrieval ────────────────────────────────────────────────────────────

export function runTopic(doc, topic) {
  const q = norm(topic);
  const exact = doc.nodes.filter(n => norm(n.title) === q);
  const partial = doc.nodes.filter(n => norm(n.title).includes(q));
  const hits = exact.length ? exact : partial;

  if (hits.length === 0) {
    return `No section or subsection matches "${topic}".\n\n${renderIndex(doc)}`;
  }
  if (hits.length > 1 && exact.length !== 1) {
    const titles = hits.map(h => `  - ${h.title}${h.level === 2 ? '  (section)' : ''}`).join('\n');
    return `"${topic}" matches ${hits.length} headings — retrieve one specifically:\n${titles}`;
  }
  return slice(doc, hits[0]);
}

// ─── Search ─────────────────────────────────────────────────────────────────────

export function runSearch(doc, term) {
  const q = term.toLowerCase();
  const leaves = doc.nodes.filter(n =>
    norm(n.title) !== 'table of contents' &&
    (n.level === 3 || !doc.sections.find(s => s.line === n.line)?.subsections.length),
  );
  const matches = [];
  for (const node of leaves) {
    const body = slice(doc, node);
    if (body.toLowerCase().includes(q)) matches.push({ node, body });
  }

  if (matches.length === 0) {
    return `No subsection mentions "${term}". Try \`get_patterns\` with no arguments to see the index.`;
  }
  const MAX = 8;
  const shown = matches.slice(0, MAX);
  const header = matches.length > MAX
    ? `${matches.length} subsections mention "${term}" — showing the first ${MAX}. Narrow with a more specific term or use topic=.\n`
    : `${matches.length} subsection${matches.length === 1 ? '' : 's'} mention "${term}":\n`;
  return header + '\n' + shown.map(m => m.body).join('\n\n---\n\n');
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function successText(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
