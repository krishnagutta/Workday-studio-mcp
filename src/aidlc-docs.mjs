/**
 * aidlc-docs — the persisted lifecycle artifact for an integration.
 *
 * plan_integration builds a rich plan (design brief, per-sub-flow prop contracts,
 * EMF index map, gap list) that previously existed only in the tool response, so
 * the design rationale evaporated when the session ended. This module persists it
 * next to the project:
 *
 *   <project>/aidlc-docs/plan.md      human-readable — read in review and handoff
 *   <project>/aidlc-docs/state.json   machine-readable — lifecycle state for tools
 *
 * See docs/ai-dlc-alignment-proposal.md (increment 1).
 *
 * NOTE: these files are meant to be committed to the user's project repo. Never
 * write credentials or tenant values here — attribute NAMES only, never values.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export const AIDLC_DIR = 'aidlc-docs';

/**
 * Writes plan.md + state.json into <projectPath>/aidlc-docs/.
 * Preserves `created` and the `decisions` log if state.json already exists, so
 * re-scaffolding an integration does not discard its history.
 * Returns the project-relative paths written.
 */
export async function writeAidlcDocs(projectPath, plan, { today = isoDate() } = {}) {
  const dir = join(projectPath, AIDLC_DIR);
  await mkdir(dir, { recursive: true });

  const prior = await readStateIfPresent(dir);
  const state = buildState(plan, { today, prior });

  await writeFile(join(dir, 'plan.md'), renderPlanMarkdown(plan, state), 'utf-8');
  await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf-8');

  return [`${AIDLC_DIR}/plan.md`, `${AIDLC_DIR}/state.json`];
}

async function readStateIfPresent(dir) {
  const p = join(dir, 'state.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf-8'));
  } catch {
    return null;  // corrupt or hand-edited — regenerate rather than fail the scaffold
  }
}

/** Reads a project's state.json, or null when the project has no aidlc-docs/. */
export async function readState(projectPath) {
  return readStateIfPresent(join(projectPath, AIDLC_DIR));
}

/**
 * Applies `mutate(state)` and writes the result back.
 *
 * Returns null and writes nothing when the project has no aidlc-docs/ — every
 * caller must tolerate that, because projects predating this feature (and any
 * assembly edited without plan_integration) simply have no lifecycle state.
 * State tracking is a convenience layer; it must never gate an edit.
 */
export async function updateState(projectPath, mutate, { today = isoDate() } = {}) {
  const dir = join(projectPath, AIDLC_DIR);
  const state = await readStateIfPresent(dir);
  if (!state) return null;

  mutate(state);
  state.updated = today;
  await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf-8');
  return state;
}

/** Marks a unit of work as built. No-op when the unit or the state is absent. */
export async function markUnitBuilt(projectPath, unitId, opts = {}) {
  return updateState(projectPath, (state) => {
    const unit = (state.units_of_work ?? []).find(u => u.id === unitId);
    if (unit) unit.status = 'built';
  }, opts);
}

/**
 * Records an assembly-wide validation result.
 *
 * Validation is assembly-wide, not per-unit — so `validated_clean` on a unit
 * means "the assembly validated clean while this unit was built", not that the
 * unit was verified in isolation. Units still stubbed are never marked clean.
 */
export async function recordValidation(projectPath, { clean, errors = 0, warnings = 0 }, opts = {}) {
  return updateState(projectPath, (state) => {
    state.last_validation = {
      date: opts.today ?? isoDate(),
      clean,
      error_count: errors,
      warning_count: warnings,
    };
    for (const unit of state.units_of_work ?? []) {
      unit.validated_clean = clean && unit.status === 'built';
    }
  }, opts);
}

// ─── Retrofit — derive state for a project that predates aidlc-docs ───────────
//
// Only infers what the assembly actually proves: the sub-flows (cc:local-in ids
// with a matching Do{X} mediation) and whether each is still a TODO stub. The
// design brief is human knowledge that no assembly records — it is marked
// unknown rather than guessed, so a retrofitted plan never invents rationale.

