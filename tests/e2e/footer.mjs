import { test, open, shot } from './harness.mjs';
import assert from 'node:assert/strict';
for (const [name, vp, mode] of [['desktop-dark', { width: 1280, height: 800 }, 'dark'], ['desktop-light', { width: 1280, height: 800 }, 'light'], ['mobile', { width: 390, height: 780 }, 'dark']]) {
  test('footer ' + name, async (t) => {
    const p = await t.newPage({ viewport: vp, colorScheme: mode }); await open(p, 'tasks');
    const r = await p.evaluate(() => { const f = document.querySelector('.site-footer'); const tx = f.querySelector('.site-footer__text').getBoundingClientRect(); const m = document.getElementById('main').getBoundingClientRect(); const main = document.querySelector('.main-col').getBoundingClientRect(); const nav = document.querySelector('.bottom-nav'); return { text: f.innerText, cx: Math.round(tx.left + tx.width / 2), mcx: Math.round(main.left + main.width / 2), bottomGap: Math.round(window.innerHeight - tx.bottom), overlap: nav && getComputedStyle(nav).display !== 'none' ? tx.bottom > nav.getBoundingClientRect().top : false, hscroll: document.documentElement.scrollWidth > innerWidth, mainBottom: Math.round(m.bottom), footTop: Math.round(tx.top) }; });
    assert.equal(r.text, 'Created by Rupayan Barman'); assert.ok(Math.abs(r.cx - r.mcx) <= 1); assert.equal(r.overlap, false); assert.equal(r.hscroll, false); assert.ok(r.footTop >= r.mainBottom);
    await shot(p, 'footer-' + name);
  });
}
