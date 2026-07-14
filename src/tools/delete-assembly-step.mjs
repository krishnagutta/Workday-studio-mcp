import { z } from 'zod';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { config } from '../config.mjs';
import { backupFile, writeFileSafe } from '../fs.mjs';
import { validateAssembly } from '../assembly-validator.mjs';

// ─── Public tool registration ─────────────────────────────────────────────────

export function register(server) {
  server.tool(
    'delete_assembly_step',
    [
      'Atomically deletes a step from BOTH assembly.xml AND assembly-diagram.xml.',
      '',
      'WHY THIS EXISTS:',
      '  Removing an element from assembly.xml alone leaves dangling diagram href',
      '  references (element/source/target/elements), which crash Studio with',
      '  scala.MatchError when the diagram opens. This tool mirrors the removal',
      '  across both files in a single operation:',
      '',
      '  assembly.xml         — the element block itself (self-closing or paired tag)',
      '  assembly-diagram.xml — the visualProperties block wrapping the element href,',
      '                         every connections block whose source OR target points',
      '                         at the deleted step (by id OR by @mixed positional ref),',
      '                         and swimlane elements membership lines',
      '',
      '  For a TOP-LEVEL element it also re-numbers all higher @mixed positional',
      '  indices in the diagram by -2 (removing one element plus its preceding',
      '  whitespace shifts every subsequent EMF XPath index down by two).',
      '',
      'SAFETY:',
      '  Refuses to delete a step that other steps still route to (routes-to,',
      '  routes-response-to, or a vm:// endpoint naming a cc:local-in) unless',
      "  force=true — rewire or delete the callers first, or pass force and fix",
      '  the reported references afterwards.',
      '',
      'Creates backups of both files before writing. Runs validate_assembly after.',
      '',
      'BATCH DELETES: call once per step ID — do not batch multiple deletes into one call.',
    ].join('\n'),
    {
      project_name: z.string().describe('Project name, e.g. "INT999_Employee_Sync"'),
      step_id: z.string().describe('The step ID to delete, e.g. "CallLegacyFlow"'),
      force: z.boolean().optional()
        .describe('Delete even if other steps still reference this ID (the references are reported and will fail validation until rewired)'),
      dry_run: z.boolean().optional()
        .describe('If true, return the planned removals without writing any files'),
    },
    async ({ project_name, step_id, force = false, dry_run = false }) => {
      const projectPath = resolve(config.workspacePath, project_name);

      if (!existsSync(projectPath)) {
        return errorResponse(
          'PROJECT_NOT_FOUND',
          `Project '${project_name}' does not exist.`,
          'Check the project name with list_studio_projects.',
        );
      }

      const wsDir        = join(projectPath, 'ws', 'WSAR-INF');
      const assemblyPath = join(wsDir, 'assembly.xml');
      const diagramPath  = join(wsDir, 'assembly-diagram.xml');

      if (!existsSync(assemblyPath)) {
        return errorResponse('ASSEMBLY_NOT_FOUND', `assembly.xml not found in ${wsDir}`, 'Run plan_integration first to create the assembly.');
      }

      const assemblyXml = await readFile(assemblyPath, 'utf8');
      const diagramXml  = existsSync(diagramPath) ? await readFile(diagramPath, 'utf8') : null;

      // ── Locate the element ──────────────────────────────────────────────────

      const element = findElementById(assemblyXml, step_id);
      if (!element) {
        return errorResponse(
          'ID_NOT_FOUND',
          `No element with id "${step_id}" found in assembly.xml.`,
          'Check spelling with list_assembly_steps — IDs are case-sensitive.',
        );
      }

      // @mixed re-numbering assumes the comment-free layout (elements on odd
      // indices). validate_assembly already treats comments as an ERROR.
      if (element.isTopLevel && /<!--/.test(assemblyXml)) {
        return errorResponse(
          'COMMENTS_PRESENT',
          'assembly.xml contains XML comments — @mixed positional indices cannot be re-numbered safely.',
          'Remove every <!-- --> block first (they break diagram EMF XPath references anyway), then retry.',
        );
      }

      // ── Inbound references from surviving steps ─────────────────────────────

      const inbound = findInboundRefs(assemblyXml, step_id, element);
      if (inbound.length > 0 && !force) {
        return errorResponse(
          'INBOUND_REFERENCES',
          `${inbound.length} other step(s) still reference "${step_id}": ${inbound.map(r => r.summary).join('; ')}`,
          'Rewire those routes first (or delete the callers), or pass force=true and fix the reported references afterwards.',
        );
      }

      // ── Compute removals ────────────────────────────────────────────────────

      const assemblyResult = removeFromAssembly(assemblyXml, element);
      const diagramResult  = diagramXml
        ? removeFromDiagram(diagramXml, step_id, element.isTopLevel ? element.mixedIndex : null)
        : { updated: null, visualProperties: 0, connections: 0, swimlaneRefs: 0, shiftedRefs: 0 };

      if (dry_run) {
        return successResponse({
          dry_run: true,
          element: { tag: element.tag, id: step_id, top_level: element.isTopLevel, mixed_index: element.isTopLevel ? element.mixedIndex : null },
          inbound_references: inbound.map(r => r.summary),
          diagram_removals: {
            visual_properties_blocks: diagramResult.visualProperties,
            connections_blocks: diagramResult.connections,
            swimlane_refs: diagramResult.swimlaneRefs,
            shifted_mixed_refs: diagramResult.shiftedRefs,
          },
        });
      }

      // ── Write both files ────────────────────────────────────────────────────

      const assemblyBackup = await backupFile(assemblyPath);
      await writeFileSafe(assemblyPath, assemblyResult.updated, false);

      let diagramBackup = null;
      if (diagramXml && diagramResult.updated !== null) {
        diagramBackup = await backupFile(diagramPath);
        await writeFileSafe(diagramPath, diagramResult.updated, false);
      }

      // ── Validate the result ─────────────────────────────────────────────────

      let issues = [];
      try {
        issues = validateAssembly(assemblyResult.updated, wsDir, diagramResult.updated);
      } catch (e) {
        issues = [{ severity: 'WARNING', code: 'VALIDATION_FAILED', message: e.message }];
      }
      const errors   = issues.filter(i => i.severity === 'ERROR');
      const warnings = issues.filter(i => i.severity !== 'ERROR');

      return successResponse({
        deleted: { tag: element.tag, id: step_id, top_level: element.isTopLevel },
        inbound_references_broken: inbound.map(r => r.summary),
        diagram_removals: {
          visual_properties_blocks: diagramResult.visualProperties,
          connections_blocks: diagramResult.connections,
          swimlane_refs: diagramResult.swimlaneRefs,
          shifted_mixed_refs: diagramResult.shiftedRefs,
        },
        assembly_backup: assemblyBackup,
        diagram_backup: diagramBackup,
        validation_errors: errors,
        validation_warnings: warnings,
        validation_clean: errors.length === 0,
      });
    },
  );
}

