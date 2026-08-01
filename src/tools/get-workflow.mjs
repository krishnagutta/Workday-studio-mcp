import { z } from 'zod';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { config } from '../config.mjs';
import {
  readState, writeAidlcDocs, inferPlanFromAssembly, AIDLC_DIR,
} from '../aidlc-docs.mjs';

// ─── Public tool registration ─────────────────────────────────────────────────

export function register(server) {
  server.tool(
    'get_workflow',
    [
      'Reports where an integration stands in its build lifecycle, and what to do next.',
      '',
      'CALL THIS FIRST when picking up an integration you did not just scaffold —',
      'it answers "what is done, what is still a stub, and what should I do now?"',
      'without reading the XML.',
      '',
      'THE LIFECYCLE (this MCP covers the first two phases):',
      '  1. INCEPTION    — plan_integration gathers the design and scaffolds the',
      '                    assembly + diagram, decomposed into sub-flows',
      '                    (the units of work).',
      '  2. CONSTRUCTION — build ONE unit at a time: update_sub_flow to fill it in,',
      '                    then validate_assembly before moving to the next.',
      '  3. OPERATIONS   — deploy, tenant config, launch. NOT automated here: this',
      '                    server is local-only and never touches a tenant. The',
      '                    handoff checklist lives in aidlc-docs/plan.md.',
      '',
      'State is read from <project>/aidlc-docs/state.json, written by',
      'plan_integration and kept current by update_sub_flow and validate_assembly.',
      '',
      'If a project has no aidlc-docs/ (it predates the convention, or was built by',
      'hand), call again with retrofit=true to derive one from the existing assembly.',
      'Retrofit records only what the assembly proves — sub-flows and which are still',
      'TODO stubs. It marks the design brief as unrecorded rather than inventing one.',
    ].join('\n'),
    {
      project_name: z.string()
        .describe('Project name, e.g. "INT999_Employee_Sync"'),
      retrofit: z.boolean().optional()
        .describe('Generate aidlc-docs/ for a project that has none, by reading its existing assembly.xml'),
    },
    async ({ project_name, retrofit = false }) => {
      const projectPath = resolve(config.workspacePath, project_name);
      if (!existsSync(projectPath)) {
        return errorResponse(
          'PROJECT_NOT_FOUND',
          `Project '${project_name}' does not exist.`,
          'Check the name with list_studio_projects.',
        );
      }

      const assemblyPath = join(projectPath, 'ws', 'WSAR-INF', 'assembly.xml');
      let state = await readState(projectPath);

      if (!state && retrofit) {
        if (!existsSync(assemblyPath)) {
          return errorResponse(
            'ASSEMBLY_NOT_FOUND',
            `Cannot retrofit '${project_name}' — no assembly.xml to read.`,
            'Use plan_integration to design and scaffold a new integration instead.',
          );
        }
        const plan = inferPlanFromAssembly(project_name, await readFile(assemblyPath, 'utf-8'));
        await writeAidlcDocs(projectPath, plan);
        state = await readState(projectPath);
        return successText(render(project_name, state, {
          retrofitted: true,
          units: plan.props_contract.length,
        }));
      }

      if (!state) {
        return successText([
          `# ${project_name} — no lifecycle state`,
          '',
          `This project has no \`${AIDLC_DIR}/\`, so there is no record of its design or progress.`,
          '',
          existsSync(assemblyPath)
            ? 'It already has an `assembly.xml`. Call `get_workflow` again with `retrofit=true` to derive state from it.'
            : 'It has no `assembly.xml` either. Start with `plan_integration` — gather the design decisions from the user FIRST.',
        ].join('\n'));
      }

      return successText(render(project_name, state));
    },
  );
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function render(projectName, state, { retrofitted = false, units = 0 } = {}) {
  const out = [];
  const uow = state.units_of_work ?? [];
  const stubs = uow.filter(u => u.status === 'todo_stub');
  const built = uow.filter(u => u.status === 'built');

  out.push(`# ${projectName} — lifecycle`, '');
  if (retrofitted) {
    out.push(`Retrofitted \`${AIDLC_DIR}/\` from the existing assembly (${units} sub-flow(s) found).`,
      'The design brief could not be recovered — record it in `plan.md` while you still remember it.', '');
  }

  out.push(`**Phase:** ${state.phase}  |  **Units of work:** ${built.length}/${uow.length} built`, '');

  if (uow.length) {
    out.push('| Unit of work | Status | Validated |', '|---|---|---|');
    for (const u of uow) {
      out.push(`| \`${u.id}\` | ${u.status === 'built' ? 'built' : 'TODO stub'} | ${u.validated_clean ? 'clean' : '—'} |`);
    }
    out.push('');
  }

  if (state.last_validation) {
    const v = state.last_validation;
    out.push(`**Last validation** (${v.date}): ${v.clean ? 'clean' : `${v.error_count} error(s), ${v.warning_count} warning(s)`}`, '');
  }

  if (state.open_gaps?.length) {
    out.push('**Open gaps:**');
    for (const g of state.open_gaps) out.push(`- ${g}`);
    out.push('');
  }

  out.push('## Next', '');
  if (stubs.length) {
    const next = stubs[0];
    out.push(`Build the next unit: \`update_sub_flow\` with \`sub_flow_id="${next.id}"\` — ${next.description}`);
    out.push(`Then \`validate_assembly\` before starting the next unit. ${stubs.length} stub(s) remain.`);
  } else if (uow.length === 0) {
    out.push('No units of work recorded. If this integration has sub-flows, re-run with `retrofit=true`.');
  } else if (state.last_validation && !state.last_validation.clean) {
    out.push('All units are built but the last validation was not clean — run `validate_assembly` and fix what it reports.');
  } else if (!state.last_validation) {
    out.push('All units are built. Run `validate_assembly` to confirm the assembly and diagram agree.');
  } else {
    out.push('All units are built and the assembly validates clean.', '',
      `**Construction is done — Operations is a human handoff.** Work the checklist in \`${AIDLC_DIR}/plan.md\`:`,
      'tenant config, real WIDs, ISU permissions, credentials, then deploy and launch.',
      'This server is local-only and cannot do any of it for you.');
  }

  return out.join('\n');
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function successText(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
