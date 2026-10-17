import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd, parseDuration } from '../../public/js/core/quick-add.js';

const TODAY = '2026-10-13'; // a Tuesday
test('extracts priority, tags, category, date and estimate', () => {
  const r = parseQuickAdd('Pay rent !high #bills #home @Finance tomorrow ~1h30m', TODAY);
  assert.deepEqual(r, { title: 'Pay rent', priority: 'high', tags: ['bills', 'home'], category: 'Finance', deadline: '2026-10-14', estimateMin: 90 });
});
test('weekday names resolve to the NEXT such day (never today)', () => {
  assert.equal(parseQuickAdd('x fri', TODAY).deadline, '2026-10-16');
  assert.equal(parseQuickAdd('x tuesday', TODAY).deadline, '2026-10-20');
});
test('plain words stay in the title; unknown !flags are kept as text', () => {
  const r = parseQuickAdd('Call mum !weird', TODAY);
  assert.equal(r.title, 'Call mum !weird');
  assert.equal(r.priority, null);
});
test('durations', () => {
  assert.equal(parseDuration('30m'), 30); assert.equal(parseDuration('2h'), 120); assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('abc'), null); assert.equal(parseDuration('0'), null);
});
test('empty or only-tokens input gives an empty title (caller must reject)', () => {
  assert.equal(parseQuickAdd('   !high #x', TODAY).title, '');
});
