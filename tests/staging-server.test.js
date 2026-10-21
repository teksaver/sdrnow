import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { Readable, Writable } from 'node:stream';
import {
  createRequestHandler,
  sanitizeValue,
  htmlToTokens,
  tokensToHtml,
  applyTokensFormat,
  buildEmphasisModelPrelude,
  validateAndSanitizePayload,
  isBlankValue,
  patchHtmlContent,
  computePreviewToken,
  getRevision,
  incrementRevision,
  createTracker,
  sendTemEmail,
  sendMailpitEmail,
  classifyUa,
  uaFamily,
  getCtaTargets,
  parseRecipients,
  escapeHtmlAttr,
} from '../infra/staging-server.js';

const TEST_SECRET = 'test-secret-12345';
const TEST_ADMIN_USER = 'admin';
const TEST_ADMIN_PASS = 'secret123';
const TEST_ADMIN_PASS_SHA256 = crypto.createHash('sha256').update(TEST_ADMIN_PASS).digest('hex');

// Setup temporary test directories
function setupTestDirs() {
  const baseTmp = path.join(process.cwd(), 'tests', 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const stagingDir = path.join(baseTmp, 'staging');
  const prodDir = path.join(baseTmp, 'html');

  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(path.join(stagingDir, 'en'), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, 'mentions-legales'), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, 'en', 'legal-notice'), { recursive: true });

  fs.mkdirSync(prodDir, { recursive: true });
  fs.mkdirSync(path.join(prodDir, 'en'), { recursive: true });
  fs.mkdirSync(path.join(prodDir, 'mentions-legales'), { recursive: true });
  fs.mkdirSync(path.join(prodDir, 'en', 'legal-notice'), { recursive: true });

  // Initial mock translations.json
  const initialTranslations = {
    schema: {
      'meta.title': { type: 'plain', optional: false },
      'meta.description': { type: 'plain', optional: false },
      'meta.legal_title': { type: 'plain', optional: false },
      'hero.title': { type: 'rich', optional: false },
      'pricing.strategy_unit': { type: 'plain', optional: true },
    },
    fr: {
      'meta.title': 'Titre FR',
      'meta.description': 'Desc FR',
      'meta.legal_title': 'Mentions Légales FR',
      'hero.title': 'Accroche FR <em>orange</em>',
      'pricing.strategy_unit': '',
    },
    en: {
      'meta.title': 'Title EN',
      'meta.description': 'Desc EN',
      'meta.legal_title': 'Legal Notice EN',
      'hero.title': 'Catchphrase EN <em>orange</em>',
      'pricing.strategy_unit': '',
    },
  };

  const jsonStr = JSON.stringify(initialTranslations, null, 2);
  fs.writeFileSync(path.join(stagingDir, 'translations.json'), jsonStr);
  fs.writeFileSync(path.join(prodDir, 'translations.json'), jsonStr);

  // Initial compiled HTML files
  const indexHtmlFr = `<!DOCTYPE html><html lang="fr"><head><title data-i18n="meta.title">Titre FR</title><meta name="description" content="Desc FR" data-i18n-content="meta.description"></head><body><h1 data-i18n="hero.title" data-i18n-type="rich">Accroche FR <em>orange</em></h1><span data-i18n="pricing.strategy_unit" data-i18n-type="plain"></span></body></html>`;
  const indexHtmlEn = `<!DOCTYPE html><html lang="en"><head><title data-i18n="meta.title">Title EN</title><meta name="description" content="Desc EN" data-i18n-content="meta.description"></head><body><h1 data-i18n="hero.title" data-i18n-type="rich">Catchphrase EN <em>orange</em></h1><span data-i18n="pricing.strategy_unit" data-i18n-type="plain"></span></body></html>`;
  const legalHtmlFr = `<!DOCTYPE html><html lang="fr"><head><title data-i18n="meta.legal_title">Mentions Légales FR</title><meta name="description" content="Desc FR" data-i18n-content="meta.description"></head><body><h1 data-i18n="legal.title">Mentions</h1></body></html>`;
  const legalHtmlEn = `<!DOCTYPE html><html lang="en"><head><title data-i18n="meta.legal_title">Legal Notice EN</title><meta name="description" content="Desc EN" data-i18n-content="meta.description"></head><body><h1 data-i18n="legal.title">Legal</h1></body></html>`;

  fs.writeFileSync(path.join(stagingDir, 'index.html'), indexHtmlFr);
  fs.writeFileSync(path.join(stagingDir, 'en', 'index.html'), indexHtmlEn);
  fs.writeFileSync(path.join(stagingDir, 'mentions-legales', 'index.html'), legalHtmlFr);
  fs.writeFileSync(path.join(stagingDir, 'en', 'legal-notice', 'index.html'), legalHtmlEn);

  fs.writeFileSync(path.join(prodDir, 'index.html'), indexHtmlFr);
  fs.writeFileSync(path.join(prodDir, 'en', 'index.html'), indexHtmlEn);
  fs.writeFileSync(path.join(prodDir, 'mentions-legales', 'index.html'), legalHtmlFr);
  fs.writeFileSync(path.join(prodDir, 'en', 'legal-notice', 'index.html'), legalHtmlEn);

  return { baseTmp, stagingDir, prodDir };
}

function cleanupDirs(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup error
  }
}

// In-memory HTTP request mock (zero network socket needed)
function mockRequest(handler, url, options = {}) {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const headers = {};
    for (const [k, v] of Object.entries(options.headers || {})) {
      headers[k.toLowerCase()] = v;
    }

    const req = new Readable({
      read() {
        if (options.body) {
          const content = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
          this.push(content);
        }
        this.push(null);
      },
    });
    req.url = url;
    req.method = method;
    req.headers = headers;
    req.socket = { remoteAddress: options.remoteAddress || '127.0.0.1' };

    let statusCode = 200;
    const resHeaders = {};
    const chunks = [];

    const res = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });

    res.writeHead = function (status, h = {}) {
      statusCode = status;
      for (const [k, v] of Object.entries(h)) {
        res.setHeader(k, v);
      }
      return res;
    };

    res.setHeader = function (k, v) {
      resHeaders[k.toLowerCase()] = v;
    };

    res.getHeader = function (k) {
      return resHeaders[k.toLowerCase()];
    };

    res.on('finish', () => {
      resolve({
        statusCode,
        headers: resHeaders,
        body: Buffer.concat(chunks).toString('utf8'),
      });
    });

    handler(req, res).catch(reject);
  });
}

// ==========================================
// Unit Tests: Sanitization & HTML Patching
// ==========================================

test('sanitizeValue: strips all tags for plain type', () => {
  const result = sanitizeValue('Hello <strong>World</strong>\n<script>alert(1)</script>', 'plain');
  assert.equal(result, 'Hello World alert(1)');
});

test('sanitizeValue: plain values are stored as text, not HTML (F4)', () => {
  // The editor sends textContent: « R&D » and « < 10 ms » are kept as typed, never entity-encoded
  assert.equal(sanitizeValue('R&D', 'plain'), 'R&D');
  assert.equal(sanitizeValue('< 10 ms', 'plain'), '< 10 ms');
  assert.equal(sanitizeValue('a < b > c', 'plain'), 'a < b > c');
  assert.equal(sanitizeValue('dès\u00a0demain', 'plain'), 'dès\u00a0demain');
  assert.equal(sanitizeValue('Appel <b>gratuit</b><br>ici', 'plain'), 'Appel gratuitici');
  for (const v of ['R&D', '< 10 ms', 'AT&amp;T', 'a < b > c']) {
    assert.equal(sanitizeValue(sanitizeValue(v, 'plain'), 'plain'), sanitizeValue(v, 'plain'));
  }
});

test('isBlankValue: tags, <br>, spaces and &nbsp; are not visible content (F5)', () => {
  assert.equal(isBlankValue('&nbsp;', 'rich'), true);
  assert.equal(isBlankValue('<br>&nbsp; <em> </em>', 'rich'), true);
  assert.equal(isBlankValue('<em>x</em>', 'rich'), false);
  assert.equal(isBlankValue('\u00a0 ', 'plain'), true);
  assert.equal(isBlankValue('0', 'plain'), false);
  const schema = { 'hero.title': { type: 'rich', optional: false }, 'hero.cta': { type: 'plain', optional: false } };
  const res = validateAndSanitizePayload({ fr: { 'hero.title': '<br><br>' }, en: {} }, schema);
  assert.equal(res.error, 'empty_required_field');
});

test('sanitizeValue: preserves <em>, <br> without attributes and converts <strong>, <b>, <i> to <em> for rich type', () => {
  const raw = 'Super <em class="foo" onclick="bad()">pitch</em> et <strong style="color:red">gras</strong><br><p>Paragraphe</p>';
  const result = sanitizeValue(raw, 'rich');
  assert.equal(result, 'Super <em>pitch</em> et <em>gras</em><br>Paragraphe');
});

test('sanitizeValue: server normalization of nested, adjacent, empty and whitespace <em>', () => {
  assert.equal(sanitizeValue('<em>a<em>b</em></em>', 'rich'), '<em>ab</em>');
  assert.equal(sanitizeValue('<em>a</em><em>b</em>', 'rich'), '<em>ab</em>');
  assert.equal(sanitizeValue('<em></em>', 'rich'), '');
  assert.equal(sanitizeValue('<em> </em>', 'rich'), '');
  assert.equal(sanitizeValue('<b>x</b>', 'rich'), '<em>x</em>');
  assert.equal(sanitizeValue('<i>x</i>', 'rich'), '<em>x</em>');
});

test('pure token format: E1 (sélection partielle -> Normal)', () => {
  const html = '<em>Votre SDR externalisé dès demain</em>';
  const tokens = htmlToTokens(html);
  const text = tokens.map((t) => t.ch).join('');
  const start = text.indexOf('SDR externalisé');
  const end = start + 'SDR externalisé'.length;
  const res = tokensToHtml(applyTokensFormat(tokens, start, end, false));
  assert.equal(res, '<em>Votre</em> SDR externalisé <em>dès demain</em>');
});

test('pure token format: E2 (extension emphase -> Emphase)', () => {
  const html = 'mot <em>orange</em> fin';
  const tokens = htmlToTokens(html);
  const text = tokens.map((t) => t.ch).join('');
  const start = text.indexOf('mot orange');
  const end = start + 'mot orange'.length;
  const res = tokensToHtml(applyTokensFormat(tokens, start, end, true));
  assert.equal(res, '<em>mot orange</em> fin');
});

test('pure token format: E3 (idempotence -> Emphase)', () => {
  const html = '<em>orange</em>';
  const tokens = htmlToTokens(html);
  const text = tokens.map((t) => t.ch).join('');
  const start = text.indexOf('ran');
  const end = start + 'ran'.length;
  const res = tokensToHtml(applyTokensFormat(tokens, start, end, true));
  assert.equal(res, '<em>orange</em>');
});

test('pure token format: E4 (respect strict de la sélection -> Emphase)', () => {
  const html = '<em>a</em> et <em>b</em>';
  const tokens = htmlToTokens(html);
  const text = tokens.map((t) => t.ch).join('');
  // Only the selected characters change: the unselected spaces stay normal
  const start = text.indexOf('et');
  const end = start + 'et'.length;
  assert.equal(tokensToHtml(applyTokensFormat(tokens, start, end, true)), '<em>a</em> <em>et</em> <em>b</em>');
  // Selecting the whole span gives a single emphasis
  assert.equal(tokensToHtml(applyTokensFormat(tokens, 0, text.length, true)), '<em>a et b</em>');
});

test('pure token format: E5 (reset complet -> Normal)', () => {
  const html = '<em>a</em> et <em>b</em>';
  const tokens = htmlToTokens(html);
  const res = tokensToHtml(applyTokensFormat(tokens, 0, tokens.length, false));
  assert.equal(res, 'a et b');
});

test('pure token format: E6 (saut de ligne -> Normal)', () => {
  const html = '<em>ligne 1<br>ligne 2</em>';
  const tokens = htmlToTokens(html);
  const text = tokens.map((t) => (t.br ? '\n' : t.ch)).join('');
  const start = text.indexOf('1');
  const end = text.indexOf('ligne 2') + 'ligne'.length;
  const res = tokensToHtml(applyTokensFormat(tokens, start, end, false));
  assert.equal(res, '<em>ligne</em> 1<br>ligne <em>2</em>');
});

test('pure token format: E7 (espaces en bordure rejetés -> Emphase)', () => {
  const html = 'Appel de 100 leads ou';
  const tokens = htmlToTokens(html);
  const text = tokens.map((t) => t.ch).join('');
  const start = text.indexOf(' 100 leads ');
  const end = start + ' 100 leads '.length;
  const res = tokensToHtml(applyTokensFormat(tokens, start, end, true));
  assert.equal(res, 'Appel de <em>100 leads</em> ou');
});

