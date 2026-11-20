// Send: a selection in the page goes into the composer (the last multi-line box typed in on this page) where its
// caret was; "Send as quote" in its popover. Offered only then; the page doesn't scroll; one undo step
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, select, text, press, type, undo, wait, drag, inBar, clickBar, point, popover } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

// A page with text to select above the editors (and, with tall, a page long enough to scroll)
// Send first on the bar: its place doesn't depend on the default order (only four buttons show)
async function page({ tall = false } = {}) {
    const p = await open(browser, { openShadow: true, settings: { order: ['send', 'copy', 'search', 'translate', 'cut', 'paste'] } });
    await p.evaluate((tall) => {
        document.body.insertAdjacentHTML('afterbegin', '<div id="src" style="font: 18px sans-serif; margin: 20px"><p>The quick brown fox jumps.</p><p>Over the lazy dog it went.</p></div>');
        if (tall) document.getElementById('src').insertAdjacentHTML('afterend', '<div style="height: 2000px"></div>');
    }, tall);
    return p;
}
// Written in: the lines set, the caret placed, then typed (as a person writes in it)
async function writeIn(p, ed, lines, caret, typed) { await set(p, ed, lines); await select(p, ed, caret); await type(p, typed); }
// Page text selected with the mouse: from [paragraph, offset] to [paragraph, offset]
async function selectPage(p, from, to) {
    const point = (at, end) => p.evaluate(([i, o], end) => {
        const t = document.querySelectorAll('#src p')[i].firstChild, r = document.createRange(); r.setStart(t, o); r.setEnd(t, o);
        const q = r.getBoundingClientRect(); return [q.left + (end ? -1 : 1), q.top + q.height / 2];
    }, at, end);
    await drag(p, await point(from, false), await point(to, true), { settle: 700 });
}
const offered = (p) => p.evaluate(() => LighthouseState.activeActions.some(a => a.id === 'send'));
const clickSend = (p) => clickBar(p, 'Send', 300);
// Send's popover opened as hovering opens it, and its item pressed (items act on mousedown)
async function clickQuote(p) {
    await point(p, 'Send', { name: false, settle: 700 });
    await inBar(p, (root) => [...root.querySelectorAll('.lighthouse-btn .lighthouse-btn')].find(b => b.textContent.trim() === 'Send as quote').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await wait(300);
}

test('not offered before a composer was written in', async () => {
    const p = await page();
    await selectPage(p, [0, 16], [0, 19]);
    assert.strictEqual(await offered(p), false);
    await p.close();
});

for (const ed of ['ta', 'ce', 'pm', 'lx', 'ql']) {
    test(`${ed}: the selection goes in where the caret was`, async () => {
        const p = await page();
        await writeIn(p, ed, ['Hello world'], [0, 5], ' there');
        await selectPage(p, [0, 16], [0, 19]);
        assert.strictEqual(await offered(p), true);
        await clickSend(p);
        assert.strictEqual(await text(p, ed), 'Hello there fox world');
        assert.deepStrictEqual(p.errors, []);
        await p.close();
    });
}

// A one-line box (a search box) takes it too: its lines as spaces, and no quote (quote lines can't exist there)
test('a one-line box: offered, lines become spaces, no quote', async () => {
    const p = await page();
    await writeIn(p, 'in', ['Hello'], [0, 5], ' world');
    await selectPage(p, [0, 4], [1, 4]);
    assert.strictEqual(await offered(p), true);
    await point(p, 'Send', { name: false, settle: 700 });
    assert.strictEqual(await popover(p), null, 'no Send as quote');
    await clickSend(p);
    assert.strictEqual(await text(p, 'in'), 'Hello world quick brown fox jumps. Over');
    await p.close();
});

// The shortcut (the browser's; here its message): the cursor back in the last box, where it was
for (const ed of ['ta', 'pm', 'lx']) {
    test(`${ed}: the shortcut puts the cursor back where it was`, async () => {
        const p = await page();
        await writeIn(p, ed, ['Hello world'], [0, 5], ',');
        await selectPage(p, [0, 4], [0, 9]);
        await p.evaluate(() => window.messageListeners.forEach(f => f({ action: 'BACK_TO_BOX' })));
        await wait(200); await type(p, ' there');
        assert.strictEqual(await text(p, ed), 'Hello, there world');
        await p.close();
    });
}

for (const [ed, kind] of [['cm', 'a code editor']]) {
    test(`not offered for ${kind}`, async () => {
        const p = await page();
        await writeIn(p, ed, ['Hello world'], [0, 11], ' there');
        await selectPage(p, [0, 16], [0, 19]);
        assert.strictEqual(await offered(p), false);
        await p.close();
    });
}

test('not offered once the composer is gone', async () => {
    const p = await page();
    await writeIn(p, 'ta', ['Hello'], [0, 5], ' there');
    await p.evaluate(() => document.getElementById('ta').remove());
    await selectPage(p, [0, 16], [0, 19]);
    assert.strictEqual(await offered(p), false);
    await p.close();
});

test('not offered for a selection inside the composer itself', async () => {
    const p = await page();
    await writeIn(p, 'pm', ['hello world', 'second line'], [1, 11], '!');
    await select(p, 'pm', [0, 6], [1, 6]);   // across lines: the bar treats it as page text
    await p.keyboard.down('Shift'); await p.keyboard.press('ArrowRight'); await p.keyboard.up('Shift'); await wait(600);
    assert.strictEqual(await offered(p), false);
    await p.close();
});

test('the strip names the box, from its own label', async () => {
    const p = await page();
    await p.evaluate(() => document.getElementById('ta').setAttribute('placeholder', 'Message the team'));
    await writeIn(p, 'ta', [''], [0, 0], 'Hi');
    const info = () => p.evaluate(() => LighthouseActions.find(a => a.id === 'send').info(null, { composer: LighthouseSend.composer }));
    assert.strictEqual(await info(), 'Into Message the team');
    await p.evaluate(() => document.getElementById('ta').removeAttribute('placeholder'));
    assert.strictEqual(await info(), 'Into the last text box');
    await p.close();
});

test('ta: Send as quote: its own lines, each "> ", then an empty line to write on', async () => {
    const p = await page();
    await writeIn(p, 'ta', [''], [0, 0], 'Question:');
    await selectPage(p, [0, 0], [1, 26]);
    await clickQuote(p);
    assert.strictEqual(await text(p, 'ta'), 'Question:\n> The quick brown fox jumps.\n> \n> Over the lazy dog it went.\n\n');
    await p.close();
});

test('pm: Send as quote arrives as the editor\'s own lines', async () => {
    const p = await page();
    await writeIn(p, 'pm', [''], [0, 0], 'Question:');
    await selectPage(p, [0, 4], [0, 26]);
    await clickQuote(p);
    // Paragraphs of its own: the empty one after it is where the caret waits (rich text separates paragraphs itself)
    assert.strictEqual(await text(p, 'pm'), 'Question:\n> quick brown fox jumps.\n');
    await p.close();
});

for (const ed of ['ta', 'ce', 'pm', 'lx', 'ql']) {
    test(`${ed}: the page doesn't scroll to the composer`, async () => {
        const p = await page({ tall: true });
        await writeIn(p, ed, ['Hello'], [0, 5], ' there');
        await p.evaluate(() => scrollTo(0, 0)); await wait(100);
        await selectPage(p, [0, 16], [0, 19]);
        await clickSend(p);
        assert.strictEqual(await p.evaluate(() => scrollY), 0);
        await p.close();
    });
}

test('one undo takes it out again', async () => {
    const p = await page();
    await writeIn(p, 'ta', ['Hello world'], [0, 5], ' there');
    await selectPage(p, [0, 16], [0, 19]);
    await clickSend(p);
    await undo(p, 'ta'); await wait(150);
    assert.strictEqual(await text(p, 'ta'), 'Hello there world');
    await p.close();
});

// After Send the box has the caret, but that's no first click into it: no Paste bar over what was sent, and
// selecting the sent text gets the field's own bar
for (const ed of ['ta', 'ce', 'pm', 'lx', 'ql']) {
    test(`${ed}: no bar after Send; the sent text selected gets the field's bar`, async () => {
        const p = await page();
        await writeIn(p, ed, ['Hi'], [0, 2], ' there');
        await selectPage(p, [0, 4], [1, 26]);   // two paragraphs
        await clickSend(p); await wait(300);
        assert.strictEqual(await p.evaluate(() => LighthouseState.mode), 'HIDDEN');
        const all = await text(p, ed), at = all.indexOf('quick');
        if (ed === 'ta') await p.evaluate((at) => { const t = document.getElementById('ta'); t.focus(); t.setSelectionRange(at, at + 4); }, at);
        else await p.evaluate((ed) => { const w = document.createTreeWalker(editors[ed].el, NodeFilter.SHOW_TEXT); for (let t; (t = w.nextNode());) { const i = t.data.indexOf('quick'); if (i >= 0) return getSelection().setBaseAndExtent(t, i, t, i + 4); } }, ed);
        await p.keyboard.down('Shift'); await p.keyboard.press('ArrowRight'); await p.keyboard.up('Shift'); await wait(600);
        assert.strictEqual(await p.evaluate(() => LighthouseState.mode), 'INPUT');
        await p.close();
    });
}

// The box far down the page (the caret deep in it), the page scrolled away: the shortcut brings the page back to the
// box, with the caret's line in view
for (const ed of ['ta', 'ce', 'pm', 'lx']) {
    test(`${ed}: the shortcut scrolls back to the box, the caret in view`, async () => {
        const p = await open(browser, { openShadow: true });
        await p.setViewport({ width: 900, height: 600 });
        await p.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<div style="height:1500px">Article text</div>'));
        await set(p, ed, Array.from({ length: 60 }, (_, i) => `line ${i}`)); await select(p, ed, [55, 6]); await type(p, 'X'); await wait(200);
        await p.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); }); await wait(300);
        await p.evaluate(() => window.messageListeners.forEach(f => f({ action: 'BACK_TO_BOX' }))); await wait(400);
        const seen = await p.evaluate(() => { const el = document.activeElement, s = getSelection();
            const q = ['TEXTAREA', 'INPUT'].includes(el.tagName) ? el.getBoundingClientRect() : s.getRangeAt(0).getBoundingClientRect();
            return q.top >= 0 && q.bottom <= innerHeight; });
        assert.ok(seen, 'the box, or the caret in it, is on the screen');
        await p.close();
    });
}

