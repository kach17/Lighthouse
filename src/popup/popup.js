// popup.js
// Settings for Lighthouse. Uses the same stylesheets and components as the bar.
(function() {
    const $ = window.LighthouseUtils;
    const Config = window.LighthouseConfig;
    const Data = window.LighthouseData;

    let currentState = { ...Config.defaults };
    let currentHostname = '';

    const GRIP_ICON  = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;
    const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.2A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.8L17.5 7"/></svg>`;

    document.addEventListener('DOMContentLoaded', () => {
        chrome.storage.sync.get(Config.defaults, (items) => {
            currentState = items;

            bindCheckbox('toggle-snapping', items.smartSnapping, v => updateSetting('smartSnapping', v));
            bindCheckbox('toggle-handles', items.addDragHandles !== false, v => updateSetting('addDragHandles', v));
            bindCheckbox('toggle-debug', items.debugMode || false, v => updateSetting('debugMode', v));
            bindCheckbox('toggle-labels', items.showLabels !== false, v => updateSetting('showLabels', v));
            bindCheckbox('toggle-tidy', items.tidySpacing !== false, v => updateSetting('tidySpacing', v));
            setupLinkPreviews(items.linkPreviews === true);
            bindChoice('brackets-mode', 'mode', items.brackets || 'wrap', v => updateSetting('brackets', v));

            setupToggleRows();
            setupTheme();
            setupStandards();
            renderButtons();
            renderSearch();
            setupAddEngine();
            renderSnippets();
            setupAddSnippet();
            setupSiteToggle();
            setupTabs();
            setupImportExport();
            setupPendingFlush();

            const version = document.getElementById('version-label');
            if (version) version.textContent = `Version ${chrome.runtime.getManifest().version}`;
        });
    });

    // -------------------------------------------------------------------------
    // Settings helpers
    // -------------------------------------------------------------------------

    function updateSetting(key, value) {
        currentState[key] = value;
        chrome.storage.sync.set({ [key]: value });
    }

    // Single settings are rows wrapping a checkbox: the row is the control,
    // and its state is stated in words by CSS ("On" / "Off").
    function bindCheckbox(id, checked, onChange) {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked = !!checked;
        el.addEventListener('change', () => onChange(el.checked));
    }

    // Link previews are opt-in: turning them on asks Chrome for permission to fetch the
    // hovered page; turning them off gives that permission back.
    function setupLinkPreviews(enabled) {
        const input = document.getElementById('toggle-link-previews');
        if (!input) return;
        const ORIGINS = { origins: ['https://*/*', 'http://*/*'] };
        input.checked = enabled;
        input.addEventListener('change', () => {
            if (input.checked) {
                chrome.permissions.request(ORIGINS, (granted) => {
                    input.checked = !!granted;
                    updateSetting('linkPreviews', !!granted);
                });
            } else {
                chrome.permissions.remove(ORIGINS, () => updateSetting('linkPreviews', false));
            }
        });
    }

    // A choice among a few options: a segmented control, the chosen one takes the tone.
    function bindChoice(id, attr, value, onChange) {
        const group = document.getElementById(id);
        if (!group) return;
        const sync = (v) => group.querySelectorAll(`[data-${attr}]`).forEach(b => {
            const on = b.dataset[attr] === v;
            b.classList.toggle('is-engaged', on);
            b.setAttribute('aria-checked', String(on));
        });
        sync(value);
        group.addEventListener('click', (e) => {
            const btn = e.target.closest(`[data-${attr}]`);
            if (!btn) return;
            sync(btn.dataset[attr]);
            onChange(btn.dataset[attr]);
        });
    }

    // On/Off rows: clicking a segment sets that value, clicking elsewhere on the row toggles.
    // The hidden checkbox stays the source of truth (and keeps keyboard access).
    function setupToggleRows() {
        document.querySelectorAll('.lh-toggle').forEach(row => {
            const input = row.querySelector('input[type="checkbox"]');
            row.addEventListener('click', (e) => {
                if (e.target === input || e.target.closest('label')) return; // the label toggles natively
                const seg  = e.target.closest('[data-value]');
                const next = seg ? seg.dataset.value === 'true' : !input.checked;
                if (next !== input.checked) {
                    input.checked = next;
                    input.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    // -------------------------------------------------------------------------
    // Theme: one resolver shared with the bar
    // -------------------------------------------------------------------------

    function setupTheme() {
        const input    = document.getElementById('custom-css-input');
        const saveBtn  = document.getElementById('save-css-btn');
        const lightBtn = document.getElementById('theme-light-btn');
        const darkBtn  = document.getElementById('theme-dark-btn');

        const sharedStyle = document.createElement('style');
        sharedStyle.id = 'shared-theme-styles';
        document.head.appendChild(sharedStyle);

        const css = Data.resolveThemeCSS(currentState);
        input.value = css;
        sharedStyle.textContent = css;

        const syncChoice = (mode) => {
            [[lightBtn, 'light'], [darkBtn, 'dark']].forEach(([btn, m]) => {
                btn.classList.toggle('is-engaged', mode === m);
                btn.setAttribute('aria-pressed', String(mode === m));
            });
        };
        syncChoice(currentState.customStyles ? currentState.themeMode : (currentState.themeMode || 'light'));

        const apply = (cssText, mode) => {
            sharedStyle.textContent = cssText;
            input.value = cssText;
            updateSetting('customStyles', cssText);
            if (mode) { updateSetting('themeMode', mode); syncChoice(mode); }
        };

        lightBtn.addEventListener('click', () => apply(Data.cssFromTheme(Data.THEMES.light), 'light'));
        darkBtn.addEventListener('click',  () => apply(Data.cssFromTheme(Data.THEMES.dark),  'dark'));
        saveBtn.addEventListener('click', () => {
            apply(input.value, null);
            saveBtn.textContent = 'Saved';
            setTimeout(() => { saveBtn.textContent = 'Save CSS'; }, 1000);
        });
    }

    // -------------------------------------------------------------------------
    // Standards (Language / Currency / Units)
    // -------------------------------------------------------------------------

    function setupStandards() {
        const langSelect = document.getElementById('std-lang');
        const currSelect = document.getElementById('std-curr');
        const unitSelect = document.getElementById('std-units');

        // Names in the user's own language, from the browser (e.g. 英語 for English on a Japanese system)
        const ui = (() => {   // a valid language tag for the browser's language, or English
            const raw = String((chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || 'en').split('@')[0];
            try { return Intl.getCanonicalLocales(raw); } catch (e) { return ['en']; }
        })();
        const nameOf = (type, code) => { try { return new Intl.DisplayNames(ui, { type }).of(code) || code; } catch (e) { return code; } };

        Data.LANGUAGES
            .map(code => ({ code, name: nameOf('language', code) }))
            .sort((a, b) => a.name.localeCompare(b.name, ui))
            .forEach(({ code, name }) => langSelect.appendChild($.create('option', { attrs: { value: code }, text: name })));
        [...new Set(Object.values(Data.CURRENCY_MAP))].sort().forEach(code => {
            const name = nameOf('currency', code);
            currSelect.appendChild($.create('option', { attrs: { value: code }, text: name === code ? code : `${code} — ${name}` }));
        });

        const std = currentState.standards || Config.defaults.standards;
        langSelect.value = std.language;
        currSelect.value = std.currency;
        unitSelect.value = std.units;

        const save = () => updateSetting('standards', {
            language: langSelect.value, currency: currSelect.value, units: unitSelect.value
        });
        [langSelect, currSelect, unitSelect].forEach(s => s.addEventListener('change', save));
    }

    // -------------------------------------------------------------------------
    // Site toggle: the header states it in words
    // -------------------------------------------------------------------------

    function setupSiteToggle() {
        const toggle = document.getElementById('toggle-site');
        const label  = document.getElementById('current-site');

        const getBlacklist = () => {
            if (!Array.isArray(currentState.blacklist)) currentState.blacklist = [];
            return currentState.blacklist;
        };
        const unavailable = () => {
            label.textContent = 'Not available on this page';
            toggle.checked  = false;
            toggle.disabled = true;
        };

        toggle.disabled = true;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0] || !tabs[0].url) return unavailable();
            try {
                const url = new URL(tabs[0].url);
                if (!(url.protocol.startsWith('http') || url.protocol === 'file:')) return unavailable();
                currentHostname = url.hostname || 'Local file';
                label.textContent = currentHostname.replace(/^www\./, '');
                toggle.checked  = !getBlacklist().includes(currentHostname);
                toggle.disabled = false;
            } catch (e) {
                unavailable();
            }
        });

        toggle.addEventListener('change', () => {
            if (!currentHostname) return;
            const list = getBlacklist();
            const idx  = list.indexOf(currentHostname);
            if (toggle.checked) { if (idx > -1) list.splice(idx, 1); }
            else if (idx === -1) list.push(currentHostname);
            updateSetting('blacklist', list);
        });
    }

    // -------------------------------------------------------------------------
    // Tabs: the chosen tab is engaged, like a button with its popover open
    // -------------------------------------------------------------------------

    function setupTabs() {
        const tabs = document.querySelectorAll('.p-tabs .tab');
        tabs.forEach(tab => {
            tab.setAttribute('aria-selected', String(tab.classList.contains('is-engaged')));
            tab.addEventListener('click', () => {
                flushPending();
                tabs.forEach(t => {
                    t.classList.toggle('is-engaged', t === tab);
                    t.setAttribute('aria-selected', String(t === tab));
                });
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            });
        });
    }

    // -------------------------------------------------------------------------
    // Lists: the row is the thing you act on.
    // Click (or Space/Enter) turns it on or off, drag (or Alt+Arrow) reorders.
    // Enabled rows form the ordered list; the rest sit under "Off".
    // A toggled row confirms in place and moves when the pointer leaves the list,
    // so nothing shifts under the cursor.
    // -------------------------------------------------------------------------

    let pending = null;

    function flushPending() {
        if (!pending) return;
        const run = pending;
        pending = null;
        run();
    }

    function setupPendingFlush() {
        document.querySelectorAll('.tab-content').forEach(sec => sec.addEventListener('mouseleave', flushPending));
        window.addEventListener('blur', flushPending);
    }

    // Moves an item right after the last enabled one (a re-enabled item joins the end of the list)
    function moveAfterLastOn(arr, item, isOn) {
        arr.splice(arr.indexOf(item), 1);
        let last = -1;
        arr.forEach((x, i) => { if (isOn(x)) last = i; });
        arr.splice(last + 1, 0, item);
    }

    function createRow({ label, icon, url, isOn, type, ref, onToggle, onDelete, rerender }) {
        const state = $.create('span', { className: 'lh-row-state' });
        const li = $.create('li', {
            className: 'lh-row list-item' + (isOn ? '' : ' is-off'),
            attrs: { tabindex: '0', role: 'checkbox', 'aria-checked': String(isOn), 'data-type': type, draggable: String(isOn) },
            children: [
                $.create('span', { className: 'lh-row-grip', html: GRIP_ICON }),
                $.create('span', { className: 'lh-row-icon', children: [ $.createSmartIcon(icon, url, label) ] }),
                $.create('span', { className: 'lh-row-label', text: label }),
                state
            ]
        });
        li._ref = ref;

        if (isOn) {
            li.addEventListener('dragstart', handleDragStart);
            li.addEventListener('dragover', handleDragOver);
            li.addEventListener('dragenter', handleDragEnter);
            li.addEventListener('dragend', handleDragEnd);
        }

        if (onDelete) {
            li.appendChild($.create('button', {
                className: 'lh-row-delete',
                attrs: { 'aria-label': `Delete ${label}`, title: 'Delete' },
                html: TRASH_ICON,
                events: { click: (e) => { e.stopPropagation(); flushPending(); onDelete(); } }
            }));
        }

        const toggle = (viaKeyboard) => {
            const next = li.getAttribute('aria-checked') !== 'true';
            li.setAttribute('aria-checked', String(next));
            onToggle(next);
            if (viaKeyboard) {
                pending = null;
                rerender(ref);
                return;
            }
            // Confirm in place
            li.classList.toggle('is-off', !next);
            state.textContent = next !== isOn ? (next ? 'On' : 'Off') : '';
            state.classList.toggle('is-on', next);
            pending = () => rerender();
        };

        li.addEventListener('click', (e) => {
            if (e.target.closest('.lh-row-delete')) return;
            toggle(false);
        });

        li.addEventListener('keydown', (e) => {
            if (e.target !== li) return;
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(true); return; }
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const sibling = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
            if (e.altKey && isOn) {
                if (!sibling) return;
                e.key === 'ArrowUp' ? sibling.before(li) : sibling.after(li);
                li.focus();
                persistOrder(type);
            } else {
                const rows = [...document.querySelectorAll(`.tab-content.active .lh-row[role="checkbox"]`)];
                const target = rows[rows.indexOf(li) + (e.key === 'ArrowUp' ? -1 : 1)];
                if (target) target.focus();
            }
        });

        return li;
    }

    function focusRef(listIds, ref) {
        if (ref == null) return;
        for (const id of listIds) {
            const row = [...document.getElementById(id).children].find(li => li._ref === ref);
            if (row) { row.focus(); return; }
        }
    }

    function renderButtons(focus) {
        const onList  = document.getElementById('button-list');
        const offList = document.getElementById('button-list-off');
        onList.innerHTML = '';
        offList.innerHTML = '';

        currentState.order.forEach(id => {
            const meta = Config.actions.find(a => a.id === id);
            if (!meta) return;
            const isOn = !!currentState.enabled[id];
            (isOn ? onList : offList).appendChild(createRow({
                label: meta.label, icon: meta.icon, isOn, type: 'main', ref: id,
                onToggle: (next) => {
                    currentState.enabled[id] = next;
                    if (next) moveAfterLastOn(currentState.order, id, x => x !== id && !!currentState.enabled[x]);
                    updateSetting('enabled', currentState.enabled);
                    updateSetting('order', currentState.order);
                },
                rerender: renderButtons
            }));
        });

        document.getElementById('button-list-off-label').hidden = offList.children.length === 0;
        focusRef(['button-list', 'button-list-off'], focus);
    }

    function renderSearch(focus) {
        const onList  = document.getElementById('search-list');
        const offList = document.getElementById('search-list-off');
        onList.innerHTML = '';
        offList.innerHTML = '';

        currentState.searchEngines.forEach(engine => {
            (engine.enabled ? onList : offList).appendChild(createRow({
                label: engine.name, icon: engine.icon, url: engine.url, isOn: !!engine.enabled, type: 'search', ref: engine,
                onToggle: (next) => {
                    engine.enabled = next;
                    if (next) moveAfterLastOn(currentState.searchEngines, engine, e => e !== engine && !!e.enabled);
                    updateSetting('searchEngines', currentState.searchEngines);
                },
                onDelete: () => {
                    currentState.searchEngines.splice(currentState.searchEngines.indexOf(engine), 1);
                    updateSetting('searchEngines', currentState.searchEngines);
                    renderSearch();
                },
                rerender: renderSearch
            }));
        });

        document.getElementById('search-list-off-label').hidden = offList.children.length === 0;
        focusRef(['search-list', 'search-list-off'], focus);
    }

    function persistOrder(type) {
        if (type === 'main') {
            const onIds = [...document.querySelectorAll('#button-list .list-item')].map(li => li._ref);
            currentState.order = onIds.concat(currentState.order.filter(id => !onIds.includes(id)));
            updateSetting('order', currentState.order);
        } else if (type === 'search') {
            const onEngines = [...document.querySelectorAll('#search-list .list-item')].map(li => li._ref);
            updateSetting('searchEngines', onEngines.concat(currentState.searchEngines.filter(e => !onEngines.includes(e))));
        }
    }

    // -------------------------------------------------------------------------
    // Adding: an inline row at the end of each list
    // -------------------------------------------------------------------------

    // Opens a list's add fields in place of its "+ Add" row, and closes them again.
    function bindAddForm(triggerId, formId, cancelId, focusEl, clear) {
        const trigger = document.getElementById(triggerId);
        const form    = document.getElementById(formId);
        const open  = () => { trigger.hidden = true; form.hidden = false; focusEl.focus(); };
        const close = () => { form.hidden = true; trigger.hidden = false; clear(); };
        trigger.addEventListener('click', open);
        document.getElementById(cancelId).addEventListener('click', close);
        form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
        return close;
    }

    function setupAddEngine() {
        const save      = document.getElementById('save-add');
        const nameInput = document.getElementById('new-name');
        const urlInput  = document.getElementById('new-url');
        const close = bindAddForm('add-trigger', 'add-form', 'cancel-add', nameInput, () => { nameInput.value = ''; urlInput.value = ''; });

        const add = () => {
            const name = nameInput.value.trim();
            let url    = urlInput.value.trim();
            if (!name || !url) return;
            if (!url.startsWith('http')) url = 'https://' + url;
            flushPending();
            const engine = { id: 'custom-' + Date.now(), name, url, icon: null, enabled: true };
            currentState.searchEngines.push(engine);
            moveAfterLastOn(currentState.searchEngines, engine, e => e !== engine && !!e.enabled);
            updateSetting('searchEngines', currentState.searchEngines);
            renderSearch();
            close();
        };
        save.addEventListener('click', add);
        urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    }

    function renderSnippets() {
        const list     = document.getElementById('shortcuts-list');
        const empty    = document.getElementById('shortcuts-empty');
        const snippets = currentState.shortcuts || [];
        list.innerHTML = '';
        empty.hidden = snippets.length > 0;

        snippets.forEach((s, index) => {
            list.appendChild($.create('li', {
                className: 'lh-row p-static',
                children: [
                    $.create('span', { className: 'lh-row-mono', text: '//' + s.trigger }),
                    $.create('span', { className: 'lh-row-sub', text: s.expansion }),
                    $.create('button', {
                        className: 'lh-row-delete',
                        attrs: { 'aria-label': `Delete //${s.trigger}`, title: 'Delete' },
                        html: TRASH_ICON,
                        events: { click: () => { snippets.splice(index, 1); updateSetting('shortcuts', snippets); renderSnippets(); } }
                    })
                ]
            }));
        });
    }

    function setupAddSnippet() {
        const save           = document.getElementById('save-add-shortcut');
        const triggerInput   = document.getElementById('new-shortcut-trigger');
        const expansionInput = document.getElementById('new-shortcut-expansion');
        const close = bindAddForm('add-shortcut-trigger', 'add-shortcut-form', 'cancel-add-shortcut', triggerInput, () => { triggerInput.value = ''; expansionInput.value = ''; });

        save.addEventListener('click', () => {
            const trigger   = triggerInput.value.trim().replace(/^\/+/, '');
            const expansion = expansionInput.value; // preserve intentional whitespace
            if (!trigger || !expansion) return;
            if (/\s/.test(trigger)) { alert('A trigger can’t contain spaces.'); return; }
            if (!currentState.shortcuts) currentState.shortcuts = [];
            if (currentState.shortcuts.find(s => s.trigger === trigger)) { alert(`//${trigger} already exists.`); return; }
            currentState.shortcuts.push({ trigger, expansion });
            updateSetting('shortcuts', currentState.shortcuts);
            renderSnippets();
            close();
        });
    }

    // -------------------------------------------------------------------------
    // Import / Export
    // -------------------------------------------------------------------------

    function setupImportExport() {
        const exportBtn = document.getElementById('export-settings-btn');
        const importBtn = document.getElementById('import-settings-btn');
        const fileInput = document.getElementById('import-file-input');

        exportBtn.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(currentState, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `lighthouse-settings-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
        });

        importBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const imported = JSON.parse(event.target.result);
                    if (typeof imported !== 'object' || !imported) throw new Error('Invalid format');
                    chrome.storage.sync.set(imported, () => window.location.reload());
                } catch (err) {
                    alert('That file isn’t a Lighthouse settings export.');
                }
            };
            reader.readAsText(file);
            fileInput.value = '';
        });
    }

    // -------------------------------------------------------------------------
    // Drag & Drop (enabled rows only)
    // -------------------------------------------------------------------------

    let dragSrcEl = null;

    function handleDragStart(e) {
        flushPendingSafely();
        dragSrcEl = this;
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => this.classList.add('dragging'));
    }

    // A pending toggle elsewhere in the list shouldn't re-render mid-drag;
    // it is applied when the drag ends instead.
    let deferredDuringDrag = null;
    function flushPendingSafely() {
        if (pending) { deferredDuringDrag = pending; pending = null; }
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    function handleDragEnter(e) {
        e.preventDefault();
        const target = this.closest('.list-item');
        if (target && dragSrcEl && target !== dragSrcEl && target.parentNode === dragSrcEl.parentNode) {
            const items = [...dragSrcEl.parentNode.children];
            if (items.indexOf(dragSrcEl) < items.indexOf(target)) target.after(dragSrcEl);
            else target.before(dragSrcEl);
        }
    }

    function handleDragEnd() {
        this.classList.remove('dragging');
        persistOrder(this.dataset.type);
        dragSrcEl = null;
        if (deferredDuringDrag) { const run = deferredDuringDrag; deferredDuringDrag = null; run(); }
    }
})();
