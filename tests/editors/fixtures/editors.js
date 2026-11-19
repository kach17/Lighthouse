// Real editors, one of each kind Lighthouse meets, behind one small interface:
// set(lines) (no undo history before it), text() (lines joined by \n), select([line, column], [line, column]).
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { registerRichText } from '@lexical/rich-text';
import { registerHistory, createEmptyHistoryState } from '@lexical/history';
import Quill from 'quill';
import { EditorView as CodeView, basicSetup } from 'codemirror';

const $ = (id) => document.getElementById(id);
const nbsp = (s) => s.replace(/\u00a0/g, ' ');

// The DOM's text nodes, one per line in these fixtures
function selectDom(el, [l1, c1], [l2, c2]) {
    el.focus();
    const lines = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t; (t = walk.nextNode());) if (t.data.length) lines.push(t);
    getSelection().setBaseAndExtent(lines[l1], c1, lines[l2], c2);
}
function selectField(el, a, z) {
    el.focus();
    const lines = el.value.split('\n'), at = ([l, c]) => lines.slice(0, l).reduce((n, s) => n + s.length + 1, 0) + c;
    el.setSelectionRange(at(a), at(z));
}

const pmHistory = () => [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap)];
const pm = new EditorView($('pm'), { state: EditorState.create({ schema, plugins: pmHistory() }) });

const lx = createEditor({ namespace: 'fixture', onError: (e) => { throw e; } });
lx.setRootElement($('lx'));
registerRichText(lx);
const lxHistory = createEmptyHistoryState();
registerHistory(lx, lxHistory, 300);

const ql = new Quill('#ql');
const cm = new CodeView({ extensions: [basicSetup], parent: $('cm') });

// An editor that pairs brackets itself, on keydown: Lighthouse must leave it alone
$('own').addEventListener('keydown', (e) => { if (e.key === '(') { e.preventDefault(); document.execCommand('insertText', false, '[OWN]'); } });

const field = (id) => ({
    el: $(id),
    set(lines) { $(id).value = lines.join('\n'); },
    text: () => $(id).value,
    select: (a, z) => selectField($(id), a, z),
});
const dom = (el, set) => ({ el, set, text: () => nbsp(el.innerText).replace(/\n$/, ''), select: (a, z) => selectDom(el, a, z) });

window.editors = {
    ta: field('ta'),
    in: field('in'),
    proxy: field('proxy'),
    ce: dom($('ce'), (lines) => { $('ce').innerHTML = lines.map(l => `<div>${l}</div>`).join(''); }),
    own: dom($('own'), (lines) => { $('own').textContent = lines.join(' '); }),
    pm: {
        el: pm.dom,
        set(lines) {
            const doc = schema.node('doc', null, lines.map(l => schema.node('paragraph', null, l ? [schema.text(l)] : [])));
            pm.updateState(EditorState.create({ schema, doc, plugins: pmHistory() }));
        },
        text: () => nbsp(pm.state.doc.content.content.map(n => n.textContent).join('\n')),
        select: (a, z) => selectDom(pm.dom, a, z),
    },
    lx: {
        el: $('lx'),
        set(lines) {
            lx.update(() => {
                const root = $getRoot().clear();
                for (const l of lines) { const p = $createParagraphNode(); if (l) p.append($createTextNode(l)); root.append(p); }
            }, { discrete: true });
            // The history starts here: this text is what an undo returns to
            Object.assign(lxHistory, { current: { editor: lx, editorState: lx.getEditorState() }, undoStack: [], redoStack: [] });
        },
        text: () => nbsp(lx.getEditorState().read(() => $getRoot().getChildren().map(n => n.getTextContent()).join('\n'))),
        select: (a, z) => selectDom($('lx'), a, z),
    },
    ql: {
        el: ql.root,
        set(lines) { ql.setText(lines.join('\n')); ql.history.clear(); },
        text: () => nbsp(ql.getText().replace(/\n$/, '')),
        select: (a, z) => selectDom(ql.root, a, z),
    },
    cm: {
        el: cm.contentDOM,
        set(lines) { cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: lines.join('\n') } }); },
        text: () => cm.state.doc.toString(),
        select(a, z) {
            const lines = cm.state.doc.toString().split('\n'), at = ([l, c]) => lines.slice(0, l).reduce((n, s) => n + s.length + 1, 0) + c;
            cm.focus(); cm.dispatch({ selection: { anchor: at(a), head: at(z) } });
        },
    },
};
