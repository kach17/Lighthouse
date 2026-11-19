// Drag handles sit on the selected text: in a text field, a line break at either end of the selection (one begun
// past a line's end, a whole line taken with Shift+↓) puts the handles where they'd be without it
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, press, wait, drag, inBar, barBox } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

const TEXT = 'The quick brown fox jumps.\nOver the lazy dog it went.\nAnd then it slept soundly.';
// Selected as a person would with the keyboard (Shift+→ makes the last character), then the handles read
async function handlesFor(from, to) {
    const p = await open(browser, { settings: { addDragHandles: true }, openShadow: true });
    await p.evaluate((t, from, to) => { const ta = document.getElementById('ta'); ta.style.height = '110px'; ta.value = t; ta.focus(); ta.setSelectionRange(from, to - 1); }, TEXT, from, to);
    await press(p, 'Shift+ArrowRight'); await wait(600);
    const handles = await inBar(p, (root) => root ? [...root.querySelectorAll('.lighthouse-tooltip-draghandle')].map(h => h.style.transform).sort() : []);
    await p.close();
    return handles;
}

const line2 = TEXT.indexOf('Over'), line2End = TEXT.indexOf('went.') + 5;
const CASES = [
    ['a line break before', [line2 - 1, line2 + 20], [line2, line2 + 20]],
    ['a line break after (a whole line)', [line2, line2End + 1], [line2, line2End]],
    ['line breaks on both sides', [line2 - 1, line2End + 1], [line2, line2End]],
];
for (const [name, withBreak, without] of CASES) {
    test(`textarea: ${name}`, async () => {
        const expected = await handlesFor(...without);
        assert.strictEqual(expected.length, 2, 'both handles shown');
        assert.deepStrictEqual(await handlesFor(...withBreak), expected);
    });
}

// A long page before the selection (a conversation), and a drag ending past the last line: the end handle sits after
// the last selected word, not at the edge of whatever the drag ended in
test('page: a drag past the end, many paragraphs before it', async () => {
    const p = await open(browser, { settings: { addDragHandles: true }, openShadow: true });
    await p.evaluate(() => {
        const thread = document.createElement('div'); thread.style.cssText = 'font:16px/1.5 sans-serif; width:600px';
        thread.innerHTML = Array.from({ length: 700 }, (_, i) => `<p style="margin:0">Earlier message ${i}</p>`).join('')
            + '<ul id="answer"><li><b>One:</b> the first point.</li><li><b>Two:</b> the last point here.</li></ul><div style="height:80px"></div><div>actions</div>';
        document.body.prepend(thread);
        document.getElementById('answer').scrollIntoView({ block: 'center' });
    });
    await wait(200);
    const at = await p.evaluate(() => {
        const lis = document.querySelectorAll('#answer li'), t = lis[0].lastChild, r = document.createRange(); r.setStart(t, 5); r.setEnd(t, 5);
        const a = r.getBoundingClientRect(), z = lis[1].getBoundingClientRect(), last = document.createRange(); last.selectNodeContents(lis[1].lastChild);
        const e = last.getBoundingClientRect();
        return { from: [a.left, a.top + a.height / 2], to: [z.right + 120, z.bottom + 30], wordEnd: [e.right, e.top] };
    });
    await drag(p, at.from, at.to, { steps: 10 });
    const end = await inBar(p, (root) => {
        const lines = [...root.querySelectorAll('.lighthouse-tooltip-draghandle-line')].map(e => e.getBoundingClientRect());
        const q = lines.sort((a, b) => a.top - b.top).pop(); return { left: q.left, top: q.top };
    });
    assert.ok(Math.abs(end.left - at.wordEnd[0]) < 6 && Math.abs(end.top - at.wordEnd[1]) < 6, `end handle at ${Math.round(end.left)},${Math.round(end.top)}; the last word ends at ${Math.round(at.wordEnd[0])},${Math.round(at.wordEnd[1])}`);
    await p.close();
});

// A selection whose box runs far past what is seen (the rest of an answer clipped in a scrolling panel, as on
// some chat pages), both ends on screen: the bar sits at its first line, not pinned to the top of the screen
test('page: the bar by the selection\'s ends when its box runs off screen', async () => {
    const p = await open(browser, { settings: { addDragHandles: true }, openShadow: true });
    await p.setViewport({ width: 1100, height: 760 });
    await p.evaluate(() => {
        document.body.innerHTML = `<div style="position:fixed; top:0; left:0; right:0; height:620px; overflow:auto; font:18px/1.6 sans-serif; padding:20px 60px">
            ${Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i} above the selection.</p>`).join('')}
            <p id="first">Clothing: a heavy blazer worn open over a plain shirt.</p>
            ${Array.from({ length: 40 }, (_, i) => `<p>More of the answer, paragraph ${i}, well below the panel's visible area.</p>`).join('')}</div>
            <div id="footer" style="position:fixed; bottom:12px; left:60px; font:14px sans-serif">The assistant can make mistakes. Your privacy and settings</div>`;
    });
    await wait(200);
    const pt = await p.evaluate(() => { const t = document.getElementById('first').firstChild, r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 0); const a = r.getBoundingClientRect();
        const f = document.getElementById('footer').firstChild, z = document.createRange(); z.setStart(f, 50); z.setEnd(f, 50); const e = z.getBoundingClientRect(); return [a.left + 1, a.top + a.height / 2, e.left, e.top + e.height / 2, a.top]; });
    await drag(p, [pt[0], pt[1]], [pt[2], pt[3]], { steps: 1 });
    const bar = await barBox(p);
    assert.match(bar.mode, /mode-top\b/);
    assert.ok(bar.bottom <= pt[4] && pt[4] - bar.bottom < 40, `the bar (bottom ${Math.round(bar.bottom)}) sits just above the first line (${Math.round(pt[4])})`);
    await p.close();
});