test('pure token format: E8 (héritage strong converti en em)', () => {
  const html = 'Appel de <strong>100 leads</strong>';
  const tokens = htmlToTokens(html);
  const res = tokensToHtml(tokens);
  assert.equal(res, 'Appel de <em>100 leads</em>');
});

test('pure token format: E9 (caret dans emphase -> Normal)', () => {
  const html = '<em>orange</em>';
  const tokens = htmlToTokens(html);
  const res = tokensToHtml(applyTokensFormat(tokens, 2, 2, false));
  assert.equal(res, 'orange');
});

test('pure token format: E10 (sélection hors champ / hors limites -> aucun changement)', () => {
  const html = 'mot <em>orange</em>';
  const tokens = htmlToTokens(html);
  const res1 = tokensToHtml(applyTokensFormat(tokens, 100, 150, true));
  assert.equal(res1, 'mot <em>orange</em>');
  const res2 = tokensToHtml(applyTokensFormat(tokens, -10, -5, false));
  assert.equal(res2, 'mot <em>orange</em>');
});

test('pure token format: E11 (indépendance FR/EN)', () => {
  const fr = '<em>Votre SDR</em> dès demain';
  const en = 'Your SDR <em>starting tomorrow</em>';

  const frTokens = htmlToTokens(fr);
  const frRes = tokensToHtml(applyTokensFormat(frTokens, 0, 'Votre SDR'.length, false));

  assert.equal(frRes, 'Votre SDR dès demain');
  assert.equal(en, 'Your SDR <em>starting tomorrow</em>');
});

// Text as the browser exposes it (decoded text node values), like domToTokens in editor-client.js
function textToTokens(text, em = false) {
  return Array.from(text.split(''), (ch) => ({ ch, em }));
}

// Loads the prelude served with /__editor.js in an isolated context, as the browser would
function loadBrowserModel(prelude = buildEmphasisModelPrelude()) {
  const context = vm.createContext({ window: {} });
  vm.runInContext(prelude, context);
  return context.window.__sdrnowEmphasisModel;
}

// E1-E11 as (model) => html, so they run against both the server and the browser copy
const EMPHASIS_CASES = {
  E1: (m) => {
    const tokens = m.htmlToTokens('<em>Votre SDR externalisé dès demain</em>');
    const start = 'Votre '.length;
    return m.tokensToHtml(m.applyTokensFormat(tokens, start, start + 'SDR externalisé'.length, false));
  },
  E2: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('mot <em>orange</em> fin'), 0, 'mot orange'.length, true)),
  E3: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('<em>orange</em>'), 2, 5, true)),
  E4: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('<em>a</em> et <em>b</em>'), 2, 4, true)),
  E4b: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('<em>a</em> et <em>b</em>'), 0, 6, true)),
  E5: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('<em>a</em> et <em>b</em>'), 0, 6, false)),
  E6: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('<em>ligne 1<br>ligne 2</em>'), 6, 13, false)),
  E7: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('Appel de 100 leads ou'), 8, 19, true)),
  E8: (m) => m.tokensToHtml(m.htmlToTokens('Appel de <strong>100 leads</strong>')),
  E9: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('<em>orange</em>'), 2, 2, false)),
  E10: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('mot <em>orange</em>'), 100, 150, true)),
  E11: (m) => m.tokensToHtml(m.applyTokensFormat(m.htmlToTokens('<em>Votre SDR</em> dès demain'), 0, 9, false)),
  escape: (m) => m.tokensToHtml(textToTokens('a < b & c <img src=x onerror=alert(1)>')),
  nbsp: (m) => m.tokensToHtml(m.applyTokensFormat(textToTokens('mot\u00a0orange\u00a0fin'), 3, 11, true)),
};

const SERVER_MODEL = { htmlToTokens, tokensToHtml, applyTokensFormat };

test('pure token format: E1-E11 shared cases give the expected markup', () => {
  const expected = {
    E1: '<em>Votre</em> SDR externalisé <em>dès demain</em>',
    E2: '<em>mot orange</em> fin',
    E3: '<em>orange</em>',
    E4: '<em>a</em> <em>et</em> <em>b</em>',
    E4b: '<em>a et b</em>',
    E5: 'a et b',
    E6: '<em>ligne</em> 1<br>ligne <em>2</em>',
    E7: 'Appel de <em>100 leads</em> ou',
    E8: 'Appel de <em>100 leads</em>',
    E9: 'orange',
    E10: 'mot <em>orange</em>',
    E11: 'Votre SDR dès demain',
    escape: 'a &lt; b &amp; c &lt;img src=x onerror=alert(1)&gt;',
    nbsp: 'mot&nbsp;<em>orange</em>&nbsp;fin',
  };
  for (const [name, run] of Object.entries(EMPHASIS_CASES)) {
    assert.equal(run(SERVER_MODEL), expected[name], name);
  }
});

test('escaping: decoded text tokens are escaped by tokensToHtml (F1)', () => {
  assert.equal(tokensToHtml(textToTokens('a < b & c')), 'a &lt; b &amp; c');
  assert.equal(
    tokensToHtml(textToTokens('<img src=x onerror=alert(1)>')),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
  // Same inside an emphasis run, and after an Emphase action on typed text
  const typed = textToTokens('R&D <b>');
  assert.equal(tokensToHtml(applyTokensFormat(typed, 0, typed.length, true)), '<em>R&amp;D &lt;b&gt;</em>');
});

test('htmlToTokens: decodes entities and keeps malformed tags as text (F3)', () => {
  const text = (html) => htmlToTokens(html).map((t) => (t.br ? '\n' : t.ch)).join('');
  assert.equal(text('R&amp;D &lt;b&gt; &quot;x&quot; &#39;y&apos; a&nbsp;b'), 'R&D <b> "x" \'y\' a\u00a0b');
  assert.equal(text('&#233;&#xE9;&#x1F600;&eacute;'), 'éé\u{1F600}é');
  assert.equal(text('a < b <img src=x onerror=alert(1)'), 'a < b <img src=x onerror=alert(1)');
  assert.equal(text('a<!-- hidden <em> -->b<!-- unterminated'), 'ab');
  assert.equal(text('<em title="a>b">x</em>'), 'x');
  assert.deepEqual(htmlToTokens('<em>&amp;</em>'), [{ ch: '&', em: true }]);
});

test('sanitizeValue: no double escaping, unterminated tags escaped, &nbsp; stable', () => {
  assert.equal(sanitizeValue('R&amp;D <em>x</em>', 'rich'), 'R&amp;D <em>x</em>');
  const unterminated = sanitizeValue('<img src=x onerror=alert(1)', 'rich');
  assert.equal(unterminated, '&lt;img src=x onerror=alert(1)');
  assert.ok(!unterminated.includes('<img'));
  assert.equal(sanitizeValue('a < b & c', 'rich'), 'a &lt; b &amp; c');
  assert.equal(sanitizeValue('&lt;em&gt;texte&lt;/em&gt;', 'rich'), '&lt;em&gt;texte&lt;/em&gt;');
  // &nbsp; round-trip, and whitespace pushed out of <em> / trimmed like a regular space
  assert.equal(sanitizeValue('dès&nbsp;demain&nbsp;!', 'rich'), 'dès&nbsp;demain&nbsp;!');
  assert.equal(sanitizeValue('mot&nbsp;<em>&nbsp;orange&nbsp;</em>&nbsp;fin', 'rich'), 'mot&nbsp;&nbsp;<em>orange</em>&nbsp;&nbsp;fin');
  // A normal space between two emphases is the author's choice: kept, not merged
  assert.equal(sanitizeValue('<em>a</em>&nbsp;<em>b</em>', 'rich'), '<em>a</em>&nbsp;<em>b</em>');
  assert.equal(sanitizeValue('<em>Votre</em> <em>SDR</em>', 'rich'), '<em>Votre</em> <em>SDR</em>');
  assert.equal(sanitizeValue('<em>&nbsp;</em>', 'rich'), '');
  assert.equal(sanitizeValue('&nbsp; texte &nbsp;', 'rich'), 'texte');
});

test('sanitizeValue: idempotent on rich values', () => {
  const inputs = [
    'R&amp;D <em>x</em>',
    'Audit & Scénarisation',
    '<img src=x onerror=alert(1)',
    '&lt;img src=x onerror=alert(1)&gt;',
    'a < b & c > d',
    '<em>a<em>b</em></em> <strong style="x">c</strong>',
    'mot&nbsp;<em>&nbsp;orange&nbsp;</em>&nbsp;fin',
    ' <br> <em>ligne 1<br>ligne 2</em> ',
    '<!-- note --><em title="a>b">x</em><script>alert(1)</script>',
    '&#x1F600; &#0; &eacute; &unknown; &amp;amp;',
    '<em>Votre SDR</em>\u00a0dès demain',
  ];
  for (const input of inputs) {
    const once = sanitizeValue(input, 'rich');
    assert.equal(sanitizeValue(once, 'rich'), once, input);
  }
});

test('sanitizeValue: every rich value of src/i18n/translations.json is stable (FR and EN)', () => {
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'i18n', 'translations.json'), 'utf8'));
  const richKeys = Object.keys(data.schema).filter((key) => data.schema[key].type === 'rich');
  assert.ok(richKeys.length > 0);
  for (const lang of ['fr', 'en']) {
    for (const key of richKeys) {
      const value = data[lang][key];
      assert.equal(sanitizeValue(value, 'rich'), value, `${lang} ${key}`);
    }
  }
});

test('browser model: the /__editor.js prelude behaves exactly like the server model (F2)', () => {
  const browserModel = loadBrowserModel();
  assert.equal(typeof browserModel.htmlToTokens, 'function');
  assert.equal(typeof browserModel.tokensToHtml, 'function');
  assert.equal(typeof browserModel.applyTokensFormat, 'function');
  for (const [name, run] of Object.entries(EMPHASIS_CASES)) {
    assert.equal(run(browserModel), run(SERVER_MODEL), name);
  }
  // What the browser sends back (innerHTML of decoded text) is stable under the server sanitizer
  const typed = browserModel.tokensToHtml(textToTokens('R&D <img src=x onerror=alert(1)>\u00a0fin'));
  assert.equal(sanitizeValue(typed, 'rich'), typed);
});

test('editor-client.js: no local copy of the pure model, uses the served one', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'infra', 'editor-client.js'), 'utf8');
  for (const name of ['htmlToTokens', 'tokensToHtml', 'renderTokensLine', 'applyTokensFormat', 'escapeHtmlText']) {
    assert.ok(!new RegExp(`function\\s+${name}\\b`).test(source), name);
  }
  assert.ok(source.includes('window.__sdrnowEmphasisModel'));
});


test('validateAndSanitizePayload: detects empty required fields and unknown keys', () => {
  const schema = {
    'hero.title': { type: 'rich', optional: false },
    'pricing.strategy_unit': { type: 'plain', optional: true },
  };

  // Missing required content
  const res1 = validateAndSanitizePayload(
    {
      fr: { 'hero.title': '   ', 'pricing.strategy_unit': '' },
      en: { 'hero.title': 'Valid', 'pricing.strategy_unit': '' },
    },
    schema
  );
  assert.equal(res1.error, 'empty_required_field');

  // Optional field empty is allowed
  const res2 = validateAndSanitizePayload(
    {
      fr: { 'hero.title': 'Titre valide', 'pricing.strategy_unit': '' },
      en: { 'hero.title': 'Valid title', 'pricing.strategy_unit': '' },
    },
    schema
  );
  assert.equal(res2.error, undefined);
  assert.equal(res2.sanitized.fr['pricing.strategy_unit'], '');

  // Unknown key rejected
  const res3 = validateAndSanitizePayload(
    {
      fr: { 'unknown.key': 'abc' },
      en: { 'unknown.key': 'abc' },
    },
    schema
  );
  assert.equal(res3.error, 'unknown_key');
});

test('patchHtmlContent: correctly patches elements, title and meta description without regex corruption', () => {
  const html = `<!DOCTYPE html><html><head><title data-i18n="meta.title">Old Title</title><meta name="description" content="Old Description" data-i18n-content="meta.description"></head><body><h1 data-i18n="hero.title" data-i18n-type="rich">Old Hero</h1></body></html>`;

  const dict = {
    'meta.title': 'Nouveau Titre $1 & Étoiles',
    'meta.description': 'Nouvelle "Description" & $100',
    'hero.title': 'Nouveau Hero <em>Accent $&</em>',
  };

  const patched = patchHtmlContent(html, dict);

  // Title and meta are plain: their decoded text is escaped
  assert.ok(patched.includes('<title data-i18n="meta.title">Nouveau Titre $1 &amp; Étoiles</title>'));
  assert.ok(patched.includes('content="Nouvelle &quot;Description&quot; &amp; $100"'));
  assert.ok(patched.includes('<h1 data-i18n="hero.title" data-i18n-type="rich">Nouveau Hero <em>Accent $&</em></h1>'));
});

