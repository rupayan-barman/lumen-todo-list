import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, safeUrl, stripMarkdown, toggleCheckbox } from '../../public/js/core/markdown.js';

const flat = (n) => JSON.stringify(n);

test('raw HTML stays literal text (never an element node)', () => {
  const ast = parseMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script>');
  assert.ok(!flat(ast).includes('"t":"html"'));
  assert.ok(flat(ast).includes('<script>'));  // as plain text; the DOM renderer uses textContent
});
test('javascript: and data: links are not linkified', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,<b>'), null);
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  const inl = parseInline('[x](javascript:alert(1))');
  assert.ok(!inl.some((n) => n.t === 'link'));
});
test('images never become network requests', () => {
  const inl = parseInline('![cat](https://x.test/c.png)');
  assert.ok(!inl.some((n) => n.t === 'img'));
});
test('headings, lists, tasks, code, tables', () => {
  const ast = parseMarkdown('# T\n\n- [x] done\n- [ ] todo\n  - nested\n\n```js\nlet a = 1;\n```\n\n| a | b |\n|---|:-:|\n| 1 | 2 |');
  assert.equal(ast[0].t, 'h');
  assert.equal(ast[1].t, 'list');
  assert.equal(ast[1].items[0].checked, true);
  assert.equal(ast[1].items[1].children[0].items[0].c[0].v, 'nested');
  assert.equal(ast[2].t, 'code');
  assert.equal(ast[3].t, 'table');
  assert.equal(ast[3].align[1], 'center');
});
test('toggleCheckbox flips the Nth box and ignores code fences', () => {
  const src = '- [ ] a\n```\n- [ ] fake\n```\n- [ ] b';
  assert.equal(toggleCheckbox(src, 1), '- [ ] a\n```\n- [ ] fake\n```\n- [x] b');
});
test('stripMarkdown gives a plain preview', () => {
  assert.equal(stripMarkdown('# Hi **there** [link](http://a.b)'), 'Hi there link');
});
test('pathological input terminates quickly', () => {
  const t = Date.now();
  parseMarkdown('*'.repeat(20000) + '\n' + '['.repeat(5000) + '\n' + '`'.repeat(5000));
  assert.ok(Date.now() - t < 2000);
});