// Twice: from the page to the box and back, to what was mid-screen and the selection, the box let go. In a chat the
// conversation scrolls in its own panel: the same, in the panel
for (const [ed, panel] of [['ta', false], ['ta', true]]) {   // the page's scrolling and the selection: the same with any box
    test(`${ed}${panel ? ', a scrolling panel' : ''}: the shortcut again goes back to where you were reading`, async () => {
        const p = await open(browser, { openShadow: true });
        await p.setViewport({ width: 900, height: 600 });
        await p.evaluate((panel) => {
            const article = Array.from({ length: 80 }, (_, i) => `<p id="p${i}" style="margin:0 0 8px">Paragraph ${i} of the article.</p>`).join('');
            document.body.insertAdjacentHTML('afterbegin', panel ? `<div id="scroller" style="height:400px; overflow:auto">${article}</div>` : `<div>${article}</div><div style="height:800px"></div>`);
        }, panel);
        await set(p, ed, ['Dear team,']); await select(p, ed, [0, 10]); await type(p, ' hello'); await wait(200);
        // Reading: paragraph 40 mid-screen, a word in it selected
        await p.evaluate(() => { document.activeElement.blur(); document.getElementById('p40').scrollIntoView({ block: 'center' });
            const t = document.getElementById('p40').firstChild, r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 9); getSelection().removeAllRanges(); getSelection().addRange(r); });
        await wait(200);
        const flip = async () => { await p.evaluate(() => window.messageListeners.forEach(f => f({ action: 'BACK_TO_BOX' }))); await wait(900); };   // the return scrolls smoothly
        await flip();
        assert.notStrictEqual(await p.evaluate(() => document.activeElement.id || document.activeElement.closest('[id]').id), 'p40');
        await flip();
        const back = await p.evaluate(() => { const q = document.getElementById('p40').getBoundingClientRect(), box = document.activeElement;
            return { selected: getSelection().toString(), seen: q.top >= 0 && q.bottom <= innerHeight, inBox: box.tagName === 'TEXTAREA' || box.isContentEditable }; });
        assert.deepStrictEqual(back, { selected: 'Paragraph', seen: true, inBox: false });
        await p.close();
    });
}

