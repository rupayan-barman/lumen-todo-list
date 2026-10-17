// Safe Markdown: text -> AST (pure, unit-tested). The DOM renderer in ui/markdown-view.js builds
// elements with createElement/textContent only, so note content can never inject HTML or script.
// Images are NOT rendered (they would trigger network requests); they degrade to their alt text.

export function safeUrl(u) {
  if (typeof u !== 'string') return null;
  const t = u.trim();
  if (!/^(https?:\/\/|mailto:)/i.test(t)) return null;
  try { new URL(t); } catch { return null; }
  return t;
}

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!~|>'.split(''));
const LINK_RE = /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/y;
const IMG_RE = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/y;
const URL_RE = /https?:\/\/[^\s<>()\[\]]+[^\s<>()\[\].,;:!?'"]/y;

export function parseInline(s, depth = 0) {
  const out = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.has(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { flush(); out.push({ t: 'code', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    }
    if (depth < 4) {
      if ((c === '*' && s[i + 1] === '*') || (c === '_' && s[i + 1] === '_')) {
        const d = c + c;
        const j = s.indexOf(d, i + 2);
        if (j > i + 2) { flush(); out.push({ t: 'strong', c: parseInline(s.slice(i + 2, j), depth + 1) }); i = j + 2; continue; }
      }
      if (c === '~' && s[i + 1] === '~') {
        const j = s.indexOf('~~', i + 2);
        if (j > i + 2) { flush(); out.push({ t: 'del', c: parseInline(s.slice(i + 2, j), depth + 1) }); i = j + 2; continue; }
      }
      if ((c === '*' || c === '_') && s[i + 1] && s[i + 1] !== ' ' && s[i + 1] !== c) {
        const prev = s[i - 1];
        const okStart = c === '*' || !prev || !/[A-Za-z0-9]/.test(prev);
        if (okStart) {
          let j = i + 1;
          while ((j = s.indexOf(c, j)) !== -1 && (s[j - 1] === ' ' || s[j + 1] === c)) j++;
          if (j > i + 1) { flush(); out.push({ t: 'em', c: parseInline(s.slice(i + 1, j), depth + 1) }); i = j + 1; continue; }
        }
      }
      if (c === '!' && s[i + 1] === '[') {
        IMG_RE.lastIndex = i;
        const m = IMG_RE.exec(s);
        if (m) { buf += m[1] || 'image'; i += m[0].length; continue; }
      }
      if (c === '[') {
        LINK_RE.lastIndex = i;
        const m = LINK_RE.exec(s);
        if (m) {
          flush();
          const href = safeUrl(m[2]);
          if (href) out.push({ t: 'link', href, c: parseInline(m[1] || href, depth + 1) });
          else out.push({ t: 'text', v: m[1] });
          i += m[0].length;
          continue;
        }
      }
      if (c === 'h' && (s.startsWith('http://', i) || s.startsWith('https://', i)) && (i === 0 || /[\s(]/.test(s[i - 1]))) {
        URL_RE.lastIndex = i;
        const m = URL_RE.exec(s);
        if (m) { flush(); const href = safeUrl(m[0]); if (href) { out.push({ t: 'link', href, c: [{ t: 'text', v: m[0] }] }); i += m[0].length; continue; } }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const FENCE = /^```\s*([A-Za-z0-9_+#.-]{0,20})\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}
const isTableSep = (line) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-') && line.includes('|');

export function parseMarkdown(src, depth = 0) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const MAX_BLOCKS = 20000;

  while (i < lines.length && blocks.length < MAX_BLOCKS) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const f = FENCE.exec(line.trim());
    if (f && line.trim().startsWith('```')) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      blocks.push({ t: 'code', lang: f[1] || '', v: body.join('\n') });
      continue;
    }

    const hm = HEADING.exec(line);
    if (hm) { blocks.push({ t: 'h', l: hm[1].length, c: parseInline(hm[2]) }); i++; continue; }

    if (HR.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    if (/^\s{0,3}>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      blocks.push({ t: 'quote', c: depth < 5 ? parseMarkdown(body.join('\n'), depth + 1) : [{ t: 'p', c: [{ t: 'text', v: body.join(' ') }] }] });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const sep = splitRow(lines[i + 1]);
      const align = sep.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && rows.length < 500) rows.push(splitRow(lines[i++]));
      blocks.push({
        t: 'table', align,
        head: head.map((c) => parseInline(c)),
        rows: rows.map((r) => head.map((_, k) => parseInline(r[k] ?? ''))),
      });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m) {
          const indent = m[1].replace(/\t/g, '    ').length;
          let text = m[3];
          let checked = null;
          const tm = TASK.exec(text);
          if (tm) { checked = tm[1] !== ' '; text = tm[2]; }
          items.push({ indent, ordered: /\d/.test(m[2][0]), checked, c: parseInline(text) });
          i++;
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].c.push({ t: 'text', v: ' ' }, ...parseInline(lines[i].trim())); // lazy continuation
          i++;
        } else break;
      }
      blocks.push(buildList(items));
      continue;
    }

    // paragraph: consecutive non-empty lines that do not start another block
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i].trim()) && !HEADING.test(lines[i]) && !/^\s{0,3}>/.test(lines[i]) && !LIST_ITEM.test(lines[i]) && !HR.test(lines[i])) {
      para.push(lines[i++]);
    }
    const c = [];
    para.forEach((l, k) => {
      if (k > 0) c.push({ t: 'br' });
      c.push(...parseInline(l.trim()));
    });
    blocks.push({ t: 'p', c });
  }
  return blocks;
}

function buildList(flat) {
  const root = { t: 'list', ordered: flat[0].ordered, items: [] };
  const stack = [{ indent: flat[0].indent, list: root }];
  for (const it of flat) {
    while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];
    if (it.indent > top.indent && top.list.items.length) {
      const parent = top.list.items[top.list.items.length - 1];
      const sub = { t: 'list', ordered: it.ordered, items: [] };
      (parent.children ??= []).push(sub);
      stack.push({ indent: it.indent, list: sub });
      top = stack[stack.length - 1];
    }
    top.list.items.push({ checked: it.checked, c: it.c });
  }
  return root;
}

/** Plain-text preview (for lists/search snippets). */
export function stripMarkdown(src, max = 160) {
  const t = String(src ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\s]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Toggle the Nth task-list checkbox (counting only outside code fences). Returns the new source. */
export function toggleCheckbox(src, index) {
  const lines = String(src).split('\n');
  let n = -1;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim().startsWith('```')) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\]\s)/.exec(l);
    if (m && ++n === index) {
      lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3] + l.slice(m[0].length);
      break;
    }
  }
  return lines.join('\n');
}
