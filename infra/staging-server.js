import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration & Defaults ---
const PORT = parseInt(process.env.PORT || '3001', 10);
const ADMIN_USER = process.env.ADMIN_USER || 'client,admin';
const ADMIN_PASS_SHA256 = process.env.ADMIN_PASS_SHA256 ||
  // Default: SHA-256 of "admin"
  '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';
const STAGING_PREVIEW_SECRET = process.env.STAGING_PREVIEW_SECRET || 'sdrnow-staging-preview-secret-key';
const GITHUB_PAT = process.env.GITHUB_PAT || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'sdrnow/sdrnow';
const STAGING_DIR = process.env.STAGING_DIR || '/var/www/staging';
const PROD_DIR = process.env.PROD_DIR || '/var/www/html';
const EDITOR_SCRIPT_PATH = process.env.EDITOR_SCRIPT_PATH || path.join(__dirname, 'editor-client.js');
// Cookieless tracking & Scaleway TEM (spec cookieless-server-tracking)
const ANALYTICS_FILE = process.env.ANALYTICS_FILE || '/etc/sdrnow/analytics.jsonl';
// Test visits of staging.sdrnow.fr: separate log, never mixed with production
const STAGING_ANALYTICS_FILE = process.env.STAGING_ANALYTICS_FILE || '/etc/sdrnow/analytics-staging.jsonl';
const TEM_SECRET_KEY = process.env.TEM_SECRET_KEY || '';
const TEM_PROJECT_ID = process.env.SCW_DEFAULT_PROJECT_ID || '';
const TEM_REGION = process.env.TEM_REGION || 'fr-par';
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || 'jcm@sdrnow.fr';
const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM || 'alertes@sdrnow.fr';
const STATS_URL = process.env.STATS_URL || 'https://sdrnow.fr/stats';
// Mailpit (shared capture instance on the VM, never delivers anything): Send API reached by
// Node directly on the loopback; its UI is served behind the admin password on staging.
const MAILPIT_URL = (process.env.MAILPIT_URL || 'http://127.0.0.1:8025/mail').replace(/\/+$/, '');
const MAILPIT_UI_URL = 'https://staging.sdrnow.fr/mail/';
// Append-only send log (one line per attempt and per transport), shown on each <site>/stats
const EMAIL_LOG_FILE = process.env.EMAIL_LOG_FILE || '/etc/sdrnow/email-log.jsonl';
const EMAIL_LOG_STATS_LIMIT = 50;

// --- Helper Utilities ---

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function getRevision(stagingDir = STAGING_DIR) {
  const revFile = path.join(stagingDir, '.revision');
  try {
    if (fs.existsSync(revFile)) {
      const val = parseInt(fs.readFileSync(revFile, 'utf8').trim(), 10);
      if (!Number.isNaN(val)) return val;
    }
  } catch (err) {
    console.error('Error reading .revision:', err);
  }
  return 1;
}

export function incrementRevision(stagingDir = STAGING_DIR) {
  const current = getRevision(stagingDir);
  const next = current + 1;
  const revFile = path.join(stagingDir, '.revision');
  atomicWriteFileSync(revFile, String(next));
  return next;
}

export function computePreviewToken(stagingDir = STAGING_DIR, secret = STAGING_PREVIEW_SECRET) {
  const revision = getRevision(stagingDir);
  const transPath = path.join(stagingDir, 'translations.json');
  let content = '{}';
  try {
    if (fs.existsSync(transPath)) {
      content = fs.readFileSync(transPath, 'utf8');
    }
  } catch (err) {
    console.error('Error reading translations.json for token:', err);
  }
  const transHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  return crypto
    .createHmac('sha256', secret)
    .update(`${revision}:${transHash}`)
    .digest('hex');
}

// --- Sanitization & Validation (AD-8) ---

// Emphasis formatting model (P2/P3). Tokens hold DECODED characters (what the browser
// exposes as text node values): htmlToTokens decodes entities, tokensToHtml escapes them.
// These functions only reference each other and JS built-ins: they are also served verbatim
// to the browser through EMPHASIS_MODEL_PRELUDE (see buildEmphasisModelPrelude).
// Whitespace is JS `\s` everywhere, which includes U+00A0 (&nbsp;): it is pushed out of <em>.

export function decodeHtmlEntities(text) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
    laquo: '\u00ab', raquo: '\u00bb', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', euro: '\u20ac',
    copy: '\u00a9', reg: '\u00ae', eacute: '\u00e9', egrave: '\u00e8', ecirc: '\u00ea',
    agrave: '\u00e0', acirc: '\u00e2', ccedil: '\u00e7', ocirc: '\u00f4', ucirc: '\u00fb',
    ugrave: '\u00f9', icirc: '\u00ee', iuml: '\u00ef', euml: '\u00eb', Eacute: '\u00c9',
  };
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (entity, dec, hex, name) => {
    if (name !== undefined) {
      return Object.prototype.hasOwnProperty.call(named, name) ? named[name] : entity;
    }
    const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    // Same replacement as the browser for NUL, surrogates and out-of-range code points
    if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(code);
  });
}

export function escapeHtmlText(text) {
  // Mirrors the browser's innerHTML serialization of text nodes
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&nbsp;');
}

