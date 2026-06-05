// Minimal config web UI. Vanilla Node http, no framework.
// Binds to localhost by default; reach it over an SSH tunnel.
const http = require('http');
const QRCode = require('qrcode');

const HOST = process.env.WEB_HOST || '127.0.0.1';
const PORT = parseInt(process.env.WEB_PORT || '8080', 10);

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy(); // basic flood guard
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// hooks: { getState, getConfig, saveConfig, relink }
function startServer(hooks) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }

      if (req.method === 'GET' && req.url === '/api/state') {
        const s = hooks.getState();
        let qrImage = null;
        if (s.qr) qrImage = await QRCode.toDataURL(s.qr, { margin: 1, width: 264 });
        sendJson(res, 200, {
          connection: s.connection,
          configured: s.configured,
          lastReply: s.lastReply,
          lastError: s.lastError,
          pendingReply: s.pendingReply,
          qrImage,
        });
        return;
      }

      if (req.method === 'GET' && req.url === '/api/models') {
        try {
          const models = await hooks.getModels();
          sendJson(res, 200, { models });
        } catch (e) {
          sendJson(res, 200, { models: [], error: e.message });
        }
        return;
      }

      if (req.method === 'GET' && req.url === '/api/config') {
        const c = hooks.getConfig();
        sendJson(res, 200, {
          targetNumber: c.targetNumber,
          model: c.model,
          fallbackModel: c.fallbackModel,
          persona: c.persona,
          oncePerDay: c.oncePerDay,
          apiKeySet: Boolean(c.openrouterApiKey),
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/config') {
        const body = await readBody(req);
        const patch = {};
        if (typeof body.targetNumber === 'string')
          patch.targetNumber = body.targetNumber.replace(/\D/g, '');
        if (typeof body.model === 'string') patch.model = body.model.trim();
        if (typeof body.fallbackModel === 'string') patch.fallbackModel = body.fallbackModel.trim();
        if (typeof body.persona === 'string') patch.persona = body.persona;
        if (typeof body.oncePerDay === 'boolean') patch.oncePerDay = body.oncePerDay;
        // Only overwrite the key when a non-empty value is supplied.
        if (typeof body.openrouterApiKey === 'string' && body.openrouterApiKey.trim())
          patch.openrouterApiKey = body.openrouterApiKey.trim();
        hooks.saveConfig(patch);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/relink') {
        await hooks.relink();
        sendJson(res, 200, { ok: true });
        return;
      }

      res.writeHead(404).end('Not found');
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Web UI on http://${HOST}:${PORT}`);
  });
  return server;
}

