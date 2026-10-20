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
    // Strip all HTML and replace newlines with a single space
    return rawVal.replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim();
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
      const textOnly = cleanVal.replace(/<[^>]*>/g, '').trim();

      if (!fieldDef.optional && textOnly.length === 0) {
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

  for (const [key, val] of Object.entries(dict)) {
    const escapedKey = escapeRegex(key);

    // 1. Meta content: <meta ... data-i18n-content="key" ...>
    if (key === 'meta.description') {
      const metaRegex = new RegExp(`<meta([^>]*\\bdata-i18n-content=["']${escapedKey}["'][^>]*)>`, 'gi');
      patched = patched.replace(metaRegex, (match, attrs) => {
        const escapedVal = val.replace(/"/g, '&quot;');
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
      patched = patched.replace(titleRegex, (match, attrs) => `<title${attrs}>${val}</title>`);
    }

    // 3. Regular elements: <tag ... data-i18n="key" ...>...</tag>
    const elRegex = new RegExp(`<([a-zA-Z0-9]+)([^>]*\\bdata-i18n=["']${escapedKey}["'][^>]*)>[\\s\\S]*?<\\/\\1>`, 'gi');
    patched = patched.replace(elRegex, (match, tag, attrs) => `<${tag}${attrs}>${val}</${tag}>`);
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
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

  return async function handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const currentToken = computePreviewToken(stagingDir, secret);

    // --- 1. Evaluate Authentication Doors (AD-7) ---
    let isAdmin = false;
    let isReadOnly = false;

    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Basic ')) {
      try {
        const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const colonIdx = credentials.indexOf(':');
        if (colonIdx !== -1) {
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
            isAdmin = true;
          }
        }
      } catch (err) {
        isAdmin = false;
      }

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

    // --- 2. API Routes (Admin Only) ---
    if (pathname.startsWith('/api/')) {
      if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'forbidden', message: 'Admin access required' }));
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
    const mimeTypes = {
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
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // HEAD request
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': contentType });
      return res.end();
    }

    // HTML injection rule (AD-4, AD-7): Inject editor only for admin
    if (ext === '.html') {
      let html = fs.readFileSync(filePath, 'utf8');
      if (isAdmin) {
        const scriptTag = '<script src="/__editor.js"></script></body>';
        html = html.replace(/<\/body>/i, scriptTag);
      }
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
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SDRnow Staging Server] Listening on http://0.0.0.0:${PORT}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