// Server-only (not part of the browser model): safe in text AND in quoted attribute values
export function escapeHtmlAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function htmlToTokens(html) {
  if (typeof html !== 'string' || !html) return [];
  const tokens = [];
  // Comments (dropped, an unterminated one runs to the end) or a well-formed tag:
  // `<name ...>` / `</name ...>`, quoted attribute values may contain `>`.
  // Any other `<` (e.g. `a < b`, `<img src=x` without `>`) stays plain text.
  const tagRegex = /<!--[\s\S]*?(?:-->|$)|<(\/)?([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  let lastIndex = 0;
  let emDepth = 0;
  let match;

  function pushText(raw) {
    const text = decodeHtmlEntities(raw);
    for (let i = 0; i < text.length; i++) {
      tokens.push({ ch: text[i], em: emDepth > 0 });
    }
  }

  while ((match = tagRegex.exec(html)) !== null) {
    pushText(html.slice(lastIndex, match.index));
    lastIndex = tagRegex.lastIndex;
    if (match[2] === undefined) continue; // comment

    const isClosing = Boolean(match[1]);
    const tagName = match[2].toLowerCase();

    if (tagName === 'br') {
      tokens.push({ br: true });
    } else if (['em', 'strong', 'b', 'i'].includes(tagName)) {
      if (isClosing) {
        emDepth = Math.max(0, emDepth - 1);
      } else {
        emDepth++;
      }
    }
  }

  pushText(html.slice(lastIndex));

  return tokens;
}

export function tokensToHtml(tokens) {
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

  let html = '';
  for (const run of runs) {
    const text = run.chars.join('');
    if (!run.em) {
      html += escapeHtmlText(text);
    } else {
      const matchLeading = text.match(/^\s*/)[0];
      const matchTrailing = text.slice(matchLeading.length).match(/\s*$/)[0];
      const core = text.slice(matchLeading.length, text.length - matchTrailing.length);

      if (core.length === 0) {
        html += escapeHtmlText(text);
      } else {
        html += escapeHtmlText(matchLeading) + '<em>' + escapeHtmlText(core) + '</em>' + escapeHtmlText(matchTrailing);
      }
    }
  }

  return html;
}

export function applyTokensFormat(tokens, start, end, isEmphasis) {
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

// Single source of truth for the browser: the pure model above is serialized with
// fn.toString() and prepended to /__editor.js, which reads window.__sdrnowEmphasisModel.
export function buildEmphasisModelPrelude() {
  const fns = [decodeHtmlEntities, escapeHtmlText, htmlToTokens, renderTokensLine, tokensToHtml, applyTokensFormat];
  return [
    '// --- SDRnow emphasis model (generated from infra/staging-server.js, do not edit) ---',
    '(function () {',
    "  'use strict';",
    ...fns.map((fn) => fn.toString()),
    `  window.__sdrnowEmphasisModel = Object.freeze({ ${fns.map((fn) => fn.name).join(', ')} });`,
    '})();',
    '',
  ].join('\n');
}

const EMPHASIS_MODEL_PRELUDE = buildEmphasisModelPrelude();

export function sanitizeValue(rawVal, type) {
  if (typeof rawVal !== 'string') return '';
  if (type === 'plain') {
    // Plain values are text, not HTML (the editor sends textContent, Astro renders {t()} escaped,
    // patchHtmlContent escapes them): entities are NOT decoded, so « R&D » stays R&D.
    // Tag-like sequences are still dropped and line breaks become a single space.
    return rawVal
      .replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?\/?>/g, '')
      .replace(/[\r\n]+/g, ' ')
      .trim();
  }
  // Rich:
  // 1. <strong>, <b>, <i> (with or without attributes) -> <em>
  // 2. Strip any tags other than <em>, <br>; strip attributes
  // 3. Normalize: unnest <em>, merge contiguous <em>, remove empty or spaces-only <em>
  // 4. Trim leading/trailing whitespace on decoded characters (so &nbsp; is trimmed too)
  const tokens = htmlToTokens(rawVal);
  let s = 0;
  let e = tokens.length;
  while (s < e && !tokens[s].br && /\s/.test(tokens[s].ch)) s++;
  while (e > s && !tokens[e - 1].br && /\s/.test(tokens[e - 1].ch)) e--;
  return tokensToHtml(tokens.slice(s, e));
}

// A value is blank when it has no visible character: tags, <br>, spaces and &nbsp; do not count
export function isBlankValue(value, type) {
  if (typeof value !== 'string') return true;
  if (type === 'plain') return value.trim().length === 0;
  return htmlToTokens(value).every((t) => t.br || /\s/.test(t.ch));
}

export function validateAndSanitizePayload(body, schema) {
  if (!body || typeof body !== 'object' || !body.fr || !body.en) {
    return { error: 'invalid_payload', message: 'Payload must contain fr and en objects' };
  }

  const sanitized = { fr: {}, en: {} };

  for (const lang of ['fr', 'en']) {
    const dict = body[lang];
    if (typeof dict !== 'object' || dict === null) {
      return { error: 'invalid_payload', message: `Language ${lang} must be an object` };
    }

    for (const [key, val] of Object.entries(dict)) {
      const fieldDef = schema[key];
      if (!fieldDef) {
        return { error: 'unknown_key', message: `Key "${key}" is not in schema` };
      }

      const cleanVal = sanitizeValue(val, fieldDef.type);

      if (!fieldDef.optional && isBlankValue(cleanVal, fieldDef.type)) {
        return { error: 'empty_required_field', message: `Field "${key}" (${lang}) cannot be empty` };
      }

      sanitized[lang][key] = cleanVal;
    }
  }

  return { sanitized };
}

// --- HTML Patching (<10ms) ---

export function patchHtmlContent(html, dict) {
  let patched = html;
  // Plain values are decoded text and must be escaped; rich values are already sanitized HTML.
  // Title and meta are always plain; an element is rich only if it says data-i18n-type="rich".
  const isRichAttrs = (attrs) => /\bdata-i18n-type=["']rich["']/i.test(attrs);

  for (const [key, val] of Object.entries(dict)) {
    const escapedKey = escapeRegex(key);

    // 1. Meta content: <meta ... data-i18n-content="key" ...>
    if (key === 'meta.description') {
      const metaRegex = new RegExp(`<meta([^>]*\\bdata-i18n-content=["']${escapedKey}["'][^>]*)>`, 'gi');
      patched = patched.replace(metaRegex, (match, attrs) => {
        const escapedVal = escapeHtmlText(val).replace(/"/g, '&quot;');
        let newAttrs;
        if (/\bcontent=(["'])[\s\S]*?\1/i.test(attrs)) {
          newAttrs = attrs.replace(/\bcontent=(["'])[\s\S]*?\1/i, () => `content="${escapedVal}"`);
        } else {
          newAttrs = `${attrs} content="${escapedVal}"`;
        }
        return `<meta${newAttrs}>`;
      });
    }

    // 2. Title: <title ... data-i18n="key" ...>...</title>
    if (key.startsWith('meta.')) {
      const titleRegex = new RegExp(`<title([^>]*\\bdata-i18n=["']${escapedKey}["'][^>]*)>[\\s\\S]*?<\\/title>`, 'gi');
      patched = patched.replace(titleRegex, (match, attrs) => `<title${attrs}>${escapeHtmlText(val)}</title>`);
    }

    // 3. Regular elements: <tag ... data-i18n="key" ...>...</tag>
    const elRegex = new RegExp(`<([a-zA-Z0-9]+)([^>]*\\bdata-i18n=["']${escapedKey}["'][^>]*)>[\\s\\S]*?<\\/\\1>`, 'gi');
    patched = patched.replace(elRegex, (match, tag, attrs) => `<${tag}${attrs}>${isRichAttrs(attrs) ? val : escapeHtmlText(val)}</${tag}>`);
  }

  return patched;
}

export function patchCompiledFiles(targetDir, translations) {
  const targets = [
    { file: 'index.html', dict: translations.fr },
    { file: 'en/index.html', dict: translations.en },
    { file: 'mentions-legales/index.html', dict: translations.fr },
    { file: 'en/legal-notice/index.html', dict: translations.en },
  ];

  for (const target of targets) {
    const filePath = path.join(targetDir, target.file);
    if (fs.existsSync(filePath)) {
      const html = fs.readFileSync(filePath, 'utf8');
      const patched = patchHtmlContent(html, target.dict);
      atomicWriteFileSync(filePath, patched);
    }
  }
}

// --- Asynchronous Sequential Git Mutex Queue (AD-6) ---

let gitQueue = Promise.resolve();

export function queueGitSync(fn) {
  gitQueue = gitQueue
    .then(() => fn())
    .catch((err) => {
      console.error('Git sync worker error:', err);
    });
}

async function commitTranslationFile(branch, contentJsonStr) {
  if (!GITHUB_PAT || !GITHUB_REPO) {
    console.log(`[GitSync] GITHUB_PAT or GITHUB_REPO not set. Skipping push to branch ${branch}.`);
    return;
  }

  const filePath = 'src/i18n/translations.json';
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=${branch}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_PAT}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'sdrnow-staging-server',
    'Content-Type': 'application/json',
  };

  async function getSha() {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      return data.sha;
    }
    return null;
  }

  async function putFile(sha) {
    const putUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
    const body = {
      message: 'chore(i18n): update translations [skip ci]',
      content: Buffer.from(contentJsonStr, 'utf8').toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;

    return fetch(putUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
  }

  let sha = await getSha();
  let putRes = await putFile(sha);

  if (putRes.status === 409) {
    console.log(`[GitSync] 409 Conflict on ${branch}. Retrying once with refreshed SHA...`);
    sha = await getSha();
    putRes = await putFile(sha);
  }

  if (!putRes.ok) {
    const errText = await putRes.text();
    console.error(`[GitSync] Failed to commit on ${branch}: ${putRes.status} ${errText}`);
  } else {
    console.log(`[GitSync] Successfully committed translations [skip ci] on ${branch}`);
  }
}

// --- Expired Preview Gate HTML Page (DESIGN.md / EXPERIENCE.md) ---

function getExpiredPreviewHtml() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lien de prévisualisation expiré - SDRnow</title>
  <link rel="icon" type="image/svg+xml" href="/assets/logo.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #F9FAFB;
      color: #111827;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 10px;
      max-width: 440px;
      width: 100%;
      padding: 32px 24px;
      text-align: center;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
    }
    .logo {
      height: 36px;
      margin: 0 auto 24px;
      display: block;
    }
    .icon-badge {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #FFF3ED;
      color: #F26522;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 22px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 12px;
      line-height: 1.3;
    }
    p {
      font-size: 14px;
      color: #4B5563;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="card">
    <img src="/assets/logo.svg" alt="SDRnow" class="logo">
    <div class="icon-badge">⏳</div>
    <h1>Lien de prévisualisation expiré</h1>
    <p>Ce lien d'aperçu a expiré car une nouvelle version est en cours de test. Demandez le nouveau lien à Jean-Charles.</p>
  </div>
</body>
</html>`;
}

// --- Request Body Reader ---

function readBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => {
      const err = new Error('Payload too large');
      err.code = 'PAYLOAD_TOO_LARGE';
      return err;
    };
    const declared = parseInt(req.headers?.['content-length'] || '', 10);
    if (!Number.isNaN(declared) && declared > maxBytes) {
      req.resume();
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      if (overflow) return; // drain the rest so the response can still be written
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        overflow = true;
        reject(tooLarge());
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (!overflow) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// =====================================================================
// --- Cookieless Server-Side Tracking (spec cookieless-server-tracking) ---
// Zero cookie / browser storage: a visitor is a daily anon_id = HMAC(daily_secret, ip|ua),
// the secret lives in RAM only and rotates at 00:00 Europe/Paris. Raw IPs are never stored.
// =====================================================================

const PROD_HOSTS = new Set(['sdrnow.fr', 'www.sdrnow.fr']);
const PARIS_TZ = 'Europe/Paris';
const SLUG_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const DEFAULT_CTA_TARGET = 'https://calendly.com/jc-maleysson/30min';
const CTA_ALIASES = { decouverte: 'hero', discovery: 'hero' };
const BOT_UA_RE = /bot|crawl|spider|slurp|linkedinbot|slackbot|whatsapp|facebot|twitterbot|telegrambot|discordbot|applebot|bingpreview|headlesschrome|lighthouse|curl|wget|python|go-http-client|safelinks|mimecast|urlscan/i;
const HEALTH_EVENTS = new Set(['init', 'pricing_view', 'copy', 'contact', 'lang_switch', 'print', 'ping']);
const HEALTH_MAX_BYTES = 512;
const HEALTH_RATE_LIMIT_PER_MIN = 30;
const SESSION_GAP_MS = 30 * 60 * 1000;
const MAX_VISITORS_IN_RAM = 50000;
const MAX_PENDING_EVENTS_PER_SLUG = 500;
const MAX_PENDING_SLUGS = 2000;

// Prod HTML pages served (and counted) by Node; anything else on the prod host is static only
const PROD_PAGES = {
  '/': 'index.html',
  '/en': 'en/index.html',
  '/en/': 'en/index.html',
  '/mentions-legales': 'mentions-legales/index.html',
  '/mentions-legales/': 'mentions-legales/index.html',
  '/en/legal-notice': 'en/legal-notice/index.html',
  '/en/legal-notice/': 'en/legal-notice/index.html',
};
const PROSPECT_ROUTE_RE = /^\/(pour|offre|en\/for|en\/offer)\/([^/]+)\/?$/;
const CTA_ROUTE_RE = /^\/(rdv|en\/book)\/([^/]+)\/?$/;
const WITNESS_ASSET = '/assets/logo.svg';
const LEGAL_PATH_RE = /^\/(mentions-legales|en\/legal-notice)\/?$/;
// Production stats routes (Basic Auth admin, never counted as visits)
const PROD_STATS_PATHS = new Set(['/stats', '/stats/', '/api/stats/export']);
const PROD_STATS_MAX_AUTH_FAILURES = 10; // per minute and per IP, then 429

export function getCtaTargets(env = process.env) {
  const targets = { hero: DEFAULT_CTA_TARGET, starter: DEFAULT_CTA_TARGET, strategy: DEFAULT_CTA_TARGET };
  for (const [name, value] of Object.entries(env)) {
    const m = /^CTA_TARGET_([A-Z0-9_]+)$/.exec(name);
    if (m && typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim())) {
      targets[m[1].toLowerCase().replace(/_/g, '-')] = value.trim();
    }
  }
  return targets;
}

export function parseRecipients(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((r) => String(r).trim()).filter((r) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(r)))];
}

export function classifyUa(ua) {
  if (typeof ua !== 'string' || !ua.trim()) return 'bot';
  return BOT_UA_RE.test(ua) ? 'bot' : 'human';
}

export function uaFamily(ua) {
  const s = typeof ua === 'string' ? ua : '';
  if (classifyUa(s) === 'bot') {
    const names = [
      ['LinkedInBot', /linkedinbot/i], ['Slackbot', /slackbot/i], ['WhatsApp', /whatsapp/i],
      ['Facebook', /facebot|facebookexternalhit/i], ['Twitter', /twitterbot/i], ['Telegram', /telegrambot/i],
      ['Discord', /discordbot/i], ['Applebot', /applebot/i], ['Googlebot', /googlebot/i], ['Bingbot', /bingbot|bingpreview/i],
      ['SafeLinks', /safelinks/i], ['Mimecast', /mimecast/i], ['urlscan', /urlscan/i], ['Lighthouse', /lighthouse/i],
      ['Headless Chrome', /headlesschrome/i], ['Script', /curl|wget|python|go-http-client/i],
    ];
    const found = names.find(([, re]) => re.test(s));
    return found ? `Robot (${found[0]})` : 'Robot';
  }
  let device = 'Autre';
  if (/iPhone/.test(s)) device = 'iPhone';
  else if (/iPad/.test(s)) device = 'iPad';
  else if (/Android/.test(s)) device = 'Android';
  else if (/Windows/.test(s)) device = 'Windows';
  else if (/Macintosh|Mac OS X/.test(s)) device = 'Mac';
  else if (/CrOS/.test(s)) device = 'Chromebook';
  else if (/Linux/.test(s)) device = 'Linux';
  let browser = '';
  if (/Edg(e|A|iOS)?\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/Firefox\/|FxiOS/.test(s)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';
  return browser ? `${device} (${browser})` : device;
}

// Real client IP: Caddy overwrites X-Forwarded-For for untrusted clients, first value wins
export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

function getHostname(req) {
  return String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

export function isProdHost(req) {
  return PROD_HOSTS.has(getHostname(req));
}

const PARIS_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARIS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function parisParts(ms) {
  const parts = {};
  for (const p of PARIS_FORMAT.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

export function parisDate(ms) {
  return parisParts(ms).date;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
}

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_FR_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function formatShortDateFr(dateStr) {
  const [, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  return `${d} ${MONTHS_FR[m - 1]}`;
}

function formatLongDateFr(dateStr) {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const weekday = DAYS_FR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS_FR_LONG[m - 1]} ${y}`;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}m ${String(rest).padStart(2, '0')}s`;
}

function plural(n, singular, pluralForm) {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

function percent(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function langFromPath(p) {
  return p === '/en' || String(p).startsWith('/en/') ? 'en' : 'fr';
}

// Prospect slug of a page path (/pour/<slug>, /offre/<slug>, /en/for/<slug>, /en/offer/<slug>), else null
export function prospectSlugFromPath(p) {
  const m = PROSPECT_ROUTE_RE.exec(String(p || ''));
  if (!m) return null;
  let slug;
  try {
    slug = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  return SLUG_RE.test(slug) ? slug.toLowerCase() : null;
}

// Path of a same-site Referer (the page a CTA was clicked from), else ''
function refererPath(req) {
  const raw = req.headers['referer'] || req.headers['referrer'];
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const url = new URL(raw);
    return url.hostname.toLowerCase() === getHostname(req) ? url.pathname : '';
  } catch {
    return '';
  }
}

function refererHost(req) {
  const raw = req.headers['referer'] || req.headers['referrer'];
  if (typeof raw !== 'string' || !raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '').slice(0, 100);
  } catch {
    return '';
  }
}

export function classifyReferer(host) {
  const h = String(host || '');
  if (!h || PROD_HOSTS.has(h) || PROD_HOSTS.has(`www.${h}`)) return 'Accès direct / Messagerie';
  if (/linkedin|lnkd\.in/.test(h)) return 'LinkedIn';
  if (/mail|outlook|teams|office/.test(h)) return 'Accès direct / Messagerie';
  if (/google|bing|duckduckgo|qwant|ecosia|yahoo|yandex|brave|startpage|lilo/.test(h)) return 'Moteurs de recherche';
  return h;
}

export function ctaLabel(key) {
  const labels = { hero: 'Hero', starter: 'Starter', strategy: 'Strategy' };
  if (labels[key]) return labels[key];
  const s = String(key || '').replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ctaRoute(key) {
  const reverse = { hero: 'decouverte' };
  return `/rdv/${reverse[key] || key}`;
}

// --- Scaleway Transactional Email (HTTPS API only, never SMTP) ---

export async function sendTemEmail(message, config = {}) {
  const secretKey = config.secretKey ?? TEM_SECRET_KEY;
  const projectId = config.projectId ?? TEM_PROJECT_ID;
  const region = config.region || TEM_REGION;
  const from = config.from || ALERT_EMAIL_FROM;
  const fetchImpl = config.fetch || fetch;
  if (!secretKey || !projectId) {
    throw new Error('TEM_SECRET_KEY ou SCW_DEFAULT_PROJECT_ID absent : envoi ignoré');
  }
  const res = await fetchImpl(`https://api.scaleway.com/transactional-email/v1alpha1/regions/${region}/emails`, {
    method: 'POST',
    headers: { 'X-Auth-Token': secretKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { email: from, name: 'Radar SDRnow' },
      to: [{ email: message.to }],
      subject: message.subject,
      text: message.text,
      html: message.html,
      project_id: projectId,
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      // ignore
    }
    throw new Error(`HTTP ${res.status} ${detail}`);
  }
  // TEM message id, kept in the send log
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Body unreadable: the send itself succeeded
  }
  return (data && Array.isArray(data.emails) && data.emails[0] && data.emails[0].id) || null;
}

// --- Mailpit Send API (capture only: Mailpit has no relay, nothing is ever delivered) ---

export async function sendMailpitEmail(message, config = {}) {
  const url = (config.url || MAILPIT_URL).replace(/\/+$/, '');
  const from = config.from || ALERT_EMAIL_FROM;
  const fetchImpl = config.fetch || fetch;
  const res = await fetchImpl(`${url}/api/v1/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      From: { Email: from, Name: 'Radar SDRnow' },
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
      HTML: message.html,
      Tags: message.tags || [],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      // ignore
    }
    throw new Error(`HTTP ${res.status} ${detail}`);
  }
  const data = await res.json();
  if (!data || !data.ID) throw new Error('Réponse Mailpit sans ID');
  return data.ID;
}

function describeSendError(err) {
  if (!err) return 'erreur inconnue';
  const cause = err.cause && (err.cause.code || err.cause.message);
  return `${err.message || err}${cause ? ` (${cause})` : ''}`.slice(0, 300);
}

export function readEmailLog(file, { site = null, limit = EMAIL_LOG_STATS_LIMIT } = {}) {
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      // A line without a valid timestamp would break the date rendering of /stats: skipped
      if (!rec || typeof rec !== 'object' || typeof rec.ts !== 'string' || !Number.isFinite(Date.parse(rec.ts))) continue;
      if (!site || rec.site === site) lines.push(rec);
    } catch {
      // Truncated / corrupt line: skipped
    }
  }
  // Most recent first
  return lines.slice(-limit).reverse();
}

// --- Aggregation (pure: rebuilt from analytics.jsonl, robust to restarts) ---

export function parseAnalyticsLines(content) {
  const events = [];
  for (const line of String(content || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === 'object' && ev.date && ev.anon_id && ev.event) events.push(ev);
    } catch {
      // Ignore a truncated / corrupted line
    }
  }
  return events;
}

// Two sessions of the slug (any device) separated by more than 30 min of silence
function hasSpacedSessions(events) {
  const times = events.map((e) => Date.parse(e.ts)).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > SESSION_GAP_MS) return true;
  }
  return false;
}

function countSessions(events) {
  // A session = events of one anon_id without a gap > 30 min
  const byAnon = new Map();
  for (const ev of events) {
    if (!byAnon.has(ev.anon_id)) byAnon.set(ev.anon_id, []);
    byAnon.get(ev.anon_id).push(Date.parse(ev.ts));
  }
  let sessions = 0;
  for (const times of byAnon.values()) {
    times.sort((a, b) => a - b);
    sessions += 1;
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] > SESSION_GAP_MS) sessions += 1;
    }
  }
  return sessions;
}

export function summarizeSignals(events) {
  const s = {
    pricingView: false, copies: new Set(), contacts: new Set(), legal: false, print: false,
    langSwitch: false, en: false, ctas: [], duration: 0, hasTelemetry: false,
  };
  for (const ev of events) {
    if (ev.tier >= 3) s.hasTelemetry = true;
    if (ev.lang === 'en') s.en = true;
    switch (ev.event) {
      case 'pricing_view': s.pricingView = true; break;
      case 'copy': if (ev.target) s.copies.add(ev.target); break;
      case 'contact': if (ev.target) s.contacts.add(ev.target); break;
      case 'print': s.print = true; break;
      case 'lang_switch': s.langSwitch = true; break;
      case 'ping': s.duration += Number(ev.duration) || 0; break;
      case 'cta_click': if (ev.target && !s.ctas.includes(ev.target)) s.ctas.push(ev.target); break;
      case 'pageview': if (LEGAL_PATH_RE.test(String(ev.target || ''))) s.legal = true; break;
      default: break;
    }
  }
  for (const c of ['phone', 'email']) if (s.copies.has(c)) s.contacts.add(c);
  return s;
}

export function periodRange(period, today) {
  switch (period) {
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'all': return { from: '0000-00-00', to: '9999-99-99' };
    default: return { from: today, to: today };
  }
}

export function aggregateVisitors(events) {
  // Visitor = (date, anon_id); tier = max of its events (tier is written at write time)
  const visitors = new Map();
  for (const ev of events) {
    const key = `${ev.date}|${ev.anon_id}`;
    let v = visitors.get(key);
    if (!v) {
      v = { key, date: ev.date, anon_id: ev.anon_id, tier: 1, slugs: new Set(), testers: new Set(), events: [], ua_family: ev.ua_family || '', referer: null };
      visitors.set(key, v);
    }
    v.tier = Math.max(v.tier, Number(ev.tier) || 1);
    if (ev.slug) v.slugs.add(ev.slug);
    if (ev.tester) v.testers.add(ev.tester); // staging only: Basic Auth user or "preview"
    if (ev.ua_family) v.ua_family = ev.ua_family;
    if (ev.event === 'pageview' && v.referer === null) v.referer = ev.referer || '';
    v.events.push(ev);
  }
  for (const v of visitors.values()) {
    v.events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    // Origin = first external referer of the day (internal navigation does not count)
    const external = v.events.find((e) => e.event === 'pageview' && e.referer && classifyReferer(e.referer) !== 'Accès direct / Messagerie');
    v.origin = classifyReferer(external ? external.referer : v.referer);
    v.signals = summarizeSignals(v.events);
  }
  return [...visitors.values()];
}

export function computeStats(events, { period = 'today', today, ctaKeys = ['hero', 'starter', 'strategy'] } = {}) {
  const { from, to } = periodRange(period, today);
  const inRange = events.filter((e) => e.date >= from && e.date <= to);
  const visitors = aggregateVisitors(inRange);

  const bots = visitors.filter((v) => v.tier < 2);
  const humans = visitors.filter((v) => v.tier >= 2);
  const anonHumans = humans.filter((v) => v.slugs.size === 0);
  const full = anonHumans.filter((v) => v.tier >= 3);
  const adblock = anonHumans.filter((v) => v.tier === 2);
  const pricing = anonHumans.filter((v) => v.signals.pricingView);
  const copyPrices = anonHumans.reduce((n, v) => n + v.signals.copies.size - (v.signals.copies.has('phone') ? 1 : 0) - (v.signals.copies.has('email') ? 1 : 0), 0);
  const durations = full.map((v) => v.signals.duration).filter((d) => d > 0).sort((a, b) => a - b);
  const median = durations.length
    ? (durations.length % 2 ? durations[(durations.length - 1) / 2] : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2)
    : 0;

  // Funnel: cta_click per offer key + direct contact, anonymous humans only
  const keys = [...ctaKeys];
  const ctaCounts = Object.fromEntries(keys.map((k) => [k, 0]));
  let contactCount = 0;
  let clickers = 0;
  for (const v of anonHumans) {
    let clicked = false;
    for (const ev of v.events) {
      if (ev.event === 'cta_click' && ev.target) {
        if (!(ev.target in ctaCounts)) { ctaCounts[ev.target] = 0; keys.push(ev.target); }
        ctaCounts[ev.target] += 1;
        clicked = true;
      } else if (ev.event === 'contact') {
        contactCount += 1;
        clicked = true;
      }
    }
    if (clicked) clickers += 1;
  }
  const ctaTotal = Object.values(ctaCounts).reduce((a, b) => a + b, 0);
  const funnel = keys.map((k) => ({ key: k, kind: 'cta', clicks: ctaCounts[k] }));
  funnel.sort((a, b) => b.clicks - a.clicks);
  funnel.push({ key: 'contact', kind: 'contact', clicks: contactCount });
  const conversions = ctaTotal + contactCount;

  // Origins
  const origins = new Map();
  for (const v of anonHumans) {
    const o = origins.get(v.origin) || { source: v.origin, visitors: 0, ctas: 0 };
    o.visitors += 1;
    o.ctas += v.events.filter((e) => e.event === 'cta_click').length;
    origins.set(v.origin, o);
  }

  // Staging testers (anonymous human visitors per tester name)
  const testerCounts = new Map();
  for (const v of anonHumans) for (const t of v.testers) testerCounts.set(t, (testerCounts.get(t) || 0) + 1);
  const testers = [...testerCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Radar prospects: one row per slug with at least one human visitor
  const bySlug = new Map();
  for (const v of humans) {
    for (const slug of v.slugs) {
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug).push(v);
    }
  }
  const prospects = [];
  for (const [slug, list] of bySlug) {
    const evs = list.flatMap((v) => v.events.filter((e) => e.slug === slug)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const perDay = new Map();
    for (const v of list) perDay.set(v.date, (perDay.get(v.date) || 0) + 1);
    const dates = [...perDay.keys()].sort();
    const firstPage = evs.find((e) => e.event === 'pageview' && PROSPECT_ROUTE_RE.test(String(e.target || '')));
    const prefixMatch = firstPage ? PROSPECT_ROUTE_RE.exec(firstPage.target) : null;
    const last = evs[evs.length - 1];
    prospects.push({
      slug,
      pathPrefix: prefixMatch ? `/${prefixMatch[1]}/` : '/pour/',
      lastTs: last ? last.ts : null,
      devices: Math.max(...perDay.values()),
      sessions: countSessions(evs),
      revisit: hasSpacedSessions(evs),
      revisitDays: dates.length > 1 ? daysBetween(dates[0], dates[dates.length - 1]) : 0,
      families: [...new Set(list.map((v) => v.ua_family).filter(Boolean))],
      origin: list.map((v) => v.origin).find((o) => o !== 'Accès direct / Messagerie') || 'Accès direct / Messagerie',
      adblockOnly: list.every((v) => v.tier === 2),
      signals: summarizeSignals(evs),
      testers: [...new Set(evs.map((e) => e.tester).filter(Boolean))],
    });
  }
  prospects.sort((a, b) => Date.parse(b.lastTs || 0) - Date.parse(a.lastTs || 0));

  return {
    period, from, to, today,
    humans: anonHumans.length,
    full: full.length,
    adblock: adblock.length,
    adblockPct: percent(adblock.length, anonHumans.length),
    pricing: pricing.length,
    pricingPct: percent(pricing.length, full.length),
    medianDuration: median,
    copyPrices,
    ctaTotal,
    contactCount,
    conversions,
    clickers,
    clickersPct: percent(clickers, anonHumans.length),
    bots: bots.length,
    funnel,
    origins: [...origins.values()].sort((a, b) => b.visitors - a.visitors),
    prospects,
    testers,
    anonVisitors: anonHumans,
  };
}

// --- Email templates (inline CSS only, max 600px, no remote resource) ---

const EMAIL_BADGE = {
  hot: 'background:#FFEDD5;color:#C2410C;border:1px solid #FDBA74;',
  cta: 'background:#DCFCE7;color:#15803D;border:1px solid #86EFAC;',
};

function emailBadge(kind, label) {
  return `<span style="display:inline-block;${EMAIL_BADGE[kind]}border-radius:9999px;padding:3px 10px;font-size:12px;font-weight:700;white-space:nowrap;">${escapeHtmlAttr(label)}</span>`;
}

function emailKpi(value, label, color = '#111827') {
  return `<td style="width:33%;padding:4px;"><div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:10px 8px;text-align:center;">
<div style="font-size:18px;font-weight:800;color:${color};line-height:1.2;">${value}</div>
<div style="font-size:11px;color:#4B5563;text-transform:uppercase;font-weight:600;">${escapeHtmlAttr(label)}</div></div></td>`;
}

function emailTimeline(items) {
  if (!items.length) return '';
  return `<div style="border-left:2px solid #E5E7EB;margin:0 0 20px 6px;padding-left:14px;font-size:13px;color:#374151;">
${items.map((it) => `<div style="margin-bottom:9px;"><span style="color:#F26522;">●</span> ${it}</div>`).join('\n')}
</div>`;
}

function emailShell({ preheader, eyebrow, eyebrowColor, title, mono = false, badge, body, ctaLabel: buttonLabel, statsUrl }) {
  const font = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtmlAttr(title)}</title></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:${font};color:#111827;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtmlAttr(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;"><tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:6px;">
<tr><td style="background:#111827;color:#FFFFFF;padding:16px 20px;border-bottom:3px solid #F26522;border-radius:6px 6px 0 0;">
<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${eyebrowColor};font-weight:700;">${escapeHtmlAttr(eyebrow)}</div>
<div style="font-size:18px;font-weight:800;margin:2px 0 8px;${mono ? 'font-family:ui-monospace, SFMono-Regular, Menlo, monospace;' : ''}">${escapeHtmlAttr(title)}</div>
${badge}
</td></tr>
<tr><td style="padding:20px;font-size:14px;line-height:1.5;">
${body}
<a href="${escapeHtmlAttr(statsUrl)}" style="display:inline-block;background:#F26522;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:6px;">${escapeHtmlAttr(buttonLabel)}</a>
</td></tr></table>
</td></tr></table>
</body></html>`;
}

function describeProspectEvent(ev, deviceRank) {
  const esc = escapeHtmlAttr;
  const path = String(ev.target || '');
  switch (ev.event) {
    case 'pageview': {
      if (PROSPECT_ROUTE_RE.test(path)) {
        const from = ev.referer ? ` depuis ${esc(classifyReferer(ev.referer))}` : '';
        const where = deviceRank > 1 ? `un <strong>${deviceRank}e appareil : ${esc(ev.ua_family)}</strong>` : `<strong>${esc(ev.ua_family)}</strong>`;
        return `Ouverture de <code>${esc(path)}</code> sur ${where}${from}`;
      }
      if (LEGAL_PATH_RE.test(path)) return 'Clic sur <strong>Mentions légales</strong> (vérification société)';
      return `Navigation vers la page d'accueil <strong>${ev.lang === 'en' ? 'EN' : 'FR'}</strong>`;
    }
    case 'pricing_view': return "Lecture jusqu'à la section <strong>Tarifs</strong>";
    case 'copy': {
      if (ev.target === 'starter' || ev.target === 'strategy') return `<strong>Copie de texte (Ctrl+C)</strong> dans la carte <em>Package ${esc(ctaLabel(ev.target))}</em>`;
      if (ev.target === 'phone') return '<strong>Copie du numéro de téléphone</strong>';
      if (ev.target === 'email') return "<strong>Copie de l'adresse email</strong>";
      return '<strong>Copie de texte (Ctrl+C)</strong> dans les <em>Tarifs</em>';
    }
    case 'contact': return ev.target === 'email' ? "<strong>Clic sur l'email</strong> jcm@sdrnow.fr" : '<strong>Clic sur le téléphone</strong> 06 67 90 24 94';
    case 'lang_switch': return `Changement de langue (${ev.target === 'en' ? 'FR → EN' : 'EN → FR'})`;
    case 'print': return '<strong>Impression / Export PDF</strong> de la page';
    case 'cta_click': return `<strong>Clic CTA « Prise de rendez-vous » — ${esc(ctaLabel(ev.target))}</strong> (<code>${esc(ctaRoute(ev.target))}</code>)`;
    default: return null; // render, init, ping: technical, not shown
  }
}

function mainAction(signals) {
  if (signals.ctas.length) return `Clic RDV ${ctaLabel(signals.ctas[signals.ctas.length - 1])}`;
  if (signals.copies.has('starter') || signals.copies.has('strategy')) {
    return `Copie tarif ${ctaLabel(signals.copies.has('starter') ? 'starter' : 'strategy')}`;
  }
  if (signals.copies.has('pricing')) return 'Copie des tarifs';
  if (signals.contacts.has('phone')) return 'Téléphone';
  if (signals.contacts.has('email')) return 'Email';
  if (signals.pricingView) return 'Tarifs vus';
  if (signals.print) return 'Export PDF';
  if (signals.duration > 0) return `Lecture ${formatDuration(signals.duration)}`;
  return 'Ouverture du lien';
}

export function buildProspectAlertEmail({ slug, events, devices, statsUrl = STATS_URL }) {
  const signals = summarizeSignals(events);
  const devicesLabel = plural(devices, 'appareil', 'appareils');
  const action = mainAction(signals);
  const subject = `🔥 [SDRnow] ${slug} vient de consulter votre offre (${devicesLabel} • ${action})`;
  const families = [...new Set(events.map((e) => e.ua_family).filter(Boolean))];
  const ctaKey = signals.ctas[signals.ctas.length - 1];

  const ranks = new Map();
  const items = [];
  for (const ev of events) {
    if (!ranks.has(ev.anon_id)) ranks.set(ev.anon_id, ranks.size + 1);
    const label = describeProspectEvent(ev, ranks.get(ev.anon_id));
    if (label) items.push(`<span style="font-family:ui-monospace, Menlo, monospace;font-size:12px;color:#6B7280;">${parisParts(Date.parse(ev.ts)).time}</span> ${label}`);
  }

  const banner = [];
  if (devices >= 2) banner.push(`Ce lien a été ouvert sur <strong>${devices} appareils distincts</strong> (transfert probable à un autre décideur)`);
  if (ctaKey) banner.push(`a déclenché un clic sur <strong>${escapeHtmlAttr(ctaLabel(ctaKey))}</strong>`);
  const bannerText = banner.length
    ? `<strong>Signal fort :</strong> ${banner.join(' et ')}.`
    : `<strong>Ouverture confirmée :</strong> ${escapeHtmlAttr(slug)} a consulté votre offre (${escapeHtmlAttr(families.join(' + ') || 'appareil inconnu')}).`;

  const preheaderParts = [];
  if (devices >= 2) preheaderParts.push(`Partage interne détecté (${families.join(' + ')})`);
  preheaderParts.push(signals.hasTelemetry ? `${formatDuration(signals.duration)} de lecture` : 'Lecture sous Adblock / Sans JS');
  if (signals.copies.size) preheaderParts.push('A copié un tarif ou un contact');

  const body = `
<div style="background:#FFF3ED;border-left:4px solid #F26522;padding:12px 14px;border-radius:4px;margin-bottom:16px;font-size:13px;color:#7C2D12;">${bannerText}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr>
${emailKpi(signals.hasTelemetry ? formatDuration(signals.duration) : 'N/A', signals.hasTelemetry ? 'Lecture active' : 'Sans JS')}
${emailKpi(String(devices), 'Appareils (#anon)')}
${emailKpi(ctaKey ? escapeHtmlAttr(ctaLabel(ctaKey)) : '—', 'CTA cliqué', ctaKey ? '#15803D' : '#4B5563')}
</tr></table>
<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#4B5563;margin-bottom:8px;">Chronologie de la consultation</div>
${emailTimeline(items)}`;

  const html = emailShell({
    preheader: preheaderParts.join(' • '),
    eyebrow: 'Radar Prospect B2B',
    mono: true,
    eyebrowColor: '#FDBA74',
    title: (events.find((e) => e.event === 'pageview' && PROSPECT_ROUTE_RE.test(String(e.target || ''))) || {}).target || `/pour/${slug}`,
    badge: devices >= 2 ? emailBadge('hot', `🔥 Partage interne (${devices} appareils)`) : '',
    body,
    ctaLabel: 'Ouvrir le Radar complet (/stats) →',
    statsUrl,
  });

  const textLines = [subject, '', ...events.map((ev) => {
    const label = describeProspectEvent(ev, ranks.get(ev.anon_id));
    return label ? `${parisParts(Date.parse(ev.ts)).time} ${label.replace(/<[^>]+>/g, '')}` : null;
  }).filter(Boolean), '', `Radar complet : ${statsUrl}`];

  return { subject, html, text: textLines.join('\n') };
}

export function buildDigestEmail({ date, stats, statsUrl = STATS_URL }) {
  const n = stats.humans;
  const clicks = stats.ctaTotal;
  const readers = stats.pricing;
  const subject = `📊 [SDRnow] Bilan du ${formatShortDateFr(date)} : ${plural(n, 'visiteur anonyme', 'visiteurs anonymes')} (${plural(clicks, 'clic RDV', 'clics RDV')} • ${readers} ${readers === 1 ? 'a lu' : 'ont lu'} les tarifs)`;

  const choices = stats.funnel
    .filter((f) => f.kind === 'cta')
    .map((f) => `${plural(f.clicks, 'clic', 'clics')} <em>${escapeHtmlAttr(ctaLabel(f.key))}</em>`)
    .join(' • ');

  const notable = [...stats.anonVisitors]
    .map((v) => {
      const s = v.signals;
      const score = s.ctas.length * 100 + s.contacts.size * 50 + s.copies.size * 20 + (s.pricingView ? 10 : 0) + s.duration / 60;
      return { v, s, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ v, s }) => {
      const first = v.events[0];
      const facts = [];
      if (s.hasTelemetry && s.duration > 0) facts.push(`<strong>${formatDuration(s.duration)}</strong>`);
      if (s.pricingView) facts.push('Tarifs vus');
      if ([...s.copies].some((c) => c !== 'phone' && c !== 'email')) facts.push('Copie tarif');
      if (s.contacts.size) facts.push([...s.contacts].map((c) => (c === 'phone' ? 'Téléphone' : 'Email')).join(' + '));
      if (s.langSwitch) facts.push('Switch FR↔EN');
      if (s.print) facts.push('Export PDF');
      for (const c of s.ctas) facts.push(`<span style="color:#15803D;font-weight:700;">Clic RDV ${escapeHtmlAttr(ctaLabel(c))}</span>`);
      if (!facts.length) facts.push('Consultation simple');
      const adblock = v.tier === 2 ? ' • <span style="color:#B45309;font-weight:700;">Adblock</span>' : '';
      return `<strong>Visiteur #${escapeHtmlAttr(v.anon_id)}</strong> (${parisParts(Date.parse(first.ts)).time.slice(0, 5)} • ${escapeHtmlAttr(v.origin)} • ${escapeHtmlAttr(v.ua_family)}${adblock}) — ${facts.join(' • ')}`;
    });

  const body = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr>
${emailKpi(String(n), 'Visiteurs humains')}
${emailKpi(`${readers} <span style="font-size:12px;color:#6B7280;">(${percent(readers, n)}%)</span>`, 'Tarifs vus')}
${emailKpi(`${clicks} <span style="font-size:12px;">(${percent(stats.clickers, n)}%)</span>`, 'Clics CTA', '#F26522')}
</tr></table>
<div style="font-size:13px;background:#F3F4F6;padding:10px 14px;border-radius:6px;margin-bottom:16px;color:#374151;">
<strong>Répartition technique :</strong> ${stats.full} avec télémétrie complète • <strong>${stats.adblock} sous Adblock / Sans JS</strong> • <em>${plural(stats.bots, 'robot / scanner écarté', 'robots / scanners écartés')}</em>.<br>
<strong>Choix des offres :</strong> ${choices || 'aucun clic'}${stats.contactCount ? ` • ${plural(stats.contactCount, 'contact direct', 'contacts directs')}` : ''}.
</div>
<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#4B5563;margin-bottom:8px;">Consultations anonymes notables d'hier</div>
${emailTimeline(notable)}`;

  const html = emailShell({
    preheader: `${stats.full} visites complètes + ${stats.adblock} sous Adblock (${stats.bots} robots filtrés) • Voir le détail des consultations`,
    eyebrow: 'Digest quotidien audience anonyme',
    eyebrowColor: '#9CA3AF',
    title: formatLongDateFr(date),
    badge: clicks ? emailBadge('cta', `${plural(clicks, 'clic RDV', 'clics RDV')}`) : '',
    body,
    ctaLabel: 'Consulter le tableau de bord /stats →',
    statsUrl,
  });

  const text = [
    subject, '',
    `${stats.full} avec télémétrie complète, ${stats.adblock} sous Adblock / Sans JS, ${stats.bots} robots écartés.`,
    ...notable.map((l) => `- ${l.replace(/<[^>]+>/g, '')}`),
    '', `Tableau de bord : ${statsUrl}`,
  ].join('\n');

  return { subject, html, text };
}

// --- Tracker: daily secret, visitor states, tiers, rate-limit, jsonl, alerts, digest ---

export function createTracker(options = {}) {
  const analyticsFile = options.analyticsFile || ANALYTICS_FILE;
  const ctaTargets = options.ctaTargets || getCtaTargets();
  const recipients = parseRecipients(options.alertRecipients ?? ALERT_EMAIL_TO);
  // Site of this tracker: 'prod' (sdrnow.fr) or 'staging' (test visits of staging.sdrnow.fr)
  const site = options.site === 'staging' ? 'staging' : 'prod';
  // Transports: Mailpit always (capture, never delivered); TEM (real delivery) only for prod,
  // once a TEM key is provisioned. Staging never reaches TEM, whatever the configuration.
  const sendMailpit = options.sendMailpit || ((message) => sendMailpitEmail(message));
  const sendEmail = options.sendEmail || ((message) => sendTemEmail(message));
  const temEnabled = site === 'prod' && (Boolean(options.sendEmail) || Boolean(TEM_SECRET_KEY && TEM_PROJECT_ID));
  // Send log shared by both sites (each /stats filters its own lines); next to an injected log
  const emailLogFile = options.emailLogFile
    || (options.analyticsFile ? path.join(path.dirname(options.analyticsFile), 'email-log.jsonl') : EMAIL_LOG_FILE);
  const now = options.now || Date.now;
  const debounceMs = options.debounceMs ?? 120000;
  // Email links point to the stats of the tracker's own site
  const statsUrl = options.statsUrl || (site === 'staging' ? `${STATS_ENVS.staging.origin}/stats` : STATS_URL);
  // Daily secret kept on a systemd tmpfs (never on the SSD) so it survives same-day restarts
  const secretFile = options.secretFile || null;

  let currentDate = parisDate(now());
  let dailySecret = loadDailySecret() || crypto.randomBytes(32);
  saveDailySecret();
  let visitors = new Map(); // anon_id -> { tier, slug, bot, uaFamily, pendingRender }
  let rateLimits = new Map(); // hashed ip -> { start, count }
  const pendingAlerts = new Map(); // slug -> { events, anons, timer }
  const inflight = new Set();
  let tickTimer = null;
  let dirReady = false;

  function loadDailySecret() {
    if (!secretFile) return null;
    try {
      const saved = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
      if (saved && saved.date === currentDate && /^[0-9a-f]{64}$/.test(saved.secret)) {
        return Buffer.from(saved.secret, 'hex');
      }
    } catch {
      // Missing or unreadable: a new secret is generated
    }
    return null;
  }

  function saveDailySecret() {
    if (!secretFile) return;
    try {
      const tmp = `${secretFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ date: currentDate, secret: dailySecret.toString('hex') }), { mode: 0o600 });
      fs.renameSync(tmp, secretFile); // overwrites (destroys) the previous day's secret
    } catch (err) {
      console.error('[Analytics] Secret journalier non persisté :', err.message);
    }
  }

  // After a restart: rebuild today's anon_id -> slug / tier map from the log
  function rebuildVisitors() {
    for (const ev of readEvents()) {
      if (ev.date !== currentDate) continue;
      let state = visitors.get(ev.anon_id);
      if (!state) {
        const family = String(ev.ua_family || '');
        state = { tier: 1, slug: null, bot: family.startsWith('Robot'), uaFamily: family, pendingRender: false };
        visitors.set(ev.anon_id, state);
      }
      state.tier = Math.max(state.tier, Number(ev.tier) || 1);
      if (ev.slug) state.slug = ev.slug;
    }
  }

  function track(promise) {
    inflight.add(promise);
    promise.finally(() => inflight.delete(promise));
    return promise;
  }

  function anonId(ip, ua) {
    return crypto.createHmac('sha256', dailySecret).update(`${ip}|${ua}`).digest('hex').slice(0, 8);
  }

  function append(record) {
    try {
      if (!dirReady) {
        fs.mkdirSync(path.dirname(analyticsFile), { recursive: true });
        dirReady = true;
      }
      fs.appendFileSync(analyticsFile, JSON.stringify(record) + '\n', 'utf8');
    } catch (err) {
      console.error('[Analytics] Écriture impossible :', err.message);
    }
  }

  function readEvents() {
    try {
      return parseAnalyticsLines(fs.readFileSync(analyticsFile, 'utf8'));
    } catch {
      return [];
    }
  }

  // One line per attempt and per transport; never the HTML body nor any IP
  function logSend(entry) {
    try {
      fs.mkdirSync(path.dirname(emailLogFile), { recursive: true });
      fs.appendFileSync(emailLogFile, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error('[Email] Journal d\'envoi impossible :', err.message);
    }
  }

  function sendVia(transport, label, fn, message, meta) {
    return track(
      Promise.resolve()
        .then(() => fn(message))
        .then(
          (id) => ({ ok: true, error: null, id: id && typeof id !== 'boolean' ? String(id).slice(0, 128) : null }),
          (err) => {
            const error = describeSendError(err);
            console.error(`[${label}] Échec de l'envoi « ${message.subject} » : ${error}`);
            return { ok: false, error, id: null };
          }
        )
        .then((result) => logSend({
          ts: new Date(now()).toISOString(),
          site,
          kind: meta.kind,
          ref: meta.ref,
          to: message.to,
          subject: message.subject,
          transport,
          ...result,
        }))
    );
  }

  // meta = { kind: 'alert' | 'digest', ref: slug | date }
  function deliver(email, meta) {
    const subject = site === 'staging' ? `[STAGING] ${email.subject}` : email.subject;
    const tags = site === 'staging' ? ['staging'] : (temEnabled ? ['prod', 'tem'] : ['prod']);
    for (const to of recipients) {
      // One individual send per recipient: no recipient ever sees the others.
      // Each transport is independent: a failure of one never blocks the other.
      const message = { ...email, subject, to };
      if (temEnabled) sendVia('tem', 'TEM', sendEmail, message, meta);
      sendVia('mailpit', 'Mailpit', sendMailpit, { ...message, tags }, meta);
    }
  }

  async function sendDigest(date) {
    const stats = computeStats(readEvents(), { period: 'today', today: date, ctaKeys: Object.keys(ctaTargets) });
    if (stats.humans < 1) return false; // quiet day: no send at all
    deliver(buildDigestEmail({ date, stats, statsUrl }), { kind: 'digest', ref: date });
    return true;
  }

  function rotateIfNeeded() {
    const today = parisDate(now());
    if (today === currentDate) return false;
    const previous = currentDate;
    currentDate = today;
    dailySecret = crypto.randomBytes(32);
    saveDailySecret();
    visitors = new Map();
    rateLimits = new Map();
    dropUnarmedAlerts();
    track(sendDigest(previous).catch((err) => console.error('[Email] Digest impossible :', err.message)));
    return true;
  }

  function fireAlert(slug) {
    const pending = pendingAlerts.get(slug);
    pendingAlerts.delete(slug);
    if (!pending) return;
    const humans = new Set([...pending.anons].filter(([, a]) => a.tier >= 2).map(([id]) => id));
    const events = pending.events.filter((e) => humans.has(e.anon_id));
    // A closing reading-time ping alone is not a new visit: no second, empty email
    if (!events.some((e) => e.event !== 'ping')) return;
    for (const [id, st] of visitors) {
      if (st.slug === slug && st.tier >= 2 && !st.bot) humans.add(id);
    }
    deliver(buildProspectAlertEmail({ slug, events, devices: humans.size, statsUrl }), { kind: 'alert', ref: slug });
  }

  // Slugs only seen by non-human visitors never arm a timer: do not keep them forever
  function dropUnarmedAlerts() {
    for (const [slug, p] of pendingAlerts) if (!p.timer) pendingAlerts.delete(slug);
  }

  function trackAlert(record, state) {
    let pending = pendingAlerts.get(record.slug);
    if (!pending) {
      if (pendingAlerts.size >= MAX_PENDING_SLUGS) dropUnarmedAlerts();
      if (pendingAlerts.size >= MAX_PENDING_SLUGS) return;
      pending = { events: [], anons: new Map(), timer: null };
      pendingAlerts.set(record.slug, pending);
    }
    pending.events.push(record);
    if (pending.events.length > MAX_PENDING_EVENTS_PER_SLUG) pending.events.shift();
    pending.anons.set(record.anon_id, { tier: state.tier });
    // Only a human visit (tier >= 2) arms / re-arms the debounce timer
    if (state.tier >= 2) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = setTimeout(() => fireAlert(record.slug), debounceMs);
      if (pending.timer.unref) pending.timer.unref();
    }
  }

  function visit(req, { create = true } = {}) {
    rotateIfNeeded();
    const ua = String(req.headers['user-agent'] || '').slice(0, 512);
    const anon = anonId(getClientIp(req), ua);
    let state = visitors.get(anon);
    if (!state && create) {
      if (visitors.size >= MAX_VISITORS_IN_RAM) visitors.delete(visitors.keys().next().value);
      state = { tier: 1, slug: null, bot: classifyUa(ua) === 'bot', uaFamily: uaFamily(ua), pendingRender: false };
      visitors.set(anon, state);
    }
    return { anon, state };
  }

  // fields.tester (staging only): who ran the test; absent from production records
  function logEvent(anon, state, event, fields = {}) {
    const record = {
      ts: new Date(now()).toISOString(),
      date: currentDate,
      anon_id: anon,
      // fields.slug: the prospect page that emitted the event (another open tab of the same
      // browser shares the anon_id, so state.slug, the last prospect link opened, may differ)
      slug: fields.slug || state.slug,
      tier: state.tier,
      event,
      target: fields.target ?? null,
      duration: fields.duration ?? null,
      lang: fields.lang ?? null,
      referer: fields.referer ?? null,
      ua_family: state.uaFamily,
    };
    if (fields.tester) record.tester = String(fields.tester).slice(0, 64);
    append(record);
    if (record.slug && !state.bot) trackAlert(record, state);
    return record;
  }

  function recordPageview(req, { path: pagePath, slug = null, tester = null }) {
    const { anon, state } = visit(req);
    if (slug) state.slug = slug; // anon_id -> slug, kept in RAM for the day
    state.pendingRender = true;
    return logEvent(anon, state, 'pageview', { target: pagePath, lang: langFromPath(pagePath), referer: refererHost(req), tester });
  }

  function recordRender(req, { tester = null } = {}) {
    // Witness asset loaded after an HTML page: proof of a real rendering browser
    const { anon, state } = visit(req, { create: false });
    if (!state || !state.pendingRender) return null;
    state.pendingRender = false;
    if (!state.bot && state.tier < 2) state.tier = 2;
    return logEvent(anon, state, 'render', { tester });
  }

  function checkRateLimit(req) {
    rotateIfNeeded();
    const key = crypto.createHmac('sha256', dailySecret).update(`rl|${getClientIp(req)}`).digest('hex').slice(0, 16);
    const t = now();
    let entry = rateLimits.get(key);
    if (!entry || t - entry.start >= 60000) {
      if (rateLimits.size > 10000) {
        for (const [k, e] of rateLimits) if (t - e.start >= 60000) rateLimits.delete(k);
      }
      entry = { start: t, count: 0 };
      rateLimits.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= HEALTH_RATE_LIMIT_PER_MIN;
  }

  function recordHealth(req, payload, { tester = null } = {}) {
    const { anon, state } = visit(req);
    if (!state.bot) state.tier = 3;
    state.pendingRender = false;
    const p = typeof payload.p === 'string' ? payload.p.slice(0, 200) : '';
    const t = typeof payload.t === 'string' ? payload.t.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) : '';
    const dRaw = Number(payload.d);
    const duration = payload.e === 'ping' && Number.isFinite(dRaw) ? Math.min(Math.max(Math.round(dRaw), 0), 86400) : null;
    return logEvent(anon, state, payload.e, { target: t || null, duration, lang: p ? langFromPath(p) : null, slug: prospectSlugFromPath(p), tester });
  }

  function recordCta(req, key, lang, { tester = null } = {}) {
    const { anon, state } = visit(req);
    return logEvent(anon, state, 'cta_click', { target: key, lang, referer: refererHost(req), slug: prospectSlugFromPath(refererPath(req)), tester });
  }

  function stats(period) {
    rotateIfNeeded();
    return computeStats(readEvents(), { period, today: currentDate, ctaKeys: Object.keys(ctaTargets) });
  }

  rebuildVisitors();

  function startTimers() {
    if (tickTimer) return;
    tickTimer = setInterval(rotateIfNeeded, 30000);
    if (tickTimer.unref) tickTimer.unref();
  }

  function stopTimers() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    for (const p of pendingAlerts.values()) if (p.timer) clearTimeout(p.timer);
    pendingAlerts.clear();
  }

  return {
    site,
    analyticsFile,
    emailLogFile,
    temEnabled,
    ctaTargets,
    recipients,
    now,
    anonId,
    currentDate: () => currentDate,
    rotateIfNeeded,
    recordPageview,
    recordRender,
    recordHealth,
    recordCta,
    checkRateLimit,
    readEvents,
    stats,
    emailLog: (limit = EMAIL_LOG_STATS_LIMIT) => readEmailLog(emailLogFile, { site, limit }),
    sendDigest,
    flushAlerts() {
      for (const [slug, p] of [...pendingAlerts]) {
        if (p.timer) clearTimeout(p.timer);
        if ([...p.anons.values()].some((a) => a.tier >= 2)) fireAlert(slug);
        else pendingAlerts.delete(slug);
      }
    },
    hasPendingAlert: (slug) => Boolean(pendingAlerts.get(slug)?.timer),
    whenIdle: async () => {
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
    startTimers,
    stopTimers,
  };
}

// --- /stats page (server-rendered, zero third-party resource) ---

const STATS_PERIODS = [
  ['today', "Aujourd'hui"],
  ['7d', '7 derniers jours'],
  ['30d', '30 jours'],
  ['all', 'Tout'],
];

function statsBadge(kind, label) {
  return `<span class="badge b-${kind}">${escapeHtmlAttr(label)}</span>`;
}

function formatLastVisit(ts, today) {
  if (!ts) return '—';
  const { date, time } = parisParts(Date.parse(ts));
  const hm = time.slice(0, 5);
  if (date === today) return `Aujourd'hui ${hm}`;
  if (date === addDays(today, -1)) return `Hier ${hm}`;
  return `${formatShortDateFr(date)} ${hm}`;
}

function renderProspectRow(p, today) {
  const s = p.signals;
  const hot = p.devices >= 2 || s.ctas.length > 0;
  const devices = p.devices >= 2
    ? statsBadge('hot', `🔥 ${p.devices} appareils (Partage interne)`)
    : statsBadge('neutral', '1 appareil');
  const revisit = p.revisit
    ? statsBadge('hot', p.revisitDays >= 1 ? `🔄 Revisite à J+${p.revisitDays}` : '🔄 Revisite')
    : '';
  const intents = [];
  if (s.pricingView) intents.push(statsBadge('view', '👁 Tarifs vus'));
  for (const c of s.copies) {
    if (c === 'starter' || c === 'strategy') intents.push(statsBadge('copy', `📋 Copie Tarif ${ctaLabel(c)}`));
    else if (c === 'pricing') intents.push(statsBadge('copy', '📋 Copie Tarifs'));
  }
  if (s.contacts.has('phone')) intents.push(statsBadge('copy', '📞 Téléphone'));
  if (s.contacts.has('email')) intents.push(statsBadge('copy', '✉️ Email'));
  if (s.legal) intents.push(statsBadge('neutral', '⚖️ Mentions légales'));
  if (s.print) intents.push(statsBadge('neutral', '🖨 Export PDF'));
  if (s.en) intents.push(statsBadge('neutral', '🇬🇧 Version EN'));
  if (s.langSwitch) intents.push(statsBadge('neutral', '🔁 Changement de langue'));
  if (p.adblockOnly) intents.push(statsBadge('adblock', '🛡 Adblock / Sans JS'));
  const conversion = s.ctas.length
    ? s.ctas.map((c) => statsBadge('cta', `✅ Clic RDV ${ctaLabel(c)}`)).join(' ')
    : (s.contacts.size ? '<span class="muted-sm">Contact direct</span>' : '<span class="muted-sm">—</span>');
  const reading = s.hasTelemetry ? `<strong>${formatDuration(s.duration)}</strong>` : '<span class="na">N/A (Sans JS)</span>';
  return `<tr${hot ? ' class="hot-row"' : ''}>
<td><span class="slug-pill"><span class="slug-path">${escapeHtmlAttr(p.pathPrefix)}</span>${escapeHtmlAttr(p.slug)}</span>${p.testers && p.testers.length ? `<br><span class="muted-sm">👤 ${escapeHtmlAttr(p.testers.join(', '))}</span>` : ''}</td>
<td><strong>${escapeHtmlAttr(formatLastVisit(p.lastTs, today))}</strong><br><span class="muted-sm">${escapeHtmlAttr(p.origin)} • ${escapeHtmlAttr(p.families.join(' + '))}</span></td>
<td>${devices} ${revisit}<br><span class="muted-sm">${plural(p.sessions, 'session', 'sessions')}</span></td>
<td>${reading}</td>
<td>${intents.join(' ') || '<span class="muted-sm">—</span>'}</td>
<td>${conversion}</td>
</tr>`;
}

// Each site shows its own stats: sdrnow.fr/stats (production) and staging.sdrnow.fr/stats (test visits)
const STATS_ENVS = {
  prod: {
    label: 'Prod — sdrnow.fr',
    detail: 'Visites réelles du site public',
    origin: 'https://sdrnow.fr',
    editorUrl: 'https://staging.sdrnow.fr/',
    other: { label: 'Staging — visites de test', url: 'https://staging.sdrnow.fr/stats' },
  },
  staging: {
    label: 'Staging — visites de test',
    detail: 'Visites de staging.sdrnow.fr par les testeurs authentifiés • emails capturés par Mailpit, jamais livrés',
    origin: 'https://staging.sdrnow.fr',
    editorUrl: '/',
    other: { label: 'Prod — sdrnow.fr', url: 'https://sdrnow.fr/stats' },
  },
};

const EMAIL_KINDS = { alert: '🔥 Alerte', digest: '📊 Bilan' };
const EMAIL_TRANSPORTS = { mailpit: 'Mailpit', tem: 'Scaleway TEM' };

function renderEmailRow(e, today) {
  const kind = EMAIL_KINDS[e.kind] || String(e.kind || '—');
  const ref = e.ref ? `<br><span class="muted-sm"><code>${escapeHtmlAttr(e.ref)}</code></span>` : '';
  const transport = EMAIL_TRANSPORTS[e.transport] || String(e.transport || '—');
  const result = e.ok
    ? statsBadge('neutral', '✅ Envoyé')
    : `${statsBadge('neutral', '❌ Échec')}${e.error ? `<br><span class="muted-sm">${escapeHtmlAttr(e.error)}</span>` : ''}`;
  return `<tr>
<td><strong>${escapeHtmlAttr(formatLastVisit(e.ts, today))}</strong></td>
<td>${escapeHtmlAttr(kind)}${ref}</td>
<td>${escapeHtmlAttr(e.subject || '—')}</td>
<td>${escapeHtmlAttr(e.to || '—')}</td>
<td>${escapeHtmlAttr(transport)}</td>
<td>${result}</td>
</tr>`;
}

export function renderStatsPage(stats, { ctaTargets = {}, env = 'prod', emails = [] } = {}) {
  const site = STATS_ENVS[env] || STATS_ENVS.prod;
  const isStaging = env === 'staging';
  const periodLabel = (STATS_PERIODS.find(([k]) => k === stats.period) || STATS_PERIODS[0])[1];
  const pills = STATS_PERIODS.map(([key, label]) =>
    `<a class="period-pill${key === stats.period ? ' active' : ''}" href="/stats?period=${key}"${key === stats.period ? ' aria-current="page"' : ''}>${escapeHtmlAttr(label)}</a>`
  ).join('');

  const rows = stats.prospects.length
    ? stats.prospects.map((p) => renderProspectRow(p, stats.today)).join('\n')
    : `<tr><td colspan="6" class="empty">🎯 Aucun lien prospect visité sur cette période. ${isStaging ? 'Ouvrez un lien de test' : 'Envoyez un premier lien'} <code>${site.origin}/pour/nom-prospect</code>${isStaging ? '' : ' dans vos messages'}, ou préparez-le avec le copieur rapide ci-dessus.</td></tr>`;
  const testersLine = (stats.testers || []).length
    ? `<div class="stat-box-sub">👤 ${stats.testers.map((t) => `${escapeHtmlAttr(t.name)} ×${t.count}`).join(' • ')}</div>`
    : '';

  const funnelLabels = {
    hero: 'Bouton Hero haut de page (30 min)',
    starter: 'Package SDRnow Starter',
    strategy: 'Package SDRnow Strategy',
  };
  const maxConversions = stats.conversions || 1;
  let rank = 0;
  const funnelRows = stats.funnel.map((f) => {
    rank += 1;
    const pct = percent(f.clicks, stats.conversions);
    const width = Math.round((f.clicks / maxConversions) * 100);
    const isContact = f.kind === 'contact';
    const fill = isContact ? '#6D28D9' : (rank === 1 && f.clicks > 0 ? '#F26522' : '#4B5563');
    const label = isContact
      ? 'Appel direct Téléphone / Email — <code>06 67 90 24 94</code>'
      : `${escapeHtmlAttr(funnelLabels[f.key] || `Carte ${ctaLabel(f.key)}`)} — <code>${escapeHtmlAttr(ctaRoute(f.key))}</code>`;
    return `<div class="offer-bar-row">
<div class="offer-bar-head"><span>${rank}. ${label}</span><span><strong>${plural(f.clicks, 'clic', 'clics')}</strong> (${pct}% des conversions)</span></div>
<div class="offer-bar-track"><div class="offer-bar-fill" style="width:${width}%;background:${fill};"></div></div>
</div>`;
  }).join('\n');

  const originRows = stats.origins.length
    ? stats.origins.map((o) => `<tr><td><strong>${escapeHtmlAttr(o.source)}</strong></td><td>${o.visitors} (${percent(o.visitors, stats.humans)}%)</td><td><strong>${o.ctas}</strong></td></tr>`).join('\n')
    : '<tr><td colspan="3" class="empty">Aucun visiteur humain anonyme sur cette période.</td></tr>';

  const extraTargets = Object.keys(ctaTargets).filter((k) => !['hero', 'starter', 'strategy'].includes(k));

  const emailRows = emails.length
    ? emails.map((e) => renderEmailRow(e, stats.today)).join('\n')
    : `<tr><td colspan="6" class="empty">📭 Aucun email envoyé pour l'instant depuis ${isStaging ? 'staging' : 'la prod'}. Les alertes « Prospect Chaud » et le bilan de minuit apparaîtront ici.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Radar &amp; Stats (${isStaging ? 'Staging' : 'Prod'}) - SDRnow</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23F26522'/%3E%3C/svg%3E">
<style>
:root{--primary:#F26522;--primary-soft:#FFF3ED;--chrome-bg:#111827;--chrome-surface:#1F2937;--chrome-border:#374151;--chrome-text:#F9FAFB;--chrome-muted:#9CA3AF;--page-bg:#F9FAFB;--card-bg:#FFFFFF;--text-main:#111827;--text-muted:#4B5563;--border:#E5E7EB}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:500;line-height:1.5;background:var(--page-bg);color:var(--text-main)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:.92em}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.admin-header{background:var(--chrome-bg);color:var(--chrome-text);padding:14px 28px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;border-bottom:1px solid var(--chrome-border)}
.admin-brand{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.admin-brand-logo{font-weight:900;font-size:18px;letter-spacing:-.02em;color:#fff}
.admin-brand-logo span{color:var(--primary)}
.admin-nav-pills{display:flex;gap:6px;background:var(--chrome-surface);padding:4px;border-radius:9999px;border:1px solid var(--chrome-border)}
.admin-nav-pill{font-size:12.5px;font-weight:600;padding:6px 14px;border-radius:9999px;color:var(--chrome-muted);text-decoration:none}
.admin-nav-pill.active{background:var(--primary);color:#fff}
.period-pills{display:flex;gap:6px;flex-wrap:wrap}
.period-pill{border:1px solid var(--chrome-border);background:var(--chrome-surface);padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600;color:var(--chrome-muted);text-decoration:none}
.period-pill.active{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}
.link-gen-bar{background:var(--card-bg);border-bottom:1px solid var(--border);padding:14px 28px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.link-gen-left{display:flex;align-items:center;gap:10px;font-size:13.5px;font-weight:600;flex-wrap:wrap}
.link-input-group{display:inline-flex;align-items:center;border:1px solid #D1D5DB;border-radius:6px;overflow:hidden;background:#F9FAFB;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.link-prefix{padding:6px 10px;color:#6B7280;background:#F3F4F6;border-right:1px solid var(--border)}
.link-slug-input{border:none;background:#fff;padding:6px 10px;font-family:inherit;font-weight:700;color:var(--text-main);width:170px;font-size:13px}
.btn-copy{background:var(--chrome-bg);color:#fff;border:none;padding:7px 13px;border-radius:6px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit}
.btn-copy.secondary{background:#fff;color:var(--text-muted);border:1px solid var(--border)}
.btn-copy:disabled{opacity:.5;cursor:not-allowed}
.hint{font-size:12px;color:var(--text-muted)}
.dash-content{max-width:1180px;margin:0 auto;padding:28px}
.dash-section{margin-bottom:32px}
.dash-section-header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.dash-section-title{font-size:17px;font-weight:800;line-height:1.3}
.dash-section-sub{font-size:12.5px;color:var(--text-muted)}
.radar-card{background:var(--card-bg);border:1px solid var(--border);border-radius:10px;overflow-x:auto;box-shadow:0 1px 3px rgba(0,0,0,.04)}
table.radar-table{width:100%;border-collapse:collapse;font-size:13.5px}
.radar-table th{background:var(--page-bg);text-align:left;padding:11px 14px;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);border-bottom:1px solid var(--border)}
.radar-table td{padding:13px 14px;border-bottom:1px solid var(--border);vertical-align:middle}
.radar-table tr:last-child td{border-bottom:none}
.radar-table tr.hot-row{background:#FFFDFB}
.radar-table td.empty{color:var(--text-muted);text-align:center;padding:28px 16px}
.slug-pill{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:700;font-size:13.5px;white-space:nowrap}
.slug-path{color:#9CA3AF;font-weight:500}
.muted-sm{font-size:12px;color:#6B7280}
.na{color:#9CA3AF}
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:9999px;margin:0 4px 3px 0;white-space:nowrap}
.b-hot{background:#FFEDD5;color:#C2410C;border:1px solid #FDBA74}
.b-cta{background:#DCFCE7;color:#15803D;border:1px solid #86EFAC}
.b-copy{background:#EDE9FE;color:#6D28D9;border:1px solid #C4B5FD}
.b-view{background:#DBEAFE;color:#1D4ED8;border:1px solid #93C5FD}
.b-adblock{background:#FEF3C7;color:#B45309;border:1px solid #FCD34D}
.b-neutral{background:#F3F4F6;color:#374151;border:1px solid #D1D5DB}
.stats-grid-4{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));gap:16px;margin-bottom:20px}
.stat-box{background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.stat-box.secondary{background:var(--page-bg)}
.stat-box-lbl{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:6px}
.stat-box-val{font-size:28px;font-weight:800;line-height:1.1;margin-bottom:6px}
.stat-box-val small{font-size:15px;color:#6B7280;font-weight:700}
.stat-box-sub{font-size:12.5px;color:var(--text-muted)}
.funnel-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:20px}
.funnel-grid>*{min-width:0}
.dash-section-title,.offer-bar-head span{overflow-wrap:anywhere}
.link-input-group{max-width:100%}
.link-slug-input{min-width:0}
@media (max-width:820px){.funnel-grid{grid-template-columns:1fr}.admin-header,.link-gen-bar{padding:12px 16px}.dash-content{padding:20px 16px}}
.panel-card{background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.04);overflow-x:auto}
.panel-card h3{font-size:14.5px;font-weight:800;margin-bottom:14px}
.offer-bar-row{margin-bottom:14px}
.offer-bar-head{display:flex;justify-content:space-between;gap:12px;font-size:13px;font-weight:600;margin-bottom:4px;flex-wrap:wrap}
.offer-bar-track{height:10px;background:#F3F4F6;border-radius:9999px;overflow:hidden}
.offer-bar-fill{height:100%;border-radius:9999px}
.env-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px 16px;padding:10px 28px;font-size:13px;border-bottom:1px solid var(--border)}
.env-bar.env-prod{background:var(--primary-soft);color:#7C2D12}
.env-bar.env-staging{background:#FEF3C7;color:#78350F}
.env-name{font-weight:800}
.env-bar a{color:inherit;font-weight:700}
.dash-section-sub a{color:var(--primary);font-weight:700}
@media (max-width:820px){.env-bar{padding:10px 16px}}
</style>
</head>
<body>
<header class="admin-header">
  <div class="admin-brand">
    <div class="admin-brand-logo">SDR<span>now</span></div>
    <nav class="admin-nav-pills" aria-label="Administration">
      <a href="${site.editorUrl}" class="admin-nav-pill">✏️ Éditeur de textes</a>
      <a href="/stats" class="admin-nav-pill active" aria-current="page">📡 Radar &amp; Stats</a>
    </nav>
  </div>
  <nav class="period-pills" aria-label="Période">
    ${pills}
    <a class="period-pill" href="/api/stats/export">⬇ Export .jsonl</a>
  </nav>
</header>

<div class="env-bar env-${isStaging ? 'staging' : 'prod'}" role="note">
  <div><span class="env-name">${isStaging ? '🧪' : '🌐'} Données affichées : ${escapeHtmlAttr(site.label)}</span> • ${escapeHtmlAttr(site.detail)}</div>
  <a href="${site.other.url}">Voir ${escapeHtmlAttr(site.other.label)} →</a>
</div>

<div class="link-gen-bar">
  <div class="link-gen-left">
    <label for="slug-input">🔗 Créer un lien prospect à la volée :</label>
    <span class="link-input-group"><span class="link-prefix">${site.origin}/pour/</span><input id="slug-input" type="text" class="link-slug-input" placeholder="nom-prospect" maxlength="64" autocomplete="off" spellcheck="false"></span>
    <button type="button" class="btn-copy" id="copy-fr">Copier le lien FR</button>
    <button type="button" class="btn-copy secondary" id="copy-en">Copier EN (/en/for/…)</button>
  </div>
  <div class="hint">💡 Astuce : vous pouvez aussi taper directement <code>${site.origin.replace('https://', '')}/pour/nom-client</code> ${isStaging ? 'dans votre navigateur' : 'dans vos messages'} sans passer par ici.</div>
</div>

<main class="dash-content">
  <section class="dash-section">
    <div class="dash-section-header">
      <h2 class="dash-section-title">🎯 1. Radar Prospects Identifiés (<code>/pour/&lt;slug&gt;</code> &amp; <code>/offre/&lt;slug&gt;</code>)</h2>
      <div class="dash-section-sub">${escapeHtmlAttr(periodLabel)} • Trié par dernière activité • ${isStaging ? "Alerte capturée par Mailpit après 2 min d'inactivité" : "Alerte email après 2 min d'inactivité"}</div>
    </div>
    <div class="radar-card">
      <table class="radar-table">
        <thead><tr><th>Prospect (Slug)</th><th>Dernière visite</th><th>Appareils &amp; Revisites</th><th>Lecture active</th><th>Signaux d'intention &amp; Comportement</th><th>Conversion CTA</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </section>

  <section class="dash-section">
    <div class="dash-section-header">
      <h2 class="dash-section-title">📊 2. Audience Anonyme (<code>/</code> &amp; <code>/en</code>) &amp; Entonnoir par Carte d'Offre</h2>
      <div class="dash-section-sub">Visiteurs reconnus le temps d'une journée, sans cookie • ${isStaging ? 'Bilan capturé par Mailpit à minuit si au moins 1 visite' : 'Bilan email à minuit si au moins 1 visite'}</div>
    </div>
    <div class="stats-grid-4">
      <div class="stat-box">
        <div class="stat-box-lbl">Visiteurs humains</div>
        <div class="stat-box-val">${stats.humans}</div>
        <div class="stat-box-sub"><strong>${stats.full}</strong> Télémétrie complète • <strong style="color:#B45309;">${stats.adblock} sous Adblock / Sans JS (${stats.adblockPct}%)</strong></div>
        ${testersLine}
      </div>
      <div class="stat-box">
        <div class="stat-box-lbl">Ont lu jusqu'aux tarifs</div>
        <div class="stat-box-val">${stats.pricing} <small>(${stats.pricingPct}%)</small></div>
        <div class="stat-box-sub">Temps actif médian : <strong>${formatDuration(stats.medianDuration)}</strong> • ${plural(stats.copyPrices, 'copie de prix', 'copies de prix')}</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-lbl">Clics d'action (total)</div>
        <div class="stat-box-val" style="color:var(--primary);">${stats.conversions} <small>(${stats.clickersPct}%)</small></div>
        <div class="stat-box-sub"><strong>${stats.ctaTotal}</strong> clics RDV + <strong>${stats.contactCount}</strong> contacts directs</div>
      </div>
      <div class="stat-box secondary">
        <div class="stat-box-lbl">Bots &amp; Scanners écartés</div>
        <div class="stat-box-val" style="color:#6B7280;">${stats.bots}</div>
        <div class="stat-box-sub">Aperçus LinkedInBot, SafeLinks &amp; robots exclus des statistiques</div>
      </div>
    </div>

    <div class="funnel-grid">
      <div class="panel-card">
        <h3>🎯 Conversion par Carte d'Offre (<code>/rdv/…</code> &amp; <code>/en/book/…</code>)</h3>
${funnelRows}
${extraTargets.length ? `<p class="muted-sm">Cartes additionnelles configurées : ${extraTargets.map((k) => `<code>${escapeHtmlAttr(ctaRoute(k))}</code>`).join(', ')}</p>` : ''}
      </div>
      <div class="panel-card">
        <h3>🌍 Origines du Trafic Humain (Referer)</h3>
        <table class="radar-table">
          <thead><tr><th>Source</th><th>Visiteurs</th><th>Clics CTA</th></tr></thead>
          <tbody>
${originRows}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="dash-section" id="emails">
    <div class="dash-section-header">
      <h2 class="dash-section-title">📬 3. Emails envoyés</h2>
      <div class="dash-section-sub">${EMAIL_LOG_STATS_LIMIT} derniers envois ${isStaging ? 'de staging' : 'de la prod'} • <a href="${MAILPIT_UI_URL}" target="_blank" rel="noopener">Lire le contenu dans Mailpit →</a></div>
    </div>
    <div class="radar-card">
      <table class="radar-table">
        <thead><tr><th>Date</th><th>Type</th><th>Objet</th><th>Destinataire</th><th>Voie</th><th>Résultat</th></tr></thead>
        <tbody>
${emailRows}
        </tbody>
      </table>
    </div>
  </section>
</main>

<script>
(function () {
  var input = document.getElementById('slug-input');
  var btnFr = document.getElementById('copy-fr');
  var btnEn = document.getElementById('copy-en');
  function normalize(v) {
    return v.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, 64);
  }
  function valid(v) { return /^[a-zA-Z0-9_-]{2,64}$/.test(v); }
  function refresh() { var ok = valid(input.value.replace(/-+$/, '')); btnFr.disabled = !ok; btnEn.disabled = !ok; }
  input.addEventListener('input', function () { var pos = normalize(input.value); if (pos !== input.value) input.value = pos; refresh(); });
  function copy(btn, prefix) {
    var slug = input.value.replace(/-+$/, '');
    input.value = slug;
    if (!valid(slug)) return;
    var url = prefix + slug;
    var label = btn.textContent;
    function done() { btn.textContent = '✓ Copié !'; setTimeout(function () { btn.textContent = label; }, 2000); }
    function fallback() { var ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); done(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback); else fallback();
  }
  btnFr.addEventListener('click', function () { copy(btnFr, '${site.origin}/pour/'); });
  btnEn.addEventListener('click', function () { copy(btnEn, '${site.origin}/en/for/'); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); copy(btnFr, '${site.origin}/pour/'); } });
  refresh();
})();
</script>
</body>
</html>`;
}

// --- Server Request Handler ---

export function createRequestHandler(options = {}) {
  const stagingDir = options.stagingDir || STAGING_DIR;
  const prodDir = options.prodDir || PROD_DIR;
  const adminUser = options.adminUser || ADMIN_USER;
  const adminPassSha256 = options.adminPassSha256 || ADMIN_PASS_SHA256;
  const secret = options.secret || STAGING_PREVIEW_SECRET;
  const editorScriptPath = options.editorScriptPath || EDITOR_SCRIPT_PATH;

  // Expected 32-byte buffers for timingSafeEqual
  const allowedUsers = String(adminUser)
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const expectedUserHashes = allowedUsers.map((u) =>
    crypto.createHash('sha256').update(u, 'utf8').digest()
  );
  const expectedPassHash = Buffer.from(adminPassSha256, 'hex');
  // Injected staging log only (editor tests, tools): send log next to it, never the real /etc/sdrnow file
  const emailLogFile = options.emailLogFile
    || (!options.analyticsFile && options.stagingAnalyticsFile ? path.join(path.dirname(options.stagingAnalyticsFile), 'email-log.jsonl') : undefined);
  const tracker = options.tracker || createTracker({ ...options, emailLogFile });
  const ctaTargets = tracker.ctaTargets;
  // Test visits of staging.sdrnow.fr: own log, own daily secret, emails to Mailpit only
  const stagingTracker = options.stagingTracker || createTracker({
    // Injected prod log (tests, tools): staging log next to it, never the real /etc/sdrnow file
    analyticsFile: options.stagingAnalyticsFile
      || (options.analyticsFile ? path.join(path.dirname(options.analyticsFile), 'analytics-staging.jsonl') : STAGING_ANALYTICS_FILE),
    ctaTargets,
    now: options.now,
    site: 'staging',
    statsUrl: `${STATS_ENVS.staging.origin}/stats`,
    emailLogFile: tracker.emailLogFile,
    sendMailpit: options.sendMailpit,
  });
  const clock = tracker.now || Date.now;

  // Basic Auth check shared by the staging gate and the production /stats routes.
  // Returns null without a Basic header, { ok: false } on bad credentials, { ok: true, user } otherwise.
  function checkBasicAuth(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Basic ')) return null;
    try {
      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIdx = credentials.indexOf(':');
      if (colonIdx === -1) return { ok: false };
      const user = credentials.slice(0, colonIdx);
      const pass = credentials.slice(colonIdx + 1);

      const givenUserHash = crypto.createHash('sha256').update(user, 'utf8').digest();
      const givenPassHash = crypto.createHash('sha256').update(pass, 'utf8').digest();

      const isUserValid = expectedUserHashes.some(
        (expectedHash) =>
          givenUserHash.length === expectedHash.length &&
          crypto.timingSafeEqual(givenUserHash, expectedHash)
      );

      if (
        isUserValid &&
        givenPassHash.length === expectedPassHash.length &&
        crypto.timingSafeEqual(givenPassHash, expectedPassHash)
      ) {
        return { ok: true, user };
      }
    } catch {
      // Malformed header: treated as bad credentials
    }
    return { ok: false };
  }

  // Production /stats: more than 10 failed logins per minute and per IP -> 429 (IP kept hashed, RAM only)
  const authFailureKey = crypto.randomBytes(32);
  const authFailures = new Map(); // hashed ip -> { start, count }
  // The 60 s window is anchored on the first failure: only a counted failure opens / resets it
  function authFailureKeyOf(req) {
    return crypto.createHmac('sha256', authFailureKey).update(getClientIp(req)).digest('hex').slice(0, 16);
  }
  function isAuthLocked(req) {
    const entry = authFailures.get(authFailureKeyOf(req));
    return Boolean(entry) && clock() - entry.start < 60000 && entry.count >= PROD_STATS_MAX_AUTH_FAILURES;
  }
  function noteAuthFailure(req) {
    const key = authFailureKeyOf(req);
    const t = clock();
    let entry = authFailures.get(key);
    if (!entry || t - entry.start >= 60000) {
      if (authFailures.size > 10000) {
        for (const [k, e] of authFailures) if (t - e.start >= 60000) authFailures.delete(k);
      }
      entry = { start: t, count: 0 };
      authFailures.set(key, entry);
    }
    entry.count += 1;
  }

  function resolveCtaKey(segment) {
    const key = CTA_ALIASES[segment] || segment;
    return Object.prototype.hasOwnProperty.call(ctaTargets, key) ? key : null;
  }

  function sendNotFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 Not Found');
  }

  function readSiteFile(rootDir, relPath) {
    const root = path.resolve(rootDir);
    const filePath = path.resolve(root, relPath);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;
    try {
      if (!fs.statSync(filePath).isFile()) return null;
      return { filePath, content: fs.readFileSync(filePath) };
    } catch {
      return null;
    }
  }

  function readProdFile(relPath) {
    return readSiteFile(prodDir, relPath);
  }

  function sendStatsPage(req, res, parsedUrl, statsTracker, env) {
    const requested = parsedUrl.searchParams.get('period');
    const period = STATS_PERIODS.some(([key]) => key === requested) ? requested : 'today';
    const html = renderStatsPage(statsTracker.stats(period), { ctaTargets, env, emails: statsTracker.emailLog() });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    return res.end(req.method === 'HEAD' ? undefined : html);
  }

  function sendStatsExport(res, statsTracker) {
    let content = '';
    try {
      content = fs.readFileSync(statsTracker.analyticsFile, 'utf8');
    } catch {
      content = '';
    }
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="${path.basename(statsTracker.analyticsFile).replace(/[^\w.-]/g, '_')}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    return res.end(content);
  }

  // Tracked routes shared by production (public) and staging (behind the auth gate):
  // prospect links, CTA redirects, the JS beacon and the witness asset. Returns false when
  // the path is none of them. site = { tracker, dir, tester, decorateHtml }.
  async function handleTrackedRoute(req, res, pathname, site) {
    const isGet = req.method === 'GET';
    const isRead = isGet || req.method === 'HEAD';
    const tester = site.tester || null;

    // 1. Personalised prospect links: /pour/<slug>, /offre/<slug>, /en/for/<slug>, /en/offer/<slug>
    const prospect = PROSPECT_ROUTE_RE.exec(pathname);
    if (prospect && isRead) {
      let rawSlug = '';
      try {
        rawSlug = decodeURIComponent(prospect[2]);
      } catch {
        sendNotFound(res);
        return true;
      }
      if (!SLUG_RE.test(rawSlug)) {
        sendNotFound(res);
        return true;
      }
      const lang = prospect[1].startsWith('en/') ? 'en' : 'fr';
      const file = readSiteFile(site.dir, lang === 'en' ? 'en/index.html' : 'index.html');
      if (!file) {
        sendNotFound(res);
        return true;
      }
      if (isGet) site.tracker.recordPageview(req, { path: pathname, slug: rawSlug.toLowerCase(), tester });
      res.writeHead(200, {
        'Content-Type': MIME_TYPES['.html'],
        'Cache-Control': 'no-cache',
        'X-Robots-Tag': 'noindex, nofollow',
      });
      res.end(isGet ? (site.decorateHtml ? site.decorateHtml(file.content) : file.content) : undefined);
      return true;
    }

    // 2. CTA routes: /rdv/<offre>, /en/book/<offer> -> 302 to the per-offer target
    const cta = CTA_ROUTE_RE.exec(pathname);
    if (cta && isRead) {
      const key = resolveCtaKey(cta[2]);
      if (!key) {
        sendNotFound(res);
        return true;
      }
      if (isGet) site.tracker.recordCta(req, key, cta[1] === 'rdv' ? 'fr' : 'en', { tester });
      res.writeHead(302, { Location: ctaTargets[key], 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }

    // 3. Stealth JS telemetry beacon
    if (pathname === '/health') {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('405 Method Not Allowed');
        return true;
      }
      if (!site.tracker.checkRateLimit(req)) {
        req.resume();
        res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' });
        res.end('429 Too Many Requests');
        return true;
      }
      let raw;
      try {
        raw = await readBody(req, HEALTH_MAX_BYTES);
      } catch (err) {
        const status = err && err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(status === 413 ? '413 Payload Too Large' : '400 Bad Request');
        return true;
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !HEALTH_EVENTS.has(payload.e)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('400 Bad Request');
        return true;
      }
      site.tracker.recordHealth(req, payload, { tester });
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }

    // 4. Witness asset: always revalidated (no-cache + ETag) so each page render is proven
    if (pathname === WITNESS_ASSET && isRead) {
      const file = readSiteFile(site.dir, WITNESS_ASSET.slice(1));
      if (!file) {
        sendNotFound(res);
        return true;
      }
      const etag = `"${crypto.createHash('sha1').update(file.content).digest('hex').slice(0, 16)}"`;
      if (isGet) site.tracker.recordRender(req, { tester });
      const headers = { 'Content-Type': MIME_TYPES['.svg'], 'Cache-Control': 'no-cache', ETag: etag };
      const inm = req.headers['if-none-match'];
      if (inm && inm.split(',').map((t) => t.trim().replace(/^W\//, '')).includes(etag)) {
        res.writeHead(304, headers);
        res.end();
        return true;
      }
      res.writeHead(200, headers);
      res.end(isGet ? file.content : undefined);
      return true;
    }

    return false;
  }

  // Production stats (sdrnow.fr/stats, /api/stats/export): same Basic Auth as staging, never
  // logged as a visit, noindex + no-store on every response, failed logins rate-limited.
  function handleProdStats(req, res, pathname, parsedUrl) {
    const guard = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
    if (isAuthLocked(req)) {
      res.writeHead(429, { ...guard, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' });
      return res.end('429 Too Many Requests');
    }
    const auth = checkBasicAuth(req);
    if (!auth || !auth.ok) {
      if (auth) noteAuthFailure(req); // bad credentials (a bare request without credentials is not a failure)
      res.writeHead(401, {
        ...guard,
        'WWW-Authenticate': 'Basic realm="SDRnow Stats"',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      return res.end('401 Unauthorized');
    }
    if (pathname === '/api/stats/export') {
      if (req.method !== 'GET') {
        res.writeHead(405, { ...guard, Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('405 Method Not Allowed');
      }
      return sendStatsExport(res, tracker);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...guard, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('405 Method Not Allowed');
    }
    return sendStatsPage(req, res, parsedUrl, tracker, 'prod');
  }

  // Production traffic (Host sdrnow.fr / www.sdrnow.fr): public, never authenticated (except
  // /stats), never sets a cookie. Only GET page loads, the witness asset, /health and /rdv/* are logged.
  async function handleProdRequest(req, res, parsedUrl) {
    const pathname = parsedUrl.pathname;
    const isGet = req.method === 'GET';
    const isRead = isGet || req.method === 'HEAD';

    // 0. Production stats, behind the admin Basic Auth
    if (PROD_STATS_PATHS.has(pathname)) {
      return handleProdStats(req, res, pathname, parsedUrl);
    }

    // 1-4. Prospect links, CTA routes, JS beacon, witness asset
    if (await handleTrackedRoute(req, res, pathname, { tracker, dir: prodDir })) return;

    if (!isRead) {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('405 Method Not Allowed');
    }

    // 5. HTML pages (/, /en, legal notices) and any other static file of PROD_DIR
    let relPath = PROD_PAGES[pathname];
    let file = relPath ? readProdFile(relPath) : null;
    if (!relPath) {
      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        return sendNotFound(res);
      }
      const base = decoded.replace(/^\/+/, '');
      for (const candidate of [base, path.join(base, 'index.html'), `${base}.html`]) {
        if (!candidate) continue;
        file = readProdFile(candidate);
        if (file) break;
      }
    }
    if (!file) return sendNotFound(res);
    const ext = path.extname(file.filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    if (ext === '.html') {
      if (isGet) tracker.recordPageview(req, { path: pathname });
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
    }
    return res.end(isGet ? file.content : undefined);
  }

  return async function handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // --- 0. Production dispatch (before any staging auth) ---
    if (isProdHost(req)) {
      return handleProdRequest(req, res, parsedUrl);
    }

    const currentToken = computePreviewToken(stagingDir, secret);

    // --- 1. Evaluate Authentication Doors (AD-7) ---
    let isAdmin = false;
    let isReadOnly = false;
    let authUser = null;

    const basicAuth = checkBasicAuth(req);
    if (basicAuth) {
      isAdmin = basicAuth.ok;
      if (isAdmin) authUser = basicAuth.user;

      // If Basic Auth header was sent but invalid, immediately return 401
      if (!isAdmin) {
        res.writeHead(401, {
          'WWW-Authenticate': 'Basic realm="SDRnow Staging Admin"',
          'Content-Type': 'text/plain; charset=utf-8',
        });
        return res.end('401 Unauthorized');
      }
    }

    // If not admin, check Read-Only Door (query ?preview= takes priority over cookie)
    if (!isAdmin) {
      const previewQuery = parsedUrl.searchParams.get('preview');
      if (previewQuery !== null) {
        if (previewQuery === currentToken) {
          isReadOnly = true;
          // Set cookie for session navigation
          res.setHeader(
            'Set-Cookie',
            `staging_preview=${currentToken}; Path=/; HttpOnly; Secure; SameSite=Lax`
          );
        } else {
          // Expiré ou invalide: 403 propre sans WWW-Authenticate
          res.writeHead(403, {
            'Content-Type': 'text/html; charset=utf-8',
          });
          return res.end(getExpiredPreviewHtml());
        }
      } else {
        // Check cookie
        const cookieHeader = req.headers['cookie'] || '';
        const match = cookieHeader.match(/\bstaging_preview=([^;]+)/);
        if (match) {
          if (match[1] === currentToken) {
            isReadOnly = true;
          } else {
            res.setHeader('Set-Cookie', 'staging_preview=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax');
            res.writeHead(403, {
              'Content-Type': 'text/html; charset=utf-8',
            });
            return res.end(getExpiredPreviewHtml());
          }
        }
      }
    }

    // Default Gate: If neither Admin nor Read-Only, return 401 with WWW-Authenticate
    if (!isAdmin && !isReadOnly) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="SDRnow Staging Admin"',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      return res.end('401 Unauthorized');
    }

    // Who is testing: Basic Auth user name (admin, client) or "preview" (preview link reviewer)
    const tester = isAdmin ? authUser : 'preview';
    const injectEditor = (html) => {
      const text = Buffer.isBuffer(html) ? html.toString('utf8') : html;
      return isAdmin ? text.replace(/<\/body>/i, '<script src="/__editor.js"></script></body>') : text;
    };

    // --- 1a. Staging test tracking (after the gate): prospect links, CTA, beacon, witness asset ---
    if (await handleTrackedRoute(req, res, pathname, { tracker: stagingTracker, dir: stagingDir, tester, decorateHtml: injectEditor })) {
      return;
    }

    // --- 1b. Radar & Stats dashboard of the staging test visits (Admin Only) ---
    if (pathname === '/stats' || pathname === '/stats/') {
      if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('403 Forbidden');
      }
      return sendStatsPage(req, res, parsedUrl, stagingTracker, 'staging');
    }

    // --- 2. API Routes (Admin Only) ---
    if (pathname.startsWith('/api/')) {
      if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'forbidden', message: 'Admin access required' }));
      }

      // GET /api/stats/export -- raw append-only log of the staging test visits as a download
      if (req.method === 'GET' && pathname === '/api/stats/export') {
        return sendStatsExport(res, stagingTracker);
      }

      // GET /api/translations
      if (req.method === 'GET' && pathname === '/api/translations') {
        const transFile = path.join(stagingDir, 'translations.json');
        try {
          const raw = fs.readFileSync(transFile, 'utf8');
          const parsed = JSON.parse(raw);
          const previewUrl = `https://${req.headers.host || 'staging.sdrnow.fr'}/?preview=${currentToken}`;
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(
            JSON.stringify({
              schema: parsed.schema,
              fr: parsed.fr,
              en: parsed.en,
              previewToken: currentToken,
              previewUrl,
            })
          );
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'file_read_error', message: err.message }));
        }
      }

      // POST /api/staging
      if (req.method === 'POST' && pathname === '/api/staging') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }));
        }

        const transFile = path.join(stagingDir, 'translations.json');
        let currentData;
        try {
          currentData = JSON.parse(fs.readFileSync(transFile, 'utf8'));
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'server_error', message: 'Cannot read translations.json' }));
        }

        const check = validateAndSanitizePayload(body, currentData.schema);
        if (check.error) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify(check));
        }

        // Merge updated fr & en into existing translations preserving schema
        const updatedTranslations = {
          schema: currentData.schema,
          fr: { ...currentData.fr, ...check.sanitized.fr },
          en: { ...currentData.en, ...check.sanitized.en },
        };
        const updatedJsonStr = JSON.stringify(updatedTranslations, null, 2);

        // Atomic write in Staging (<10ms)
        incrementRevision(stagingDir);
        atomicWriteFileSync(transFile, updatedJsonStr);
        patchCompiledFiles(stagingDir, updatedTranslations);

        const newToken = computePreviewToken(stagingDir, secret);
        const newPreviewUrl = `https://${req.headers.host || 'staging.sdrnow.fr'}/?preview=${newToken}`;

        // Return HTTP 202 Accepted immediately
        res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            status: 'accepted',
            previewToken: newToken,
            previewUrl: newPreviewUrl,
            gitSync: 'queued',
          })
        );

        // Async sequential GitHub queue
        queueGitSync(() => commitTranslationFile('staging', updatedJsonStr));
        return;
      }

      // POST /api/publish
      if (req.method === 'POST' && pathname === '/api/publish') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }));
        }

        const transFile = path.join(stagingDir, 'translations.json');
        let currentData;
        try {
          currentData = JSON.parse(fs.readFileSync(transFile, 'utf8'));
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'server_error', message: 'Cannot read translations.json' }));
        }

        const check = validateAndSanitizePayload(body, currentData.schema);
        if (check.error) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify(check));
        }

        const updatedTranslations = {
          schema: currentData.schema,
          fr: { ...currentData.fr, ...check.sanitized.fr },
          en: { ...currentData.en, ...check.sanitized.en },
        };
        const updatedJsonStr = JSON.stringify(updatedTranslations, null, 2);

        // Atomic write in Staging AND Prod (<10ms)
        incrementRevision(stagingDir);
        atomicWriteFileSync(transFile, updatedJsonStr);
        patchCompiledFiles(stagingDir, updatedTranslations);

        const prodTransFile = path.join(prodDir, 'translations.json');
        atomicWriteFileSync(prodTransFile, updatedJsonStr);
        patchCompiledFiles(prodDir, updatedTranslations);

        const newToken = computePreviewToken(stagingDir, secret);
        const newPreviewUrl = `https://${req.headers.host || 'staging.sdrnow.fr'}/?preview=${newToken}`;

        res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            status: 'accepted',
            previewToken: newToken,
            previewUrl: newPreviewUrl,
            gitSync: 'queued',
          })
        );

        // Async sequential GitHub queue (main then staging)
        queueGitSync(async () => {
          await commitTranslationFile('main', updatedJsonStr);
          await commitTranslationFile('staging', updatedJsonStr);
        });
        return;
      }

      // POST /api/reset
      if (req.method === 'POST' && pathname === '/api/reset') {
        const prodTransFile = path.join(prodDir, 'translations.json');
        const transFile = path.join(stagingDir, 'translations.json');
        let prodData;
        try {
          if (fs.existsSync(prodTransFile)) {
            prodData = JSON.parse(fs.readFileSync(prodTransFile, 'utf8'));
          } else if (fs.existsSync(transFile)) {
            // Cold start fallback: Production has not yet been deployed with translations.json.
            // Initialize prod translations.json from staging baseline so reset does not crash.
            prodData = JSON.parse(fs.readFileSync(transFile, 'utf8'));
            try {
              atomicWriteFileSync(prodTransFile, JSON.stringify(prodData, null, 2));
            } catch {
              // Ignore write error if prodDir is not writable in isolated test environments
            }
          } else {
            throw new Error(`Neither ${prodTransFile} nor ${transFile} exists.`);
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(
            JSON.stringify({
              error: 'prod_read_failed',
              message: 'Failed to read production translations: ' + err.message,
            })
          );
        }

        const prodJsonStr = JSON.stringify(prodData, null, 2);

        // Copy prod to staging (<10ms)
        incrementRevision(stagingDir);
        atomicWriteFileSync(transFile, prodJsonStr);
        patchCompiledFiles(stagingDir, prodData);

        const newToken = computePreviewToken(stagingDir, secret);
        const newPreviewUrl = `https://${req.headers.host || 'staging.sdrnow.fr'}/?preview=${newToken}`;

        res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            status: 'accepted',
            previewToken: newToken,
            previewUrl: newPreviewUrl,
            gitSync: 'queued',
          })
        );

        // Async GitHub queue for staging branch
        queueGitSync(() => commitTranslationFile('staging', prodJsonStr));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'not_found' }));
    }

    // --- 3. Serve Editor Client Script (/__editor.js) ---
    if (pathname === '/__editor.js') {
      if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('403 Forbidden');
      }

      if (fs.existsSync(editorScriptPath)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return res.end(EMPHASIS_MODEL_PRELUDE + fs.readFileSync(editorScriptPath, 'utf8'));
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Editor script not found');
    }

    // --- 4. Static Files from STAGING_DIR ---
    let relativePath = pathname.slice(1);
    if (!relativePath || relativePath.endsWith('/')) {
      relativePath += 'index.html';
    }

    // Safe path resolution
    const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(stagingDir, safePath);

    // If file doesn't exist, try adding .html or /index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      const idxPath = path.join(filePath, 'index.html');
      if (fs.existsSync(idxPath)) {
        filePath = idxPath;
      }
    } else if (!fs.existsSync(filePath)) {
      if (fs.existsSync(filePath + '.html')) {
        filePath = filePath + '.html';
      } else if (fs.existsSync(path.join(filePath, 'index.html'))) {
        filePath = path.join(filePath, 'index.html');
      }
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // HEAD request
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': contentType });
      return res.end();
    }

    // HTML injection rule (AD-4, AD-7): Inject editor only for admin
    if (ext === '.html') {
      const html = injectEditor(fs.readFileSync(filePath, 'utf8'));
      if (req.method === 'GET') stagingTracker.recordPageview(req, { path: pathname, tester });
      res.writeHead(200, { 'Content-Type': contentType });
      return res.end(html);
    }

    // Other static files
    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  };
}

