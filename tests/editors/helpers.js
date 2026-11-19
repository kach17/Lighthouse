// Shared by every test: a page with the fixture editors and the extension's content scripts, loaded in
// the manifest's order with a stand-in for the chrome APIs they use (settings come from `settings`).
const puppeteer = require('puppeteer');
const fs = require('fs'), path = require('path');

const ROOT = process.env.LIGHTHOUSE_ROOT || path.resolve(__dirname, '../../extension');   // the extension (LIGHTHOUSE_ROOT: another copy, a store build)
const SCRIPTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'))).content_scripts[0].js
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
const EDITORS = fs.readFileSync(path.join(__dirname, 'build', 'editors.js'), 'utf8');
// The bar's stylesheets, as the extension serves them (chrome.runtime.getURL): the bar looks and takes clicks as for users
const FILES = Object.fromEntries(['src/content/tokens.css', 'src/content/styles.css'].map(f =>
    [f, 'data:text/css;base64,' + fs.readFileSync(path.join(ROOT, f)).toString('base64')]));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const PAGE = `<style>
  .ProseMirror, .ql-editor { white-space: pre-wrap; }   /* as the editors' own stylesheets set it */
  #pm, #lx, #ql, #cm, #ce, #own, textarea, input { display: block; width: 500px; margin: 30px; font: 16px monospace; border: 1px solid #888; min-height: 24px; }
</style>
<div id="pm"></div><div id="lx" contenteditable="true"></div><div id="ql"></div><div id="cm"></div>
<div id="ce" contenteditable="true"></div><div id="own" contenteditable="true"></div>
<textarea id="ta"></textarea><input id="in"><textarea id="chat"></textarea><div id="sent"></div>
<textarea id="proxy" style="width: 1px; height: 1px; min-height: 0; opacity: 0"></textarea>`;

const chromeStub = (settings, replies = {}) => `window.chrome = {
  runtime: { id: 'test', lastError: null, getURL: (p) => (${JSON.stringify(FILES)})[p] || p, onMessage: { addListener(f) { (window.messageListeners ||= []).push(f); } },   // a test delivers a message: messageListeners
    sendMessage: (m, cb) => { (window.asked ||= []).push(m && m.action); const r = (${JSON.stringify(replies)})[m && m.action]; cb && cb(r ? { success: true, ...r } : {}); } },   // window.asked: what the page asked the background for
  storage: { sync: { get: (d, cb) => cb(Object.assign({}, d, ${JSON.stringify(settings)})), set() {} },
             local: { get: (d, cb) => cb(d || {}), set() {} }, onChanged: { addListener() {} } } };`;

const launch = () => puppeteer.launch({ args: ['--no-sandbox'] });

/**
 * A page with the editors. Options: settings (chrome.storage.sync), lighthouse (false: without the
 * extension, to compare with native behavior), before (run before the extension loads), openShadow
 * (the bar's shadow root readable, to check what it shows), replies (the background's answers, by
 * action: { TRANSLATE: { result } }), voices (an English voice; what is spoken goes to window.spoken).
 */
async function open(browser, { settings = {}, lighthouse = true, before, openShadow, replies, voices } = {}) {
    const p = await browser.newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(e.message));
    await p.setContent(PAGE);
    if (openShadow) await p.evaluate(() => { const a = Element.prototype.attachShadow; Element.prototype.attachShadow = function (o) { return a.call(this, { ...o, mode: 'open' }); }; });
    await p.addScriptTag({ content: EDITORS });
    if (before) await before(p);
    if (voices) await p.evaluate(() => {
        const voice = { lang: 'en-US', name: 'Test voice', voiceURI: 'test', localService: true, default: true };
        window.spoken = [];
        speechSynthesis.getVoices = () => [voice];
        speechSynthesis.speak = (u) => { window.spoken.push(u.text); setTimeout(() => u.onend && u.onend(new Event('end'))); };
        speechSynthesis.cancel = () => {};
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };   // its voice takes the stand-in
    });
    if (lighthouse) {
        await p.evaluate(chromeStub(settings, replies));
        for (const s of SCRIPTS) await p.addScriptTag({ content: s });
    }
    await wait(150);
    return p;
}

// One editor of the page: lines set (no undo history before), a selection made, its text read
const set = (p, ed, lines) => p.evaluate((ed, lines) => editors[ed].set(lines), ed, lines);
const select = (p, ed, a, z = a) => p.evaluate((ed, a, z) => editors[ed].select(a, z), ed, a, z);
const text = (p, ed) => p.evaluate((ed) => editors[ed].text(), ed);

