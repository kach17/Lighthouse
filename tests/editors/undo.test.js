// Undo stays universal: every Lighthouse edit is one step in the browser's or the editor's own history
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, select, text, press, type, undo, wait } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

const TEXT = 'I want small noodles';
const EDITS = [
    ['Backspace over "small"', [0, 7], [0, 12], (p) => press(p, 'Backspace')],
    ['typing over "small "', [0, 7], [0, 13], (p) => type(p, 'b')],
    ['wrapping "small"', [0, 7], [0, 12], (p) => type(p, '(')],
    ['auto-closing "("', [0, 20], [0, 20], (p) => type(p, '(')],
];
for (const ed of ['ta', 'ce', 'pm', 'lx', 'ql']) for (const [name, from, to, act] of EDITS) {
    test(`${ed}: ${name}, then one undo`, async () => {
        const p = await open(browser, { settings: { brackets: 'close' } });
        await set(p, ed, [TEXT]); await select(p, ed, from, to);
        await act(p); await wait(150);
        assert.notStrictEqual(await text(p, ed), TEXT, 'the edit happened');
        await undo(p, ed); await wait(150);
        assert.strictEqual(await text(p, ed), TEXT);
        await p.close();
    });
}
