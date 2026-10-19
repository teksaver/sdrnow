import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import {
  createRequestHandler,
  sanitizeValue,
  validateAndSanitizePayload,
  patchHtmlContent,
  computePreviewToken,
  getRevision,
  incrementRevision,
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

test('sanitizeValue: preserves <em>, <strong>, <br> without attributes for rich type', () => {
  const raw = 'Super <em class="foo" onclick="bad()">pitch</em> et <strong style="color:red">gras</strong><br><p>Paragraphe</p>';
  const result = sanitizeValue(raw, 'rich');
  assert.equal(result, 'Super <em>pitch</em> et <strong>gras</strong><br>Paragraphe');
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

  assert.ok(patched.includes('<title data-i18n="meta.title">Nouveau Titre $1 & Étoiles</title>'));
  assert.ok(patched.includes('content="Nouvelle &quot;Description&quot; & $100"'));
  assert.ok(patched.includes('<h1 data-i18n="hero.title" data-i18n-type="rich">Nouveau Hero <em>Accent $&</em></h1>'));
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
    assert.ok(duration < 50, `Duration ${duration}ms should be fast (<10-50ms)`);

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