const PAGE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>autowhatsapper</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: #0f1115; color: #e6e8eb; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 18px 60px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #8b929c; font-size: 13px; margin-bottom: 22px; }
  .card { background: #171a21; border: 1px solid #262b34; border-radius: 12px; padding: 18px; margin-bottom: 16px; }
  .status { display: flex; align-items: center; gap: 10px; font-weight: 600; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #6b7280; flex: none; }
  .dot.open { background: #22c55e; } .dot.qr { background: #eab308; }
  .dot.connecting { background: #3b82f6; } .dot.closed { background: #ef4444; }
  .qrbox { text-align: center; margin-top: 14px; }
  .qrbox img { background: #fff; padding: 10px; border-radius: 10px; width: 264px; max-width: 100%; }
  .hint { color: #8b929c; font-size: 13px; margin-top: 10px; }
  label { display: block; font-size: 13px; color: #aab1bb; margin: 14px 0 5px; }
  input, textarea, select { width: 100%; padding: 9px 11px; background: #0f1115; border: 1px solid #2b313b;
    border-radius: 8px; color: #e6e8eb; font: inherit; }
  textarea { resize: vertical; min-height: 64px; }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .row input[type=checkbox] { width: auto; }
  button { margin-top: 18px; width: 100%; padding: 11px; border: 0; border-radius: 8px;
    background: #2563eb; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  button.ghost { background: #262b34; }
  button.ghost:hover { background: #313845; }
  .saved { color: #22c55e; font-size: 13px; text-align: center; margin-top: 10px; min-height: 18px; }
  .meta { font-size: 12px; color: #8b929c; margin-top: 6px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>autowhatsapper</h1>
  <div class="sub">Guten-Morgen Auto-Antwort · Konfiguration</div>

  <div class="card">
    <div class="status"><span id="dot" class="dot"></span><span id="statusText">Lade…</span></div>
    <div id="qrbox" class="qrbox" style="display:none">
      <img id="qrimg" alt="WhatsApp QR">
      <div class="hint">WhatsApp → Verknüpfte Geräte → Gerät verknüpfen → QR scannen</div>
    </div>
    <div id="meta" class="meta"></div>
    <button id="relink" class="ghost" style="display:none">Neu verknüpfen (abmelden)</button>
  </div>

  <div class="card">
    <form id="cfg">
      <label>Zielnummer (Landesvorwahl, ohne +)</label>
      <input id="targetNumber" inputmode="numeric" placeholder="491701234567">

      <label>OpenRouter API Key</label>
      <input id="openrouterApiKey" type="password" autocomplete="off" placeholder="sk-or-…">
      <div class="meta" id="keyMeta"></div>

      <label>Modell</label>
      <div class="row" style="margin-top:0">
        <input id="freeOnly" type="checkbox">
        <label style="margin:0">Nur Gratis-Modelle anzeigen</label>
      </div>
      <select id="model"></select>
      <div class="meta" id="modelMeta"></div>

      <label>Fallback-Modell (falls das Hauptmodell streikt)</label>
      <select id="fallbackModel"></select>

      <label>Persona (wie der Bot klingt)</label>
      <textarea id="persona"></textarea>

      <div class="row">
        <input id="oncePerDay" type="checkbox">
        <label style="margin:0">Nur auf den ersten Gruß pro Tag antworten</label>
      </div>

      <button type="submit">Speichern</button>
      <div class="saved" id="saved"></div>
    </form>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const labels = { open:'Verbunden', qr:'QR scannen zum Verknüpfen', connecting:'Verbinde…',
  closed:'Getrennt' };

async function refresh() {
  try {
    const s = await (await fetch('/api/state')).json();
    $('dot').className = 'dot ' + s.connection;
    let txt = labels[s.connection] || s.connection;
    if (!s.configured) txt = 'Nicht konfiguriert — bitte Key & Nummer setzen';
    $('statusText').textContent = txt;
    $('qrbox').style.display = s.qrImage ? 'block' : 'none';
    if (s.qrImage) $('qrimg').src = s.qrImage;
    $('relink').style.display = s.connection === 'open' ? 'block' : 'none';
    let meta = '';
    if (s.pendingReply) meta = '⏳ Antwort geplant gegen ' + s.pendingReply + ' Uhr';
    if (s.lastReply) meta += (meta ? ' · ' : '') + 'Letzte Antwort: ' + s.lastReply;
    if (s.lastError) meta += (meta ? ' · ' : '') + 'Fehler: ' + s.lastError;
    $('meta').textContent = meta;
  } catch (e) { /* keep last state */ }
}

let ALL_MODELS = [];
let SAVED_MODEL = '';
let SAVED_FALLBACK = '';
let MODELS_ERR = null;

async function loadModels(selected, fallback) {
  SAVED_MODEL = selected || '';
  SAVED_FALLBACK = fallback || '';
  try {
    const r = await (await fetch('/api/models')).json();
    ALL_MODELS = r.models || [];
    MODELS_ERR = r.error || null;
  } catch (e) { ALL_MODELS = []; MODELS_ERR = e.message; }
  renderModels();
  renderFallback();
}

function formatCost(usd) {
  const cents = usd * 100;
  const s = cents >= 1 ? cents.toFixed(2) : cents.toPrecision(2);
  return '≈ ' + s.replace('.', ',') + ' ¢/Antwort';
}

function fillSelect(sel, list, current) {
  // Keep the saved/selected model usable even if a filter would hide it.
  if (current && !list.some((m) => m.id === current))
    list = [ALL_MODELS.find((m) => m.id === current) || { id: current, name: current }, ...list];
  sel.innerHTML = '';
  for (const m of list) {
    const o = document.createElement('option');
    o.value = m.id;
    let label = (m.free ? '🆓 ' : '') + (m.name && m.name !== m.id ? m.id + ' — ' + m.name : m.id);
    if (!m.free && m.costPerReply) label += '  (' + formatCost(m.costPerReply) + ')';
    o.textContent = label;
    sel.appendChild(o);
  }
  if (current) sel.value = current;
}

function renderModels() {
  const onlyFree = $('freeOnly').checked;
  const current = $('model').value || SAVED_MODEL;
  const list = onlyFree ? ALL_MODELS.filter((m) => m.free) : ALL_MODELS.slice();
  fillSelect($('model'), list, current);
  $('modelMeta').textContent = MODELS_ERR
    ? 'Modell-Liste nicht erreichbar — gespeichertes Modell wird genutzt.'
    : list.length + (onlyFree ? ' Gratis-Modelle' : ' Modelle') + ' von OpenRouter';
}

function renderFallback() {
  // Fallback ignores the free filter — it should be a reliable model.
  const current = $('fallbackModel').value || SAVED_FALLBACK;
  fillSelect($('fallbackModel'), ALL_MODELS.slice(), current);
}

async function loadConfig() {
  const c = await (await fetch('/api/config')).json();
  $('targetNumber').value = c.targetNumber || '';
  await loadModels(c.model, c.fallbackModel);
  $('persona').value = c.persona || '';
  $('oncePerDay').checked = !!c.oncePerDay;
  $('keyMeta').textContent = c.apiKeySet
    ? 'Ein Key ist gespeichert. Feld leer lassen, um ihn zu behalten.'
    : 'Noch kein Key gespeichert.';
}

$('cfg').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    targetNumber: $('targetNumber').value,
    model: $('model').value,
    fallbackModel: $('fallbackModel').value,
    persona: $('persona').value,
    oncePerDay: $('oncePerDay').checked,
  };
  const key = $('openrouterApiKey').value.trim();
  if (key) payload.openrouterApiKey = key;
  const r = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload) });
  $('saved').textContent = r.ok ? 'Gespeichert ✓' : 'Fehler beim Speichern';
  $('openrouterApiKey').value = '';
  await loadConfig();
  setTimeout(() => { $('saved').textContent = ''; }, 2500);
});

$('relink').addEventListener('click', async () => {
  if (!confirm('WhatsApp abmelden und neuen QR-Code anzeigen?')) return;
  await fetch('/api/relink', { method:'POST' });
});

$('freeOnly').addEventListener('change', renderModels);

loadConfig();
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;

module.exports = { startServer };
