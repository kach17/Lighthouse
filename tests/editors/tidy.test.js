// Tidy spacing: deleting, cutting and typing over a selection leave one clean join, in every editor; the joins
// themselves (tidySeam, through insertText) on a range of text
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, select, text, press, type } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

const TEXT = 'I want small noodles';   // "small": columns 7 to 12
async function edit(ed, from, to, act) {
    const p = await open(browser);
    await set(p, ed, [TEXT]);
    await select(p, ed, from, to);
    await act(p);
    const result = await text(p, ed);
    await p.close();
    return result;
}

for (const ed of ['ta', 'in', 'ce', 'pm', 'lx', 'ql']) {
    test(`${ed}: Backspace over "small"`, async () => assert.strictEqual(await edit(ed, [0, 7], [0, 12], (p) => press(p, 'Backspace')), 'I want noodles'));
    test(`${ed}: Delete over "small"`, async () => assert.strictEqual(await edit(ed, [0, 7], [0, 12], (p) => press(p, 'Delete')), 'I want noodles'));
    test(`${ed}: Backspace over " small"`, async () => assert.strictEqual(await edit(ed, [0, 6], [0, 12], (p) => press(p, 'Backspace')), 'I want noodles'));
    test(`${ed}: Ctrl+X over "small"`, async () => assert.strictEqual(await edit(ed, [0, 7], [0, 12], (p) => press(p, 'Control+KeyX')), 'I want noodles'));
    test(`${ed}: typing over "small " keeps the space`, async () => assert.strictEqual(await edit(ed, [0, 7], [0, 13], (p) => type(p, 'big')), 'I want big noodles'));
}

// Word deletion is the browser's own (a shortcut people know by heart): untouched
test('Ctrl+Backspace is the browser\'s', async () => {
    assert.strictEqual(await edit('ta', [0, 12], [0, 12], (p) => p.keyboard.down('Control').then(() => p.keyboard.press('Backspace', { commands: ['deleteWordBackward'] })).then(() => p.keyboard.up('Control'))), 'I want  noodles');
});

// The joins themselves: [text, selected (first occurrence, or [from, to]), inserted, expected]
const JOINS = [
    ['Hello, world!', 'world', '', 'Hello!'],
    ['Hello world. Bye.', 'Bye.', '', 'Hello world.'],
    ['Hello world. Bye.', 'Hello world. ', '', 'Bye.'],
    ['Hello world. Bye.', 'Hello world.', '', 'Bye.'],
    ['I like (small) noodles', 'small', '', 'I like noodles'],
    ['one, two, three', 'two', '', 'one, three'],
    ['one, two, three', 'three', '', 'one, two'],
    ['Well, I like cats.', 'Well', '', 'I like cats.'],
    ['I like cats.', 'cats', '', 'I like.'],
    ['He said "hello" loudly', 'hello', '', 'He said loudly'],
    ['visit www.x.com today', 'www.x.com', '', 'visit today'],
    ['foo\n  bar baz', 'bar', '', 'foo\n  baz'],
    ["c'est vrai !", 'vrai', '', "c'est !"],
    ['Is it ¿verdad? sí', 'verdad', '', 'Is it sí'],
    ['我想要小面条', '小', '', '我想要面条'],
    ['call f(x) now', 'x', '', 'call f() now'],
    ['I want noodles', [7, 7], 'small', 'I want small noodles'],
    ['I want noodles', [6, 6], 'small', 'I want small noodles'],
    ['I want noodles.', [14, 14], 'today', 'I want noodles today.'],
    ['I want noodles.', [15, 15], 'Now', 'I want noodles. Now'],
    ['Hello world', [5, 5], ',', 'Hello, world'],
    ['Hello world', [11, 11], '!', 'Hello world!'],
    ['price 1,', [8, 8], '5', 'price 1,5'],
    ['我想要面条', [3, 3], '小', '我想要小面条'],
    ['small', [1, 3], 'x', 'sxll'],                       // between two letters of a word: no spaces
];
test('joins: deletions and insertions through insertText', async () => {
    const p = await open(browser);
    for (const [t, sel, ins, want] of JOINS) {
        const got = await p.evaluate((t, sel, ins) => {
            const el = document.getElementById('ta'); el.value = t; el.focus();
            const [s, e] = Array.isArray(sel) ? sel : [t.indexOf(sel), t.indexOf(sel) + sel.length];
            el.setSelectionRange(s, e); LighthouseSelection.insertText(el, ins); return el.value;
        }, t, sel, ins);
        assert.strictEqual(got, want, `${JSON.stringify(t)}, ${ins ? 'insert ' + JSON.stringify(ins) : 'delete'} at ${JSON.stringify(sel)}`);
    }
    await p.close();
});
