import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findElementById, findInboundRefs, removeFromAssembly, removeFromDiagram,
} from '../src/tools/delete-assembly-step.mjs';
import { validateAssembly } from '../src/assembly-validator.mjs';
import { ASSEMBLY, DIAGRAM } from './fixtures/assembly.mjs';

test('locates a top-level element and computes its @mixed index (2P-1)', () => {
  const orphan = findElementById(ASSEMBLY, 'OrphanStep');
  assert.ok(orphan, 'OrphanStep not found');
  assert.equal(orphan.isTopLevel, true);
  assert.equal(orphan.mixedIndex, 7, 'position 4 → @mixed.7');

  assert.equal(findElementById(ASSEMBLY, 'GlobalErrorHandler').mixedIndex, 17);
});

test('nested elements are found but are not top-level', () => {
  const evalA = findElementById(ASSEMBLY, 'EvalA');
  assert.ok(evalA);
  assert.equal(evalA.isTopLevel, false);
  assert.equal(evalA.mixedIndex, null);
});

test('missing id returns null', () => {
  assert.equal(findElementById(ASSEMBLY, 'NoSuchStep'), null);
});

test('block scan is balanced — a step ends at its own close tag', () => {
  const a = findElementById(ASSEMBLY, 'DoStepA');
  const block = ASSEMBLY.slice(a.start, a.end);
  assert.ok(block.includes('DoStepAError'), 'should contain its own send-error');
  assert.ok(!block.includes('cc:route'), 'must not swallow the following element');
});

test('detects inbound references in all three forms', () => {
  const stepB = findElementById(ASSEMBLY, 'DoStepB');
  assert.equal(findInboundRefs(ASSEMBLY, 'DoStepB', stepB).length, 1, 'routes-to from Route1');

  const callTail = findElementById(ASSEMBLY, 'CallTail');
  assert.equal(findInboundRefs(ASSEMBLY, 'CallTail', callTail).length, 2,
    'routes-to from DoStepB + routes-to from DoStepAError');

  const tailFlow = findElementById(ASSEMBLY, 'TailFlow');
  const vm = findInboundRefs(ASSEMBLY, 'TailFlow', tailFlow);
  assert.equal(vm.length, 1);
  assert.equal(vm[0].kind, 'vm:// endpoint');
});

test('a step referenced by nobody has no inbound refs', () => {
  const orphan = findElementById(ASSEMBLY, 'OrphanStep');
  assert.deepEqual(findInboundRefs(ASSEMBLY, 'OrphanStep', orphan), []);
});

test('removal drops the element and shifts later positions', () => {
  const orphan = findElementById(ASSEMBLY, 'OrphanStep');
  const after = removeFromAssembly(ASSEMBLY, orphan).updated;

  assert.ok(!after.includes('OrphanStep'));
  assert.ok(after.includes('DoStepB') && after.includes('Route1'), 'neighbours survive');
  assert.equal(findElementById(after, 'DoStepB').mixedIndex, 7, 'DoStepB shifts 9 → 7');
});

test('diagram mirroring removes all three entry kinds and re-numbers @mixed', () => {
  const orphan = findElementById(ASSEMBLY, 'OrphanStep');
  const d = removeFromDiagram(DIAGRAM, 'OrphanStep', orphan.mixedIndex);

  assert.equal(d.visualProperties, 1);
  assert.equal(d.connections, 1, 'the Route1 → OrphanStep arrow');
  assert.equal(d.swimlaneRefs, 2, 'id-form + positional-form membership');
  assert.ok(!d.updated.includes('#OrphanStep'), 'no id refs left');

  // < deleted index: unchanged. > deleted index: shifted by -2.
  assert.ok(d.updated.includes('@mixed.1/@mixed.3/@mixed.3'), 'lower index untouched');
  assert.ok(d.updated.includes('@mixed.1/@mixed.15'), '17 → 15');
  assert.ok(!d.updated.includes('@mixed.1/@mixed.17'));
  assert.equal(d.shiftedRefs, 2);

  // The deleted element's own positional ref is dropped BEFORE the shift, so
  // exactly one @mixed.7 remains — the one that shifted down from 9.
  assert.equal((d.updated.match(/@mixed\.1\/@mixed\.7"/g) || []).length, 1);
});

test('deleting a nested element shifts no positional refs', () => {
  const d = removeFromDiagram(DIAGRAM, 'EvalA', null);
  assert.equal(d.shiftedRefs, 0);
  assert.ok(d.updated.includes('@mixed.1/@mixed.17'), 'top-level refs untouched');
});

test('validator: unmirrored delete is caught, mirrored delete is clean', () => {
  const orphan = findElementById(ASSEMBLY, 'OrphanStep');
  const after = removeFromAssembly(ASSEMBLY, orphan).updated;

  // Known-bad: assembly changed, diagram not updated.
  const stale = validateAssembly(after, null, DIAGRAM);
  assert.ok(stale.some(i => i.code === 'STALE_DIAGRAM_HREF'),
    'dangling diagram href must be reported');

  // Known-good: both files updated together.
  const mirrored = removeFromDiagram(DIAGRAM, 'OrphanStep', orphan.mixedIndex);
  const clean = validateAssembly(after, null, mirrored.updated);
  assert.ok(!clean.some(i => i.code === 'STALE_DIAGRAM_HREF'));
  assert.ok(!clean.some(i => i.code.startsWith('BROKEN_ROUTES')));
});

test('force-deleting a routed-to step leaves a broken route for the validator', () => {
  const b = findElementById(ASSEMBLY, 'DoStepB');
  const asm = removeFromAssembly(ASSEMBLY, b).updated;
  const diag = removeFromDiagram(DIAGRAM, 'DoStepB', b.mixedIndex);

  const issues = validateAssembly(asm, null, diag.updated);
  assert.ok(issues.some(i => i.code === 'BROKEN_ROUTES_TO'),
    'Route1 still points at the deleted step');
});
