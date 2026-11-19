// The hidden clipboard page (background.js): opened for a read, not when the background starts; closed 20 s after the
// last read; opened again for the next; a read during a close waits for it. Run against a stand-in for Chrome, its clock
// ours, no browser needed
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm'), path = require('path');
const { ROOT } = require('./helpers');

function setup() {
    const src = fs.readFileSync(path.join(ROOT, 'src/background/background.js'), 'utf8');
    // Its code, found by the code (a store build has no comments): from its state to the end of readClipboard
    const from = src.indexOf('let creating'), fn = src.indexOf('async function readClipboard', from), part = src.slice(from, src.indexOf('\n}', fn) + 2);
    const s = { now: 0, timers: [], open: false, created: 0, closed: 0, closeDelay: 0 };
    const clock = { setTimeout: (f, ms) => { const t = { at: s.now + ms, f }; s.timers.push(t); return t; }, clearTimeout: (t) => { s.timers = s.timers.filter(x => x !== t); } };
    const chrome = { offscreen: {
            hasDocument: async () => s.open,
            createDocument: async () => { s.created++; s.open = true; },
            closeDocument: () => new Promise(r => setTimeout(() => { s.open = false; s.closed++; r(); }, s.closeDelay)) },
        runtime: { sendMessage: async () => { if (!s.open) throw new Error('no document'); return { text: 'clip' }; } } };
    const ctx = { chrome, ...clock }; vm.createContext(ctx); vm.runInContext(part + '\nthis.read = () => readClipboard({ tab: { active: true } });', ctx);
    s.read = ctx.read;
    s.advance = async (ms) => { s.now += ms; for (const t of s.timers.filter(t => t.at <= s.now)) { s.timers = s.timers.filter(x => x !== t); t.f(); } await new Promise(r => setTimeout(r, 10)); };
    return s;
}

test('opened for a read, closed 20 s after the last one, opened again', async () => {
    const s = setup();
    assert.strictEqual(s.created, 0, 'not opened when the background starts');
    assert.strictEqual((await s.read()).text, 'clip');
    await s.advance(10000); await s.read();
    assert.strictEqual(s.created, 1, 'a read within 20 s reuses it');
    await s.advance(15000); assert.ok(s.open, 'the wait restarts with each read');
    await s.advance(6000); assert.ok(!s.open, 'closed 20 s after the last read');
    assert.strictEqual((await s.read()).text, 'clip'); assert.strictEqual(s.created, 2, 'opened again');
});

test('a read during a close waits for it, then opens the page again', async () => {
    const s = setup(); s.closeDelay = 50;
    await s.read(); await s.advance(20000);
    assert.strictEqual((await s.read()).text, 'clip');
    assert.ok(s.open); assert.strictEqual(s.created, 2);
});
