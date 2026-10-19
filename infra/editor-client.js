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

  // --- Update ARIA & Visual State on Format Buttons ---
  function updateFormatButtonAria() {
    const btnBold = document.getElementById('sdrnow-btn-bold');
    const btnEm = document.getElementById('sdrnow-btn-em');
    if (!btnBold || !btnEm) return;

    let isBold = false;
    let isEm = false;
    const selection = window.getSelection();

    if (selection && selection.rangeCount) {
      let node = selection.anchorNode;
      while (node && !node.classList?.contains('sdrnow-input-area')) {
        const name = node.nodeName?.toLowerCase();
        if (name === 'strong') isBold = true;
        if (name === 'em') isEm = true;
        node = node.parentNode;
      }
    }

    btnBold.setAttribute('aria-pressed', isBold ? 'true' : 'false');
    btnEm.setAttribute('aria-pressed', isEm ? 'true' : 'false');
    btnBold.style.background = isBold ? TOKENS.primary : TOKENS.chromeBg;
    btnBold.style.color = isBold ? '#FFFFFF' : TOKENS.chromeText;
    btnEm.style.background = isEm ? TOKENS.primarySoft : TOKENS.chromeBg;
    btnEm.style.color = isEm ? TOKENS.primaryHover : TOKENS.primary;
  }

  // --- Format Commands Helper (Precise Selection Range Unwrapping) ---
  function toggleFormat(tag) {
    const activeInput = (document.activeElement && document.activeElement.classList.contains('sdrnow-input-area'))
      ? document.activeElement
      : (state.lastActiveInput || document.getElementById(`sdrnow-input-${state.currentLang}`));

    if (!activeInput) return;
    activeInput.focus();

    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);

    // Check if selection is inside an existing tag of this type
    let parent = selection.anchorNode;
    let tagNode = null;
    while (parent && parent !== activeInput) {
      if (parent.nodeName && parent.nodeName.toLowerCase() === tag) {
        tagNode = parent;
        break;
      }
      parent = parent.parentNode;
    }

    if (tagNode) {
      // Split tagNode so only the selected text is unwrapped
      const beforeRange = document.createRange();
      beforeRange.setStartBefore(tagNode);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const beforeFrag = beforeRange.cloneContents();

      const afterRange = document.createRange();
      afterRange.setStart(range.endContainer, range.endOffset);
      afterRange.setEndAfter(tagNode);
      const afterFrag = afterRange.cloneContents();

      const selectedFrag = range.extractContents();
      const cleanText = document.createTextNode(selectedFrag.textContent || '');

      const replacementFrag = document.createDocumentFragment();
      if (beforeFrag.textContent) {
        const b = document.createElement(tag);
        b.appendChild(beforeFrag);
        replacementFrag.appendChild(b);
      }
      replacementFrag.appendChild(cleanText);
      if (afterFrag.textContent) {
        const a = document.createElement(tag);
        a.appendChild(afterFrag);
        replacementFrag.appendChild(a);
      }

      tagNode.parentNode.replaceChild(replacementFrag, tagNode);
    } else {
      // Wrap selection in tag
      if (range.collapsed) return;
      const selectedContent = range.extractContents();
      const el = document.createElement(tag);
      el.appendChild(selectedContent);
      range.insertNode(el);
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
          <button id="sdrnow-btn-bold" type="button" aria-pressed="false" style="background: ${TOKENS.chromeBg}; color: ${TOKENS.chromeText}; border: 1px solid ${TOKENS.chromeBorder}; border-radius: 4px; padding: 3px 8px; font-size: 12px; font-weight: 700; cursor: pointer;">
            B Gras
          </button>
          <button id="sdrnow-btn-em" type="button" aria-pressed="false" style="background: ${TOKENS.chromeBg}; color: ${TOKENS.primary}; border: 1px solid ${TOKENS.chromeBorder}; border-radius: 4px; padding: 3px 8px; font-size: 12px; font-weight: 600; cursor: pointer;">
            🔶 Emphase Orange
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
      .sdrnow-input-area strong {
        font-weight: 700;
        color: #FFFFFF;
      }
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
    const btnBold = document.getElementById('sdrnow-btn-bold');
    const btnEm = document.getElementById('sdrnow-btn-em');
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

    // Format toolbar
    if (fieldDef.type === 'rich') {
      btnBold.style.display = 'inline-block';
      btnEm.style.display = 'inline-block';
      btnEm.textContent = (key === 'pricing.title') ? '🔶 Emphase Soulignée' : '🔶 Emphase Orange';
      document.getElementById('sdrnow-plain-badge').style.display = 'none';
    } else {
      btnBold.style.display = 'none';
      btnEm.style.display = 'none';
      document.getElementById('sdrnow-plain-badge').style.display = 'inline-block';
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
    const btnBold = document.getElementById('sdrnow-btn-bold');
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
    btnBold.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    btnEm.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    btnBold.addEventListener('click', () => toggleFormat('strong'));
    btnEm.addEventListener('click', () => toggleFormat('em'));

    // 8. Keyboard Interceptions (Paste, Enter, Cmd+B/I/U)
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

        // Cmd/Ctrl + B
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          if (state.activeType === 'rich') {
            toggleFormat('strong');
          }
          return;
        }

        // Cmd/Ctrl + I
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          if (state.activeType === 'rich') {
            toggleFormat('em');
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
