import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  writeAidlcDocs, readState, updateState, markUnitBuilt, recordValidation,
  inferPlanFromAssembly, buildState, opsChecklist, renderPlanMarkdown, AIDLC_DIR,
} from '../src/aidlc-docs.mjs';

const PLAN = {
  integration: 'INT999_Example',
  design_brief: { data_source: 'raas', record_volume: 'large' },
  props_contract: [
    { sub_flow: 'GetWorkers', description: 'Fetch workers', reads_props: ['A'], writes_props: ['B'], error_handler: 'PutGetWorkersError' },
    { sub_flow: 'TransformCsv', description: 'Build CSV', reads_props: ['B'], writes_props: ['C'], error_handler: 'PutTransformCsvError' },
  ],
  gaps_to_fill: [],
};

async function project(withDocs = true) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-lifecycle-'));
  await mkdir(join(dir, 'ws', 'WSAR-INF'), { recursive: true });
  if (withDocs) await writeAidlcDocs(dir, PLAN, { today: '2026-07-26' });
  return dir;
}

// ─── State transitions (increment 3) ─────────────────────────────────────────

test('markUnitBuilt flips exactly one unit to built', async () => {
  const dir = await project();
  try {
    const state = await markUnitBuilt(dir, 'GetWorkers');
    const byId = Object.fromEntries(state.units_of_work.map(u => [u.id, u.status]));
    assert.equal(byId.GetWorkers, 'built');
    assert.equal(byId.TransformCsv, 'todo_stub', 'other units must be untouched');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('recordValidation marks only BUILT units clean', async () => {
  const dir = await project();
  try {
    await markUnitBuilt(dir, 'GetWorkers');
    const state = await recordValidation(dir, { clean: true }, { today: '2026-07-27' });

    assert.equal(state.last_validation.clean, true);
    const byId = Object.fromEntries(state.units_of_work.map(u => [u.id, u.validated_clean]));
    assert.equal(byId.GetWorkers, true);
    assert.equal(byId.TransformCsv, false,
      'a still-stubbed unit is never "validated clean" just because the assembly parsed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failing validation clears every clean flag', async () => {
  const dir = await project();
  try {
    await markUnitBuilt(dir, 'GetWorkers');
    await recordValidation(dir, { clean: true });
    const state = await recordValidation(dir, { clean: false, errors: 2, warnings: 1 });

    assert.equal(state.last_validation.clean, false);
    assert.equal(state.last_validation.error_count, 2);
    assert.ok(state.units_of_work.every(u => u.validated_clean === false));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('state writers no-op (not throw) when a project has no aidlc-docs/', async () => {
  const dir = await project(false);
  try {
    assert.equal(await readState(dir), null);
    assert.equal(await markUnitBuilt(dir, 'GetWorkers'), null);
    assert.equal(await recordValidation(dir, { clean: true }), null);
    assert.equal(await updateState(dir, () => { throw new Error('must not run'); }), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unknown unit ids are ignored rather than invented', async () => {
  const dir = await project();
  try {
    const state = await markUnitBuilt(dir, 'NoSuchUnit');
    assert.equal(state.units_of_work.length, 2);
    assert.ok(state.units_of_work.every(u => u.status === 'todo_stub'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ─── Retrofit (§7.3) ─────────────────────────────────────────────────────────

const EXISTING = `<beans xmlns:cc="http://www.capeclear.com/assembly/10">
<cc:assembly name="INT999_Legacy">
  <cc:workday-in id="StartHere" routes-to="Call_Alpha"/>
  <cc:local-out id="Call_Alpha" endpoint="vm://INT999_Legacy/Alpha"/>
  <cc:local-in id="Alpha" routes-to="DoAlpha"/>
  <cc:async-mediation id="DoAlpha">
    <cc:steps><cc:log id="L"><cc:log-message><cc:text>TODO: fill me in</cc:text></cc:log-message></cc:log></cc:steps>
  </cc:async-mediation>
  <cc:local-in id="Beta" routes-to="DoBeta"/>
  <cc:async-mediation id="DoBeta">
    <cc:steps><cc:eval id="E"><cc:expression>props['x'] = 1</cc:expression></cc:eval></cc:steps>
  </cc:async-mediation>
</cc:assembly>
</beans>`;

test('retrofit derives units of work from an existing assembly', () => {
  const plan = inferPlanFromAssembly('INT999_Legacy', EXISTING);
  assert.equal(plan.inferred, true);
  assert.deepEqual(plan.props_contract.map(c => c.sub_flow), ['Alpha', 'Beta']);
});

test('retrofit distinguishes TODO stubs from built sub-flows', () => {
  const plan = inferPlanFromAssembly('INT999_Legacy', EXISTING);
  const state = buildState(plan, { today: '2026-07-26' });
  const byId = Object.fromEntries(state.units_of_work.map(u => [u.id, u.status]));
  assert.equal(byId.Alpha, 'todo_stub', 'Alpha still contains a TODO marker');
  assert.equal(byId.Beta, 'built', 'Beta has real steps');
});

test('retrofit refuses to invent a design brief', () => {
  const plan = inferPlanFromAssembly('INT999_Legacy', EXISTING);
  assert.match(JSON.stringify(plan.design_brief), /[Nn]ot recorded/);
  assert.ok(plan.gaps_to_fill.some(g => /[Dd]esign brief/.test(g)),
    'the missing rationale must be surfaced as a gap, not silently faked');
});

// ─── Tailored Operations checklist (increment 4) ─────────────────────────────

test('ops checklist adapts to the design brief', () => {
  const raas = opsChecklist({ data_source: 'raas', trigger: 'scheduled' }).join('\n');
  assert.match(raas, /custom report/i);
  assert.match(raas, /schedule/i);
  assert.ok(!/listener service/i.test(raas), 'webhook step must not appear for a RAAS integration');

  const hook = opsChecklist({ data_source: 'webhook', trigger: 'event-driven' }).join('\n');
  assert.match(hook, /listener service/i);
  assert.ok(!/custom report/i.test(hook));

  const auth = opsChecklist({ external_auth: 'oauth2' }).join('\n');
  assert.match(auth, /oauth2/i);
  assert.match(auth, /never be committed/i, 'must warn against committing credentials');
});

test('ops checklist always ends with placeholder + deploy steps', () => {
  const steps = opsChecklist({});
  assert.match(steps.at(-2), /TODO_/);
  assert.match(steps.at(-1), /non-production/);
});

test('the tailored checklist reaches plan.md', () => {
  const plan = { ...PLAN, design_brief: { data_source: 'webhook', external_auth: 'api-key' } };
  const md = renderPlanMarkdown(plan, buildState(plan, { today: '2026-07-26' }));
  assert.match(md, /## Human handoff \(Operations\)/);
  assert.match(md, /listener service/i);
  assert.match(md, /api-key/i);
});