test('patchHtmlContent: plain elements are escaped, rich elements are not (F4)', () => {
  const html = '<a data-i18n="hero.cta" data-i18n-type="plain">Old</a><p data-i18n="hero.description" data-i18n-type="rich">Old</p>';
  const patched = patchHtmlContent(html, { 'hero.cta': 'R&D <b>x</b>', 'hero.description': 'R&amp;D <em>x</em>' });
  assert.ok(patched.includes('<a data-i18n="hero.cta" data-i18n-type="plain">R&amp;D &lt;b&gt;x&lt;/b&gt;</a>'));
  assert.ok(patched.includes('<p data-i18n="hero.description" data-i18n-type="rich">R&amp;D <em>x</em></p>'));
});

// ==========================================
// Integration Tests: Staging Server Endpoints
// ==========================================

test('Server: Gatekeeper authentication logic (AD-7)', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();

  const handler = createRequestHandler({
    stagingDir,
    prodDir,
    adminUser: TEST_ADMIN_USER,
    adminPassSha256: TEST_ADMIN_PASS_SHA256,
    secret: TEST_SECRET,
    stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
  });

  try {
    // 1. Unauthenticated request -> 401 with WWW-Authenticate
    const res1 = await mockRequest(handler, '/');
    assert.equal(res1.statusCode, 401);
    assert.ok(res1.headers['www-authenticate']?.includes('Basic realm="SDRnow Staging Admin"'));

    // 2. Invalid Basic Auth -> 401
    const badAuth = Buffer.from('admin:wrongpass').toString('base64');
    const res2 = await mockRequest(handler, '/', {
      headers: { Authorization: `Basic ${badAuth}` },
    });
    assert.equal(res2.statusCode, 401);

    // 3. Valid Basic Auth -> 200 with __editor.js injection
    const goodAuth = Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64');
    const res3 = await mockRequest(handler, '/', {
      headers: { Authorization: `Basic ${goodAuth}` },
    });
    assert.equal(res3.statusCode, 200);
    assert.ok(res3.body.includes('<script src="/__editor.js"></script>'));

    // 3b. Valid Basic Auth with "client" when adminUser is "client,admin"
    const handlerMulti = createRequestHandler({
      stagingDir,
      prodDir,
      adminUser: 'client,admin',
      adminPassSha256: TEST_ADMIN_PASS_SHA256,
      secret: TEST_SECRET,
      stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
    });
    const clientAuth = Buffer.from(`client:${TEST_ADMIN_PASS}`).toString('base64');
    const resClient = await mockRequest(handlerMulti, '/', {
      headers: { Authorization: `Basic ${clientAuth}` },
    });
    assert.equal(resClient.statusCode, 200);
    assert.ok(resClient.body.includes('<script src="/__editor.js"></script>'));

    // 4. Invalid or Expired preview token -> 403 Expired Preview Gate (NO WWW-Authenticate!)
    const res4 = await mockRequest(handler, '/?preview=bad-token-1234');
    assert.equal(res4.statusCode, 403);
    assert.equal(res4.headers['www-authenticate'], undefined);
    assert.ok(res4.body.includes('Lien de prévisualisation expiré'));

    // 5. Valid preview token -> 200 without __editor.js, sets cookie
    const validToken = computePreviewToken(stagingDir, TEST_SECRET);
    const res5 = await mockRequest(handler, `/?preview=${validToken}`);
    assert.equal(res5.statusCode, 200);
    assert.ok(!res5.body.includes('<script src="/__editor.js"></script>'));
    assert.ok(res5.headers['set-cookie']?.includes(`staging_preview=${validToken}`));

    // 6. Request with valid preview cookie -> 200 without editor
    const res6 = await mockRequest(handler, '/en', {
      headers: { Cookie: `staging_preview=${validToken}` },
    });
    assert.equal(res6.statusCode, 200);
    assert.ok(!res6.body.includes('<script src="/__editor.js"></script>'));

    // 7. Read-only user trying /api/* -> 403 Forbidden
    const res7 = await mockRequest(handler, '/api/translations', {
      headers: { Cookie: `staging_preview=${validToken}` },
    });
    assert.equal(res7.statusCode, 403);

    // 8. Stale/expired preview cookie -> 403 Expired Preview Gate without WWW-Authenticate, clears cookie
    const res8 = await mockRequest(handler, '/en', {
      headers: { Cookie: 'staging_preview=old-expired-token' },
    });
    assert.equal(res8.statusCode, 403);
    assert.equal(res8.headers['www-authenticate'], undefined);
    assert.ok(res8.body.includes('Lien de prévisualisation expiré'));
    assert.ok(res8.headers['set-cookie']?.includes('staging_preview=;'));
  } finally {
    cleanupDirs(baseTmp);
  }
});

test('Server: API staging mutation and atomic patch (<10ms)', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();

  const handler = createRequestHandler({
    stagingDir,
    prodDir,
    adminUser: TEST_ADMIN_USER,
    adminPassSha256: TEST_ADMIN_PASS_SHA256,
    secret: TEST_SECRET,
    stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
  });

  const adminAuth = Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64');
  const headers = {
    Authorization: `Basic ${adminAuth}`,
    'Content-Type': 'application/json',
  };

  try {
    const oldRev = getRevision(stagingDir);

    const start = Date.now();
    const res = await mockRequest(handler, '/api/staging', {
      method: 'POST',
      headers,
      body: {
        fr: {
          'meta.title': 'SDRnow Staging Modifié',
          'hero.title': 'Nouveau Hero <em>Génial</em>',
        },
        en: {
          'meta.title': 'SDRnow Staging Modified',
          'hero.title': 'New Hero <em>Awesome</em>',
        },
      },
    });
    const duration = Date.now() - start;

    assert.equal(res.statusCode, 202);
    assert.ok(duration < 500, `Duration ${duration}ms should be fast (<500ms)`);

    const json = JSON.parse(res.body);
    assert.equal(json.status, 'accepted');
    assert.ok(json.previewToken);
    assert.ok(json.previewUrl.includes(json.previewToken));

    // Verify .revision incremented
    const newRev = getRevision(stagingDir);
    assert.equal(newRev, oldRev + 1);

    // Verify disk files were patched
    const patchedIndexFr = fs.readFileSync(path.join(stagingDir, 'index.html'), 'utf8');
    assert.ok(patchedIndexFr.includes('SDRnow Staging Modifié'));
    assert.ok(patchedIndexFr.includes('Nouveau Hero <em>Génial</em>'));

    const patchedIndexEn = fs.readFileSync(path.join(stagingDir, 'en', 'index.html'), 'utf8');
    assert.ok(patchedIndexEn.includes('SDRnow Staging Modified'));
    assert.ok(patchedIndexEn.includes('New Hero <em>Awesome</em>'));

    // Verify Prod was NOT touched by /api/staging
    const prodIndexFr = fs.readFileSync(path.join(prodDir, 'index.html'), 'utf8');
    assert.ok(!prodIndexFr.includes('SDRnow Staging Modifié'));
  } finally {
    cleanupDirs(baseTmp);
  }
});

test('Server: API publish mutates both Staging and Prod', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();

  const handler = createRequestHandler({
    stagingDir,
    prodDir,
    adminUser: TEST_ADMIN_USER,
    adminPassSha256: TEST_ADMIN_PASS_SHA256,
    secret: TEST_SECRET,
    stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
  });

  const adminAuth = Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64');
  const headers = {
    Authorization: `Basic ${adminAuth}`,
    'Content-Type': 'application/json',
  };

  try {
    const res = await mockRequest(handler, '/api/publish', {
      method: 'POST',
      headers,
      body: {
        fr: {
          'meta.title': 'Titre Prod Publié',
          'hero.title': 'Hero Prod <em>Orange</em>',
        },
        en: {
          'meta.title': 'Title Prod Published',
          'hero.title': 'Hero Prod <em>Orange</em>',
        },
      },
    });

    assert.equal(res.statusCode, 202);

    // Both staging and prod must have been updated
    const stagingHtml = fs.readFileSync(path.join(stagingDir, 'index.html'), 'utf8');
    const prodHtml = fs.readFileSync(path.join(prodDir, 'index.html'), 'utf8');

    assert.ok(stagingHtml.includes('Titre Prod Publié'));
    assert.ok(prodHtml.includes('Titre Prod Publié'));
  } finally {
    cleanupDirs(baseTmp);
  }
});

test('Server: API reset restores Staging from Prod without touching Prod', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();

  // First change staging to something else
  fs.writeFileSync(
    path.join(stagingDir, 'translations.json'),
    JSON.stringify({
      schema: {
        'meta.title': { type: 'plain', optional: false },
      },
      fr: { 'meta.title': 'Titre Altéré en Staging' },
      en: { 'meta.title': 'Altered Title in Staging' },
    })
  );

  const handler = createRequestHandler({
    stagingDir,
    prodDir,
    adminUser: TEST_ADMIN_USER,
    adminPassSha256: TEST_ADMIN_PASS_SHA256,
    secret: TEST_SECRET,
    stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
  });

  const adminAuth = Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64');
  const headers = {
    Authorization: `Basic ${adminAuth}`,
    'Content-Type': 'application/json',
  };

  try {
    const res = await mockRequest(handler, '/api/reset', {
      method: 'POST',
      headers,
      body: {},
    });

    assert.equal(res.statusCode, 202);

    // Staging index.html should have Prod title ('Titre FR') restored
    const stagingHtml = fs.readFileSync(path.join(stagingDir, 'index.html'), 'utf8');
    assert.ok(stagingHtml.includes('Titre FR'));
    assert.ok(!stagingHtml.includes('Titre Altéré'));
  } finally {
    cleanupDirs(baseTmp);
  }
});