export function inferPlanFromAssembly(integration, assemblyXml) {
  const localIns = [...assemblyXml.matchAll(/<cc:local-in\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]);

  const units = localIns.filter(id =>
    new RegExp(`<cc:async-mediation\\b[^>]*\\bid="Do${escapeRe(id)}"`).test(assemblyXml));

  return {
    integration,
    inferred: true,
    design_brief: {
      note: 'Not recorded — this integration predates aidlc-docs. Fill in from the team’s knowledge.',
    },
    execution_chain: units.length
      ? units.map(u => `Call_${u}`).join(' →(routes-response-to)→ ')
      : '(no vm:// sub-flows found)',
    props_contract: units.map(id => ({
      sub_flow: id,
      description: '(not recorded — describe this sub-flow)',
      reads_props: ['(define)'],
      writes_props: ['(define)'],
      error_handler: `Put${id}Error`,
    })),
    gaps_to_fill: ['Design brief was not recorded — reconstruct it and update this file'],
    _stub_units: units.filter(id =>
      new RegExp(`<cc:async-mediation\\b[^>]*\\bid="Do${escapeRe(id)}"[\\s\\S]{0,600}?TODO`).test(assemblyXml)),
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── state.json ───────────────────────────────────────────────────────────────

export function buildState(plan, { today = isoDate(), prior = null } = {}) {
  return {
    integration: plan.integration,
    phase: 'construction',            // Inception completed the moment a plan exists
    created: prior?.created ?? today,
    updated: today,
    design_brief: plan.design_brief,
    units_of_work: (plan.props_contract ?? []).map(c => ({
      id: c.sub_flow,
      description: c.description,
      // A fresh scaffold is all TODO stubs. A retrofit reads the real assembly,
      // so anything without a TODO marker is already built.
      status: plan._stub_units
        ? (plan._stub_units.includes(c.sub_flow) ? 'todo_stub' : 'built')
        : 'todo_stub',
      validated_clean: false,
      error_handler: c.error_handler,
    })),
    open_gaps: plan.gaps_to_fill ?? [],
    decisions: prior?.decisions ?? [],
  };
}

// ─── plan.md ──────────────────────────────────────────────────────────────────

export function renderPlanMarkdown(plan, state) {
  const b = plan.design_brief ?? {};
  const out = [];

  out.push(`# ${plan.integration} — integration plan`, '');
  out.push('_Generated by `plan_integration`. Regenerated whenever the integration is re-scaffolded;',
    'the `decisions` log in `state.json` is preserved across regenerations._', '');

  out.push('## Design brief', '');
  out.push('| Decision | Value |', '|---|---|');
  for (const [k, v] of Object.entries(b)) {
    out.push(`| ${k.replace(/_/g, ' ')} | ${fmt(v)} |`);
  }
  out.push('');

  out.push('## Units of work (sub-flows)', '');
  out.push(`Execution chain:`, '', '```', plan.execution_chain ?? '(none)', '```', '');
  out.push('| Sub-flow | Purpose | Reads props | Writes props | Error handler |');
  out.push('|---|---|---|---|---|');
  for (const c of plan.props_contract ?? []) {
    out.push(`| \`${c.sub_flow}\` | ${c.description} | ${list(c.reads_props)} | ${list(c.writes_props)} | \`${c.error_handler}\` |`);
  }
  out.push('');

  if (plan.build_order?.length) {
    out.push('## Build order', '');
    plan.build_order.forEach((step, i) => out.push(`${i + 1}. ${step}`));
    out.push('');
  }

  if (plan.gaps_to_fill?.length) {
    out.push('## Open gaps', '',
      'Work the scaffold deliberately did not do — resolve before the integration runs.', '');
    for (const g of plan.gaps_to_fill) out.push(`- [ ] ${g}`);
    out.push('');
  }

  out.push('## Human handoff (Operations)', '');
  out.push('This MCP is local-only: it never touches a tenant. These steps are yours:', '');
  for (const step of opsChecklist(b)) out.push(`- [ ] ${step}`);
  out.push('');

  if (plan.auto_generated_in_workday_in?.length) {
    out.push('## Declarations generated in `cc:workday-in`', '');
    for (const a of plan.auto_generated_in_workday_in) out.push(`- ${a}`);
    out.push('');
  }

  if (plan.emf_xpath_summary && Object.keys(plan.emf_xpath_summary).length) {
    out.push('## EMF `@mixed` reference map', '',
      '_Positional diagram references at scaffold time. These shift when top-level elements are',
      'added or removed — see `get_patterns` topic="Insertion shift rule"._', '');
    out.push('| Element | Path |', '|---|---|');
    for (const [k, v] of Object.entries(plan.emf_xpath_summary)) out.push(`| ${k} | \`${v}\` |`);
    out.push('');
  }

  if (plan.warnings?.length) {
    out.push('## Warnings', '');
    for (const w of plan.warnings) out.push(`- ⚠️ ${w}`);
    out.push('');
  }

  out.push('---', '', `_Lifecycle state: \`${AIDLC_DIR}/state.json\` (phase: ${state.phase})._`);
  return out.join('\n');
}

// ─── Operations handoff — tailored to what the design brief implies ──────────
//
// The MCP deliberately does not automate any of this (no tenant, no network).
// Writing it down is how the boundary stays explicit instead of forgotten.

export function opsChecklist(brief = {}) {
  const steps = [];
  const src = brief.data_source;
  const dst = brief.data_destination;

  if (brief.raas_reports?.length || src === 'raas' || src === 'multiple') {
    steps.push('Create/verify the custom report(s) in the tenant and confirm each `cloud:report-alias` name matches exactly');
    steps.push('Replace any `TODO_REPLACE_WITH_REPORT_WID` placeholder with the real report WID');
  }
  if (brief.soap_operations?.length || src === 'soap-get' || dst === 'workday-soap-write') {
    steps.push('Grant the ISU domain permissions for every SOAP operation used (get *and* write domains differ)');
  }
  if (src === 'inbound-file') {
    steps.push('Configure the retrieval service and confirm the file is attached to the integration event');
  }
  if (src === 'webhook') {
    steps.push('Register the listener service and subscribe it to the triggering business event');
  }
  if (brief.external_auth && brief.external_auth !== 'none') {
    steps.push(`Enter the ${brief.external_auth} credentials as integration attributes in the Workday UI — values must never be committed here`);
  }
  if (brief.trigger === 'scheduled') {
    steps.push('Create the schedule (frequency, time zone, and the run-as ISU)');
  }
  if (brief.trigger === 'event-driven') {
    steps.push('Wire the business process trigger that launches this integration');
  }
  if (brief.trigger === 'launch-params-manual') {
    steps.push('Bind each launch parameter to its prompt/report field before the first manual run');
  }
  if (brief.error_handling?.includes('email-notification')) {
    steps.push('Set the notification recipients — and point them at a test address on non-production tenants');
  }
  if (dst === 'file-delivery') {
    steps.push('Confirm the delivery target (integration event attachment or configured transport) and its retention');
  }
  if (dst === 'external-rest' || src === 'external-rest') {
    steps.push('Allow-list the external endpoint and confirm the tenant can reach it from this environment');
  }

  steps.push('Replace any remaining `TODO_*` placeholder in the assembly with a real tenant value');
  steps.push('Deploy to a non-production tenant first, launch, then read the server log (`parse_server_log`)');
  return steps;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : '_none_';
  if (v === undefined || v === null || v === '') return '_none_';
  return String(v);
}

function list(v) {
  return Array.isArray(v) && v.length ? v.map(x => `\`${x}\``).join(', ') : '_tbd_';
}
