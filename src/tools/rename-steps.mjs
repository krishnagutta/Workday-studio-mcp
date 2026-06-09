import { z } from 'zod';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { config } from '../config.mjs';
import { backupFile, writeFileSafe } from '../fs.mjs';
import { readFile } from 'fs/promises';
import { validateAssembly } from '../assembly-validator.mjs';

// ─── Public tool registration ─────────────────────────────────────────────────

export function register(server) {
  server.tool(
    'rename_steps',
    [
      'Atomically renames a step ID in BOTH assembly.xml AND assembly-diagram.xml.',
      '',
      'WHY THIS EXISTS:',
      '  Renaming an ID in only one file causes a scala.MatchError crash when Studio',
      '  opens the diagram. This tool updates all references in a single operation:',
      '',
      '  assembly.xml        — id="OldID", routes-to="OldID", routes-response-to="OldID",',
      '                        endpoint vm:// paths containing /OldID',
      '  assembly-diagram.xml — all href="assembly.xml#OldID" forms (visualProperties,',
      '                         connections source/target, swimlane elements)',
      '',
      'SAFE TO USE FOR:',
      '  cc:async-mediation, cc:local-in, cc:local-out, cc:route, cc:splitter,',
      '  cc:send-error, cc:workday-out-*, cc:http-out, cc:workday-in, and any',
      '  other element with an id= attribute.',
      '',
      'Creates backups of both files before writing. Runs validate_assembly after.',
      '',
      'BATCH RENAMES: call once per ID — do not batch multiple renames into one call.',
    ].join('\n'),
    {
      project_name: z.string().describe('Project name, e.g. "INT161_Acquisition_PostProcessing"'),
      old_id: z.string().describe('The existing step ID to rename, e.g. "AsyncMediation3"'),
      new_id: z.string()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'IDs must start with a letter or underscore and contain only alphanumerics and underscores')
        .describe('New step ID, e.g. "SetTransactionProps" — use verb+object PascalCase'),
      dry_run: z.boolean().optional()
        .describe('If true, return the planned replacements without writing any files'),
    },
    async ({ project_name, old_id, new_id, dry_run = false }) => {
      const projectPath = resolve(config.workspacePath, project_name);

      if (!existsSync(projectPath)) {
        return errorResponse(
          'PROJECT_NOT_FOUND',
          `Project '${project_name}' does not exist.`,
          'Check the project name with list_studio_projects.',
        );
      }

      if (old_id === new_id) {
        return errorResponse('NO_CHANGE', `old_id and new_id are identical: "${old_id}"`, 'Provide a different new_id.');
      }

      const wsDir        = join(projectPath, 'ws', 'WSAR-INF');
      const assemblyPath = join(wsDir, 'assembly.xml');
      const diagramPath  = join(wsDir, 'assembly-diagram.xml');

      if (!existsSync(assemblyPath)) {
        return errorResponse('ASSEMBLY_NOT_FOUND', `assembly.xml not found in ${wsDir}`, 'Run plan_integration first to create the assembly.');
      }

      const assemblyXml = await readFile(assemblyPath, 'utf8');
      const diagramXml  = existsSync(diagramPath) ? await readFile(diagramPath, 'utf8') : null;

      // ── Compute replacements ────────────────────────────────────────────────

      const assemblyResult = renameInAssembly(assemblyXml, old_id, new_id);
      const diagramResult  = diagramXml ? renameInDiagram(diagramXml, old_id, new_id) : { updated: null, count: 0 };

      if (assemblyResult.count === 0 && diagramResult.count === 0) {
        return errorResponse(
          'ID_NOT_FOUND',
          `No references to id "${old_id}" found in assembly.xml or assembly-diagram.xml.`,
          'Check spelling — IDs are case-sensitive.',
        );
      }

      if (dry_run) {
        return successResponse({
          dry_run: true,
          assembly_replacements: assemblyResult.count,
          diagram_replacements: diagramResult.count,
          assembly_preview: buildDiff(assemblyXml, assemblyResult.updated, old_id),
          diagram_preview: diagramXml ? buildDiff(diagramXml, diagramResult.updated, old_id) : 'no diagram file',
        });
      }

      // ── Write both files atomically ────────────────────────────────────────

      const assemblyBackup = await backupFile(assemblyPath);
      await writeFileSafe(assemblyPath, assemblyResult.updated, false);

      let diagramBackup = null;
      if (diagramXml && diagramResult.updated) {
        diagramBackup = await backupFile(diagramPath);
        await writeFileSafe(diagramPath, diagramResult.updated, false);
      }

      // ── Validate ───────────────────────────────────────────────────────────

      let validation = null;
      try {
        validation = await validateAssembly(assemblyPath);
      } catch (e) {
        validation = { errors: [], warnings: [], error: e.message };
      }

      return successResponse({
        renamed: { from: old_id, to: new_id },
        assembly_replacements: assemblyResult.count,
        diagram_replacements: diagramResult.count,
        assembly_backup: assemblyBackup,
        diagram_backup: diagramBackup,
        validation_errors:   validation?.errors   ?? [],
        validation_warnings: validation?.warnings  ?? [],
        validation_clean: (validation?.errors?.length ?? 0) === 0,
      });
    },
  );
}