test('Server: Preview token invalidation on Staging mutation', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();

  const handler = createRequestHandler({
    stagingDir,
    prodDir,
    adminUser: TEST_ADMIN_USER,
    adminPassSha256: TEST_ADMIN_PASS_SHA256,
    secret: TEST_SECRET,
    stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
  });

  const adminAuth = Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64');
  const headers = {
    Authorization: `Basic ${adminAuth}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Get initial token
    const initialToken = computePreviewToken(stagingDir, TEST_SECRET);
    const res1 = await mockRequest(handler, `/?preview=${initialToken}`);
    assert.equal(res1.statusCode, 200);

    // 2. Perform a staging mutation
    const res2 = await mockRequest(handler, '/api/staging', {
      method: 'POST',
      headers,
      body: {
        fr: { 'meta.title': 'Titre V2' },
        en: { 'meta.title': 'Title V2' },
      },
    });
    assert.equal(res2.statusCode, 202);
    const newJson = JSON.parse(res2.body);
    const newToken = newJson.previewToken;
    assert.notEqual(newToken, initialToken);

    // 3. Old token MUST now return 403 Expired Preview Gate (no WWW-Authenticate)
    const res3 = await mockRequest(handler, `/?preview=${initialToken}`);
    assert.equal(res3.statusCode, 403);
    assert.equal(res3.headers['www-authenticate'], undefined);
    assert.ok(res3.body.includes('Lien de prévisualisation expiré'));

    // 4. New token MUST return 200
    const res4 = await mockRequest(handler, `/?preview=${newToken}`);
    assert.equal(res4.statusCode, 200);
  } finally {
    cleanupDirs(baseTmp);
  }
});

test('Server: GET /api/translations returns schema, fr, en, previewToken, previewUrl for admin', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();

  const handler = createRequestHandler({
    stagingDir,
    prodDir,
    adminUser: TEST_ADMIN_USER,
    adminPassSha256: TEST_ADMIN_PASS_SHA256,
    secret: TEST_SECRET,
    stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
  });

  const adminAuth = Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64');

  try {
    const res = await mockRequest(handler, '/api/translations', {
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.schema);
    assert.ok(data.fr);
    assert.ok(data.en);
    assert.ok(data.previewToken);
    assert.ok(data.previewUrl);
  } finally {
    cleanupDirs(baseTmp);
  }
});

test('Server: Access control on /__editor.js (admin only)', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();

  const editorPath = path.join(baseTmp, 'editor-test.js');
  fs.writeFileSync(editorPath, 'console.log("editor client");');

  const handler = createRequestHandler({
    stagingDir,
    prodDir,
    adminUser: TEST_ADMIN_USER,
    adminPassSha256: TEST_ADMIN_PASS_SHA256,
    secret: TEST_SECRET,
    stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
    editorScriptPath: editorPath,
  });

  const adminAuth = Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64');
  const previewToken = computePreviewToken(stagingDir, TEST_SECRET);

  try {
    // 1. Unauthenticated -> 401
    const res1 = await mockRequest(handler, '/__editor.js');
    assert.equal(res1.statusCode, 401);

    // 2. Read-only preview user -> 403
    const res2 = await mockRequest(handler, '/__editor.js', {
      headers: { Cookie: `staging_preview=${previewToken}` },
    });
    assert.equal(res2.statusCode, 403);

    // 3. Admin -> 200 JS
    const res3 = await mockRequest(handler, '/__editor.js', {
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    assert.equal(res3.statusCode, 200);
    assert.equal(res3.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.ok(res3.body.includes('editor client'));
    assert.ok(res3.body.startsWith(buildEmphasisModelPrelude()));
  } finally {
    cleanupDirs(baseTmp);
  }
});

test('Server: served /__editor.js = emphasis model prelude + real editor-client.js, parseable', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();
  const handler = createRequestHandler({
    stagingDir,
    prodDir,
    adminUser: TEST_ADMIN_USER,
    adminPassSha256: TEST_ADMIN_PASS_SHA256,
    secret: TEST_SECRET,
    stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
    editorScriptPath: path.join(process.cwd(), 'infra', 'editor-client.js'),
  });
  const adminAuth = Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64');

  try {
    const res = await mockRequest(handler, '/__editor.js', {
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    assert.equal(res.statusCode, 200);
    const prelude = buildEmphasisModelPrelude();
    assert.ok(res.body.startsWith(prelude));
    assert.ok(res.body.includes('window.__sdrnowEmphasisModel = Object.freeze({'));
    assert.doesNotThrow(() => new vm.Script(res.body, { filename: '__editor.js' }));

    // The prelude extracted from the served script yields the server results on E1-E11
    const browserModel = loadBrowserModel(res.body.slice(0, prelude.length));
    for (const [name, run] of Object.entries(EMPHASIS_CASES)) {
      assert.equal(run(browserModel), run(SERVER_MODEL), name);
    }
  } finally {
    cleanupDirs(baseTmp);
  }
});

test('Server: POST /api/reset gracefully falls back when prod translations.json is missing', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();

  // Delete prod translations.json (simulating cold start before prod deployment)
  fs.unlinkSync(path.join(prodDir, 'translations.json'));

  const handler = createRequestHandler({
    stagingDir,
    prodDir,
    adminUser: TEST_ADMIN_USER,
    adminPassSha256: TEST_ADMIN_PASS_SHA256,
    secret: TEST_SECRET,
    stagingAnalyticsFile: path.join(baseTmp, 'analytics-staging.jsonl'),
  });

  const adminAuth = Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64');

  try {
    // 1. Staging exists, prod missing -> succeeds with 202 and initializes prod
    const res = await mockRequest(handler, '/api/reset', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${adminAuth}`,
        'Content-Type': 'application/json',
      },
      body: {},
    });
    assert.equal(res.statusCode, 202);
    const json = JSON.parse(res.body);
    assert.equal(json.status, 'accepted');
    assert.ok(fs.existsSync(path.join(prodDir, 'translations.json')));

    // 2. Both missing -> 500
    fs.unlinkSync(path.join(stagingDir, 'translations.json'));
    fs.unlinkSync(path.join(prodDir, 'translations.json'));
    const resFail = await mockRequest(handler, '/api/reset', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${adminAuth}`,
        'Content-Type': 'application/json',
      },
      body: {},
    });
    assert.equal(resFail.statusCode, 500);
    const jsonFail = JSON.parse(resFail.body);
    assert.equal(jsonFail.error, 'prod_read_failed');
  } finally {
    cleanupDirs(baseTmp);
  }
});


// ==========================================
// Cookieless server-side tracking (spec cookieless-server-tracking, I/O matrix)
// ==========================================

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const LINKEDIN_BOT_UA = 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)';
const TEST_IPS = ['203.0.113.7', '198.51.100.23', '192.0.2.44', '203.0.113.99', '198.51.100.250'];
const CTA = {
  hero: 'https://cal.example/hero',
  starter: 'https://cal.example/starter',
  strategy: 'https://cal.example/strategy',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setupTracking(trackerOptions = {}) {
  const dirs = setupTestDirs();
  fs.mkdirSync(path.join(dirs.prodDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dirs.prodDir, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  fs.mkdirSync(path.join(dirs.stagingDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dirs.stagingDir, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><!-- staging --></svg>');
  const analyticsFile = path.join(dirs.baseTmp, 'etc-sdrnow', 'analytics.jsonl');
  const stagingAnalyticsFile = path.join(dirs.baseTmp, 'etc-sdrnow', 'analytics-staging.jsonl');
  const emailLogFile = path.join(dirs.baseTmp, 'etc-sdrnow', 'email-log.jsonl');
  // ctx.sent: TEM sends (real delivery); ctx.mailpit: Mailpit captures
  const ctx = { ...dirs, analyticsFile, stagingAnalyticsFile, emailLogFile, clock: Date.parse('2026-10-20T12:00:00Z'), sent: [], mailpit: [], prodResponses: [] };
  ctx.makeTracker = (extra = {}) =>
    createTracker({
      analyticsFile,
      emailLogFile,
      ctaTargets: CTA,
      alertRecipients: ['jcm@sdrnow.fr', 'copie@example.fr'],
      sendEmail: async (message) => {
        ctx.sent.push(message);
      },
      sendMailpit: async (message) => {
        ctx.mailpit.push(message);
        return `mp-${ctx.mailpit.length}`;
      },
      now: () => ctx.clock,
      debounceMs: 40,
      ...trackerOptions,
      ...extra,
    });
  ctx.tracker = ctx.makeTracker();
  // Staging test visits: separate log, Mailpit only (sendEmail still wired to ctx.sent to prove TEM is never used)
  ctx.stagingTracker = ctx.makeTracker({ analyticsFile: stagingAnalyticsFile, site: 'staging' });
  ctx.makeHandler = (tracker, stagingTracker = ctx.stagingTracker) =>
    createRequestHandler({
      stagingDir: dirs.stagingDir,
      prodDir: dirs.prodDir,
      adminUser: 'client,admin',
      adminPassSha256: TEST_ADMIN_PASS_SHA256,
      secret: TEST_SECRET,
      tracker,
      stagingTracker,
    });
  ctx.handler = ctx.makeHandler(ctx.tracker);
  // Every prod request goes through here: invariant "no Set-Cookie on sdrnow.fr"
  ctx.prod = async (url, { ip = TEST_IPS[0], ua = IPHONE_UA, headers = {}, ...rest } = {}) => {
    const res = await mockRequest(ctx.handler, url, {
      ...rest,
      headers: { Host: 'sdrnow.fr', 'User-Agent': ua, 'X-Forwarded-For': ip, ...headers },
    });
    assert.equal(res.headers['set-cookie'], undefined, `Set-Cookie on prod ${url}`);
    assert.equal(res.headers['www-authenticate'], undefined, `WWW-Authenticate on prod ${url}`);
    ctx.prodResponses.push(res);
    return res;
  };
  ctx.health = (body, opts = {}) => ctx.prod('/health', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), ...opts });
  // Staging request: auth = 'admin' | 'client' | null, preview = token sent as the preview cookie
  ctx.staging = (url, { ip = TEST_IPS[0], ua = IPHONE_UA, auth = 'admin', preview = null, headers = {}, ...rest } = {}) => {
    const h = { Host: 'staging.sdrnow.fr', 'User-Agent': ua, 'X-Forwarded-For': ip };
    if (auth) h.Authorization = `Basic ${Buffer.from(`${auth}:${TEST_ADMIN_PASS}`).toString('base64')}`;
    if (preview) h.Cookie = `staging_preview=${preview}`;
    return mockRequest(ctx.handler, url, { ...rest, headers: { ...h, ...headers } });
  };
  // Production stats request (Basic Auth expected, so not through ctx.prod)
  ctx.prodStats = (url, { ip = TEST_IPS[0], headers = {}, ...rest } = {}) =>
    mockRequest(ctx.handler, url, { ...rest, headers: { Host: 'sdrnow.fr', 'User-Agent': MAC_UA, 'X-Forwarded-For': ip, ...headers } });
  const readLog = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  ctx.events = () => readLog(analyticsFile);
  ctx.stagingEvents = () => readLog(stagingAnalyticsFile);
  ctx.emailLog = () => readLog(emailLogFile);
  ctx.idle = async () => {
    await ctx.tracker.whenIdle();
    await ctx.stagingTracker.whenIdle();
  };
  ctx.cleanup = () => {
    ctx.tracker.stopTimers();
    ctx.stagingTracker.stopTimers();
    // Invariant: no raw IP is ever written to any log, and no email body in the send log
    for (const file of [analyticsFile, stagingAnalyticsFile, emailLogFile]) {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      for (const ip of TEST_IPS) assert.ok(!raw.includes(ip), `raw IP ${ip} leaked into ${path.basename(file)}`);
    }
    for (const line of ctx.emailLog()) {
      assert.deepEqual(Object.keys(line).sort(), ['error', 'id', 'kind', 'ok', 'ref', 'site', 'subject', 'to', 'transport', 'ts'], 'send log fields only');
    }
    cleanupDirs(dirs.baseTmp);
  };
  return ctx;
}

const adminHeaders = () => ({ Authorization: `Basic ${Buffer.from(`${TEST_ADMIN_USER}:${TEST_ADMIN_PASS}`).toString('base64')}` });

test('tracking helpers: UA classification, families, CTA table, recipients, attribute escaping', () => {
  assert.equal(classifyUa(LINKEDIN_BOT_UA), 'bot');
  assert.equal(classifyUa('Mozilla/5.0 (compatible; SafeLinks)'), 'bot');
  assert.equal(classifyUa(''), 'bot');
  assert.equal(classifyUa(IPHONE_UA), 'human');
  assert.equal(uaFamily(IPHONE_UA), 'iPhone (Safari)');
  assert.equal(uaFamily(MAC_UA), 'Mac (Chrome)');
  assert.equal(uaFamily(LINKEDIN_BOT_UA), 'Robot (LinkedInBot)');
  const targets = getCtaTargets({ CTA_TARGET_STARTER: 'https://pay.example/starter', CTA_TARGET_HERO: '', CTA_TARGET_PAIEMENT_PRO: 'https://pay.example/pro' });
  assert.equal(targets.starter, 'https://pay.example/starter');
  assert.equal(targets.hero, 'https://calendly.com/jc-maleysson/30min');
  assert.equal(targets.strategy, 'https://calendly.com/jc-maleysson/30min');
  assert.equal(targets['paiement-pro'], 'https://pay.example/pro');
  assert.deepEqual(parseRecipients('jcm@sdrnow.fr, copie@domaine.fr,,bad'), ['jcm@sdrnow.fr', 'copie@domaine.fr']);
  assert.equal(escapeHtmlAttr(`"><img src=x onerror='1'>`), '&quot;&gt;&lt;img src=x onerror=&#39;1&#39;&gt;');
});

