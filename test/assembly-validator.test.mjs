import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateAssembly } from '../src/assembly-validator.mjs';

const wrap = (body) =>
  `<beans xmlns:cc="http://www.capeclear.com/assembly/10">\n<cc:assembly name="INT999">\n${body}\n</cc:assembly>\n</beans>`;

const codes = (xml, wsDir = null, diagram = null) =>
  validateAssembly(xml, wsDir, diagram).map(i => i.code);

/**
 * Each rule is asserted twice: it must FIRE on a minimal violating input and
 * stay SILENT on the corresponding clean input. A rule that only ever fires is
 * indistinguishable from a rule that always fires.
 */
const cases = [
  {
    code: 'XML_COMMENTS_PRESENT',
    bad: wrap(`  <!-- shifts every @mixed index -->\n  <cc:local-in id="A" routes-to="B"/>\n  <cc:async-mediation id="B"/>`),
    good: wrap(`  <cc:local-in id="A" routes-to="B"/>\n  <cc:async-mediation id="B"/>`),
  },
  {
    code: 'BROKEN_ROUTES_TO',
    bad: wrap(`  <cc:local-in id="A" routes-to="Nope"/>`),
    good: wrap(`  <cc:local-in id="A" routes-to="B"/>\n  <cc:async-mediation id="B"/>`),
  },
  {
    code: 'SPLITTER_HAS_ROUTES_TO',
    bad: wrap(`  <cc:splitter id="S" routes-to="B"><cc:sub-route routes-to="B"/></cc:splitter>\n  <cc:async-mediation id="B"/>`),
    good: wrap(`  <cc:splitter id="S"><cc:sub-route routes-to="B"/></cc:splitter>\n  <cc:async-mediation id="B"/>`),
  },
  {
    code: 'LOG_HAS_CONDITION',
    bad: wrap(`  <cc:async-mediation id="M"><cc:steps>\n      <cc:log id="L" condition="props['x']=='1'"><cc:log-message><cc:text>hi</cc:text></cc:log-message></cc:log>\n    </cc:steps></cc:async-mediation>`),
    good: wrap(`  <cc:async-mediation id="M"><cc:steps>\n      <cc:log id="L"><cc:log-message><cc:text>hi</cc:text></cc:log-message></cc:log>\n    </cc:steps></cc:async-mediation>`),
  },
  {
    code: 'MVEL_SEMICOLON_IN_STRING',
    // A ';' inside a single-quoted MVEL literal fails the ENTIRE deploy.
    bad: wrap(`  <cc:async-mediation id="M"><cc:steps>\n      <cc:eval id="E"><cc:expression>props['m'] = 'a; b'</cc:expression></cc:eval>\n    </cc:steps></cc:async-mediation>`),
    good: wrap(`  <cc:async-mediation id="M"><cc:steps>\n      <cc:eval id="E"><cc:expression>props['m'] = 'a, b'</cc:expression></cc:eval>\n    </cc:steps></cc:async-mediation>`),
  },
  {
    code: 'JAVA_TIME_IN_PER_MESSAGE_EVAL',
    // Per-message evals cannot resolve java.time FQCNs at RUNTIME...
    bad: wrap(`  <cc:async-mediation id="M"><cc:steps>\n      <cc:eval id="DoDecide"><cc:expression>props['d'] = java.time.LocalDate.parse(props['iso'])</cc:expression></cc:eval>\n    </cc:steps></cc:async-mediation>`),
    // ...but the run-scoped bootstrap eval is exempt.
    good: wrap(`  <cc:async-mediation id="M"><cc:steps>\n      <cc:eval id="InitializeProperties"><cc:expression>props['d'] = java.time.LocalDate.now()</cc:expression></cc:eval>\n    </cc:steps></cc:async-mediation>`),
  },
  {
    code: 'CC_NOTE_IN_ASSEMBLY',
    bad: wrap(`  <cc:note id="N"/>`),
    good: wrap(`  <cc:async-mediation id="B"/>`),
  },
];

for (const { code, bad, good } of cases) {
  test(`${code} fires on a violation`, () => {
    assert.ok(codes(bad).includes(code), `expected ${code}, got ${JSON.stringify(codes(bad))}`);
  });
  test(`${code} stays silent on clean input`, () => {
    assert.ok(!codes(good).includes(code), `unexpected ${code} in ${JSON.stringify(codes(good))}`);
  });
}

// ─── Diagram-aware rules (need both files) ───────────────────────────────────

const DIAG_ASM = wrap(
  `  <cc:local-in id="A" routes-to="B"/>\n  <cc:async-mediation id="B"/>\n  <cc:send-error id="GlobalErrorHandler" rethrow-error="false"/>`);

test('SEND_ERROR_ID_IN_DIAGRAM fires when a send-error is referenced by id', () => {
  const bad = `<diagram><visualProperties><element href="assembly.xml#GlobalErrorHandler"/></visualProperties></diagram>`;
  assert.ok(codes(DIAG_ASM, null, bad).includes('SEND_ERROR_ID_IN_DIAGRAM'));
});

test('SEND_ERROR_ID_IN_DIAGRAM silent when referenced positionally', () => {
  const good = `<diagram><connections type="routesTo"><source href="assembly.xml#//@beans/@mixed.1/@mixed.5"/><target href="assembly.xml#B"/></connections></diagram>`;
  assert.ok(!codes(DIAG_ASM, null, good).includes('SEND_ERROR_ID_IN_DIAGRAM'));
});

test('STALE_DIAGRAM_HREF fires for an href with no matching element', () => {
  const bad = `<diagram><visualProperties><element href="assembly.xml#GhostStep"/></visualProperties></diagram>`;
  assert.ok(codes(DIAG_ASM, null, bad).includes('STALE_DIAGRAM_HREF'));
});

test('POSITIONAL_REF_EVEN_INDEX fires — even indices are whitespace, not elements', () => {
  const bad = `<diagram><connections type="routesTo"><source href="assembly.xml#//@beans/@mixed.1/@mixed.4"/><target href="assembly.xml#B"/></connections></diagram>`;
  assert.ok(codes(DIAG_ASM, null, bad).includes('POSITIONAL_REF_EVEN_INDEX'));
});

test('POSITIONAL_REF_OUT_OF_RANGE fires past the last element', () => {
  const bad = `<diagram><connections type="routesTo"><source href="assembly.xml#//@beans/@mixed.1/@mixed.999"/><target href="assembly.xml#B"/></connections></diagram>`;
  assert.ok(codes(DIAG_ASM, null, bad).includes('POSITIONAL_REF_OUT_OF_RANGE'));
});

test('a fully mirrored assembly + diagram produces no diagram findings', () => {
  const diagram = `<diagram>
  <visualProperties x="10" y="10"><element href="assembly.xml#A"/></visualProperties>
  <visualProperties x="20" y="10"><element href="assembly.xml#B"/></visualProperties>
  <connections type="routesTo"><source href="assembly.xml#A"/><target href="assembly.xml#B"/></connections>
</diagram>`;
  const found = codes(DIAG_ASM, null, diagram);
  for (const c of ['STALE_DIAGRAM_HREF', 'SEND_ERROR_ID_IN_DIAGRAM',
    'POSITIONAL_REF_EVEN_INDEX', 'POSITIONAL_REF_OUT_OF_RANGE']) {
    assert.ok(!found.includes(c), `unexpected ${c}`);
  }
});
