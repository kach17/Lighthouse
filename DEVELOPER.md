# Developer Documentation

This document serves as a guide for navigating, understanding, and contributing to the Lighthouse extension codebase.

## 1. Project Structure

```
/
├── manifest.json       # Extension configuration (MV3)
├── src/
│   ├── background/     # Service Worker (API proxies, migration)
│   ├── content/        # Content Scripts (UI injection, event listeners)
│   ├── modules/        # Core Logic (State, Actions, UI generation)
│   ├── popup/          # Extension Popup (Settings)
│   └── utils/          # Helpers (Config, Logger, Math)
└── icons/              # App icons (to be created for production)
```

### Module Descriptions

Here is a breakdown of the core modules located in `src/modules/`:

*   **`actions.js`**: The registry of all available actions (Copy, Paste, Search, Translate, etc.). Each action defines its trigger conditions, execution logic, and preview behavior.
*   **`api.js`**: Handles communication with external APIs (e.g., Google Translate, Wikipedia) and the background script for cross-origin requests.
*   **`handles.js`**: Manages the interactive drag handles that appear around the selection on desktop, allowing for precise text adjustment.
*   **`markers.js`**: Handles visual highlighting and markers within the text, used for features like "Wiki-Peek" or search result highlighting.
*   **`math.js`**: Contains logic for detecting mathematical expressions in the selected text and solving them.
*   **`selection.js`**: The core engine for analyzing the user's selection. It handles text extraction, context detection (Input vs. Text vs. Link), and smart snapping logic.
*   **`state.js`**: The central state machine. It orchestrates the transition between different modes (Hidden, Selection, Input, Smart) based on events from `content.js`.
*   **`ui.js`**: Responsible for rendering the tooltip UI inside the Shadow DOM. It handles positioning, animations, and DOM updates.

And the utility scripts in `src/utils/`:

*   **`config.js`**: Stores default configuration settings and user preferences.
*   **`data.js`**: Contains static data definitions such as Currency symbols, Unit conversion tables, and SVG Icons.
*   **`utils.js`**: General-purpose helper functions (Debounce, Logger, DOM utilities).

## 2. Architecture Overview

Lighthouse operates primarily as a **Content Script** extension, meaning most logic runs directly in the context of the web page.

### Key Components

1.  **Content Script (`src/content/content.js`)**:
    *   The entry point.
    *   Initializes the application.
    *   Manages global event listeners (`mouseup`, `keyup`, `scroll`, `resize`).
    *   Orchestrates the lifecycle: `Event -> Selection Analysis -> State Update -> UI Render`.

2.  **Shadow DOM (UI Isolation)**:
    *   The tooltip UI is rendered inside a **Shadow Root** (`#lighthouse-extension-root`).
    *   This ensures that the extension's styles do not bleed into the host page, and the host page's styles do not break the extension's UI.

3.  **State Management (`src/modules/state.js`)**:
    *   The "Brain" of the extension.
    *   Determines the current **Mode** (`HIDDEN`, `SELECTION`, `INPUT`, `SMART`, `LINK`) based on the context.
    *   Filters available actions based on user settings and context.

4.  **Action Registry (`src/modules/actions.js`)**:
    *   Contains the definitions for all tooltips actions (Copy, Paste, Search, etc.).
    *   Each action defines its own `condition` (when to show), `execute` (what to do), and `preview` (what to show in the secondary menu).

5.  **Background Service Worker (`src/background/background.js`)**:
    *   Handles tasks that require persistent state or cross-origin network requests.
    *   **API Proxy**: Proxies requests for Currency, Translation, and Wikipedia to avoid CORS errors in the content script.
    *   **Migration**: Updates user storage when new actions are added to the codebase.

### Module System (Global Namespace)

The project uses a **Global Namespace** pattern to share code between modules without a bundler (like Webpack/Vite) for simplicity in the raw extension context.

*   Modules attach themselves to `window` (e.g., `window.LighthouseState`, `window.LighthouseActions`).
*   **Order Matters**: In `manifest.json`, utility scripts are loaded *before* modules, and modules *before* the main content script.

## 3. How-To Guides

### How to Add a New Action

1.  Open `src/modules/actions.js`.
2.  Add a new object to the `ACTIONS` array.
3.  **Required Fields**:
    *   `id`: Unique string ID.
    *   `label`: Short text for the button.
    *   `category`: `'selection'`, `'input'`, `'smart'`, or `'link'`.
    *   `icon`: SVG string (add to `ICON_REGISTRY` at the top of the file).
    *   `condition`: Function `(ctx) => boolean`. Returns `true` if the action should appear.
    *   `execute`: Function `(ctx, tools) => result`. The primary action.
4.  **Optional Fields**:
    *   `preview`: Function returning data for the secondary menu/popover.

**Example:**
```javascript
{
    id: 'my_action',
    label: 'Hello',
    category: 'selection',
    icon: 'star', // Ensure 'star' is in ICON_REGISTRY
    condition: (ctx) => ctx.hasText && ctx.text === 'hello',
    execute: (ctx) => {
        alert('World!');
        return { success: true };
    }
}
```

### How to Debug

*   **Content Script Logs**: Open the **Web Page Console** (F12).
    *   Look for logs prefixed with `[Lighthouse]`.
    *   `State.js` logs mode changes (e.g., `Mode Changed: SELECTION`).
*   **Background Script Logs**: Open `chrome://extensions`, find Lighthouse, and click **"service worker"** to open its separate console.
    *   Check here for API errors (Translation, Currency) or Installation/Update events.

## 4. State Modes

The extension switches between these modes automatically:

*   **HIDDEN**: No tooltip shown.
*   **SELECTION**: Standard text selection. Shows Copy, Search, Translate, etc.
*   **INPUT**: User clicked inside a text input. Shows Paste, Clear, etc.
    *   *Note:* Logic exists to prevent the tooltip from annoying the user while typing. It typically appears on the *first* click/focus, then hides on subsequent clicks unless text is selected.
*   **SMART**: A specific data type was detected (Date, Color, JSON, Math). Shows specialized tools alongside standard ones.
*   **LINK**: User hovered over a hyperlink. Shows Link actions.

## 5. Manifest Management

*   **Permissions**: If you add a feature requiring a new Chrome API (e.g., `bookmarks`), add it to `permissions` in `manifest.json`.
*   **Host Permissions**: If you add a new API integration (e.g., a new translation service), add the domain to `host_permissions`.
*   **Files**: If you add a new JS file to `src/modules/`, you **MUST** add it to the `js` array in `manifest.json` under `content_scripts`.