test('tracking: prospect link /pour/<slug> serves the FR home, noindex, logs a tier-1 pageview; bad slug -> 404', async () => {
  const ctx = setupTracking();
  try {
    const res = await ctx.prod('/pour/acme');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(res.body, fs.readFileSync(path.join(ctx.prodDir, 'index.html'), 'utf8'));
    const [ev] = ctx.events();
    assert.equal(ev.event, 'pageview');
    assert.equal(ev.slug, 'acme');
    assert.equal(ev.tier, 1);
    assert.equal(ev.lang, 'fr');
    assert.equal(ev.ua_family, 'iPhone (Safari)');
    assert.match(ev.anon_id, /^[0-9a-f]{8}$/);
    assert.equal(ev.date, '2026-10-20');
    for (const k of ['ts', 'date', 'anon_id', 'slug', 'tier', 'event', 'target', 'duration', 'lang', 'referer', 'ua_family']) {
      assert.ok(k in ev, `missing field ${k}`);
    }

    assert.equal((await ctx.prod('/offre/acme')).statusCode, 200);
    for (const bad of ['/pour/a', '/pour/acme.x', `/pour/${'x'.repeat(65)}`, '/pour/%E0%A4%A', '/wp-admin', '/login', '/.env', '/acme']) {
      const r = await ctx.prod(bad);
      assert.equal(r.statusCode, 404, bad);
    }
    // HEAD is never logged
    await ctx.prod('/pour/acme', { method: 'HEAD' });
    assert.equal(ctx.events().length, 2);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: EN prospect links /en/for/<slug> and /en/offer/<slug> serve en/index.html with lang en', async () => {
  const ctx = setupTracking();
  try {
    for (const url of ['/en/for/acme', '/en/offer/acme']) {
      const res = await ctx.prod(url);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body, fs.readFileSync(path.join(ctx.prodDir, 'en', 'index.html'), 'utf8'));
      assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
    }
    assert.deepEqual(ctx.events().map((e) => [e.lang, e.slug]), [['en', 'acme'], ['en', 'acme']]);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: LinkedInBot preview stays tier 1, arms no timer and is counted as a bot', async () => {
  const ctx = setupTracking();
  try {
    await ctx.prod('/pour/acme', { ua: LINKEDIN_BOT_UA, ip: TEST_IPS[1] });
    await ctx.prod('/assets/logo.svg', { ua: LINKEDIN_BOT_UA, ip: TEST_IPS[1] });
    assert.ok(ctx.events().every((e) => e.tier === 1));
    assert.equal(ctx.tracker.hasPendingAlert('acme'), false);
    await sleep(80);
    await ctx.tracker.whenIdle();
    assert.equal(ctx.sent.length, 0);
    const stats = ctx.tracker.stats('today');
    assert.equal(stats.bots, 1);
    assert.equal(stats.prospects.length, 0);
    assert.equal(stats.humans, 0);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: HTML + witness logo (Adblock) -> tier 2, radar row, timer armed; logo revalidates with ETag', async () => {
  const ctx = setupTracking();
  try {
    await ctx.prod('/pour/acme');
    assert.equal(ctx.tracker.hasPendingAlert('acme'), false);
    const logo = await ctx.prod('/assets/logo.svg');
    assert.equal(logo.statusCode, 200);
    assert.equal(logo.headers['cache-control'], 'no-cache');
    assert.ok(logo.headers.etag);
    const render = ctx.events().find((e) => e.event === 'render');
    assert.equal(render.tier, 2);
    assert.equal(render.slug, 'acme');
    assert.equal(ctx.tracker.hasPendingAlert('acme'), true);

    // Revisit J+N with a cached logo: 304 still proves the render
    const again = await ctx.prod('/assets/logo.svg', { headers: { 'If-None-Match': logo.headers.etag } });
    assert.equal(again.statusCode, 304);

    const stats = ctx.tracker.stats('today');
    assert.equal(stats.prospects.length, 1);
    assert.equal(stats.prospects[0].adblockOnly, true);
    assert.equal(stats.prospects[0].signals.hasTelemetry, false);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: POST /health -> tier 3 and 204; 413 / 429 / 400 guards', async () => {
  const ctx = setupTracking();
  try {
    await ctx.prod('/pour/acme');
    const ok = await ctx.health({ e: 'init', p: '/pour/acme', d: 0, t: '' });
    assert.equal(ok.statusCode, 204);
    const init = ctx.events().find((e) => e.event === 'init');
    assert.equal(init.tier, 3);
    assert.equal(init.slug, 'acme');

    assert.equal((await ctx.health(JSON.stringify({ e: 'ping', t: 'x'.repeat(600) }))).statusCode, 413);
    assert.equal((await ctx.health('{not json')).statusCode, 400);
    assert.equal((await ctx.health({ e: 'steal_cookies' })).statusCode, 400);
    assert.equal((await ctx.health('[]')).statusCode, 400);
    assert.equal((await ctx.prod('/health')).statusCode, 405);

    // Rate limit: 30 POST/min/IP (5 already used above, the 405 GET does not count)
    const statuses = [];
    for (let i = 0; i < 30; i++) statuses.push((await ctx.health({ e: 'ping', d: 1 })).statusCode);
    assert.equal(statuses.filter((s) => s === 204).length, 25);
    assert.equal(statuses[statuses.length - 1], 429);
    // Another IP is not affected; a new minute resets the window
    assert.equal((await ctx.health({ e: 'ping', d: 1 }, { ip: TEST_IPS[2] })).statusCode, 204);
    ctx.clock += 61000;
    assert.equal((await ctx.health({ e: 'ping', d: 1 })).statusCode, 204);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: each event re-arms the 120 s debounce -> one single email per recipient', async () => {
  const ctx = setupTracking();
  try {
    await ctx.prod('/pour/acme');
    await ctx.health({ e: 'init', p: '/pour/acme' });
    for (const body of [{ e: 'pricing_view' }, { e: 'copy', t: 'starter' }, { e: 'ping', d: 45 }]) {
      await sleep(25); // < debounce (40 ms) each time, > debounce in total
      await ctx.health(body);
    }
    assert.equal(ctx.sent.length, 0);
    await sleep(90);
    await ctx.tracker.whenIdle();
    assert.equal(ctx.sent.length, 2);
    assert.deepEqual(ctx.sent.map((m) => m.to).sort(), ['copie@example.fr', 'jcm@sdrnow.fr']);
    assert.equal(ctx.sent[0].subject, '🔥 [SDRnow] acme vient de consulter votre offre (1 appareil • Copie tarif Starter)');
    assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(ctx.sent[0].html), 'no IP in the email');
  } finally {
    ctx.cleanup();
  }
});

test('tracking: CTA routes log cta_click and 302 to the per-offer target, no-store; unknown offer -> 404', async () => {
  const ctx = setupTracking();
  try {
    await ctx.prod('/pour/acme');
    const fr = await ctx.prod('/rdv/starter');
    assert.equal(fr.statusCode, 302);
    assert.equal(fr.headers.location, CTA.starter);
    assert.equal(fr.headers['cache-control'], 'no-store');
    const en = await ctx.prod('/en/book/starter');
    assert.equal(en.headers.location, CTA.starter);
    assert.equal((await ctx.prod('/rdv/decouverte')).headers.location, CTA.hero);
    assert.equal((await ctx.prod('/en/book/discovery')).headers.location, CTA.hero);
    assert.equal((await ctx.prod('/rdv/strategy')).headers.location, CTA.strategy);
    assert.equal((await ctx.prod('/rdv/inconnue')).statusCode, 404);
    const clicks = ctx.events().filter((e) => e.event === 'cta_click');
    assert.deepEqual(clicks.map((e) => [e.target, e.lang, e.slug]), [
      ['starter', 'fr', 'acme'], ['starter', 'en', 'acme'], ['hero', 'fr', 'acme'], ['hero', 'en', 'acme'], ['strategy', 'fr', 'acme'],
    ]);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: two prospect tabs in the same browser -> each beacon ping and CTA click goes to the page that sent it', async () => {
  const ctx = setupTracking();
  try {
    // Tab A: first test, read for a while
    await ctx.prod('/pour/test-mail');
    await ctx.prod('/assets/logo.svg');
    await ctx.health({ e: 'init', p: '/pour/test-mail' });
    // Tab B, same browser (same anon_id): quick 2 s visit of another link
    await ctx.prod('/pour/test-2s');
    await ctx.prod('/assets/logo.svg');
    await ctx.health({ e: 'init', p: '/pour/test-2s' });
    // Tab A, now hidden, sends its remaining visible seconds; tab B is closed after 2 s
    await ctx.health({ e: 'ping', p: '/pour/test-mail', d: 18 });
    await ctx.health({ e: 'ping', p: '/pour/test-2s', d: 2 });
    // CTA clicked from tab A: attributed through the same-site Referer
    await ctx.prod('/rdv/starter', { headers: { Referer: 'https://sdrnow.fr/pour/test-mail' } });
    // A non-prospect page keeps the last prospect link of the visitor (navigation /pour/x -> /en)
    await ctx.health({ e: 'pricing_view', p: '/en' });

    const events = ctx.events();
    const durationOf = (slug) => events.filter((e) => e.slug === slug && e.event === 'ping').reduce((n, e) => n + e.duration, 0);
    assert.equal(durationOf('test-2s'), 2);
    assert.equal(durationOf('test-mail'), 18);
    assert.equal(events.find((e) => e.event === 'cta_click').slug, 'test-mail');
    assert.equal(events.find((e) => e.event === 'pricing_view').slug, 'test-2s');
  } finally {
    ctx.cleanup();
  }
});

test('tracking: the same anon_id opening /en afterwards stays attached to the prospect (RAM map of the day)', async () => {
  const ctx = setupTracking();
  try {
    await ctx.prod('/pour/acme');
    const res = await ctx.prod('/en');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-robots-tag'], undefined);
    await ctx.prod('/mentions-legales');
    const [first, second, third] = ctx.events();
    assert.equal(second.anon_id, first.anon_id);
    assert.equal(second.slug, 'acme');
    assert.equal(second.lang, 'en');
    assert.equal(third.slug, 'acme');
    // A different device on the generic URL stays anonymous
    await ctx.prod('/', { ip: TEST_IPS[3], ua: MAC_UA });
    assert.equal(ctx.events()[3].slug, null);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: hot prospect alert after inactivity (2 devices + Starter click), one TEM send per recipient', async () => {
  const ctx = setupTracking();
  try {
    // LinkedIn preview robot first: filtered
    await ctx.prod('/pour/acme', { ua: LINKEDIN_BOT_UA, ip: TEST_IPS[1] });
    // Prospect on iPhone with JS
    await ctx.prod('/pour/acme', { headers: { Referer: 'https://www.linkedin.com/' } });
    await ctx.prod('/assets/logo.svg');
    await ctx.health({ e: 'init', p: '/pour/acme' });
    await ctx.health({ e: 'pricing_view', p: '/pour/acme' });
    await ctx.health({ e: 'copy', p: '/pour/acme', t: 'starter' });
    // Forwarded to the CEO on a Mac, under Adblock
    const mac = { ip: TEST_IPS[2], ua: MAC_UA };
    await ctx.prod('/pour/acme', mac);
    await ctx.prod('/assets/logo.svg', mac);
    await ctx.prod('/mentions-legales', mac);
    await ctx.prod('/rdv/starter', mac);
    await sleep(90);
    await ctx.tracker.whenIdle();

    assert.equal(ctx.sent.length, 2);
    for (const m of ctx.sent) {
      assert.equal(m.subject, '🔥 [SDRnow] acme vient de consulter votre offre (2 appareils • Clic RDV Starter)');
      assert.match(m.html, /2e appareil : Mac \(Chrome\)/);
      assert.match(m.html, /Mentions légales/);
      assert.match(m.html, /href="https:\/\/sdrnow\.fr\/stats"/, 'STATS_URL defaults to the production stats');
      assert.ok(!m.html.includes('LinkedInBot'), 'bot events are not in the summary');
    }
    assert.notEqual(ctx.sent[0].to, ctx.sent[1].to);

    const stats = ctx.tracker.stats('today');
    assert.equal(stats.bots, 1);
    const row = stats.prospects[0];
    assert.equal(row.slug, 'acme');
    assert.equal(row.devices, 2);
    assert.deepEqual(row.signals.ctas, ['starter']);
    assert.equal(row.signals.legal, true);
    assert.equal(row.origin, 'LinkedIn');
    assert.equal(row.revisit, false, 'two devices a few minutes apart is a share, not a revisit');
    ctx.clock += 31 * 60 * 1000;
    await ctx.prod('/pour/acme');
    assert.equal(ctx.tracker.stats('today').prospects[0].revisit, true);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: TEM failure is logged with [TEM], no retry, server keeps serving', async () => {
  let calls = 0;
  const ctx = setupTracking({
    sendEmail: async () => {
      calls += 1;
      throw new Error('HTTP 500 boom');
    },
  });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await ctx.prod('/pour/acme');
    await ctx.prod('/assets/logo.svg');
    await sleep(90);
    await ctx.tracker.whenIdle();
    assert.equal(calls, 2); // one attempt per recipient, no retry
    assert.ok(errors.some((e) => e.startsWith('[TEM]') && e.includes('boom')));
    assert.equal((await ctx.prod('/pour/acme')).statusCode, 200);
    // The TEM failure is logged and the Mailpit copy goes out anyway
    assert.equal(ctx.mailpit.length, 2);
    const log = ctx.emailLog();
    assert.deepEqual(log.filter((l) => l.transport === 'tem').map((l) => [l.ok, l.error, l.id]), [
      [false, 'HTTP 500 boom', null], [false, 'HTTP 500 boom', null],
    ]);
    assert.deepEqual(log.filter((l) => l.transport === 'mailpit').map((l) => l.ok), [true, true]);
  } finally {
    console.error = original;
    ctx.cleanup();
  }
});

test('tracking: sendTemEmail calls the Scaleway TEM HTTPS API with the dedicated key, one recipient', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '' };
  };
  await sendTemEmail(
    { to: 'jcm@sdrnow.fr', subject: 'S', html: '<p>h</p>', text: 't' },
    { secretKey: 'tem-key', projectId: 'proj-1', fetch: fakeFetch, from: 'alertes@sdrnow.fr' }
  );
  assert.equal(calls[0].url, 'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Auth-Token'], 'tem-key');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, [{ email: 'jcm@sdrnow.fr' }]);
  assert.equal(body.project_id, 'proj-1');
  assert.equal(body.from.email, 'alertes@sdrnow.fr');

  await assert.rejects(
    sendTemEmail({ to: 'a@b.fr', subject: 'S' }, { secretKey: 'k', projectId: 'p', fetch: async () => ({ ok: false, status: 403, text: async () => 'denied' }) }),
    /HTTP 403/
  );
  await assert.rejects(sendTemEmail({ to: 'a@b.fr' }, { secretKey: '', projectId: 'p', fetch: fakeFetch }), /TEM_SECRET_KEY/);
  // The TEM message id (emails[0].id) is returned for the send log
  const id = await sendTemEmail(
    { to: 'jcm@sdrnow.fr', subject: 'S', html: '<p>h</p>', text: 't' },
    { secretKey: 'k', projectId: 'p', fetch: async () => ({ ok: true, status: 200, json: async () => ({ emails: [{ id: 'tem-123' }] }) }) }
  );
  assert.equal(id, 'tem-123');
});

