
/**
 * Lighthouse - Main Controller
 */
(function () {
  const UI = window.LighthouseUI;
  const SelLib = window.LighthouseSelection;
  const State = window.LighthouseState;
  const $ = window.LighthouseUtils;
  
  let linkHoverTimer = null;
  let recreateTimer = null;
  let linkDestroyTimer = null;

  function init() {
      State.init();
      if (UI.init) UI.init();
      
      // Events
      $.EventManager.add(document, 'mouseup', handleInteraction, true);
      $.EventManager.add(document, 'keyup', (e) => { if (e.key === 'Shift' || e.key.startsWith('Arrow')) handleInteraction(e); });
      $.EventManager.add(document, 'keydown', (e) => { if (e.key === 'Escape') UI.destroy(); });
      
      // Input Safety
      $.EventManager.add(document, 'input', (e) => {
          if ((UI.isActionActive && UI.isActionActive()) || UI.contains(e.target)) return;
          UI.destroy();
          if (window.LighthouseHandles) window.LighthouseHandles.hideDragHandles();
      }, true);
      
      // Link Hover
      $.EventManager.add(document, 'mouseover', handleLinkHover);
      $.EventManager.add(document, 'mouseout', (e) => {
          if (e.target.closest('a')) {
              linkDestroyTimer = setTimeout(() => { 
                  if (!UI.contains(e.relatedTarget) && !window.getSelection().toString()) UI.destroy(); 
              }, 200);
          }
      });

      // Scroll & Resize Lifecycle (Hide immediately, recreate after stop)
      const hideAndRecreate = () => {
          if (State.mode === 'HIDDEN') return;
          UI.destroy();
          if (window.LighthouseHandles) window.LighthouseHandles.hideDragHandles(true, true);
          
          if (recreateTimer) clearTimeout(recreateTimer);
          recreateTimer = setTimeout(() => {
              if (State.mode !== 'HIDDEN' && State.validate()) {
                  const newCtx = SelLib.getContext();
                  if (newCtx.hasText || (newCtx.isInput && newCtx.isEmptyInput)) {
                      State.update(newCtx);
                      UI.render(State);
                      if (window.LighthouseHandles && newCtx.hasText) {
                          window.LighthouseHandles.setDragHandles();
                      }
                  }
              }
          }, 650);
      };
      
      $.EventManager.add(window, 'scroll', hideAndRecreate, { capture: true, passive: true });
      $.EventManager.add(window, 'resize', hideAndRecreate, { passive: true });
      
      // Drag Start
      $.EventManager.add(document, 'dragstart', () => {
          if (State.mode !== 'HIDDEN') {
              UI.destroy();
              if (window.LighthouseHandles) window.LighthouseHandles.hideDragHandles();
          }
      });

      // Handle Window Blur (e.g. iframe click, tab switch)
      $.EventManager.add(window, 'blur', () => {
          UI.destroy(); // Force destroy
          if (window.LighthouseHandles) window.LighthouseHandles.hideDragHandles();
      });

      // Selection Change - Handle clearing immediately
      $.EventManager.add(document, 'selectionchange', () => {
          if (UI.isActionActive && UI.isActionActive()) return;
          
          const sel = window.getSelection();
          if (sel.isCollapsed) {
              const el = document.activeElement;
              // Ignore if inside an input (handled by handleInteraction/input events)
              if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
              
              UI.destroy();
              if (window.LighthouseHandles) window.LighthouseHandles.hideDragHandles();
          }
      });
      
      // Initialize Markers
      if (window.LighthouseMarkers) {
          window.LighthouseMarkers.init();
      }
      
      // Text Expander (Lazy Listener)
      document.addEventListener('focusin', (e) => {
          const el = e.target;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
              el.addEventListener('input', handleTextExpansion);
          }
      });
      
      document.addEventListener('focusout', (e) => {
          const el = e.target;
          if (el) el.removeEventListener('input', handleTextExpansion);
      });
  }

  function handleTextExpansion(e) {
      // 1. Fast Fail: Only Inputs/Textareas
      const el = e.target;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
      
      // 2. Get current value and cursor position
      const val = el.value;
      const cursor = el.selectionEnd;
      
      // 3. Find the start of the current line
      const textBeforeCursor = val.substring(0, cursor);
      const lastNewlineIndex = textBeforeCursor.lastIndexOf('\n');
      // If no newline, start is 0. If newline found, start is index + 1
      const lineStartIndex = lastNewlineIndex === -1 ? 0 : lastNewlineIndex + 1;
      
      const currentLineText = textBeforeCursor.substring(lineStartIndex);
      
      // 4. Must start with //
      if (!currentLineText.startsWith('//')) return;
      
      // 5. Trigger Check: Did we just type a Space or Enter?
      const isSpace = e.data === ' ';
      const isEnter = e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph';
      
      if (!isSpace && !isEnter) return;
      
      // 6. Extract the potential shortcut
      // It's everything between // and the cursor (minus the space/newline we just typed)
      const triggerText = currentLineText.substring(2, currentLineText.length - (isSpace ? 1 : 0)).trim();
      
      // 7. Find Match
      const shortcuts = (State.settings && State.settings.shortcuts) ? State.settings.shortcuts : [];
      const match = shortcuts.find(s => s.trigger === triggerText);
      
      if (match) {
          // 8. Replace
          // Calculate range to replace: "//" + trigger + " "
          // We replace relative to the cursor
          const lengthToReplace = 2 + triggerText.length + (isSpace ? 1 : 0);
          const start = cursor - lengthToReplace;
          
          if (start >= 0) {
              el.setSelectionRange(start, cursor);
              document.execCommand('insertText', false, match.expansion);
          }
      }
  }

  function handleInteraction(e) {
      if ((UI.isActionActive && UI.isActionActive())) return;
      if (State.settings.blacklist?.includes(window.location.hostname) || UI.contains(e.target)) return;
      if (window.LighthouseHandles && window.LighthouseHandles.isDragging) return;

      State.lastEvent = e;
      
      // Triple click delay
      const delay = e && e.detail === 3 ? 200 : 0;
      
      setTimeout(() => {
          const ctx = SelLib.getContext();
          
          // Standardize Position Capture for Scrolling Inputs
          if (e && e.type === 'mouseup' && ctx.isForm && ctx.element) {
              const rect = ctx.element.getBoundingClientRect();
              ctx.relativePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          }

          if (State.settings.smartSnapping && e && e.type === 'mouseup' && ctx.hasText) {
              try {
                  SelLib.performSnap(true);
                  // Re-fetch context but preserve mouse data
                  const snapCtx = SelLib.getContext();
                  snapCtx.relativePos = ctx.relativePos;
                  Object.assign(ctx, snapCtx);
              } catch (err) {
                  window.LighthouseUtils.Logger.warn('Lighthouse: Snap error', err);
              }
          }

          State.update(ctx);
          if (State.mode === 'HIDDEN') {
              UI.destroy();
              if (window.LighthouseHandles) window.LighthouseHandles.hideDragHandles();
          } else {
              UI.render(State);
              if (window.LighthouseHandles && ctx.hasText) {
                  window.LighthouseHandles.setDragHandles();
              }
          }
      }, delay);
  }

  function handleLinkHover(e) {
      // Clear destroy timer if we entered UI or a Link
      if (UI.contains(e.target) || e.target.closest('a')) {
          clearTimeout(linkDestroyTimer);
      }

      const link = e.target.closest('a');
      if (!link || link.hostname === window.location.hostname || UI.contains(e.target)) return;
      
      clearTimeout(linkHoverTimer);
      linkHoverTimer = setTimeout(() => {
          if (!window.getSelection().toString()) {
              State.update(SelLib.getLinkContext(link));
              if (State.mode === 'LINK') UI.render(State);
          }
      }, 400);
  }

  init();
})();