// A chat's layout: the conversation scrolls in its own panel, the box fixed below it, the cursor staying in the box while
// the chat is scrolled. Alt+L: the chat back to where it was while typing; again: back to where it was scrolled to
for (const ed of ['ta']) {   // the chat's scrolling, not the box's: one box is enough
    test(`${ed}, a box fixed below a chat: the shortcut brings the chat back, and again`, async () => {
        const p = await open(browser, { openShadow: true });
        await p.setViewport({ width: 900, height: 600 });
        await p.evaluate((ed) => {
            const chat = document.createElement('div'); chat.id = 'convo'; chat.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:140px; overflow:auto; background:#fff';
            chat.innerHTML = Array.from({ length: 80 }, (_, i) => `<p id="m${i}" style="margin:0 0 8px">Message ${i} in the conversation.</p>`).join('');
            const dock = document.createElement('div'); dock.style.cssText = 'position:fixed; left:0; right:0; bottom:0; height:130px; background:#fff';
            dock.appendChild(document.getElementById(ed)); document.body.append(chat, dock);
            chat.scrollTop = chat.scrollHeight;   // at the latest messages
        }, ed);
        await set(p, ed, ['Dear team,']); await select(p, ed, [0, 10]); await type(p, ' hello'); await wait(200);
        const shown = (id) => p.evaluate((id) => { const q = document.getElementById(id).getBoundingClientRect(), c = document.getElementById('convo').getBoundingClientRect(); return q.top >= c.top && q.bottom <= c.bottom; }, id);
        // Scrolled up to read, the cursor still in the box
        await p.evaluate(() => { document.getElementById('convo').scrollTop = 0; }); await wait(200);
        assert.strictEqual(await shown('m78'), false);
        const reading = await p.evaluate(() => document.elementFromPoint(innerWidth / 2, 230).id);   // mid-chat while reading
        const flip = async () => { await p.evaluate(() => window.messageListeners.forEach(f => f({ action: 'BACK_TO_BOX' }))); await wait(900); };
        await flip();
        assert.strictEqual(await shown('m78'), true, 'the chat is back where it was while typing');
        await flip();
        assert.strictEqual(await shown(reading), true, 'and again, back to where it was scrolled to');
        assert.strictEqual(await p.evaluate(() => document.activeElement === document.body), true, 'the box let go');
        await p.close();
    });
}

