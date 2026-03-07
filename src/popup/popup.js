// popup.js
(function() {
    const $ = window.LighthouseUtils;
    const Config = window.LighthouseConfig;
    const Data = window.LighthouseData;

    let currentState = { ...Config.defaults };
    let currentHostname = '';

    document.addEventListener('DOMContentLoaded', () => {
        chrome.storage.sync.get(Config.defaults, (items) => {
            currentState = items;

            // 1. Behavior Toggles
            const snapToggle = document.getElementById('toggle-snapping');
            snapToggle.checked = items.smartSnapping;
            snapToggle.addEventListener('change', () => updateSetting('smartSnapping', snapToggle.checked));

            const handlesToggle = document.getElementById('toggle-handles');
            if (handlesToggle) {
                handlesToggle.checked = items.addDragHandles !== false;
                handlesToggle.addEventListener('change', () => updateSetting('addDragHandles', handlesToggle.checked));
            }


            const debugToggle = document.getElementById('toggle-debug');
            if (debugToggle) {
                debugToggle.checked = items.debugMode || false;
                debugToggle.addEventListener('change', () => updateSetting('debugMode', debugToggle.checked));
            }

            // 2. Theme & Custom CSS
            setupCustomCSS();

            // 3. Standards Section
            setupStandards();

            // 4. Render Main Buttons
            renderList('button-list', currentState.order, currentState.enabled);

            // 5. Render Search Engines
            renderSearchList();

            // 6. Search Engine Add Form
            setupAddForm();

            // 7. Shortcuts
            renderShortcutsList();
            setupShortcutForm();

            // 8. Site Toggle
            setupSiteToggle();

            // 9. Tabs
            setupTabs();

            // 10. Import / Export
            setupImportExport();
        });
    });

    // -------------------------------------------------------------------------
    // Settings helpers
    // -------------------------------------------------------------------------

    function updateSetting(key, value) {
        currentState[key] = value;
        chrome.storage.sync.set({ [key]: value });
    }

    // -------------------------------------------------------------------------
    // Theme & Custom CSS
    // -------------------------------------------------------------------------

    function setupCustomCSS() {
        const input   = document.getElementById('custom-css-input');
        const saveBtn = document.getElementById('save-css-btn');
        const lightBtn = document.getElementById('theme-light-btn');
        const darkBtn  = document.getElementById('theme-dark-btn');

        // Inject a <style> tag so the popup itself reflects the active theme
        const sharedStyle = document.createElement('style');
        sharedStyle.id = 'shared-theme-styles';
        document.head.appendChild(sharedStyle);

        // Populate the CSS editor. Fall back to the active theme preset if empty.
        const activeMode = currentState.themeMode || 'dark';
        const storedCSS  = currentState.customStyles || '';
        const defaultCSS = Data.cssFromTheme(Data.THEMES[activeMode]);
        
        input.value = storedCSS || defaultCSS;
        sharedStyle.textContent = storedCSS || defaultCSS;

        // Highlight the correct preset button
        const syncButtons = (mode) => {
            lightBtn.classList.toggle('selected', mode === 'light');
            darkBtn.classList.toggle('selected',  mode === 'dark');
            document.body.dataset.theme = mode;
        };
        syncButtons(activeMode);

        // Apply any CSS and persist both the text and the resolved themeMode
        const applyCSS = (cssText, mode) => {
            sharedStyle.textContent = cssText;
            input.value = cssText;
            updateSetting('customStyles', cssText);
            if (mode) {
                updateSetting('themeMode', mode);
                syncButtons(mode);
            }

            // Saved feedback — uses CSS variables so it respects the theme
            saveBtn.classList.add('saved');
            saveBtn.textContent = 'Saved!';
            setTimeout(() => {
                saveBtn.classList.remove('saved');
                saveBtn.textContent = 'Save CSS';
            }, 1000);
        };

        lightBtn.addEventListener('click', () => applyCSS(Data.cssFromTheme(Data.THEMES.light), 'light'));
        darkBtn.addEventListener('click',  () => applyCSS(Data.cssFromTheme(Data.THEMES.dark),  'dark'));

        // Manual save: keep themeMode as-is (user wrote custom CSS, not a preset)
        saveBtn.addEventListener('click', () => applyCSS(input.value, null));
    }

    // -------------------------------------------------------------------------
    // Standards (Language / Currency / Units)
    // -------------------------------------------------------------------------

    function setupStandards() {
        const langSelect = document.getElementById('std-lang');
        const currSelect = document.getElementById('std-curr');
        const unitSelect = document.getElementById('std-units');

        Data.LANGUAGES.forEach(lang => {
            const opt = document.createElement('option');
            opt.value = lang.code;
            opt.textContent = lang.name;
            langSelect.appendChild(opt);
        });

        const currencies = [...new Set(Object.values(Data.CURRENCY_MAP))].sort();
        currencies.forEach(curr => {
            const opt = document.createElement('option');
            opt.value = curr;
            opt.textContent = curr;
            currSelect.appendChild(opt);
        });

        const std = currentState.standards || Config.defaults.standards;
        langSelect.value = std.language;
        currSelect.value = std.currency;
        unitSelect.value = std.units;

        const saveStandards = () => updateSetting('standards', {
            language: langSelect.value,
            currency: currSelect.value,
            units:    unitSelect.value
        });

        langSelect.addEventListener('change', saveStandards);
        currSelect.addEventListener('change', saveStandards);
        unitSelect.addEventListener('change', saveStandards);
    }

    // -------------------------------------------------------------------------
    // Site Toggle
    // -------------------------------------------------------------------------

    function setupSiteToggle() {
        const toggle = document.getElementById('toggle-site');
        const label  = document.getElementById('current-site');
        const row    = document.getElementById('site-toggle-row');

        const getBlacklist = () => {
            if (!Array.isArray(currentState.blacklist)) currentState.blacklist = [];
            return currentState.blacklist;
        };

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0] || !tabs[0].url) {
                label.textContent = 'No URL Detected';
                return;
            }
            try {
                const url = new URL(tabs[0].url);
                if (url.protocol.startsWith('http') || url.protocol === 'file:') {
                    currentHostname = url.hostname || 'Local File';
                    label.textContent = currentHostname;
                    toggle.checked  = !getBlacklist().includes(currentHostname);
                    toggle.disabled = false;
                    if (row) {
                        row.style.opacity = '1';
                        row.onclick = (e) => {
                            if (e.target !== toggle && e.target !== toggle.nextElementSibling) {
                                toggle.checked = !toggle.checked;
                                toggle.dispatchEvent(new Event('change'));
                            }
                        };
                    }
                } else {
                    label.textContent = 'System Page';
                    toggle.checked  = false;
                    toggle.disabled = true;
                    if (row) row.style.opacity = '0.5';
                }
            } catch (e) {
                label.textContent = 'Invalid URL';
                toggle.disabled = true;
            }
        });

        toggle.addEventListener('change', () => {
            if (!currentHostname) return;
            const list = getBlacklist();
            const idx  = list.indexOf(currentHostname);
            if (toggle.checked) {
                if (idx > -1) list.splice(idx, 1);
            } else {
                if (idx === -1) list.push(currentHostname);
            }
            currentState.blacklist = list;
            updateSetting('blacklist', list);
        });
    }

    // -------------------------------------------------------------------------
    // Tabs
    // -------------------------------------------------------------------------

    function setupTabs() {
        const tabs     = document.querySelectorAll('.tab');
        const contents = document.querySelectorAll('.tab-content');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            });
        });
    }

    // -------------------------------------------------------------------------
    // Import / Export
    // -------------------------------------------------------------------------

    function setupImportExport() {
        const exportBtn  = document.getElementById('export-settings-btn');
        const importBtn  = document.getElementById('import-settings-btn');
        const fileInput  = document.getElementById('import-file-input');

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
                    alert('Failed to import settings. Invalid file format.');
                }
            };
            reader.readAsText(file);
            fileInput.value = '';
        });
    }

    // -------------------------------------------------------------------------
    // List rendering
    // -------------------------------------------------------------------------

    function renderList(containerId, order, enabledMap) {
        const list = document.getElementById(containerId);
        list.innerHTML = '';
        order.forEach(id => {
            const meta = Config.actions.find(a => a.id === id);
            if (!meta) return;
            list.appendChild(createListItem(id, meta.label, meta.icon, null, enabledMap[id], false, (checked) => {
                currentState.enabled[id] = checked;
                updateSetting('enabled', currentState.enabled);
            }));
        });
    }

    function renderSearchList() {
        const list = document.getElementById('search-list');
        list.innerHTML = '';
        currentState.searchEngines.forEach((engine, index) => {
            list.appendChild(createListItem(index, engine.name, engine.icon, engine.url, engine.enabled, true,
                (checked) => {
                    currentState.searchEngines[index].enabled = checked;
                    updateSetting('searchEngines', currentState.searchEngines);
                },
                () => {
                    currentState.searchEngines.splice(index, 1);
                    updateSetting('searchEngines', currentState.searchEngines);
                    renderSearchList();
                }
            ));
        });
    }

    function createListItem(id, label, iconKeyOrSvg, url, isChecked, isSearch, onToggle, onDelete) {
        const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        const DRAG_ICON  = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="8" cy="4" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="20" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="16" cy="20" r="2"/></svg>`;
        const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

        const li = $.create('li', {
            className: 'list-item',
            attrs: { draggable: 'true', 'data-id': id, 'data-type': isSearch ? 'search' : 'main' },
            events: { dragstart: handleDragStart, dragover: handleDragOver, dragenter: handleDragEnter, dragend: handleDragEnd },
            children: [
                $.create('div', { className: 'drag-handle', html: DRAG_ICON }),
                $.create('div', { className: 'item-icon', children: $.createSmartIcon(iconKeyOrSvg, url, label) }),
                $.create('span', { className: 'item-name', text: label })
            ]
        });

        if (isSearch && onDelete) {
            li.appendChild($.create('div', {
                className: 'delete-btn',
                html: TRASH_ICON,
                events: { click: (e) => { e.stopPropagation(); onDelete(); } }
            }));
        }

        const check = $.create('div', {
            className: `item-check ${isChecked ? 'checked' : ''}`,
            html: CHECK_ICON,
            events: {
                click: function(e) {
                    e.stopPropagation();
                    onToggle(this.classList.toggle('checked'));
                }
            }
        });
        li.appendChild(check);
        return li;
    }

    // -------------------------------------------------------------------------
    // Search Engine add form
    // -------------------------------------------------------------------------

    function setupAddForm() {
        const trigger   = document.getElementById('add-trigger');
        const form      = document.getElementById('add-form');
        const cancel    = document.getElementById('cancel-add');
        const save      = document.getElementById('save-add');
        const nameInput = document.getElementById('new-name');
        const urlInput  = document.getElementById('new-url');

        trigger.addEventListener('click', () => { trigger.style.display = 'none'; form.classList.add('visible'); });

        cancel.addEventListener('click', () => {
            form.classList.remove('visible');
            trigger.style.display = 'block';
            nameInput.value = '';
            urlInput.value  = '';
        });

        save.addEventListener('click', () => {
            const name = nameInput.value.trim();
            let url    = urlInput.value.trim();
            if (!name || !url) return;
            if (!url.startsWith('http')) url = 'https://' + url;
            currentState.searchEngines.push({ id: 'custom-' + Date.now(), name, url, icon: null, enabled: true });
            updateSetting('searchEngines', currentState.searchEngines);
            renderSearchList();
            cancel.click();
        });
    }

    // -------------------------------------------------------------------------
    // Shortcuts
    // -------------------------------------------------------------------------

    function renderShortcutsList() {
        const list      = document.getElementById('shortcuts-list');
        const shortcuts = currentState.shortcuts || [];
        list.innerHTML  = '';

        shortcuts.forEach((s, index) => {
            const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            list.appendChild($.create('li', {
                className: 'list-item',
                attrs: { style: 'cursor:default' },
                children: [
                    $.create('div', { className: 'item-icon shortcut-trigger', text: '//' + s.trigger }),
                    $.create('span', { className: 'item-name item-name--sub', text: s.expansion }),
                    $.create('div', {
                        className: 'delete-btn',
                        html: TRASH_ICON,
                        events: {
                            click: (e) => {
                                e.stopPropagation();
                                shortcuts.splice(index, 1);
                                updateSetting('shortcuts', shortcuts);
                                renderShortcutsList();
                            }
                        }
                    })
                ]
            }));
        });
    }

    function setupShortcutForm() {
        const triggerBtn     = document.getElementById('add-shortcut-trigger');
        const form           = document.getElementById('add-shortcut-form');
        const cancel         = document.getElementById('cancel-add-shortcut');
        const save           = document.getElementById('save-add-shortcut');
        const triggerInput   = document.getElementById('new-shortcut-trigger');
        const expansionInput = document.getElementById('new-shortcut-expansion');

        triggerBtn.addEventListener('click', () => {
            triggerBtn.style.display = 'none';
            form.classList.add('visible');
            triggerInput.focus();
        });

        const closeForm = () => {
            form.classList.remove('visible');
            triggerBtn.style.display = 'block';
            triggerInput.value   = '';
            expansionInput.value = '';
        };

        cancel.addEventListener('click', closeForm);

        save.addEventListener('click', () => {
            const trigger   = triggerInput.value.trim();
            const expansion = expansionInput.value; // preserve intentional whitespace
            if (!trigger || !expansion) return;
            if (/\s/.test(trigger)) { alert('Trigger cannot contain spaces.'); return; }
            if (!currentState.shortcuts) currentState.shortcuts = [];
            if (currentState.shortcuts.find(s => s.trigger === trigger)) {
                alert('Shortcut with this trigger already exists.');
                return;
            }
            currentState.shortcuts.push({ trigger, expansion });
            updateSetting('shortcuts', currentState.shortcuts);
            renderShortcutsList();
            closeForm();
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
            if (items.indexOf(dragSrcEl) < items.indexOf(target)) {
                target.after(dragSrcEl);
            } else {
                target.before(dragSrcEl);
            }
        }
    }

    function handleDragEnd() {
        this.classList.remove('dragging');
        if (this.dataset.type === 'main') {
            const items = [...document.querySelectorAll('#button-list .list-item')];
            currentState.order = items.map(el => el.dataset.id);
            updateSetting('order', currentState.order);
        } else if (this.dataset.type === 'search') {
            const items    = [...document.querySelectorAll('#search-list .list-item')];
            const reordered = items.map(li => currentState.searchEngines[parseInt(li.dataset.id)]);
            currentState.searchEngines = reordered;
            updateSetting('searchEngines', currentState.searchEngines);
            renderSearchList();
        }
    }

})();