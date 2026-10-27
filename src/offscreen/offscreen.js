/**
 * Lighthouse - Offscreen clipboard reader
 *
 * Reads the clipboard with the extension's own clipboardRead permission, in a hidden
 * extension page. Done in the page itself, the read would be the website's: Chrome would
 * ask on every site, and allowing it would give the site the clipboard.
 *
 * The Clipboard API (navigator.clipboard) needs a focused document, which a hidden page
 * never is, so the text is pasted into a textarea instead. This is the only place that
 * knows how; if Chrome adds a better way, only readClipboard() changes.
 */
(function () {
    const box = document.getElementById('clipboard');

    function readClipboard() {
        box.value = '';
        box.focus();
        const ok = document.execCommand('paste');
        const text = ok ? box.value : '';
        box.value = '';   // nothing is kept here between reads
        return text;
    }

    // Every extension message reaches this page; it only answers its own
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.target !== 'offscreen' || msg.type !== 'read-clipboard') return;
        sendResponse({ text: readClipboard() });
    });
})();