// A code editor (CodeMirror 6: spellcheck and autocorrect off) behaves exactly as without Lighthouse:
// prose tidying there would change code (f(a, b) losing its comma)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, select, text, press, type } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

const CODE = 'let x = f(a,  b);';
const CASES = [
    ['typing "(" at the end', [0, 17], [0, 17], (p) => type(p, '(')],
    ['typing "(x)" at the end', [0, 17], [0, 17], (p) => type(p, '(x)')],
    ['"(" over "a"', [0, 10], [0, 11], (p) => type(p, '(')],
    ['Backspace over "b"', [0, 14], [0, 15], (p) => press(p, 'Backspace')],
    ['Backspace over ",  b"', [0, 11], [0, 15], (p) => press(p, 'Backspace')],
    ['"z" over "x "', [0, 4], [0, 6], (p) => type(p, 'z')],
];
for (const [name, from, to, act] of CASES) {
    test(`CodeMirror 6: ${name}`, async () => {
        const result = async (lighthouse) => {
            const p = await open(browser, { lighthouse, settings: { brackets: 'close' } });
            await set(p, 'cm', [CODE]); await select(p, 'cm', from, to); await act(p);
            const t = await text(p, 'cm'); await p.close(); return t;
        };
        assert.strictEqual(await result(true), await result(false));
    });
}