// ─── assembly.xml: locate an element by id ────────────────────────────────────
//
// Returns { tag, start, end, isTopLevel, mixedIndex } where [start, end) spans
// the element INCLUDING its preceding whitespace-only text (so the removal
// consumes exactly one element slot + one whitespace slot = a -2 @mixed shift).

export function findElementById(xml, id) {
  const openRe = new RegExp(`<([A-Za-z][\\w.-]*:[\\w.-]+)\\b[^>]*\\bid="${escapeRegex(id)}"[^>]*?(/?)>`);
  const m = openRe.exec(xml);
  if (!m) return null;

  const tag = m[1];
  const openStart = m.index;
  let end;

  if (m[2] === '/') {
    end = m.index + m[0].length;
  } else {
    end = findBlockEnd(xml, tag, m.index + m[0].length);
    if (end === -1) return null;
  }

  // Extend start backwards over whitespace-only text to the previous tag close.
  let start = openStart;
  while (start > 0 && /[ \t\r\n]/.test(xml[start - 1])) start--;

  const topLevel = topLevelChildren(xml);
  const position = topLevel.findIndex(c => c.openStart === openStart);

  return {
    tag,
    start,
    end,
    isTopLevel: position !== -1,
    mixedIndex: position !== -1 ? 2 * position + 1 : null,
  };
}

// Scan for the matching close tag, tracking nested same-tag openings.
function findBlockEnd(xml, tag, from) {
  const tokenRe = new RegExp(`<${escapeRegex(tag)}\\b[^>]*?(/?)>|</${escapeRegex(tag)}>`, 'g');
  tokenRe.lastIndex = from;
  let depth = 1;
  let t;
  while ((t = tokenRe.exec(xml)) !== null) {
    if (t[0].startsWith('</')) {
      depth--;
      if (depth === 0) return t.index + t[0].length;
    } else if (t[1] !== '/') {
      depth++;
    }
  }
  return -1;
}

// Immediate element children of <cc:assembly>, in document order.
function topLevelChildren(xml) {
  const asmOpen = xml.match(/<cc:assembly\b[^>]*>/);
  if (!asmOpen) return [];
  const bodyStart = asmOpen.index + asmOpen[0].length;
  const bodyEnd = xml.indexOf('</cc:assembly>', bodyStart);
  if (bodyEnd === -1) return [];

  const children = [];
  const tokenRe = /<([A-Za-z][\w.-]*:[\w.-]+)\b[^>]*?(\/?)>|<\/([A-Za-z][\w.-]*:[\w.-]+)>/g;
  tokenRe.lastIndex = bodyStart;
  let depth = 0;
  let t;
  while ((t = tokenRe.exec(xml)) !== null && t.index < bodyEnd) {
    if (t[3] !== undefined) {
      depth--;
    } else {
      if (depth === 0) children.push({ tag: t[1], openStart: t.index });
      if (t[2] !== '/') depth++;
    }
  }
  return children;
}

// ─── assembly.xml: inbound references from OUTSIDE the deleted span ───────────