// Nothing scrolled away: the shortcut moves the cursor, not the page (no nudge to re-centre what is already seen)
test('the shortcut moves nothing that is already in view', async () => {
    const p = await open(browser, { openShadow: true });
    await p.setViewport({ width: 900, height: 600 });
    await p.evaluate(() => {
        const convo = document.createElement('div'); convo.id = 'convo'; convo.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:140px; overflow:auto; background:#fff';
        convo.innerHTML = Array.from({ length: 80 }, (_, i) => `<p style="margin:0 0 8px">Message ${i}.</p>`).join('');
        const dock = document.createElement('div'); dock.style.cssText = 'position:fixed; left:0; right:0; bottom:0; height:130px; background:#fff';
        dock.appendChild(document.getElementById('ta')); document.body.append(convo, dock); convo.scrollTop = 777;
    });
    await set(p, 'ta', ['Dear team,']); await select(p, 'ta', [0, 10]); await type(p, ' hello'); await wait(200);
    const top = () => p.evaluate(() => document.getElementById('convo').scrollTop);
    const before = await top();
    for (let i = 0; i < 2; i++) { await p.evaluate(() => window.messageListeners.forEach(f => f({ action: 'BACK_TO_BOX' }))); await wait(700); }
    assert.strictEqual(await top(), before);
    await p.close();
});