test('mailpit: sendMailpitEmail POSTs {MAILPIT_URL}/api/v1/send (one recipient, tags) and returns the ID', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ID: 'mp-abc' }) };
  };
  const id = await sendMailpitEmail(
    { to: 'jcm@sdrnow.fr', subject: '[STAGING] S', html: '<p>h</p>', text: 't', tags: ['staging'] },
    { url: 'http://127.0.0.1:8025/mail/', fetch: fakeFetch, from: 'alertes@sdrnow.fr' }
  );
  assert.equal(id, 'mp-abc');
  assert.equal(calls[0].url, 'http://127.0.0.1:8025/mail/api/v1/send');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, undefined, 'no credentials: Node calls the loopback directly');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    From: { Email: 'alertes@sdrnow.fr', Name: 'Radar SDRnow' },
    To: [{ Email: 'jcm@sdrnow.fr' }],
    Subject: '[STAGING] S',
    Text: 't',
    HTML: '<p>h</p>',
    Tags: ['staging'],
  });
  await assert.rejects(
    sendMailpitEmail({ to: 'a@b.fr', subject: 'S' }, { fetch: async () => ({ ok: false, status: 500, text: async () => 'down' }) }),
    /HTTP 500 down/
  );
});

test('tracking: midnight rotation sends the anonymous digest only when >= 1 human visited; anon_id rotates', async () => {
  const ctx = setupTracking();
  try {
    // Quiet day: only a robot
    await ctx.prod('/', { ua: LINKEDIN_BOT_UA, ip: TEST_IPS[1] });
    ctx.clock = Date.parse('2026-10-20T22:00:30Z'); // 00:00:30 Paris on Oct 21 (CEST)
    assert.equal(ctx.tracker.rotateIfNeeded(), true);
    await ctx.tracker.whenIdle();
    assert.equal(ctx.sent.length, 0, 'no TEM call when 0 human visitor');

    // Oct 21: an anonymous human with telemetry clicks the Hero CTA
    await ctx.prod('/', { headers: { Referer: 'https://www.google.com/' } });
    const anonDay1 = ctx.events().at(-1).anon_id;
    await ctx.prod('/assets/logo.svg');
    await ctx.health({ e: 'init', p: '/' });
    await ctx.health({ e: 'pricing_view', p: '/' });
    await ctx.prod('/rdv/decouverte');
    ctx.clock = Date.parse('2026-10-21T22:00:05Z');
    await ctx.prod('/');
    await ctx.tracker.whenIdle();
    assert.notEqual(ctx.events().at(-1).anon_id, anonDay1, 'daily secret rotated');
    assert.equal(ctx.sent.length, 2);
    assert.equal(ctx.sent[0].subject, '📊 [SDRnow] Bilan du 21 oct. : 1 visiteur anonyme (1 clic RDV • 1 a lu les tarifs)');
    assert.match(ctx.sent[0].html, /Moteurs de recherche/);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: staging /stats is admin only (401 / 403), unknown period falls back to today, empty state', async () => {
  const ctx = setupTracking();
  try {
    const anon = await ctx.staging('/stats', { auth: null });
    assert.equal(anon.statusCode, 401);
    const token = computePreviewToken(ctx.stagingDir, TEST_SECRET);
    const readOnly = await ctx.staging(`/stats?preview=${token}`, { auth: null });
    assert.equal(readOnly.statusCode, 403);

    const empty = await ctx.staging('/stats?period=nimporte');
    assert.equal(empty.statusCode, 200);
    assert.match(empty.headers['content-type'], /text\/html/);
    assert.equal(empty.headers['x-robots-tag'], 'noindex, nofollow');
    assert.match(empty.body, /href="\/stats\?period=today" aria-current="page"/);
    assert.match(empty.body, /Aucun lien prospect visité/);
    assert.match(empty.body, /Bots &amp; Scanners écartés/);
    assert.ok(!/<script[^>]+src=|<link[^>]+stylesheet|fonts\.googleapis/.test(empty.body), 'no third-party resource');
    assert.equal(ctx.stagingEvents().length, 0, '/stats is never counted as a visit');
  } finally {
    ctx.cleanup();
  }
});

test('stats prod: sdrnow.fr/stats?period=7d (admin) shows the production log, noindex, no-store, not counted as a visit', async () => {
  const ctx = setupTracking();
  try {
    await ctx.prod('/pour/acme');
    await ctx.prod('/assets/logo.svg');
    await ctx.prod('/pour/acme', { ip: TEST_IPS[2], ua: MAC_UA });
    await ctx.prod('/assets/logo.svg', { ip: TEST_IPS[2], ua: MAC_UA });
    const before = ctx.events().length;
    for (const host of ['sdrnow.fr', 'www.sdrnow.fr']) {
      const page = await ctx.prodStats('/stats?period=7d', { headers: { Host: host, ...adminHeaders() } });
      assert.equal(page.statusCode, 200, host);
      assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
      assert.equal(page.headers['cache-control'], 'no-store');
      assert.equal(page.headers['set-cookie'], undefined);
      assert.match(page.body, /Données affichées : Prod — sdrnow\.fr/);
      assert.match(page.body, /href="https:\/\/staging\.sdrnow\.fr\/stats">Voir Staging — visites de test/);
      assert.match(page.body, /href="\/stats\?period=7d" aria-current="page"/);
      assert.match(page.body, /acme/);
      assert.match(page.body, /🔥 2 appareils \(Partage interne\)/);
      assert.match(page.body, /🛡 Adblock \/ Sans JS/);
      assert.match(page.body, /N\/A \(Sans JS\)/);
      assert.ok(!page.body.includes('👤'), 'production stays anonymous: no tester');
    }
    assert.equal((await ctx.prodStats('/stats/', { headers: adminHeaders() })).statusCode, 200);
    assert.equal((await ctx.prodStats('/stats', { method: 'HEAD', headers: adminHeaders() })).statusCode, 200);
    assert.equal(ctx.events().length, before, 'stats requests are never logged as visits');
    assert.ok(ctx.events().every((e) => !('tester' in e)), 'no tester field in analytics.jsonl');
  } finally {
    ctx.cleanup();
  }
});

test('stats prod: without / with bad credentials -> 401 + WWW-Authenticate; 11th failure per minute and IP -> 429', async () => {
  const ctx = setupTracking();
  try {
    const bare = await ctx.prodStats('/stats');
    assert.equal(bare.statusCode, 401);
    assert.match(bare.headers['www-authenticate'], /^Basic realm=/);
    assert.equal(bare.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(bare.headers['cache-control'], 'no-store');
    assert.ok(!bare.body.includes('acme'));
    const bad = { Authorization: `Basic ${Buffer.from('admin:wrong').toString('base64')}` };
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await ctx.prodStats('/stats', { headers: bad })).statusCode);
    assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
    // Locked for the rest of the minute, even with the right password; other IPs unaffected
    assert.equal((await ctx.prodStats('/stats', { headers: adminHeaders() })).statusCode, 429);
    assert.equal((await ctx.prodStats('/api/stats/export', { headers: bad })).statusCode, 429);
    assert.equal((await ctx.prodStats('/stats', { ip: TEST_IPS[1], headers: adminHeaders() })).statusCode, 200);
    ctx.clock += 61000;
    assert.equal((await ctx.prodStats('/stats', { headers: adminHeaders() })).statusCode, 200);
    assert.equal(ctx.events().length, 0, 'auth attempts are not visits');
  } finally {
    ctx.cleanup();
  }
});

test('stats prod: the failed-login window is anchored on the first failure (no 20 guesses across a window boundary)', async () => {
  const ctx = setupTracking();
  try {
    const bad = { Authorization: `Basic ${Buffer.from('admin:wrong').toString('base64')}` };
    // A request without credentials (or a successful one) at t0 must not open the window
    assert.equal((await ctx.prodStats('/stats')).statusCode, 401);
    assert.equal((await ctx.prodStats('/stats', { headers: adminHeaders() })).statusCode, 200);
    ctx.clock += 59000;
    for (let i = 0; i < 10; i++) assert.equal((await ctx.prodStats('/stats', { headers: bad })).statusCode, 401);
    ctx.clock += 1100; // past t0 + 60 s, but 1.1 s after the first failure
    assert.equal((await ctx.prodStats('/stats', { headers: bad })).statusCode, 429);
    // The window expires 60 s after the first failure
    ctx.clock += 59000;
    assert.equal((await ctx.prodStats('/stats', { headers: adminHeaders() })).statusCode, 200);
  } finally {
    ctx.cleanup();
  }
});

test('staging log defaults next to an injected analyticsFile, never the real /etc/sdrnow file', async () => {
  const { baseTmp, stagingDir, prodDir } = setupTestDirs();
  const analyticsFile = path.join(baseTmp, 'logs', 'analytics.jsonl');
  try {
    const handler = createRequestHandler({
      stagingDir, prodDir, adminUser: TEST_ADMIN_USER, adminPassSha256: TEST_ADMIN_PASS_SHA256, secret: TEST_SECRET, analyticsFile,
    });
    const res = await mockRequest(handler, '/', { headers: { Host: 'staging.sdrnow.fr', 'User-Agent': IPHONE_UA, ...adminHeaders() } });
    assert.equal(res.statusCode, 200);
    const sibling = path.join(baseTmp, 'logs', 'analytics-staging.jsonl');
    assert.equal(JSON.parse(fs.readFileSync(sibling, 'utf8').trim()).tester, 'admin');
    assert.equal(fs.existsSync(analyticsFile), false);
  } finally {
    cleanupDirs(baseTmp);
  }
});