export function findInboundRefs(xml, id, element) {
  const refs = [];
  const patterns = [
    [new RegExp(`\\broutes-to="${escapeRegex(id)}"`, 'g'), 'routes-to'],
    [new RegExp(`\\broutes-response-to="${escapeRegex(id)}"`, 'g'), 'routes-response-to'],
    [new RegExp(`\\bendpoint="vm://[^/"]+/${escapeRegex(id)}"`, 'g'), 'vm:// endpoint'],
  ];

  for (const [re, kind] of patterns) {
    let m;
    while ((m = re.exec(xml)) !== null) {
      if (m.index >= element.start && m.index < element.end) continue; // dies with the element
      const owner = owningElementId(xml, m.index);
      refs.push({ kind, summary: `${kind} from ${owner ?? 'an element'}` });
    }
  }
  return refs;
}

// Best-effort: the id= of the nearest preceding element open tag.
function owningElementId(xml, offset) {
  const before = xml.slice(0, offset);
  const m = before.match(/<[A-Za-z][\w.-]*:[\w.-]+\b[^>]*\bid="([^"]+)"[^>]*$/);
  return m ? `id="${m[1]}"` : null;
}

// ─── assembly.xml: remove the element span ────────────────────────────────────

export function removeFromAssembly(xml, element) {
  return { updated: xml.slice(0, element.start) + xml.slice(element.end) };
}

// ─── assembly-diagram.xml: mirror the three entries + re-number @mixed ────────
//
// Per docs/studio-integration-patterns.md "Removing components: mirror the
// three entries":
//   1. drop the <visualProperties> block wrapping <element href="assembly.xml#Id"/>
//   2. drop every <connections> block whose source OR target points at the id —
//      by literal href OR by @mixed positional ref resolving to the element
//   3. drop swimlane <elements href="assembly.xml#Id"/> membership lines
// Then (top-level deletes only) re-number every higher first-level @mixed index
// by -2 ("Insertion shift rule", inverted).

export function removeFromDiagram(xml, id, mixedIndex) {
  let updated = xml;
  const idHref = `#${id}"`;
  const positional = mixedIndex !== null
    ? new RegExp(`#//@beans/@mixed\\.1/@mixed\\.${mixedIndex}(?:[/"])`)
    : null;

  const touchesDeleted = (block) =>
    block.includes(idHref) || (positional !== null && positional.test(block));

  let visualProperties = 0;
  updated = removeBlocks(updated, 'visualProperties', touchesDeleted, () => visualProperties++);

  let connections = 0;
  updated = removeBlocks(updated, 'connections', touchesDeleted, () => connections++);

  let swimlaneRefs = 0;
  updated = updated.replace(
    new RegExp(`[ \\t]*<elements href="assembly\\.xml#${escapeRegex(id)}"\\s*/>\\r?\\n?`, 'g'),
    () => { swimlaneRefs++; return ''; },
  );
  if (mixedIndex !== null) {
    // Positional swimlane membership of the deleted element — left in place it
    // would re-resolve to the WRONG node once higher indices shift down.
    updated = updated.replace(
      new RegExp(`[ \\t]*<elements href="assembly\\.xml#//@beans/@mixed\\.1/@mixed\\.${mixedIndex}"\\s*/>\\r?\\n?`, 'g'),
      () => { swimlaneRefs++; return ''; },
    );
  }

  let shiftedRefs = 0;
  if (mixedIndex !== null) {
    updated = updated.replace(
      /(#\/\/@beans\/@mixed\.1\/@mixed\.)(\d+)/g,
      (whole, prefix, k) => {
        const K = parseInt(k, 10);
        if (K <= mixedIndex) return whole;
        shiftedRefs++;
        return `${prefix}${K - 2}`;
      },
    );
  }

  return { updated, visualProperties, connections, swimlaneRefs, shiftedRefs };
}

// Remove whole <tag ...>...</tag> (or self-closing) blocks matching a predicate.
// EMF diagram tags (visualProperties, connections) never nest within themselves.
function removeBlocks(xml, tag, predicate, onRemove) {
  const openRe = new RegExp(`<${tag}\\b[^>]*?(/?)>`, 'g');
  let result = '';
  let cursor = 0;
  let m;
  while ((m = openRe.exec(xml)) !== null) {
    let blockEnd;
    if (m[1] === '/') {
      blockEnd = m.index + m[0].length;
    } else {
      const close = xml.indexOf(`</${tag}>`, m.index);
      if (close === -1) break;
      blockEnd = close + tag.length + 3;
    }

    const block = xml.slice(m.index, blockEnd);
    if (predicate(block)) {
      let blockStart = m.index;
      while (blockStart > 0 && /[ \t]/.test(xml[blockStart - 1])) blockStart--;
      if (xml[blockStart - 1] === '\n') blockStart--;
      result += xml.slice(cursor, blockStart);
      cursor = blockEnd;
      onRemove();
    }
    openRe.lastIndex = blockEnd;
  }
  result += xml.slice(cursor);
  return result;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function successResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