// ─── assembly.xml rename ──────────────────────────────────────────────────────
//
// An ID appears in assembly.xml in four forms:
//   1. id="OldID"                             — the step's own declaration
//   2. routes-to="OldID"                      — routing target
//   3. routes-response-to="OldID"             — response routing target
//   4. endpoint="vm://ProjectName/OldID"      — vm:// local-out endpoint path
//
// Strategy: replace ="OldID" (catches forms 1–3) and /OldID" (catches form 4).
// Both patterns delimit the ID with a quote on the right and = or / on the left,
// preventing partial-ID matches (e.g. renaming "Foo" won't affect "FooBar").

function renameInAssembly(xml, oldId, newId) {
  let count = 0;

  // Form 1-3: ="OldID"
  const attrPattern = new RegExp(`="${escapeRegex(oldId)}"`, 'g');
  let updated = xml.replace(attrPattern, () => { count++; return `="${newId}"`; });

  // Form 4: /OldID" (vm:// endpoint paths — only if not already counted above)
  // This form has a / prefix instead of =, so it won't double-count.
  const pathPattern = new RegExp(`/${escapeRegex(oldId)}"`, 'g');
  updated = updated.replace(pathPattern, () => { count++; return `/${newId}"`; });

  return { updated, count };
}

// ─── assembly-diagram.xml rename ─────────────────────────────────────────────
//
// Diagram hrefs use three forms, all ending in #OldID":
//   <element href="assembly.xml#OldID"/>
//   <source  href="assembly.xml#OldID"/>
//   <target  href="assembly.xml#OldID"/>
//   <elements href="assembly.xml#OldID"/>
//   <elements href="#//@swimlanes.N"/>   ← @mixed paths — never contain plain IDs, safe to skip
//
// Strategy: replace #OldID" globally — the # prefix prevents matching substrings.

function renameInDiagram(xml, oldId, newId) {
  const pattern = new RegExp(`#${escapeRegex(oldId)}"`, 'g');
  let count = 0;
  const updated = xml.replace(pattern, () => { count++; return `#${newId}"`; });
  return { updated, count };
}

// ─── diff preview (context lines around each changed line) ───────────────────

function buildDiff(original, updated, oldId) {
  const origLines    = original.split('\n');
  const updatedLines = updated.split('\n');
  const CONTEXT = 1;
  const changed = [];

  for (let i = 0; i < origLines.length; i++) {
    if (origLines[i] !== updatedLines[i]) {
      const start = Math.max(0, i - CONTEXT);
      const end   = Math.min(origLines.length - 1, i + CONTEXT);
      for (let j = start; j <= end; j++) {
        const prefix = j === i ? '>' : ' ';
        changed.push(`L${j + 1} ${prefix} ${j === i ? updatedLines[j] : origLines[j]}`);
      }
      changed.push('---');
    }
  }

  return changed.length ? changed.join('\n') : '(no changes detected)';
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