test('export prod: sdrnow.fr/api/stats/export streams analytics.jsonl as an attachment (admin), 401 without auth', async () => {
  const ctx = setupTracking();
  try {
    const missing = await ctx.prodStats('/api/stats/export', { headers: adminHeaders() });
    assert.equal(missing.statusCode, 200);
    assert.equal(missing.body, '');
    await ctx.prod('/pour/acme');
    const res = await ctx.prodStats('/api/stats/export', { headers: adminHeaders() });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-disposition'], /^attachment; filename="analytics\.jsonl"$/);
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(res.body, fs.readFileSync(ctx.analyticsFile, 'utf8'));
    const anon = await ctx.prodStats('/api/stats/export');
    assert.equal(anon.statusCode, 401);
    assert.equal(anon.body, '401 Unauthorized');
    // Staging export only ever returns the staging log
    const staging = await ctx.staging('/api/stats/export');
    assert.equal(staging.statusCode, 200);
    assert.match(staging.headers['content-disposition'], /filename="analytics-staging\.jsonl"/);
    assert.equal(staging.body, '');
    const token = computePreviewToken(ctx.stagingDir, TEST_SECRET);
    assert.equal((await ctx.staging(`/api/stats/export?preview=${token}`, { auth: null })).statusCode, 403);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: after a restart, /stats figures are rebuilt from analytics.jsonl', async () => {
  const ctx = setupTracking();
  try {
    await ctx.prod('/pour/acme');
    await ctx.prod('/assets/logo.svg');
    await ctx.prod('/', { ip: TEST_IPS[3], ua: MAC_UA });
    await ctx.prod('/assets/logo.svg', { ip: TEST_IPS[3], ua: MAC_UA });
    ctx.tracker.stopTimers();
    const restarted = ctx.makeTracker();
    ctx.handler = ctx.makeHandler(restarted);
    const page = await ctx.prodStats('/stats', { headers: adminHeaders() });
    assert.match(page.body, /acme/);
    const stats = restarted.stats('today');
    assert.equal(stats.prospects.length, 1);
    assert.equal(stats.humans, 1);
    assert.equal(stats.adblock, 1);
    restarted.stopTimers();
  } finally {
    ctx.cleanup();
  }
});

test('staging test visit: admin opens /pour/acme + logo + POST /health -> analytics-staging.jsonl, tier 3, tester admin; nothing in prod', async () => {
  const ctx = setupTracking();
  try {
    const page = await ctx.staging('/pour/acme');
    assert.equal(page.statusCode, 200);
    assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
    assert.ok(page.body.includes('<script src="/__editor.js"></script>'), 'same staging page as /, editor included for admin');
    const logo = await ctx.staging('/assets/logo.svg');
    assert.equal(logo.statusCode, 200);
    assert.equal(logo.headers['cache-control'], 'no-cache');
    assert.ok(logo.headers.etag);
    assert.equal((await ctx.staging('/assets/logo.svg', { headers: { 'If-None-Match': logo.headers.etag } })).statusCode, 304);
    const health = await ctx.staging('/health', { method: 'POST', body: { e: 'init', p: '/pour/acme' } });
    assert.equal(health.statusCode, 204);
    assert.equal((await ctx.staging('/health', { method: 'POST', body: { e: 'nope' } })).statusCode, 400);

    const evs = ctx.stagingEvents();
    assert.deepEqual(evs.map((e) => e.event), ['pageview', 'render', 'init']);
    assert.ok(evs.every((e) => e.slug === 'acme' && e.tester === 'admin'));
    assert.equal(evs.at(-1).tier, 3);
    assert.equal(fs.existsSync(ctx.analyticsFile), false, 'nothing in analytics.jsonl');

    // Another Basic Auth user is recorded under its own name; HTML pages are logged too
    await ctx.staging('/en/', { auth: 'client', ip: TEST_IPS[1], ua: MAC_UA });
    const last = ctx.stagingEvents().at(-1);
    assert.deepEqual([last.event, last.target, last.tester, last.lang], ['pageview', '/en/', 'client', 'en']);
  } finally {
    ctx.cleanup();
  }
});

test('staging preview test: reviewer (preview cookie) opens / then /rdv/starter -> tester preview, 302 to the target', async () => {
  const ctx = setupTracking();
  try {
    const token = computePreviewToken(ctx.stagingDir, TEST_SECRET);
    const home = await ctx.staging('/', { auth: null, preview: token });
    assert.equal(home.statusCode, 200);
    assert.ok(!home.body.includes('/__editor.js'));
    const cta = await ctx.staging('/rdv/starter', { auth: null, preview: token });
    assert.equal(cta.statusCode, 302);
    assert.equal(cta.headers.location, CTA.starter);
    assert.equal(cta.headers['cache-control'], 'no-store');
    assert.deepEqual(ctx.stagingEvents().map((e) => [e.event, e.target, e.tester]), [
      ['pageview', '/', 'preview'],
      ['cta_click', 'starter', 'preview'],
    ]);
    assert.equal(fs.existsSync(ctx.analyticsFile), false);
  } finally {
    ctx.cleanup();
  }
});

test('staging unauthenticated: POST /health, GET /rdv/starter, prospect link and logo -> 401, nothing logged', async () => {
  const ctx = setupTracking();
  try {
    for (const [url, opts] of [
      ['/health', { method: 'POST', body: { e: 'init' } }],
      ['/rdv/starter', {}],
      ['/en/book/discovery', {}],
      ['/pour/acme', {}],
      ['/assets/logo.svg', {}],
      ['/', {}],
    ]) {
      const res = await ctx.staging(url, { auth: null, ...opts });
      assert.equal(res.statusCode, 401, url);
      assert.match(res.headers['www-authenticate'], /^Basic realm=/);
    }
    const bad = await ctx.staging('/rdv/starter', { auth: null, headers: { Authorization: `Basic ${Buffer.from('admin:nope').toString('base64')}` } });
    assert.equal(bad.statusCode, 401);
    assert.equal(fs.existsSync(ctx.stagingAnalyticsFile), false);
    assert.equal(fs.existsSync(ctx.analyticsFile), false);
  } finally {
    ctx.cleanup();
  }
});

test('stats staging: staging.sdrnow.fr/stats shows only the staging test log with testers; each /stats shows only its own site', async () => {
  const ctx = setupTracking();
  try {
    // Staging: admin tests a prospect link, a reviewer and an admin browse the home page
    await ctx.staging('/pour/staging-only');
    await ctx.staging('/assets/logo.svg');
    const token = computePreviewToken(ctx.stagingDir, TEST_SECRET);
    await ctx.staging('/', { auth: null, preview: token, ip: TEST_IPS[1] });
    await ctx.staging('/assets/logo.svg', { auth: null, preview: token, ip: TEST_IPS[1] });
    await ctx.staging('/', { ip: TEST_IPS[2], ua: MAC_UA });
    await ctx.staging('/assets/logo.svg', { ip: TEST_IPS[2], ua: MAC_UA });
    // Prod: a real prospect
    await ctx.prod('/pour/prod-only');
    await ctx.prod('/assets/logo.svg');

    const staging = await ctx.staging('/stats');
    assert.equal(staging.statusCode, 200);
    assert.equal(staging.headers['cache-control'], 'no-store');
    assert.match(staging.body, /Données affichées : Staging — visites de test/);
    assert.match(staging.body, /href="https:\/\/sdrnow\.fr\/stats">Voir Prod — sdrnow\.fr/);
    assert.match(staging.body, /staging-only/);
    assert.ok(!staging.body.includes('prod-only'), 'no production visit on the staging page');
    assert.match(staging.body, /👤 admin<\/span>/, 'tester shown in the radar');
    assert.match(staging.body, /👤 admin ×1 • preview ×1/, 'testers under the visitors KPI');
    assert.match(staging.body, /https:\/\/staging\.sdrnow\.fr\/pour\//, 'link generator targets staging');

    const prod = await ctx.prodStats('/stats', { headers: adminHeaders() });
    assert.match(prod.body, /prod-only/);
    assert.ok(!prod.body.includes('staging-only'), 'no staging visit on the production page');
    assert.ok(!prod.body.includes('👤'));
    assert.match(prod.body, /https:\/\/sdrnow\.fr\/pour\//);

    const token2 = computePreviewToken(ctx.stagingDir, TEST_SECRET);
    assert.equal((await ctx.staging(`/stats?preview=${token2}`, { auth: null })).statusCode, 403);
    assert.equal((await ctx.staging('/stats', { auth: null })).statusCode, 401);
  } finally {
    ctx.cleanup();
  }
});

test('alert staging: test visit on /pour/acme, 120 s idle -> one Mailpit send per recipient, [STAGING] prefix, tag staging, never TEM', async () => {
  const ctx = setupTracking();
  try {
    await ctx.staging('/pour/acme');
    await ctx.staging('/assets/logo.svg');
    await ctx.staging('/health', { method: 'POST', body: { e: 'init', p: '/pour/acme' } });
    assert.equal(ctx.stagingTracker.hasPendingAlert('acme'), true, 'alert timer armed on staging');
    await sleep(90); // > debounce (40 ms, stands for 120 s)
    await ctx.idle();
    assert.equal(ctx.sent.length, 0, 'TEM is never called from staging');
    assert.equal(ctx.mailpit.length, 2);
    assert.deepEqual(ctx.mailpit.map((m) => m.to).sort(), ['copie@example.fr', 'jcm@sdrnow.fr']);
    for (const m of ctx.mailpit) {
      assert.match(m.subject, /^\[STAGING\] 🔥 \[SDRnow\] acme vient de consulter votre offre/);
      assert.deepEqual(m.tags, ['staging']);
      assert.match(m.html, /href="https:\/\/staging\.sdrnow\.fr\/stats"/, 'staging alerts link to the staging stats');
    }
    const log = ctx.emailLog();
    assert.equal(log.length, 2);
    for (const l of log) {
      assert.equal(l.site, 'staging');
      assert.equal(l.kind, 'alert');
      assert.equal(l.ref, 'acme');
      assert.equal(l.transport, 'mailpit');
      assert.equal(l.ok, true);
      assert.equal(l.error, null);
      assert.match(l.id, /^mp-\d$/);
      assert.match(l.subject, /^\[STAGING\] 🔥/);
    }
    assert.equal(ctx.events().length, 0, 'nothing in the production log');
  } finally {
    ctx.cleanup();
  }
});

test('alert staging: Mailpit unreachable -> logged ok:false with the error, no crash', async () => {
  const ctx = setupTracking();
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    ctx.stagingTracker.stopTimers();
    ctx.stagingTracker = ctx.makeTracker({
      analyticsFile: ctx.stagingAnalyticsFile,
      site: 'staging',
      sendMailpit: (m) => sendMailpitEmail(m, {
        fetch: async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) }); },
      }),
    });
    ctx.handler = ctx.makeHandler(ctx.tracker, ctx.stagingTracker);
    await ctx.staging('/pour/acme');
    await ctx.staging('/assets/logo.svg');
    await sleep(90);
    await ctx.idle();
    const log = ctx.emailLog();
    assert.equal(log.length, 2);
    for (const l of log) {
      assert.equal(l.ok, false);
      assert.equal(l.transport, 'mailpit');
      assert.equal(l.id, null);
      assert.equal(l.error, 'fetch failed (ECONNREFUSED)');
    }
    assert.ok(errors.some((e) => e.startsWith('[Mailpit]') && e.includes('ECONNREFUSED')));
    assert.equal((await ctx.staging('/pour/acme')).statusCode, 200, 'staging keeps serving');
  } finally {
    console.error = original;
    ctx.cleanup();
  }
});