// Keys: 'Tab', 'Shift+Tab', 'Control+KeyX'. Fields edit through the browser's own commands, which headless
// Chrome runs only when told; editors with their own key handling (undo, cut) do it themselves.
const COMMANDS = { 'Control+KeyX': 'Cut', 'Control+KeyV': 'Paste', 'Control+KeyC': 'Copy', 'Control+KeyZ': 'undo' };
async function press(p, combo, { native = true } = {}) {
    const keys = combo.split('+'), key = keys.pop();
    for (const k of keys) await p.keyboard.down(k);
    await p.keyboard.press(key, native && COMMANDS[combo] ? { commands: [COMMANDS[combo]] } : {});
    for (const k of keys.reverse()) await p.keyboard.up(k);
}
// Typed one character at a time, as a person would
async function type(p, s, delay = 15) { for (const c of s) { await p.keyboard.type(c); await wait(delay); } }

// Undo: the browser's for plain fields and contenteditable, the editor's own otherwise
const undo = (p, ed) => press(p, 'Control+KeyZ', { native: ['ta', 'in', 'ce'].includes(ed) });

// --- The page and the bar, as a person uses them ---

// A drag between two points (press, move, release), then the bar's time to appear
async function drag(p, from, to, { steps = 6, settle = 900 } = {}) {
    await p.mouse.move(...from); await p.mouse.down(); await p.mouse.move(...to, { steps }); await p.mouse.up(); await wait(settle);
}
// The point where `text` starts (or ends) in the element `selector`: where a drag over it begins (or ends)
const textAt = (p, selector, text, end = false) => p.evaluate((selector, text, end) => {
    const w = document.createTreeWalker(document.querySelector(selector), NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode());) {
        const i = t.data.indexOf(text); if (i < 0) continue;
        const r = document.createRange(), o = end ? i + text.length : i; r.setStart(t, o); r.setEnd(t, o);
        const q = r.getBoundingClientRect(); return [q.left + (end ? -1 : 1), q.top + q.height / 2];
    }
    return null;
}, selector, text, end);
// A check run inside the bar: fn(root, ...args) with the bar's shadow root (pages opened with openShadow)
const BAR = `[...document.querySelectorAll('*')].find(e => e.shadowRoot && e.shadowRoot.getElementById('lighthouse-extension-tooltip'))`;
const inBar = (p, fn, ...args) => p.evaluate((BAR, src, args) => { const host = eval(BAR); return eval(`(${src})`)(host ? host.shadowRoot : null, ...args); }, BAR, fn.toString(), args);
// A button of the bar or of an open popover, by its name (its label, title or text): { at } its center, or { names } there are
const barButton = (p, name) => inBar(p, (root, name) => {
    const all = root ? [...root.querySelectorAll('.lighthouse-btn, [role="button"], button')].filter(b => b.offsetWidth) : [];
    const b = all.find(b => [b.getAttribute('aria-label'), b.title, b.textContent.trim()].some(s => s && s.startsWith(name)));
    if (!b) return { names: all.map(b => b.getAttribute('aria-label') || b.textContent.trim()) };
    const q = b.getBoundingClientRect(); return { at: [q.left + q.width / 2, q.top + q.height / 2] };
}, name);
async function clickBar(p, name, settle = 500) {
    const b = await barButton(p, name);
    if (!b.at) throw new Error(`no "${name}" on the bar; it has: ${JSON.stringify(b.names)}`);
    await p.mouse.click(...b.at); await wait(settle);
}
// Pointing at a bar button as hovering does (headless Chrome gives no hover from a moved mouse): it looks hovered,
// the strip names it (name: false, it doesn't), its preview opens (preview: false, it doesn't)
async function point(p, name, { preview = true, name: say = true, settle = 1200 } = {}) {
    const ok = await inBar(p, (root, name, say, preview) => {
        const b = root && [...root.querySelectorAll('#lighthouse-extension-tooltip > .lighthouse-btn')].find(b => [b.getAttribute('aria-label'), b.title, b.textContent.trim()].some(s => s && s.startsWith(name)));
        if (!b) return false;
        b.classList.add('is-picked'); if (say) b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); if (preview) b.dispatchEvent(new Event('mouseenter'));
        return true;
    }, name, say, preview);
    if (!ok) throw new Error(`no "${name}" on the bar`);
    await wait(settle);
}
// What the strip says, and what an open popover shows
const strip = (p) => inBar(p, (root) => { const s = root && (root.querySelector('.lighthouse-strip .is-shown') || root.querySelector('.lighthouse-strip')); return s ? s.textContent : null; });
const popover = (p) => inBar(p, (root) => { const v = root && root.querySelector('.lighthouse-popover.visible'); return v ? v.textContent : null; });
// The bar's box and mode (null while it isn't shown)
const barBox = (p) => inBar(p, (root) => { const b = root && root.getElementById('lighthouse-extension-tooltip'), q = b && b.getBoundingClientRect();
    return q && q.height ? { left: q.left, top: q.top, right: q.right, bottom: q.bottom, mode: (b.className.match(/mode-[\w-]+/) || [''])[0] } : null; });

module.exports = { launch, open, set, select, text, press, type, undo, wait, ROOT, drag, textAt, inBar, barButton, clickBar, point, strip, popover, barBox };
