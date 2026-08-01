import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildState, renderPlanMarkdown, writeAidlcDocs, AIDLC_DIR } from '../src/aidlc-docs.mjs';

const PLAN = {
  integration: 'INT999_Example',
  design_brief: { data_source: 'raas', record_volume: 'large', error_handling: ['integration-messages'] },
  execution_chain: 'Call_GetWorkers →(routes-response-to)→ Call_TransformCsv (final)',
  props_contract: [
    { sub_flow: 'GetWorkers', description: 'Fetch workers', reads_props: ['Batch_Id'], writes_props: ['Worker_Count'], error_handler: 'PutGetWorkersError' },
    { sub_flow: 'TransformCsv', description: 'Build CSV', reads_props: ['(define before building)'], writes_props: ['(define before building)'], error_handler: 'PutTransformCsvError' },
  ],
  gaps_to_fill: ['Replace TODO_REPLACE_WITH_REPORT_WID with the real report WID'],
  build_order: ['Build GetWorkers', 'Build TransformCsv'],
  emf_xpath_summary: { GlobalErrorHandler: '@mixed.9' },
  warnings: ['Do NOT add XML comments to assembly.xml'],
  auto_generated_in_workday_in: ['cloud:report-service "INT999_Example_Reports" with 1 alias'],
};

async function tempProject() {
  const dir = await mkdtemp(join(tmpdir(), 'studio-mcp-test-'));
  await mkdir(join(dir, 'ws', 'WSAR-INF'), { recursive: true });
  return dir;
}

test('state records every sub-flow as an unbuilt unit of work', () => {
  const s = buildState(PLAN, { today: '2026-07-26' });
  assert.equal(s.integration, 'INT999_Example');
  assert.equal(s.phase, 'construction');
  assert.equal(s.units_of_work.length, 2);
  assert.deepEqual(s.units_of_work.map(u => u.id), ['GetWorkers', 'TransformCsv']);
  assert.ok(s.units_of_work.every(u => u.status === 'todo_stub' && u.validated_clean === false),
    'a fresh scaffold has built nothing');
  assert.equal(s.units_of_work[0].error_handler, 'PutGetWorkersError');
  assert.deepEqual(s.decisions, []);
});

test('state carries forward a prior created date and decisions log', () => {
  const prior = { created: '2026-01-01', decisions: [{ date: '2026-01-02', decision: 'use xml-stream-splitter' }] };
  const s = buildState(PLAN, { today: '2026-07-26', prior });
  assert.equal(s.created, '2026-01-01', 're-scaffolding must not reset the creation date');
  assert.equal(s.updated, '2026-07-26');
  assert.equal(s.decisions.length, 1, 'decision history must survive a re-scaffold');
});

test('plan.md documents contracts, gaps and the tenant handoff', () => {
  const md = renderPlanMarkdown(PLAN, buildState(PLAN, { today: '2026-07-26' }));
  assert.ok(md.startsWith('# INT999_Example'));
  assert.match(md, /## Design brief/);
  assert.match(md, /`Batch_Id`/);
  assert.match(md, /\(define before building\)/, 'unspecified contracts must be actionable');
  assert.match(md, /## Open gaps/);
  assert.match(md, /- \[ \]/, 'gaps are checkboxes');
  assert.match(md, /## Human handoff \(Operations\)/);
  assert.match(md, /never touches a tenant/);
  assert.match(md, /EMF `@mixed` reference map/);
  assert.match(md, /## Warnings/);
});

test('writes plan.md and state.json at the project root', async () => {
  const dir = await tempProject();
  try {
    const written = await writeAidlcDocs(dir, PLAN, { today: '2026-07-26' });
    assert.deepEqual(written, [`${AIDLC_DIR}/plan.md`, `${AIDLC_DIR}/state.json`]);
    assert.ok(existsSync(join(dir, AIDLC_DIR, 'plan.md')));
    assert.ok(existsSync(join(dir, AIDLC_DIR, 'state.json')));
    assert.ok(!existsSync(join(dir, 'ws', 'WSAR-INF', AIDLC_DIR)),
      'must live at the project root, not beside the assembly');

    const state = JSON.parse(await readFile(join(dir, AIDLC_DIR, 'state.json'), 'utf-8'));
    assert.equal(state.integration, 'INT999_Example');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('re-writing preserves created date and decisions', async () => {
  const dir = await tempProject();
  try {
    await writeAidlcDocs(dir, PLAN, { today: '2026-07-26' });
    const p = join(dir, AIDLC_DIR, 'state.json');

    const state = JSON.parse(await readFile(p, 'utf-8'));
    state.created = '2026-01-01';
    state.decisions.push({ date: '2026-01-02', decision: 'use xml-stream-splitter' });
    await writeFile(p, JSON.stringify(state, null, 2), 'utf-8');

    await writeAidlcDocs(dir, PLAN, { today: '2026-07-27' });
    const after = JSON.parse(await readFile(p, 'utf-8'));
    assert.equal(after.created, '2026-01-01');
    assert.equal(after.decisions.length, 1);
    assert.equal(after.updated, '2026-07-27');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a corrupt hand-edited state.json is regenerated, not fatal', async () => {
  const dir = await tempProject();
  try {
    await mkdir(join(dir, AIDLC_DIR), { recursive: true });
    await writeFile(join(dir, AIDLC_DIR, 'state.json'), '{ not valid json', 'utf-8');

    await writeAidlcDocs(dir, PLAN, { today: '2026-07-26' });
    const after = JSON.parse(await readFile(join(dir, AIDLC_DIR, 'state.json'), 'utf-8'));
    assert.equal(after.integration, 'INT999_Example');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