test('alert prod without TEM key: Mailpit capture tagged prod, no TEM call, send log site prod', async () => {
  // No sendEmail option and no TEM_SECRET_KEY in the test environment: TEM inactive
  const ctx = setupTracking({ sendEmail: undefined });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return { ok: true, json: async () => ({}) }; };
  try {
    assert.equal(ctx.tracker.temEnabled, false);
    await ctx.prod('/pour/acme');
    await ctx.prod('/assets/logo.svg');
    await sleep(90);
    await ctx.idle();
    assert.equal(fetchCalls, 0, 'no TEM HTTPS call');
    assert.equal(ctx.mailpit.length, 2);
    for (const m of ctx.mailpit) {
      assert.match(m.subject, /^🔥 \[SDRnow\] acme/, 'no [STAGING] prefix in prod');
      assert.deepEqual(m.tags, ['prod']);
    }
    const log = ctx.emailLog();
    assert.deepEqual(log.map((l) => [l.site, l.kind, l.ref, l.transport, l.ok]), [
      ['prod', 'alert', 'acme', 'mailpit', true], ['prod', 'alert', 'acme', 'mailpit', true],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    ctx.cleanup();
  }
});

test('alert prod with TEM key: TEM send (id logged) + Mailpit copy tagged prod,tem -> 2 lines per recipient', async () => {
  const tem = [];
  const ctx = setupTracking({
    sendEmail: async (m) => {
      tem.push(m);
      return `tem-${tem.length}`;
    },
  });
  try {
    assert.equal(ctx.tracker.temEnabled, true);
    await ctx.prod('/pour/acme');
    await ctx.prod('/assets/logo.svg');
    await sleep(90);
    await ctx.idle();
    assert.equal(tem.length, 2);
    assert.ok(tem.every((m) => m.tags === undefined), 'tags are a Mailpit-only field');
    assert.equal(ctx.mailpit.length, 2);
    for (const m of ctx.mailpit) assert.deepEqual(m.tags, ['prod', 'tem']);
    const log = ctx.emailLog();
    assert.equal(log.length, 4);
    for (const to of ['jcm@sdrnow.fr', 'copie@example.fr']) {
      const lines = log.filter((l) => l.to === to);
      assert.deepEqual(lines.map((l) => l.transport).sort(), ['mailpit', 'tem']);
      assert.match(lines.find((l) => l.transport === 'tem').id, /^tem-\d$/);
      assert.match(lines.find((l) => l.transport === 'mailpit').id, /^mp-\d$/);
      assert.ok(lines.every((l) => l.ok && l.site === 'prod'));
    }
  } finally {
    ctx.cleanup();
  }
});

test('digest staging: midnight rotation after >= 1 human test visit -> [STAGING] digest to Mailpit; quiet day -> no send, no line', async () => {
  const ctx = setupTracking();
  try {
    await ctx.staging('/');
    await ctx.staging('/assets/logo.svg');
    ctx.clock = Date.parse('2026-10-20T22:00:30Z'); // 00:00:30 Paris on Oct 21
    assert.equal(ctx.stagingTracker.rotateIfNeeded(), true);
    await ctx.idle();
    assert.equal(ctx.sent.length, 0, 'never TEM from staging');
    assert.equal(ctx.mailpit.length, 2);
    for (const m of ctx.mailpit) {
      assert.match(m.subject, /^\[STAGING\] 📊 \[SDRnow\] Bilan du 20 oct\. : 1 visiteur anonyme/);
      assert.deepEqual(m.tags, ['staging']);
    }
    assert.deepEqual(ctx.emailLog().map((l) => [l.site, l.kind, l.ref, l.transport, l.ok]), [
      ['staging', 'digest', '2026-10-20', 'mailpit', true], ['staging', 'digest', '2026-10-20', 'mailpit', true],
    ]);

    // Oct 21: no test visit at all
    ctx.clock = Date.parse('2026-10-21T22:00:30Z');
    assert.equal(ctx.stagingTracker.rotateIfNeeded(), true);
    await ctx.idle();
    assert.equal(ctx.mailpit.length, 2, 'no digest for a quiet day');
    assert.equal(ctx.emailLog().length, 2, 'no send-log line for a quiet day');
  } finally {
    ctx.cleanup();
  }
});

test('stats emails: each /stats shows the last 50 send-log lines of its own site, link to Mailpit; empty state without a log', async () => {
  const ctx = setupTracking();
  try {
    const empty = await ctx.prodStats('/stats', { headers: adminHeaders() });
    assert.equal(empty.statusCode, 200);
    assert.match(empty.body, /📬 3\. Emails envoyés/);
    assert.match(empty.body, /Aucun email envoyé pour l'instant depuis la prod/);
    assert.match(empty.body, /href="https:\/\/staging\.sdrnow\.fr\/mail\/"/);

    const line = (i, extra) => JSON.stringify({
      ts: new Date(Date.parse('2026-10-20T08:00:00Z') + i * 60000).toISOString(),
      site: 'prod', kind: 'alert', ref: 'acme', to: 'jcm@sdrnow.fr', subject: `prod-msg-${i}`,
      transport: 'mailpit', ok: true, error: null, id: `mp-${i}`, ...extra,
    });
    const lines = [];
    for (let i = 0; i < 60; i += 1) lines.push(line(i));
    lines.push(line(60, { site: 'staging', subject: '[STAGING] staging-msg', ref: '2026-10-19', kind: 'digest' }));
    lines.push(line(61, { transport: 'tem', ok: false, error: 'HTTP 500 boom', id: null, subject: 'prod-<script>-fail' }));
    lines.push('{corrupt');
    lines.push(line(62, { ts: 'pas-une-date', subject: 'bad-ts-line' }));
    fs.mkdirSync(path.dirname(ctx.emailLogFile), { recursive: true });
    fs.writeFileSync(ctx.emailLogFile, lines.join('\n') + '\n');

    const prod = await ctx.prodStats('/stats', { headers: adminHeaders() });
    assert.equal(prod.statusCode, 200, 'an invalid ts never breaks /stats');
    assert.ok(!prod.body.includes('bad-ts-line'), 'line with an invalid ts skipped');
    assert.ok(!prod.body.includes('staging-msg'), 'no staging line on the production page');
    assert.ok(prod.body.includes('prod-msg-59</td>'));
    // 61 production lines: the failed TEM line + prod-msg-11..59 are the last 50
    assert.ok(prod.body.includes('prod-msg-11</td>'));
    assert.ok(!prod.body.includes('prod-msg-10</td>'), 'only the last 50 lines of the site');
    assert.ok(prod.body.indexOf('prod-&lt;script&gt;-fail') < prod.body.indexOf('prod-msg-59</td>'), 'most recent first');
    assert.ok(!prod.body.includes('prod-<script>'), 'subject escaped');
    assert.match(prod.body, /❌ Échec/);
    assert.match(prod.body, /HTTP 500 boom/);
    assert.match(prod.body, /Scaleway TEM/);
    assert.match(prod.body, /✅ Envoyé/);

    const staging = await ctx.staging('/stats');
    assert.match(staging.body, /\[STAGING\] staging-msg/);
    assert.match(staging.body, /📊 Bilan/);
    assert.ok(!staging.body.includes('prod-msg-'), 'no production line on the staging page');
    assert.match(staging.body, /href="https:\/\/staging\.sdrnow\.fr\/mail\/"/);
    fs.writeFileSync(ctx.emailLogFile, lines.filter((l) => l !== '{corrupt').join('\n') + '\n'); // for the cleanup invariants
  } finally {
    ctx.cleanup();
  }
});

test('tracking: prod host is public static (no staging gate, no editor), and no response sets a cookie', async () => {
  const ctx = setupTracking();
  try {
    const home = await ctx.prod('/', { headers: adminHeaders() });
    assert.equal(home.statusCode, 200);
    assert.ok(!home.body.includes('/__editor.js'));
    assert.equal((await ctx.prod('/en/legal-notice/')).statusCode, 200);
    assert.equal((await ctx.prod('/translations.json')).statusCode, 200);
    assert.equal((await ctx.prod('/api/translations')).statusCode, 404);
    assert.equal((await ctx.prod('/api/staging', { method: 'POST', body: {} })).statusCode, 405);
    assert.equal((await ctx.prod('/../staging/index.html')).statusCode, 404);
    const www = await mockRequest(ctx.handler, '/pour/acme', { headers: { Host: 'www.sdrnow.fr:443', 'User-Agent': IPHONE_UA } });
    assert.equal(www.statusCode, 200);
    assert.equal(www.headers['set-cookie'], undefined);
    assert.ok(ctx.prodResponses.length > 3);
  } finally {
    ctx.cleanup();
  }
});

test('tracking: beacon in Layout.astro is < 1.5 KB, storage-free, and emits the CAP-4 events', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'layouts', 'Layout.astro'), 'utf8');
  const script = source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
  assert.ok(Buffer.byteLength(script) < 1536, `beacon is ${Buffer.byteLength(script)} bytes`);
  assert.ok(!/cookie|localStorage|sessionStorage|indexedDB/i.test(script));

  const sent = [];
  const listeners = {};
  let now = 1000;
  const el = (attrs, parents = []) => ({
    nodeType: 1,
    attrs,
    getAttribute: (k) => attrs[k],
    hasAttribute: (k) => k in attrs,
    closest(sel) {
      const chain = [this, ...parents];
      const match = (n) => {
        if (sel === 'a') return n.attrs.tag === 'a';
        if (sel === '[data-plan]') return 'data-plan' in n.attrs;
        if (sel === '[data-track=pricing]') return n.attrs['data-track'] === 'pricing';
        if (sel.startsWith('a[href^="tel:"]')) return n.attrs.tag === 'a' && /^(tel|mailto):/.test(n.attrs.href || '');
        return false;
      };
      return chain.find(match) || null;
    },
  });
  const pricing = el({ 'data-track': 'pricing' });
  const starterCard = el({ 'data-plan': 'starter' }, [pricing]);
  const priceText = { nodeType: 3, parentNode: el({}, [starterCard, pricing]) };
  const telLink = el({ tag: 'a', href: 'tel:0667902494' });
  const langLink = el({ tag: 'a', href: '/en', 'data-lang-switch': 'en' });
  const activeLangLink = el({ tag: 'a', href: '/', 'data-lang-switch': 'fr' });
  let observerCb;
  let intervalCb;
  const document = {
    documentElement: { lang: 'fr' },
    visibilityState: 'visible',
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: (sel) => (sel === '[data-track=pricing]' ? pricing : null),
  };
  const context = {
    document,
    navigator: { sendBeacon: (url, body) => { sent.push([url, JSON.parse(body)]); return true; } },
    location: { pathname: '/pour/acme' },
    Date: { now: () => now },
    addEventListener: (type, fn) => { listeners[`win:${type}`] = fn; },
    getSelection: () => ({ anchorNode: priceText }),
    IntersectionObserver: function (cb) { observerCb = cb; this.observe = () => {}; this.disconnect = () => {}; },
    fetch: () => { throw new Error('fetch should not be used when sendBeacon works'); },
    setInterval: (fn, ms) => { assert.equal(ms, 60000); intervalCb = fn; },
    JSON,
    Math,
  };
  context.window = context;
  vm.runInNewContext(script, context);

  observerCb([{ isIntersecting: true }]);
  listeners.copy();
  listeners.click({ target: telLink });
  listeners.click({ target: langLink });
  listeners.click({ target: activeLangLink }); // already the page language: no lang_switch
  listeners['win:beforeprint']();
  now += 60000;
  intervalCb(); // still reading: keep-alive ping every 60 s (delta seconds)
  now += 42000;
  document.visibilityState = 'hidden';
  listeners.visibilitychange();
  listeners['win:pagehide'](); // nothing more visible: no second ping

  assert.ok(sent.every(([url]) => url === '/health'));
  assert.deepEqual(sent.map(([, b]) => [b.e, b.t, b.d]), [
    ['init', '', 0],
    ['pricing_view', '', 0],
    ['copy', 'starter', 0],
    ['contact', 'phone', 0],
    ['lang_switch', 'en', 0],
    ['print', '', 0],
    ['ping', '', 60],
    ['ping', '', 42],
  ]);
  assert.ok(sent.every(([, b]) => Buffer.byteLength(JSON.stringify(b)) < 512));
});

test('tracking: a closing ping after the alert does not send a second, empty email', async () => {
  const ctx = setupTracking();
  try {
    await ctx.prod('/pour/acme');
    await ctx.prod('/assets/logo.svg');
    await ctx.health({ e: 'init', p: '/pour/acme' });
    await sleep(90);
    await ctx.tracker.whenIdle();
    assert.equal(ctx.sent.length, 2);
    await ctx.health({ e: 'ping', p: '/pour/acme', d: 30 });
    await sleep(90);
    await ctx.tracker.whenIdle();
    assert.equal(ctx.sent.length, 2, 'ping-only pending entry is not mailed');
    assert.equal(ctx.events().at(-1).duration, 30, 'the ping is still logged');
  } finally {
    ctx.cleanup();
  }
});

test('tracking: daily secret survives a same-day restart (tmpfs file 0600), visitors rebuilt; new secret the next day', async () => {
  const ctx = setupTracking();
  const secretFile = path.join(ctx.baseTmp, 'run-sdrnow', 'daily-secret.json');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  const trackers = [];
  const boot = () => {
    const t = ctx.makeTracker({ secretFile });
    trackers.push(t);
    ctx.handler = ctx.makeHandler(t);
    return t;
  };
  try {
    boot();
    await ctx.prod('/pour/acme');
    await ctx.prod('/assets/logo.svg');
    const before = ctx.events().at(-1);
    const saved = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
    assert.equal(saved.date, '2026-10-20');
    assert.equal(fs.statSync(secretFile).mode & 0o777, 0o600);

    trackers[0].stopTimers();
    boot(); // service restart, same day
    await ctx.prod('/en');
    const after = ctx.events().at(-1);
    assert.equal(after.anon_id, before.anon_id, 'same device keeps its anon_id after restart');
    assert.equal(after.slug, 'acme', 'prospect attribution rebuilt from analytics.jsonl');
    assert.equal(after.tier, 2, 'tier rebuilt from analytics.jsonl');
    assert.equal(trackers[1].stats('today').prospects[0].devices, 1, 'no false "2 appareils"');

    trackers[1].stopTimers();
    ctx.clock += 24 * 3600 * 1000;
    boot(); // next day: stale file ignored and overwritten
    await ctx.prod('/en');
    assert.notEqual(ctx.events().at(-1).anon_id, before.anon_id);
    assert.equal(JSON.parse(fs.readFileSync(secretFile, 'utf8')).date, '2026-10-21');
    assert.notEqual(JSON.parse(fs.readFileSync(secretFile, 'utf8')).secret, saved.secret);
  } finally {
    for (const t of trackers) t.stopTimers();
    ctx.cleanup();
  }
});

test('tracking: without a TEM key, the digest goes to Mailpit only (no TEM HTTPS call) and is logged', async () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tests', 'tmp-dormant-'));
  const analyticsFile = path.join(dir, 'analytics.jsonl');
  fs.writeFileSync(analyticsFile, JSON.stringify({
    ts: '2026-10-20T10:00:00.000Z', date: '2026-10-20', anon_id: 'a1b2c3d4', slug: null, tier: 3,
    event: 'init', target: null, duration: null, lang: 'fr', referer: null, ua_family: 'Mac (Chrome)',
  }) + '\n');
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({ ID: 'mp-1' }) }; };
  try {
    // No sendEmail / sendMailpit option and no TEM_SECRET_KEY in the test environment
    const tracker = createTracker({ analyticsFile, ctaTargets: CTA, alertRecipients: ['jcm@sdrnow.fr'], now: () => Date.parse('2026-10-20T12:00:00Z') });
    assert.equal(await tracker.sendDigest('2026-10-20'), true, 'the day had a human visitor');
    await tracker.whenIdle();
    assert.deepEqual(urls, ['http://127.0.0.1:8025/mail/api/v1/send'], 'Mailpit only, no TEM API call');
    // Send log next to the injected analytics file, never the real /etc/sdrnow one
    const log = fs.readFileSync(path.join(dir, 'email-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map((l) => [l.site, l.kind, l.ref, l.transport, l.ok, l.id]), [['prod', 'digest', '2026-10-20', 'mailpit', true, 'mp-1']]);
    tracker.stopTimers();
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