export function createServer(options = {}) {
  const handler = createRequestHandler(options);
  return http.createServer(handler);
}

export function startServer() {
  // Timers (midnight rotation + digest) only run in the real server, never in tests
  const runtimeDir = (process.env.RUNTIME_DIRECTORY || '/run/sdrnow').split(':')[0];
  const tracker = createTracker({ site: 'prod', emailLogFile: EMAIL_LOG_FILE, secretFile: path.join(runtimeDir, 'daily-secret.json') });
  tracker.startTimers();
  // Staging test visits: separate log and daily secret (same tmpfs), emails to Mailpit only
  const stagingTracker = createTracker({
    site: 'staging',
    statsUrl: `${STATS_ENVS.staging.origin}/stats`,
    analyticsFile: STAGING_ANALYTICS_FILE,
    emailLogFile: EMAIL_LOG_FILE,
    secretFile: path.join(runtimeDir, 'daily-secret-staging.json'),
  });
  stagingTracker.startTimers();
  console.log(tracker.temEnabled
    ? `[Email] Prod : Scaleway TEM + copie Mailpit (${MAILPIT_URL}) ; staging : Mailpit seul`
    : `[Email] TEM inactif (TEM_SECRET_KEY ou SCW_DEFAULT_PROJECT_ID absent) : prod et staging capturés par Mailpit (${MAILPIT_URL})`);
  const server = createServer({ tracker, stagingTracker });
  // Loopback only: Caddy (same host) is the sole client, so X-Forwarded-For cannot be forged
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[SDRnow Staging Server] Listening on http://127.0.0.1:${PORT}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
