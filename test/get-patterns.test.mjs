import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseDoc, renderIndex, runTopic, runSearch } from '../src/tools/get-patterns.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = await readFile(join(REPO, 'docs/studio-integration-patterns.md'), 'utf-8');
const doc = parseDoc(md);

test('parses the curated doc into level-2 sections', () => {
  const titles = doc.sections.map(s => s.title);
  for (const expected of ['Diagram Rules', 'MVEL Idioms and Gotchas', 'RAAS Patterns', 'Common Errors']) {
    assert.ok(titles.includes(expected), `missing section: ${expected}`);
  }
  assert.ok(doc.sections.length >= 15, `expected the full doc, got ${doc.sections.length} sections`);
});

test('headings inside code fences are not parsed as headings', () => {
  // A '#' comment in a bash/XML example must never become a section.
  for (const n of doc.nodes) {
    assert.ok(!/^[<#]/.test(n.title), `code content leaked as a heading: ${n.title}`);
  }
});

test('Diagram Rules carries the bulk of the diagram guidance', () => {
  const diag = doc.sections.find(s => s.title === 'Diagram Rules');
  assert.ok(diag, 'Diagram Rules section missing');
  assert.ok(diag.subsections.length >= 20,
    `expected 20+ subsections, got ${diag.subsections.length}`);
});

test('the index lists sections and subsections but not their bodies', () => {
  const idx = renderIndex(doc);
  assert.match(idx, /## Diagram Rules/);
  assert.match(idx, /- Insertion shift rule/);
  assert.ok(!idx.includes('## Table of Contents'), 'ToC is noise in an index');
  assert.ok(idx.length < md.length / 3, 'index should be far smaller than the doc');
});

test('topic returns a whole section, stopping at the next section', () => {
  const sec = runTopic(doc, 'Diagram Rules');
  assert.ok(sec.startsWith('## Diagram Rules'));
  assert.match(sec, /EMF XPath/);
  assert.ok(!sec.includes('## MVEL Idioms'), 'must not bleed into the next section');
});

test('topic returns a single subsection without its siblings', () => {
  const sub = runTopic(doc, 'Insertion shift rule');
  assert.ok(sub.startsWith('### Insertion shift rule'));
  assert.ok(!sub.includes('### Verification script'));
});

test('topic matching is case-insensitive and partial', () => {
  assert.ok(runTopic(doc, 'swimlane layout template').startsWith('### Swimlane layout template'));
});

test('an ambiguous topic returns a chooser instead of guessing', () => {
  const out = runTopic(doc, 'swimlane');
  assert.match(out, /matches/);
  assert.match(out, /retrieve one specifically/);
});

test('an unknown topic falls back to the index', () => {
  const out = runTopic(doc, 'no such heading zzz');
  assert.match(out, /No section or subsection matches/);
  assert.match(out, /## Diagram Rules/);
});

test('search finds subsections by body content', () => {
  const out = runSearch(doc, 'scala.MatchError');
  assert.match(out, /mention/);
  assert.match(out, /scala\.MatchError/);
  assert.ok(out.includes('###'), 'should return subsections, not whole sections');
});

test('search reaches beyond diagrams into MVEL and RAAS', () => {
  assert.match(runSearch(doc, 'java.time').toLowerCase(), /java\.time/);
  assert.match(runSearch(doc, 'getExtrapath'), /mention/);
});

test('search reports a clean miss', () => {
  assert.match(runSearch(doc, 'zznomatchxyz'), /No subsection mentions/);
});
