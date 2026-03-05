# Lighthouse

Lighthouse is a modern, context-aware browser extension that supercharges your text selection. It provides a beautiful, floating tooltip with smart actions that adapt to what you highlight.

## ✨ Features

*   **Context-Aware Actions:** The tooltip only shows the tools you need.
    *   **Text:** Search, Translate, Define, Copy, Speak.
    *   **Links:** Open safely, Copy URL, View Safety Rating.
    *   **Smart Detection:** Automatically detects Math equations, Currency, and Proper Nouns (Wiki-Peek) to offer specialized actions.
*   **Wiki-Peek:** Highlight any famous person, place, or concept (1-4 capitalized words) to instantly see a Wikipedia summary and image without leaving the page.
*   **QR Code Generator:** Highlight any text or URL to instantly generate a scannable QR code.
*   **Drag Handles:** Easily adjust your text selection on desktop using touch-friendly drag handles (Circle, Square, Triangle, or Rhombus).
*   **Smart Snapping:** Automatically snaps your selection to whole words for precision.
*   **Customizable UI:** Fully themeable via CSS variables in the extension settings. Supports Light, Dark, and Auto modes.
*   **Performance Optimized:** Built with native event listeners, requestAnimationFrame batching, and intelligent caching to ensure zero battery drain and silky smooth 60fps interactions.

## 🚀 Installation (Developer Mode)

1.  Clone or download this repository.
2.  Open your browser's extension management page:
    *   Chrome/Brave/Edge: `chrome://extensions/`
3.  Enable **Developer mode** (usually a toggle in the top right corner).
4.  Click **Load unpacked** and select the folder containing the extension files.

## ⚙️ Configuration

Click the Lighthouse icon in your browser toolbar to open the Settings Popup.

*   **Buttons:** Drag and drop to reorder the actions in your tooltip. Enable or disable specific tools.
*   **Search Engines:** Add custom search providers (e.g., YouTube, Reddit, GitHub).
*   **Options:**
    *   Toggle Smart Snapping and Drag Handles.
    *   Change the Drag Handle style.
    *   Set your preferred Language, Currency, and Measurement Units.
    *   Customize the tooltip appearance with your own CSS.
    *   Export and Import your settings.

## 💻 Development

For technical details, architecture overview, and guides on how to contribute or add new actions, please refer to [DEVELOPER.md](./DEVELOPER.md).

## 📄 License

MIT License
