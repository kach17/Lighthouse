// popup.js
// Settings for Lighthouse. Uses the same stylesheets and components as the bar.
(function() {
    const $ = window.LighthouseUtils;
    const Config = window.LighthouseConfig;
    const Data = window.LighthouseData;

    let currentState = { ...Config.defaults };
    let currentHostname = '';

    const registryIcon = (name) => $.getIconFromSvg(window.LighthouseIcons[name]);

    document.addEventListener('DOMContentLoaded', () => {
        chrome.storage.sync.get(Config.defaults, (items) => {
            currentState = { ...Config.defaults, ...Config.validOnly(items) };   // only valid settings (config.js)

            // A control marked data-setting shows that setting and changes it: a switch, or a choice among a few
            document.querySelectorAll('input[data-setting]').forEach(input => {
                input.checked = currentState[input.dataset.setting];
                input.addEventListener('change', () => updateSetting(input.dataset.setting, input.checked));
            });
            document.querySelectorAll('[role=radiogroup][data-setting]').forEach(group => bindChoice(group, currentState[group.dataset.setting], v => updateSetting(group.dataset.setting, v)));
            setupLinkPreviews(currentState.linkPreviews);

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

    // Link previews are opt-in: turning them on asks Chrome for permission to fetch the
    // hovered page; turning them off gives that permission back.
    function setupLinkPreviews(enabled) {
        const input = document.getElementById('toggle-link-previews');
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

    // A choice among a few options: a segmented control (its buttons carry data-mode), the chosen one takes the tone.
    function bindChoice(group, value, onChange) {
        const sync = (v) => group.querySelectorAll('[data-mode]').forEach(b => {
            const on = b.dataset.mode === v;
            b.classList.toggle('is-engaged', on);
            b.setAttribute('aria-checked', String(on));
        });
        sync(value);
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mode]');
            if (!btn) return;
            sync(btn.dataset.mode);
            onChange(btn.dataset.mode);
        });
    }

    // On/Off rows: clicking a segment sets that value, clicking elsewhere on the row toggles.
    // The hidden checkbox stays the source of truth (and keeps keyboard access).
    function setupToggleRows() {
        document.querySelectorAll('.lh-toggle').forEach(row => {
            const input = row.querySelector('input[type="checkbox"]');
            row.addEventListener('click', (e) => {
                if (input.disabled) return;
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
        syncChoice(currentState.themeMode);

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
        // Every currency the browser knows, and the crypto ones data.js adds
        [...new Set([...Intl.supportedValuesOf('currency'), ...Object.values(Data.CURRENCY_MAP)])].sort().forEach(code => {
            const name = nameOf('currency', code);
            currSelect.appendChild($.create('option', { attrs: { value: code }, text: name === code ? code : `${code} — ${name}` }));
        });

        const std = currentState.standards;
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

        const unavailable = () => {
            label.textContent = 'Not available here';
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
                toggle.checked  = !currentState.blacklist.includes(currentHostname);
                toggle.disabled = false;
            } catch (e) {
                unavailable();
            }
        });

        toggle.addEventListener('change', () => {
            if (!currentHostname) return;
            const list = currentState.blacklist;
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
    // Lists: one list per tab, in bar order. The row is the thing you act on:
    // click (or Space/Enter) turns it on or off, drag (or Alt+Arrow) reorders.
    // Rows never move on their own; a row that's off stays in place and says so.
    // -------------------------------------------------------------------------

    function createRow({ label, icon, url, isOn, type, ref, onToggle, onDelete }) {
        const state = $.create('span', { className: 'lh-row-state', text: isOn ? '' : 'Off' });
        const li = $.create('li', {
            className: 'lh-row list-item' + (isOn ? '' : ' is-off'),
            attrs: { tabindex: '0', role: 'checkbox', 'aria-checked': String(isOn), 'data-type': type, draggable: 'true' },
            children: [
                $.create('span', { className: 'lh-row-grip', children: [registryIcon('grip')] }),
                $.create('span', { className: 'lh-row-icon', children: [ $.createSmartIcon(icon, url, label) ] }),
                $.create('span', { className: 'lh-row-label', text: label }),
                state
            ]
        });
        li._ref = ref;

        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragend', handleDragEnd);

        if (onDelete) {
            li.appendChild($.create('button', {
                className: 'lh-row-delete',
                attrs: { 'aria-label': `Delete ${label}`, title: 'Delete' },
                children: [registryIcon('trash')],
                events: { click: (e) => { e.stopPropagation(); onDelete(); } }
            }));
        }

        const toggle = () => {
            const next = li.getAttribute('aria-checked') !== 'true';
            li.setAttribute('aria-checked', String(next));
            li.classList.toggle('is-off', !next);
            state.textContent = next ? '' : 'Off';
            onToggle(next);
        };

        li.addEventListener('click', (e) => {
            if (e.target.closest('.lh-row-delete')) return;
            toggle();
        });

        li.addEventListener('keydown', (e) => {
            if (e.target !== li) return;
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); return; }
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const sibling = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
            if (!sibling) return;
            if (e.altKey) {
                e.key === 'ArrowUp' ? sibling.before(li) : sibling.after(li);
                li.focus();
                persistOrder(type);
            } else {
                sibling.focus();
            }
        });

        return li;
    }

    function renderButtons() {
        const list = document.getElementById('button-list');
        list.innerHTML = '';
        currentState.order.forEach(id => {
            const meta = Config.actions.find(a => a.id === id);
            if (!meta) return;
            list.appendChild(createRow({
                label: meta.label, icon: meta.icon, isOn: !!currentState.enabled[id], type: 'main', ref: id,
                onToggle: (next) => {
                    currentState.enabled[id] = next;
                    updateSetting('enabled', currentState.enabled);
                }
            }));
        });
    }

    function renderSearch() {
        const list = document.getElementById('search-list');
        list.innerHTML = '';
        currentState.searchEngines.forEach(engine => {
            list.appendChild(createRow({
                label: engine.name, icon: engine.icon, url: engine.url, isOn: !!engine.enabled, type: 'search', ref: engine,
                onToggle: (next) => {
                    engine.enabled = next;
                    updateSetting('searchEngines', currentState.searchEngines);
                },
                onDelete: () => {
                    currentState.searchEngines.splice(currentState.searchEngines.indexOf(engine), 1);
                    updateSetting('searchEngines', currentState.searchEngines);
                    renderSearch();
                }
            }));
        });
    }

    // The list is the order: read it back from the rows
    function persistOrder(type) {
        if (type === 'main') {
            const ids = [...document.querySelectorAll('#button-list .list-item')].map(li => li._ref);
            currentState.order = ids.concat(currentState.order.filter(id => !ids.includes(id)));
            updateSetting('order', currentState.order);
        } else if (type === 'search') {
            currentState.searchEngines = [...document.querySelectorAll('#search-list .list-item')].map(li => li._ref);
            updateSetting('searchEngines', currentState.searchEngines);
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
        const close = bindAddForm('add-trigger', 'add-form', 'cancel-add', urlInput, () => { nameInput.value = ''; urlInput.value = ''; });

        // bing.com/search?q=%s -> "Bing"
        const nameFromUrl = (url) => {
            try {
                const host = new URL(url).hostname.replace(/^www\./, '');
                const word = host.split('.')[0];
                return word.charAt(0).toUpperCase() + word.slice(1);
            } catch (e) { return ''; }
        };

        const add = () => {
            let url = urlInput.value.trim();
            if (!url) return;
            if (!url.startsWith('http')) url = 'https://' + url;
            const name = nameInput.value.trim() || nameFromUrl(url);
            if (!name) return;
            const engine = { id: 'custom-' + Date.now(), name, url, icon: null, enabled: true };
            currentState.searchEngines.push(engine);
            updateSetting('searchEngines', currentState.searchEngines);
            renderSearch();
            close();
        };
        save.addEventListener('click', add);
        [urlInput, nameInput].forEach(el => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); }));
    }

    function renderSnippets() {
        const list     = document.getElementById('shortcuts-list');
        const empty    = document.getElementById('shortcuts-empty');
        const hint     = document.getElementById('shortcuts-hint');
        const snippets = currentState.shortcuts;
        list.innerHTML = '';
        empty.hidden = snippets.length > 0;
        hint.hidden  = snippets.length === 0;

        snippets.forEach((s, index) => {
            list.appendChild($.create('li', {
                className: 'lh-row p-static',
                children: [
                    $.create('span', { className: 'lh-row-mono', text: '//' + s.trigger }),
                    $.create('span', { className: 'lh-row-sub', text: s.expansion }),
                    $.create('button', {
                        className: 'lh-row-delete',
                        attrs: { 'aria-label': `Delete //${s.trigger}`, title: 'Delete' },
                        children: [registryIcon('trash')],
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
        const error          = document.getElementById('shortcut-error');
        const say = (msg) => { error.textContent = msg; error.hidden = !msg; };
        const close = bindAddForm('add-shortcut-trigger', 'add-shortcut-form', 'cancel-add-shortcut', triggerInput, () => { triggerInput.value = ''; expansionInput.value = ''; say(''); });
        [triggerInput, expansionInput].forEach(el => el.addEventListener('input', () => say('')));

        // The "//" is fixed in front of the field; slashes typed anyway are dropped
        triggerInput.addEventListener('input', () => {
            const name = triggerInput.value.replace(/^\/+/, '');
            if (name !== triggerInput.value) triggerInput.value = name;
        });
        triggerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); expansionInput.focus(); } });

        save.addEventListener('click', () => {
            const trigger   = triggerInput.value.trim().replace(/^\/+/, '');
            const expansion = expansionInput.value; // preserve intentional whitespace
            if (!trigger || !expansion) return;
            if (/\s/.test(trigger)) { say('A name can’t contain spaces.'); triggerInput.focus(); return; }
            if (currentState.shortcuts.find(s => s.trigger === trigger)) { say(`//${trigger} already exists.`); triggerInput.focus(); return; }
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
                    // Only settings Lighthouse knows, with values of their kind; a file with none isn't an export
                    const valid = Config.validOnly(JSON.parse(event.target.result));
                    if (!Object.keys(valid).length) throw new Error('Not a settings export');
                    chrome.storage.sync.set(valid, () => window.location.reload());
                } catch (err) {
                    alert('That file isn’t a Lighthouse settings export.');
                }
            };
            reader.readAsText(file);
            fileInput.value = '';
        });
    }

    // -------------------------------------------------------------------------
    // Drag & Drop
    // -------------------------------------------------------------------------

    let dragSrcEl = null;

    function handleDragStart(e) {
        dragSrcEl = this;
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => this.classList.add('dragging'));
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
    }
})();