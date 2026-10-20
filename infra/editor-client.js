(function () {
  'use strict';

  // --- SDRnow In-Page Editor Client ---
  const TOKENS = {
    primary: '#F26522',
    primaryHover: '#D95316',
    primarySoft: '#FFF3ED',
    chromeBg: '#111827',
    chromeSurface: '#1F2937',
    chromeInput: '#0F172A',
    chromeBorder: '#374151',
    chromeText: '#F9FAFB',
    chromeMuted: '#9CA3AF',
    statusStaging: '#F59E0B',
    statusProd: '#15803D',
    statusDanger: '#B91C1C',
  };

  const state = {
    mode: 'read', // 'read' | 'edit'
    dirty: false,
    currentLang: document.documentElement.lang === 'en' ? 'en' : 'fr',
    activeKey: null,
    activeType: 'plain',
    activeElement: null,
    lastFocusedElement: null,
    lastActiveInput: null,
    schema: {},
    translations: { fr: {}, en: {} },
    previewUrl: '',
    confirmTimer: null,
  };

  // --- Toast Manager ---
  function showToast(message, type = 'staging', duration = 4000) {
    let toast = document.getElementById('sdrnow-editor-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sdrnow-editor-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.style.cssText = `
        position: fixed;
        top: 64px;
        right: 16px;
        z-index: 99999;
        padding: 12px 18px;
        border-radius: 6px;
        background: ${TOKENS.chromeSurface};
        color: ${TOKENS.chromeText};
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        gap: 10px;
        transition: opacity 0.2s, transform 0.2s;
      `;
      document.body.appendChild(toast);
    }

    const borderColors = {
      staging: TOKENS.statusStaging,
      prod: TOKENS.statusProd,
      error: TOKENS.statusDanger,
    };
    toast.style.borderLeft = `4px solid ${borderColors[type] || TOKENS.primary}`;
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    toast.style.display = 'flex';

    if (toast._timer) clearTimeout(toast._timer);
    if (duration > 0) {
      toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        setTimeout(() => {
          toast.style.display = 'none';
        }, 200);
      }, duration);
    }
  }

  // --- Dirty State & Unload Protection ---
  function setDirty(isDirty) {
    state.dirty = isDirty;
    const statusPill = document.getElementById('sdrnow-status-dot');
    if (statusPill) {
      if (isDirty) {
        statusPill.textContent = '● Modifications non enregistrées';
        statusPill.style.color = TOKENS.statusStaging;
      } else {
        statusPill.textContent = '● Non modifié';
        statusPill.style.color = TOKENS.chromeMuted;
      }
    }
  }

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // --- Fetch Initial Translations ---
  async function loadTranslations() {
    try {
      const res = await fetch('/api/translations');
      if (res.ok) {
        const data = await res.json();
        state.schema = data.schema || {};
        state.translations.fr = data.fr || {};
        state.translations.en = data.en || {};
        state.previewUrl = data.previewUrl || '';
      }
    } catch (err) {
      console.error('[SDRnow Editor] Failed to load /api/translations:', err);
    }
  }

  // --- Live DOM Language Switcher (CAP-1) ---
  function applyLanguageToPage(lang) {
    state.currentLang = lang;
    const dict = state.translations[lang] || {};

    // 1. Title
    const titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) {
      const key = titleEl.getAttribute('data-i18n');
      if (dict[key]) titleEl.textContent = dict[key];
    }

    // 2. Meta description
    const metaEl = document.querySelector('meta[data-i18n-content="meta.description"]');
    if (metaEl && dict['meta.description']) {
      metaEl.setAttribute('content', dict['meta.description']);
    }

    // 3. All visible data-i18n nodes
    const nodes = document.querySelectorAll('[data-i18n]');
    nodes.forEach((node) => {
      if (node.tagName === 'TITLE') return;
      const key = node.getAttribute('data-i18n');
      if (dict[key] !== undefined) {
        node.innerHTML = dict[key];
      }
    });
  }

  // --- Pure Token Formatting Model (P2) ---
  function domToTokens(root, range) {
    const tokens = [];
    let tokenStart = -1;
    let tokenEnd = -1;

    function traverse(node, isEm) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue || '';
        for (let i = 0; i < text.length; i++) {
          if (range && node === range.startContainer && i === range.startOffset) {
            tokenStart = tokens.length;
          }
          if (range && node === range.endContainer && i === range.endOffset) {
            tokenEnd = tokens.length;
          }
          tokens.push({ ch: text[i], em: isEm });
        }
        if (range && node === range.startContainer && text.length === range.startOffset) {
          tokenStart = tokens.length;
        }
        if (range && node === range.endContainer && text.length === range.endOffset) {
          tokenEnd = tokens.length;
        }
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.nodeName.toLowerCase();
        if (tag === 'br') {
          if (range && node === range.startContainer) {
            tokenStart = tokens.length;
          }
          if (range && node === range.endContainer) {
            tokenEnd = tokens.length;
          }
          tokens.push({ br: true });
          return;
        }

        const nodeIsEm = isEm || ['em', 'strong', 'b', 'i'].includes(tag);
        for (let i = 0; i < node.childNodes.length; i++) {
          if (range && node === range.startContainer && i === range.startOffset) {
            tokenStart = tokens.length;
          }
          if (range && node === range.endContainer && i === range.endOffset) {
            tokenEnd = tokens.length;
          }
          traverse(node.childNodes[i], nodeIsEm);
        }
        if (range && node === range.startContainer && node.childNodes.length === range.startOffset) {
          tokenStart = tokens.length;
        }
        if (range && node === range.endContainer && node.childNodes.length === range.endOffset) {
          tokenEnd = tokens.length;
        }
      }
    }

    traverse(root, false);

    if (tokenStart === -1) tokenStart = 0;
    if (tokenEnd === -1) tokenEnd = tokens.length;

    return {
      tokens,
      start: Math.min(tokenStart, tokenEnd),
      end: Math.max(tokenStart, tokenEnd),
    };
  }

  function tokensToHtml(tokens) {
    if (!tokens || tokens.length === 0) return '';

    const lines = [];
    let currentLine = [];
    for (const token of tokens) {
      if (token.br) {
        lines.push(currentLine);
        currentLine = [];
      } else {
        currentLine.push(token);
      }
    }
    lines.push(currentLine);

    return lines.map((line) => renderTokensLine(line)).join('<br>');
  }

  function renderTokensLine(line) {
    if (line.length === 0) return '';

    const runs = [];
    for (const token of line) {
      if (runs.length > 0 && runs[runs.length - 1].em === token.em) {
        runs[runs.length - 1].chars.push(token.ch);
      } else {
        runs.push({ em: token.em, chars: [token.ch] });
      }
    }

    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 1; i < runs.length - 1; i++) {
        if (!runs[i].em && runs[i - 1].em && runs[i + 1].em) {
          const text = runs[i].chars.join('');
          if (/^\s+$/.test(text)) {
            runs[i - 1].chars.push(...runs[i].chars, ...runs[i + 1].chars);
            runs.splice(i, 2);
            merged = true;
            break;
          }
        }
      }
    }

    let html = '';
    for (const run of runs) {
      const text = run.chars.join('');
      if (!run.em) {
        html += text;
      } else {
        const matchLeading = text.match(/^\s*/)[0];
        const matchTrailing = text.slice(matchLeading.length).match(/\s*$/)[0];
        const core = text.slice(matchLeading.length, text.length - matchTrailing.length);

        if (core.length === 0) {
          html += text;
        } else {
          html += matchLeading + '<em>' + core + '</em>' + matchTrailing;
        }
      }
    }

    return html;
  }

  function applyTokensFormat(tokens, start, end, isEmphasis) {
    const result = tokens.map((t) => ({ ...t }));
    if (start === end) {
      if (isEmphasis) return result;
      let targetIdx = -1;
      if (tokens[start] && tokens[start].em) {
        targetIdx = start;
      } else if (start > 0 && tokens[start - 1] && tokens[start - 1].em) {
        targetIdx = start - 1;
      }
      if (targetIdx !== -1) {
        let runStart = targetIdx;
        while (runStart > 0 && result[runStart - 1].em && !result[runStart - 1].br) {
          runStart--;
        }
        let runEnd = targetIdx;
        while (runEnd < result.length - 1 && result[runEnd + 1].em && !result[runEnd + 1].br) {
          runEnd++;
        }
        for (let i = runStart; i <= runEnd; i++) {
          result[i].em = false;
        }
      }
      return result;
    }

    const s = Math.max(0, Math.min(start, end));
    const e = Math.min(result.length, Math.max(start, end));

    for (let i = s; i < e; i++) {
      if (!result[i].br) {
        result[i].em = Boolean(isEmphasis);
      }
    }

    return result;
  }

  function findDomPosition(root, targetIndex) {
    let count = 0;
    let result = null;

    function walk(node) {
      if (result) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.nodeValue.length;
        if (targetIndex <= count + len) {
          result = { node, offset: Math.max(0, targetIndex - count) };
          return;
        }
        count += len;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.nodeName.toLowerCase() === 'br') {
          if (targetIndex === count) {
            const p = node.parentNode || root;
            result = { node: p, offset: Array.prototype.indexOf.call(p.childNodes, node) };
            return;
          }
          count++;
        } else {
          for (let i = 0; i < node.childNodes.length; i++) {
            walk(node.childNodes[i]);
            if (result) return;
          }
        }
      }
    }

    walk(root);
    if (!result) {
      result = { node: root, offset: root.childNodes.length };
    }
    return result;
  }

  // --- Update ARIA & Visual State on Format Button ---
  function updateFormatButtonAria() {
    const btnEm = document.getElementById('sdrnow-btn-em');
    if (!btnEm) return;

    const activeInput = (document.activeElement && document.activeElement.classList.contains('sdrnow-input-area'))
      ? document.activeElement
      : state.lastActiveInput;

    if (!activeInput) {
      btnEm.setAttribute('aria-pressed', 'false');
      btnEm.style.background = TOKENS.chromeBg;
      btnEm.style.color = TOKENS.primary;
      return;
    }

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !activeInput.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      btnEm.setAttribute('aria-pressed', 'false');
      btnEm.style.background = TOKENS.chromeBg;
      btnEm.style.color = TOKENS.primary;
      return;
    }

    const range = selection.getRangeAt(0);
    const { tokens, start, end } = domToTokens(activeInput, range);

    let isAllEm = false;
    let isMixed = false;

    if (start === end) {
      let inEm = false;
      if (tokens[start] && tokens[start].em) {
        inEm = true;
      } else if (start > 0 && tokens[start - 1] && tokens[start - 1].em) {
        inEm = true;
      }
      isAllEm = inEm;
    } else {
      let emCount = 0;
      let nonEmCount = 0;
      for (let i = start; i < end; i++) {
        if (!tokens[i].br) {
          if (tokens[i].em) emCount++;
          else nonEmCount++;
        }
      }
      if (emCount > 0 && nonEmCount === 0) {
        isAllEm = true;
      } else if (emCount > 0 && nonEmCount > 0) {
        isMixed = true;
      }
    }

    const pressedVal = isAllEm ? 'true' : (isMixed ? 'mixed' : 'false');
    btnEm.setAttribute('aria-pressed', pressedVal);

    if (isAllEm) {
      btnEm.style.background = TOKENS.primarySoft;
      btnEm.style.color = TOKENS.primaryHover;
    } else if (isMixed) {
      btnEm.style.background = 'rgba(242, 101, 34, 0.08)';
      btnEm.style.color = TOKENS.primary;
    } else {
      btnEm.style.background = TOKENS.chromeBg;
      btnEm.style.color = TOKENS.primary;
    }
  }

  // --- Format Action (Flatten -> Apply -> Reserialize) ---
  function applyFormat(isEmphasis) {
    const activeInput = (document.activeElement && document.activeElement.classList.contains('sdrnow-input-area'))
      ? document.activeElement
      : (state.lastActiveInput || document.getElementById(`sdrnow-input-${state.currentLang}`));

    if (!activeInput) return;
    activeInput.focus();

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);

    // E10: Silently ignore if selection is outside activeInput
    if (!activeInput.contains(range.commonAncestorContainer)) {
      return;
    }

    const { tokens, start, end } = domToTokens(activeInput, range);
    const formattedTokens = applyTokensFormat(tokens, start, end, isEmphasis);
    const newHtml = tokensToHtml(formattedTokens);

    activeInput.innerHTML = newHtml;

    // Restore selection
    try {
      const newRange = document.createRange();
      const startPos = findDomPosition(activeInput, start);
      const endPos = findDomPosition(activeInput, end);
      newRange.setStart(startPos.node, startPos.offset);
      newRange.setEnd(endPos.node, endPos.offset);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } catch {
      // Keep focus on activeInput
    }

    updateFormatButtonAria();
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // --- Create In-Page Editor UI ---
  function createUI() {
    // 1. Top Admin Pill
    const pill = document.createElement('div');
    pill.id = 'sdrnow-admin-pill';
    pill.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99998;
      display: flex;
      align-items: center;
      gap: 10px;
      background: ${TOKENS.chromeBg};
      border: 1px solid ${TOKENS.chromeBorder};
      border-radius: 9999px;
      padding: 6px 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      color: ${TOKENS.chromeText};
      user-select: none;
    `;

    pill.innerHTML = `
      <!-- Mode Segmented Control -->
      <div style="display: flex; background: ${TOKENS.chromeSurface}; border-radius: 9999px; padding: 2px;">
        <button id="sdrnow-btn-mode-read" style="background: ${TOKENS.primary}; color: #FFF; border: none; border-radius: 9999px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer;">
          👁️ Lecture
        </button>
        <button id="sdrnow-btn-mode-edit" style="background: transparent; color: ${TOKENS.chromeMuted}; border: none; border-radius: 9999px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer;">
          ✏️ Édition
        </button>
      </div>

      <!-- Status Indicator -->
      <span id="sdrnow-status-dot" style="font-size: 12px; font-weight: 500; color: ${TOKENS.chromeMuted};">
        ● Non modifié
      </span>

      <div style="width: 1px; height: 18px; background: ${TOKENS.chromeBorder};"></div>

      <!-- SEO Meta Editor Button -->
      <button id="sdrnow-btn-seo" style="background: ${TOKENS.chromeSurface}; color: ${TOKENS.chromeText}; border: 1px solid ${TOKENS.chromeBorder}; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 500; cursor: pointer;">
        🏷️ SEO
      </button>

      <!-- Action Buttons -->
      <button id="sdrnow-btn-save-staging" style="background: ${TOKENS.primary}; color: #FFF; border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.15s;">
        Enregistrer sur Staging
      </button>

      <button id="sdrnow-btn-copy-preview" style="background: ${TOKENS.chromeSurface}; color: ${TOKENS.chromeText}; border: 1px solid ${TOKENS.chromeBorder}; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 500; cursor: pointer;">
        📋 Copier lien Read-Only
      </button>

      <button id="sdrnow-btn-publish" style="background: ${TOKENS.statusProd}; color: #FFF; border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.15s;">
        Publier en Prod
      </button>

      <button id="sdrnow-btn-reset" style="background: transparent; color: ${TOKENS.chromeMuted}; border: 1px solid transparent; border-radius: 6px; padding: 5px 8px; font-size: 12px; font-weight: 500; cursor: pointer; transition: color 0.15s;">
        ↺ Réinitialiser depuis la Prod
      </button>
    `;

    document.body.appendChild(pill);

    // 2. Bilingual Bottom Drawer
    const drawer = document.createElement('div');
    drawer.id = 'sdrnow-bottom-drawer';
    drawer.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 260px;
      background: ${TOKENS.chromeBg};
      border-top: 2px solid ${TOKENS.primary};
      z-index: 99997;
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
      font-family: 'Inter', system-ui, sans-serif;
      display: none;
      flex-direction: column;
    `;

    drawer.innerHTML = `
      <!-- Drawer Header Bar (36px) -->
      <div style="height: 36px; padding: 0 16px; background: ${TOKENS.chromeSurface}; border-bottom: 1px solid ${TOKENS.chromeBorder}; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span id="sdrnow-drawer-key" style="font-family: ui-monospace, Menlo, monospace; font-size: 11px; font-weight: 600; color: ${TOKENS.chromeText}; background: #374151; padding: 2px 6px; border-radius: 4px;"></span>
          <span id="sdrnow-drawer-type-badge" style="font-size: 11px; font-weight: 700; color: ${TOKENS.primary}; text-transform: uppercase;"></span>
        </div>

        <!-- Semantic Format Toolbar -->
        <div id="sdrnow-format-toolbar" style="display: flex; align-items: center; gap: 6px;">
          <button id="sdrnow-btn-em" type="button" aria-pressed="false" style="background: ${TOKENS.chromeBg}; color: ${TOKENS.primary}; border: 1px solid ${TOKENS.chromeBorder}; border-radius: 4px; padding: 3px 8px; font-size: 12px; font-weight: 600; cursor: pointer;">
            🔶 Emphase · orange
          </button>
          <button id="sdrnow-btn-normal" type="button" title="Remettre la sélection en texte normal (Cmd/Ctrl + \)" style="background: ${TOKENS.chromeBg}; color: ${TOKENS.chromeMuted}; border: 1px solid ${TOKENS.chromeBorder}; border-radius: 4px; padding: 3px 8px; font-size: 12px; font-weight: 500; cursor: pointer;">
            ⊘ Normal
          </button>
          <span id="sdrnow-plain-badge" style="display: none; font-size: 12px; color: ${TOKENS.chromeMuted};">
            🔒 Texte brut (sans style ni retour à la ligne)
          </span>
        </div>

        <!-- Close Drawer Button -->
        <button id="sdrnow-btn-close-drawer" aria-label="Fermer le tiroir" style="background: transparent; color: ${TOKENS.chromeMuted}; border: none; font-size: 16px; cursor: pointer; padding: 2px 6px;">
          ✕
        </button>
      </div>

      <!-- Drawer Content (2 Columns FR / EN) -->
      <div style="flex: 1; padding: 12px 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; overflow: hidden;">
        <!-- Left: French -->
        <div style="display: flex; flex-direction: column;">
          <label style="font-size: 11px; font-weight: 700; color: ${TOKENS.chromeMuted}; letter-spacing: 0.06em; margin-bottom: 4px;">
            🇫🇷 FRANÇAIS
          </label>
          <div id="sdrnow-input-fr" class="sdrnow-input-area" contenteditable="true" style="flex: 1; background: ${TOKENS.chromeInput}; border: 1px solid ${TOKENS.chromeBorder}; border-radius: 6px; color: ${TOKENS.chromeText}; font-size: 15px; line-height: 1.55; padding: 8px 12px; overflow-y: auto; outline: none;"></div>
          <div id="sdrnow-err-fr" role="alert" style="display: none; color: ${TOKENS.statusDanger}; font-size: 12px; margin-top: 4px;">Ce champ ne peut pas être vide.</div>
        </div>

        <!-- Right: English -->
        <div style="display: flex; flex-direction: column;">
          <label style="font-size: 11px; font-weight: 700; color: ${TOKENS.chromeMuted}; letter-spacing: 0.06em; margin-bottom: 4px;">
            🇬🇧 ENGLISH
          </label>
          <div id="sdrnow-input-en" class="sdrnow-input-area" contenteditable="true" style="flex: 1; background: ${TOKENS.chromeInput}; border: 1px solid ${TOKENS.chromeBorder}; border-radius: 6px; color: ${TOKENS.chromeText}; font-size: 15px; line-height: 1.55; padding: 8px 12px; overflow-y: auto; outline: none;"></div>
          <div id="sdrnow-err-en" role="alert" style="display: none; color: ${TOKENS.statusDanger}; font-size: 12px; margin-top: 4px;">Ce champ ne peut pas être vide.</div>
        </div>
      </div>
    `;

    document.body.appendChild(drawer);

    // Style contenteditable inner tags & edit-mode empty elements
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .sdrnow-input-area em {
        font-style: normal;
        color: #F26522;
        background: rgba(242, 101, 34, 0.15);
        padding: 0 2px;
        border-radius: 2px;
      }
      .sdrnow-input-area:focus {
        border-color: ${TOKENS.primary} !important;
      }
      body.sdrnow-editing [data-i18n]:empty {
        display: inline-block !important;
        min-width: 32px !important;
        min-height: 20px !important;
        border: 1px dashed #F26522 !important;
        border-radius: 4px !important;
        background-color: rgba(242, 101, 34, 0.12) !important;
        vertical-align: middle !important;
        cursor: pointer !important;
      }
    `;
    document.head.appendChild(styleEl);

    setupEventListeners();
  }

  // --- Open Drawer for Given Key ---
  function openDrawerForKey(key) {
    const btnEm = document.getElementById('sdrnow-btn-em');
    const btnNormal = document.getElementById('sdrnow-btn-normal');
    const plainBadge = document.getElementById('sdrnow-plain-badge');
    const inputFr = document.getElementById('sdrnow-input-fr');
    const inputEn = document.getElementById('sdrnow-input-en');
    const drawer = document.getElementById('sdrnow-bottom-drawer');

    state.activeKey = key;
    const fieldDef = state.schema[key] || { type: 'plain', optional: false };
    state.activeType = fieldDef.type;

    // Header info
    document.getElementById('sdrnow-drawer-key').textContent = key;
    const typeBadge = document.getElementById('sdrnow-drawer-type-badge');
    typeBadge.textContent = fieldDef.type === 'rich' ? '• Texte Riche' : '• Texte Brut';

    // Format toolbar & Dynamic Emphasis Probe
    if (fieldDef.type === 'rich') {
      btnEm.style.display = 'inline-block';
      if (btnNormal) btnNormal.style.display = 'inline-block';
      plainBadge.style.display = 'none';

      // Dynamic probe on page node
      let emLabel = '🔶 Emphase · orange';
      let drawerEmCss = `
        font-style: normal;
        color: #F26522;
        background: rgba(242, 101, 34, 0.15);
        padding: 0 2px;
        border-radius: 2px;
      `;

      const targetEl = document.querySelector(`[data-i18n="${key}"]`);
      if (targetEl && targetEl.tagName !== 'TITLE') {
        const probe = document.createElement('em');
        probe.textContent = 'x';
        targetEl.appendChild(probe);

        const probeStyle = window.getComputedStyle(probe);
        const targetStyle = window.getComputedStyle(targetEl);

        const emColor = probeStyle.color;
        const targetColor = targetStyle.color;
        const emWeight = probeStyle.fontWeight;
        const targetWeight = targetStyle.fontWeight;
        const emTextDec = probeStyle.textDecorationLine || probeStyle.textDecoration || '';

        targetEl.removeChild(probe);

        const isUnderline = emTextDec.includes('underline');
        const isBold = (parseInt(emWeight, 10) >= 600 || emWeight === 'bold');
        const isColorInherited = (emColor === targetColor);

        if (isUnderline) {
          emLabel = '🔶 Emphase · soulignée';
          drawerEmCss = `
            font-style: normal;
            color: #FFFFFF;
            text-decoration: underline;
            text-decoration-color: #FFFFFF;
            background: transparent;
            padding: 0 2px;
          `;
        } else if (isBold && isColorInherited) {
          emLabel = '🔶 Emphase · gras';
          drawerEmCss = `
            font-style: normal;
            color: #FFFFFF;
            font-weight: 700;
            text-decoration: none;
            background: transparent;
            padding: 0 2px;
          `;
        } else {
          emLabel = '🔶 Emphase · orange';
          drawerEmCss = `
            font-style: normal;
            color: #F26522;
            font-weight: inherit;
            text-decoration: none;
            background: rgba(242, 101, 34, 0.15);
            padding: 0 2px;
            border-radius: 2px;
          `;
        }
      }

      btnEm.textContent = emLabel;

      let drawerStyleEl = document.getElementById('sdrnow-drawer-em-style');
      if (!drawerStyleEl) {
        drawerStyleEl = document.createElement('style');
        drawerStyleEl.id = 'sdrnow-drawer-em-style';
        document.head.appendChild(drawerStyleEl);
      }
      drawerStyleEl.textContent = `.sdrnow-input-area em { ${drawerEmCss} }`;
    } else {
      btnEm.style.display = 'none';
      if (btnNormal) btnNormal.style.display = 'none';
      plainBadge.style.display = 'inline-block';
    }

    // Populate values
    inputFr.innerHTML = state.translations.fr[key] || '';
    inputEn.innerHTML = state.translations.en[key] || '';

    // Clear errors
    document.getElementById('sdrnow-err-fr').style.display = 'none';
    document.getElementById('sdrnow-err-en').style.display = 'none';

    // Show drawer & compensate padding
    drawer.style.display = 'flex';
    document.body.style.paddingBottom = '280px';

    // Focus input
    if (state.currentLang === 'en') {
      inputEn.focus();
      state.lastActiveInput = inputEn;
    } else {
      inputFr.focus();
      state.lastActiveInput = inputFr;
    }

    updateFormatButtonAria();
  }

  // --- Attach Handlers ---
  function setupEventListeners() {
    const btnRead = document.getElementById('sdrnow-btn-mode-read');
    const btnEdit = document.getElementById('sdrnow-btn-mode-edit');
    const btnSeo = document.getElementById('sdrnow-btn-seo');
    const btnSaveStaging = document.getElementById('sdrnow-btn-save-staging');
    const btnCopyPreview = document.getElementById('sdrnow-btn-copy-preview');
    const btnPublish = document.getElementById('sdrnow-btn-publish');
    const btnReset = document.getElementById('sdrnow-btn-reset');
    const btnCloseDrawer = document.getElementById('sdrnow-btn-close-drawer');
    const btnEm = document.getElementById('sdrnow-btn-em');
    const inputFr = document.getElementById('sdrnow-input-fr');
    const inputEn = document.getElementById('sdrnow-input-en');
    const drawer = document.getElementById('sdrnow-bottom-drawer');

    // 1. Mode Switching
    btnRead.addEventListener('click', () => {
      state.mode = 'read';
      document.body.classList.remove('sdrnow-editing');
      btnRead.style.background = TOKENS.primary;
      btnRead.style.color = '#FFF';
      btnEdit.style.background = 'transparent';
      btnEdit.style.color = TOKENS.chromeMuted;
      closeDrawer();
      clearHighlight();
    });

    btnEdit.addEventListener('click', () => {
      state.mode = 'edit';
      document.body.classList.add('sdrnow-editing');
      btnEdit.style.background = TOKENS.primary;
      btnEdit.style.color = '#FFF';
      btnRead.style.background = 'transparent';
      btnRead.style.color = TOKENS.chromeMuted;
    });

    // 2. Click & Hover on Page Editable Elements
    document.addEventListener('mouseover', (e) => {
      if (state.mode !== 'edit') return;
      const target = e.target.closest('[data-i18n]');
      if (target && target !== state.activeElement && !target.closest('#sdrnow-bottom-drawer') && !target.closest('#sdrnow-admin-pill')) {
        target.style.outline = `2px dashed ${TOKENS.primary}`;
        target.style.outlineOffset = '4px';
        target.style.cursor = 'pointer';
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (state.mode !== 'edit') return;
      const target = e.target.closest('[data-i18n]');
      if (target && target !== state.activeElement) {
        target.style.outline = '';
        target.style.outlineOffset = '';
      }
    });

    document.addEventListener('click', (e) => {
      if (state.mode !== 'edit') return;
      const target = e.target.closest('[data-i18n]');
      if (!target || target.closest('#sdrnow-bottom-drawer') || target.closest('#sdrnow-admin-pill')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      selectElement(target);
    });

    // 3. Selection & Highlight Logic
    function selectElement(el) {
      clearHighlight();
      state.lastFocusedElement = el;
      state.activeElement = el;
      el.style.outline = `2px solid ${TOKENS.primary}`;
      el.style.outlineOffset = '4px';
      el.style.backgroundColor = TOKENS.primarySoft;

      const key = el.getAttribute('data-i18n');
      openDrawerForKey(key);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function clearHighlight() {
      if (state.activeElement) {
        state.activeElement.style.outline = '';
        state.activeElement.style.outlineOffset = '';
        state.activeElement.style.backgroundColor = '';
        state.activeElement = null;
      }
    }

    function closeDrawer() {
      drawer.style.display = 'none';
      document.body.style.paddingBottom = '';
      clearHighlight();
      // Restore focus to last active element
      if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === 'function') {
        state.lastFocusedElement.focus();
      }
    }

    btnCloseDrawer.addEventListener('click', closeDrawer);

    // 4. SEO Meta Button
    btnSeo.addEventListener('click', () => {
      const titleKey = document.querySelector('title[data-i18n]')?.getAttribute('data-i18n') || 'meta.title';
      state.lastFocusedElement = btnSeo;
      clearHighlight();
      // Toggle between title and description
      if (state.activeKey === titleKey) {
        openDrawerForKey('meta.description');
        showToast('Édition de la description SEO (meta.description)', 'staging', 2500);
      } else {
        openDrawerForKey(titleKey);
        showToast(`Édition du titre SEO (${titleKey})`, 'staging', 2500);
      }
    });

    // 5. Input Focus & Auto-Switch Language (CAP-1)
    inputFr.addEventListener('focus', () => {
      state.lastActiveInput = inputFr;
      applyLanguageToPage('fr');
      updateFormatButtonAria();
    });

    inputEn.addEventListener('focus', () => {
      state.lastActiveInput = inputEn;
      applyLanguageToPage('en');
      updateFormatButtonAria();
    });

    document.addEventListener('selectionchange', () => {
      if (drawer.style.display === 'flex') {
        updateFormatButtonAria();
      }
    });

    // 6. Input Live DOM Sync
    function handleInputSync(lang, inputEl) {
      if (!state.activeKey) return;
      const html = inputEl.innerHTML;
      state.translations[lang][state.activeKey] = html;
      setDirty(true);

      // If page currently matches this language, update the DOM in real-time
      if (state.currentLang === lang) {
        if (state.activeElement) {
          state.activeElement.innerHTML = html;
        } else if (state.activeKey.startsWith('meta.')) {
          if (state.activeKey === 'meta.description') {
            const metaEl = document.querySelector('meta[data-i18n-content="meta.description"]');
            if (metaEl) metaEl.setAttribute('content', inputEl.innerText.trim());
          } else {
            const titleEl = document.querySelector(`title[data-i18n="${state.activeKey}"]`);
            if (titleEl) titleEl.textContent = inputEl.innerText.trim();
          }
        }
      }

      // Validate empty check
      const textOnly = inputEl.innerText.trim();
      const fieldDef = state.schema[state.activeKey];
      const errEl = document.getElementById(`sdrnow-err-${lang}`);
      if (fieldDef && !fieldDef.optional && textOnly.length === 0) {
        errEl.style.display = 'block';
        inputEl.style.borderColor = TOKENS.statusDanger;
      } else {
        errEl.style.display = 'none';
        inputEl.style.borderColor = TOKENS.primary;
      }
    }

    inputFr.addEventListener('input', () => handleInputSync('fr', inputFr));
    inputEn.addEventListener('input', () => handleInputSync('en', inputEn));

    // 7. Prevent Toolbar Buttons from blurring contenteditable (mousedown preventDefault)
    btnEm.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    btnEm.addEventListener('click', () => applyFormat(true));

    const btnNormal = document.getElementById('sdrnow-btn-normal');
    if (btnNormal) {
      btnNormal.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      btnNormal.addEventListener('click', () => applyFormat(false));
    }

    // 8. Keyboard Interceptions (Paste, Enter, Cmd+B/I/U/Slash)
    [inputFr, inputEn].forEach((input) => {
      // Force text/plain on paste and strip newlines on plain mode
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        let text = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (state.activeType === 'plain') {
          text = text.replace(/[\r\n]+/g, ' ');
        }
        document.execCommand('insertText', false, text);
      });

      input.addEventListener('keydown', (e) => {
        // Enter: block in plain mode, insert <br> in rich mode
        if (e.key === 'Enter') {
          e.preventDefault();
          if (state.activeType === 'rich') {
            document.execCommand('insertLineBreak');
          }
          return;
        }

        // Cmd/Ctrl + B : blocked
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          return;
        }

        // Cmd/Ctrl + I : Emphase (idempotent)
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          if (state.activeType === 'rich') {
            applyFormat(true);
          }
          return;
        }

        // Cmd/Ctrl + \ : Normal (idempotent)
        if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
          e.preventDefault();
          if (state.activeType === 'rich') {
            applyFormat(false);
          }
          return;
        }

        // Block Cmd/Ctrl + U
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'u') {
          e.preventDefault();
          return;
        }

        // Escape closes drawer and restores focus
        if (e.key === 'Escape') {
          closeDrawer();
        }
      });
    });

    // 9. Save to Staging Action
    btnSaveStaging.addEventListener('click', async () => {
      // Validate all required fields
      for (const [key, fieldDef] of Object.entries(state.schema)) {
        if (!fieldDef.optional) {
          const frText = (state.translations.fr[key] || '').replace(/<[^>]*>/g, '').trim();
          const enText = (state.translations.en[key] || '').replace(/<[^>]*>/g, '').trim();
          if (!frText || !enText) {
            showToast(`Le champ "${key}" ne peut pas être vide.`, 'error');
            return;
          }
        }
      }

      btnSaveStaging.disabled = true;
      btnSaveStaging.textContent = 'Enregistrement...';

      try {
        const res = await fetch('/api/staging', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fr: state.translations.fr,
            en: state.translations.en,
          }),
        });

        if (res.status === 202) {
          const data = await res.json();
          state.previewUrl = data.previewUrl;
          setDirty(false);
          showToast('Enregistré sur Staging • Lien de partage mis à jour', 'staging');
        } else {
          const err = await res.json();
          showToast(`Erreur: ${err.message || 'Sauvegarde échouée'}`, 'error');
        }
      } catch (err) {
        showToast('Connexion perdue. Vos modifications restent affichées.', 'error');
      } finally {
        btnSaveStaging.disabled = false;
        btnSaveStaging.textContent = 'Enregistrer sur Staging';
      }
    });

    // 10. Copy Preview Link Action
    btnCopyPreview.addEventListener('click', async () => {
      if (!state.previewUrl) {
        await loadTranslations();
      }
      if (state.previewUrl) {
        try {
          await navigator.clipboard.writeText(state.previewUrl);
          showToast('📋 Lien d\'avis copié dans le presse-papier !', 'staging');
        } catch {
          prompt('Copiez le lien de prévisualisation ci-dessous :', state.previewUrl);
        }
      } else {
        showToast('Aucun lien de prévisualisation disponible', 'error');
      }
    });

    // 11. Publish to Production (with 3s inline confirmation)
    btnPublish.addEventListener('click', async () => {
      if (!btnPublish._confirming) {
        btnPublish._confirming = true;
        btnPublish.textContent = 'Confirmer ?';
        btnPublish.style.background = TOKENS.primary;

        state.confirmTimer = setTimeout(() => {
          btnPublish._confirming = false;
          btnPublish.textContent = 'Publier en Prod';
          btnPublish.style.background = TOKENS.statusProd;
        }, 3000);
        return;
      }

      // Second click within 3s
      clearTimeout(state.confirmTimer);
      btnPublish._confirming = false;
      btnPublish.disabled = true;
      btnPublish.textContent = 'Publication...';

      try {
        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fr: state.translations.fr,
            en: state.translations.en,
          }),
        });

        if (res.status === 202) {
          const data = await res.json();
          state.previewUrl = data.previewUrl;
          setDirty(false);
          showToast('Publié en Prod ! sdrnow.fr est à jour.', 'prod', 5000);
        } else {
          const err = await res.json();
          showToast(`Erreur: ${err.message || 'Échec publication'}`, 'error');
        }
      } catch (err) {
        showToast('Erreur réseau lors de la publication', 'error');
      } finally {
        btnPublish.disabled = false;
        btnPublish.textContent = 'Publier en Prod';
        btnPublish.style.background = TOKENS.statusProd;
      }
    });

    // 12. Reset from Production (with 3s inline confirmation)
    btnReset.addEventListener('click', async () => {
      if (!btnReset._confirming) {
        btnReset._confirming = true;
        btnReset.textContent = 'Confirmer le reset ?';
        btnReset.style.color = TOKENS.statusDanger;

        state.confirmTimer = setTimeout(() => {
          btnReset._confirming = false;
          btnReset.textContent = '↺ Réinitialiser depuis la Prod';
          btnReset.style.color = TOKENS.chromeMuted;
        }, 3000);
        return;
      }

      // Confirmed reset
      clearTimeout(state.confirmTimer);
      btnReset._confirming = false;
      btnReset.disabled = true;
      btnReset.textContent = 'Réinitialisation...';

      try {
        const res = await fetch('/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (res.status === 202) {
          showToast('Staging réinitialisé depuis la Prod. Rechargement...', 'staging');
          setTimeout(() => {
            window.location.reload();
          }, 600);
        } else {
          const err = await res.json();
          showToast(`Erreur: ${err.message || 'Échec du reset'}`, 'error');
        }
      } catch (err) {
        showToast('Erreur réseau lors de la réinitialisation', 'error');
      } finally {
        btnReset.disabled = false;
        btnReset.textContent = '↺ Réinitialiser depuis la Prod';
        btnReset.style.color = TOKENS.chromeMuted;
      }
    });
  }

  // --- Bootstrap on Load ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createUI();
      loadTranslations();
    });
  } else {
    createUI();
    loadTranslations();
  }
})();
