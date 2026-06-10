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

// hooks: { getState, getConfig, saveConfig, relink, sendNow }
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
          triggers: c.triggers,
          matchMode: c.matchMode,
          replyMode: c.replyMode,
          staticRules: c.staticRules,
          activeStart: c.activeStart,
          activeEnd: c.activeEnd,
          lang: c.lang,
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
        if (Array.isArray(body.triggers))
          patch.triggers = body.triggers
            .filter((t) => typeof t === 'string')
            .map((t) => t.trim())
            .filter(Boolean);
        if (body.matchMode === 'exact' || body.matchMode === 'contains')
          patch.matchMode = body.matchMode;
        if (body.replyMode === 'ai' || body.replyMode === 'static')
          patch.replyMode = body.replyMode;
        if (body.lang === 'de' || body.lang === 'en') patch.lang = body.lang;
        if (Array.isArray(body.staticRules))
          patch.staticRules = body.staticRules
            .filter((r) => r && typeof r.keyword === 'string')
            .map((r) => ({
              keyword: r.keyword.trim(),
              answers: Array.isArray(r.answers)
                ? r.answers.filter((a) => typeof a === 'string').map((a) => a.trim()).filter(Boolean)
                : [],
            }))
            .filter((r) => r.keyword);
        // Active window: accept HH:MM (24h) or empty (= always active).
        const HM = /^([01]?\d|2[0-3]):[0-5]\d$/;
        for (const k of ['activeStart', 'activeEnd'])
          if (typeof body[k] === 'string' && (body[k] === '' || HM.test(body[k])))
            patch[k] = body[k];
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

      if (req.method === 'POST' && req.url === '/api/send-now') {
        const sent = await hooks.sendNow();
        sendJson(res, 200, { ok: true, sent });
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
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .lang { font-size: 12px; color: #8b929c; }
  .lang button { width: auto; margin: 0; padding: 2px 7px; background: transparent; color: #8b929c;
    font: inherit; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; }
  .lang button:hover { background: #262b34; color: #e6e8eb; }
  .lang button.active { color: #e6e8eb; background: #262b34; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
  .chips:empty { display: none; }
  .chip { display: inline-flex; align-items: center; gap: 4px; background: #262b34;
    border: 1px solid #313845; border-radius: 999px; padding: 4px 6px 4px 11px; font-size: 13px; }
  .chip button { all: unset; cursor: pointer; width: 18px; height: 18px; line-height: 18px;
    text-align: center; border-radius: 50%; color: #8b929c; font-size: 14px; }
  .chip button:hover { background: #ef4444; color: #fff; }
  .chip-add { display: flex; gap: 8px; }
  .chip-add input { flex: 1; }
  .chip-add button { width: auto; margin: 0; flex: none; padding: 0 14px; }
  .rule { border: 1px solid #2b313b; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
  .rule-head { display: flex; gap: 8px; margin-bottom: 8px; }
  .rule-head input { flex: 1; }
  .rule-del { width: auto; margin: 0; flex: none; padding: 0 12px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div>
      <h1>autowhatsapper</h1>
      <div class="sub" data-i18n="subtitle"></div>
    </div>
    <div class="lang">
      <button type="button" id="langDe" data-lang="de">DE</button>
      <span>|</span>
      <button type="button" id="langEn" data-lang="en">EN</button>
    </div>
  </div>

  <div class="card">
    <div class="status"><span id="dot" class="dot"></span><span id="statusText">…</span></div>
    <div id="qrbox" class="qrbox" style="display:none">
      <img id="qrimg" alt="WhatsApp QR">
      <div class="hint" data-i18n="qrHint"></div>
    </div>
    <div id="meta" class="meta"></div>
    <button id="sendNow" style="display:none" data-i18n="sendNow"></button>
    <button id="relink" class="ghost" style="display:none" data-i18n="relink"></button>
  </div>

  <div class="card">
    <form id="cfg">
      <label data-i18n="targetNumber"></label>
      <input id="targetNumber" inputmode="numeric" placeholder="491701234567">

      <label data-i18n="replyMode"></label>
      <select id="replyMode">
        <option value="ai" data-i18n="modeAi"></option>
        <option value="static" data-i18n="modeStatic"></option>
      </select>
      <div class="meta" id="modeMeta"></div>

      <div id="staticFields">
        <label data-i18n="staticRules"></label>
        <div class="meta" data-i18n="staticRulesHint"></div>
        <div id="staticRules"></div>
        <button type="button" class="ghost" id="addRuleBtn" data-i18n="addKeyword"></button>
      </div>

      <div id="aiFields">
        <label data-i18n="apiKey"></label>
        <input id="openrouterApiKey" type="password" autocomplete="off" placeholder="sk-or-…">
        <div class="meta" id="keyMeta"></div>

        <label data-i18n="model"></label>
        <div class="row" style="margin-top:0">
          <input id="freeOnly" type="checkbox">
          <label style="margin:0" data-i18n="freeOnly"></label>
        </div>
        <select id="model"></select>
        <div class="meta" id="modelMeta"></div>

        <label data-i18n="fallbackModel"></label>
        <select id="fallbackModel"></select>

        <label data-i18n="persona"></label>
        <textarea id="persona"></textarea>

        <label data-i18n="triggers"></label>
        <div class="chips" id="triggersChips"></div>
        <div class="chip-add">
          <input id="triggersInput" data-i18n-ph="triggersPh">
          <button type="button" class="ghost" id="triggersAddBtn" data-i18n="add"></button>
        </div>
      </div>

      <label data-i18n="matchMode"></label>
      <select id="matchMode">
        <option value="exact" data-i18n="matchExact"></option>
        <option value="contains" data-i18n="matchContains"></option>
      </select>

      <label data-i18n="activeWindow"></label>
      <div class="row" style="margin-top:0">
        <input id="activeStart" type="time">
        <span style="color:#8b929c">–</span>
        <input id="activeEnd" type="time">
      </div>
      <div class="meta" data-i18n="activeWindowHint"></div>

      <div class="row">
        <input id="oncePerDay" type="checkbox">
        <label style="margin:0" data-i18n="oncePerDay"></label>
      </div>

      <button type="submit" data-i18n="save"></button>
      <div class="saved" id="saved"></div>
    </form>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);

const I18N = {
  de: {
    subtitle: 'WhatsApp Auto-Antwort · Konfiguration',
    loading: 'Lade…',
    statusOpen: 'Verbunden',
    statusQr: 'QR scannen zum Verknüpfen',
    statusConnecting: 'Verbinde…',
    statusClosed: 'Getrennt',
    notConfigured: 'Nicht konfiguriert — bitte Einrichtung abschließen',
    qrHint: 'WhatsApp → Verknüpfte Geräte → Gerät verknüpfen → QR scannen',
    relink: 'Neu verknüpfen (abmelden)',
    relinkConfirm: 'WhatsApp abmelden und neuen QR-Code anzeigen?',
    sendNow: 'Jetzt senden',
    targetNumber: 'Zielnummer (Landesvorwahl, ohne +)',
    replyMode: 'Antwort-Modus',
    modeAi: 'KI (OpenRouter)',
    modeStatic: 'Feste Texte',
    modeActiveAi: 'Aktiv: KI',
    modeActiveStatic: 'Aktiv: Feste Texte',
    staticRules: 'Feste Antworten je Stichwort',
    staticRulesHint: 'Pro Stichwort mehrere Antworten — bei einem Treffer wird zufällig eine davon gewählt.',
    addKeyword: '+ Stichwort',
    ruleKeywordPh: 'Stichwort (z. B. Moin)',
    ruleAnswerPh: 'Antwort eingeben',
    add: 'Hinzufügen',
    apiKey: 'OpenRouter API Key',
    keyNeeded: 'OpenRouter-Key nötig für den KI-Modus.',
    keySaved: 'Ein Key ist gespeichert. Feld leer lassen, um ihn zu behalten.',
    keyNone: 'Noch kein Key gespeichert.',
    model: 'Modell',
    freeOnly: 'Nur Gratis-Modelle anzeigen',
    modelsErr: 'Modell-Liste nicht erreichbar — gespeichertes Modell wird genutzt.',
    modelsFree: ' Gratis-Modelle von OpenRouter',
    modelsAll: ' Modelle von OpenRouter',
    costSuffix: ' ¢/Antwort',
    fallbackModel: 'Fallback-Modell (falls das Hauptmodell streikt)',
    persona: 'Persona (wie der Bot klingt)',
    triggers: 'Trigger',
    triggersPh: 'Wort/Satz eingeben',
    matchMode: 'Trefferart',
    matchExact: 'Exakt',
    matchContains: 'Enthält',
    oncePerDay: 'Nur auf die erste passende Nachricht pro Tag antworten',
    activeWindow: 'Aktives Zeitfenster (leer = immer aktiv)',
    activeWindowHint: 'Nur Nachrichten in diesem Fenster (Pi-Ortszeit) werden beantwortet. Über Mitternacht möglich (z. B. 22:00–06:00).',
    save: 'Speichern',
    saved: 'Gespeichert ✓',
    saveError: 'Fehler beim Speichern',
    metaPending: '⏳ Antwort geplant gegen ',
    metaPendingSuffix: ' Uhr',
    metaLastReply: 'Letzte Antwort: ',
    metaError: 'Fehler: ',
  },
  en: {
    subtitle: 'WhatsApp Auto Reply · Configuration',
    loading: 'Loading…',
    statusOpen: 'Connected',
    statusQr: 'Scan QR to link',
    statusConnecting: 'Connecting…',
    statusClosed: 'Disconnected',
    notConfigured: 'Not configured — please finish setup',
    qrHint: 'WhatsApp → Linked devices → Link a device → Scan QR',
    relink: 'Re-link (log out)',
    relinkConfirm: 'Log out of WhatsApp and show a new QR code?',
    sendNow: 'Send now',
    targetNumber: 'Target number (country code, without +)',
    replyMode: 'Reply mode',
    modeAi: 'AI (OpenRouter)',
    modeStatic: 'Fixed texts',
    modeActiveAi: 'Active: AI',
    modeActiveStatic: 'Active: Fixed texts',
    staticRules: 'Fixed replies per keyword',
    staticRulesHint: 'Several answers per keyword — one is picked at random when it matches.',
    addKeyword: '+ Keyword',
    ruleKeywordPh: 'Keyword (e.g. Moin)',
    ruleAnswerPh: 'Enter an answer',
    add: 'Add',
    apiKey: 'OpenRouter API key',
    keyNeeded: 'OpenRouter key required for AI mode.',
    keySaved: 'A key is saved. Leave the field empty to keep it.',
    keyNone: 'No key saved yet.',
    model: 'Model',
    freeOnly: 'Show free models only',
    modelsErr: 'Model list unavailable — the saved model will be used.',
    modelsFree: ' free models from OpenRouter',
    modelsAll: ' models from OpenRouter',
    costSuffix: ' ¢/reply',
    fallbackModel: 'Fallback model (if the main model fails)',
    persona: 'Persona (how the bot sounds)',
    triggers: 'Triggers',
    triggersPh: 'Enter word/phrase',
    matchMode: 'Match type',
    matchExact: 'Exact',
    matchContains: 'Contains',
    oncePerDay: 'Only reply to the first matching message per day',
    activeWindow: 'Active time window (empty = always on)',
    activeWindowHint: 'Only messages arriving in this window (Pi local time) are answered. May cross midnight (e.g. 22:00–06:00).',
    save: 'Save',
    saved: 'Saved ✓',
    saveError: 'Save failed',
    metaPending: '⏳ Reply scheduled around ',
    metaPendingSuffix: '',
    metaLastReply: 'Last reply: ',
    metaError: 'Error: ',
  },
};

let LANG = 'de';
const t = (key) => (I18N[LANG] && I18N[LANG][key] != null ? I18N[LANG][key] : key);

function applyLang(lang) {
  LANG = I18N[lang] ? lang : 'de';
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  $('langDe').classList.toggle('active', LANG === 'de');
  $('langEn').classList.toggle('active', LANG === 'en');
  // Re-render JS-driven strings in the new language.
  renderRules();
  applyMode();
  renderModels();
  refresh();
}

async function refresh() {
  try {
    const s = await (await fetch('/api/state')).json();
    $('dot').className = 'dot ' + s.connection;
    const statusKeys = { open:'statusOpen', qr:'statusQr', connecting:'statusConnecting', closed:'statusClosed' };
    let txt = statusKeys[s.connection] ? t(statusKeys[s.connection]) : s.connection;
    if (!s.configured) txt = t('notConfigured');
    $('statusText').textContent = txt;
    $('qrbox').style.display = s.qrImage ? 'block' : 'none';
    if (s.qrImage) $('qrimg').src = s.qrImage;
    $('relink').style.display = s.connection === 'open' ? 'block' : 'none';
    $('sendNow').style.display = s.pendingReply ? 'block' : 'none';
    let meta = '';
    if (s.pendingReply) meta = t('metaPending') + s.pendingReply + t('metaPendingSuffix');
    if (s.lastReply) meta += (meta ? ' · ' : '') + t('metaLastReply') + s.lastReply;
    if (s.lastError) meta += (meta ? ' · ' : '') + t('metaError') + s.lastError;
    $('meta').textContent = meta;
  } catch (e) { /* keep last state */ }
}

let ALL_MODELS = [];
let SAVED_MODEL = '';
let SAVED_FALLBACK = '';
let MODELS_ERR = null;
let API_KEY_SET = false;

// Chip list for AI-mode triggers — the source of truth on save.
const CHIPS = { triggers: [] };

function renderChips(name) {
  const box = $(name + 'Chips');
  box.innerHTML = '';
  CHIPS[name].forEach((val, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = val;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', 'remove');
    x.addEventListener('click', () => { CHIPS[name].splice(i, 1); renderChips(name); });
    chip.appendChild(label);
    chip.appendChild(x);
    box.appendChild(chip);
  });
}

function addChip(name) {
  const input = $(name + 'Input');
  const val = input.value.trim();
  if (val && !CHIPS[name].includes(val)) {
    CHIPS[name].push(val);
    renderChips(name);
  }
  input.value = '';
  input.focus();
}

['triggers'].forEach((name) => {
  $(name + 'AddBtn').addEventListener('click', () => addChip(name));
  $(name + 'Input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addChip(name); }
  });
});

// Per-keyword static rules: [{ keyword, answers: [] }] — the source of truth on
// save. Handlers capture the rule/answer by identity so add/remove stays correct
// without re-rendering the whole list.
let RULES = [];

function answerChip(rule, ans) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  const label = document.createElement('span');
  label.textContent = ans;
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '×';
  x.setAttribute('aria-label', 'remove');
  x.addEventListener('click', () => {
    const k = rule.answers.indexOf(ans);
    if (k > -1) rule.answers.splice(k, 1);
    chip.remove();
  });
  chip.appendChild(label);
  chip.appendChild(x);
  return chip;
}

function ruleCard(rule) {
  const card = document.createElement('div');
  card.className = 'rule';

  const head = document.createElement('div');
  head.className = 'rule-head';
  const kw = document.createElement('input');
  kw.type = 'text';
  kw.value = rule.keyword;
  kw.placeholder = t('ruleKeywordPh');
  kw.addEventListener('input', () => { rule.keyword = kw.value; });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'ghost rule-del';
  del.textContent = '×';
  del.addEventListener('click', () => {
    const i = RULES.indexOf(rule);
    if (i > -1) RULES.splice(i, 1);
    card.remove();
  });
  head.appendChild(kw);
  head.appendChild(del);

  const chips = document.createElement('div');
  chips.className = 'chips';
  rule.answers.forEach((a) => chips.appendChild(answerChip(rule, a)));

  const addRow = document.createElement('div');
  addRow.className = 'chip-add';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = t('ruleAnswerPh');
  const add = () => {
    const v = inp.value.trim();
    if (v && !rule.answers.includes(v)) {
      rule.answers.push(v);
      chips.appendChild(answerChip(rule, v));
    }
    inp.value = '';
    inp.focus();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'ghost';
  addBtn.textContent = t('add');
  addBtn.addEventListener('click', add);
  addRow.appendChild(inp);
  addRow.appendChild(addBtn);

  card.appendChild(head);
  card.appendChild(chips);
  card.appendChild(addRow);
  return card;
}

function renderRules() {
  const box = $('staticRules');
  box.innerHTML = '';
  RULES.forEach((rule) => box.appendChild(ruleCard(rule)));
}

$('addRuleBtn').addEventListener('click', () => {
  const rule = { keyword: '', answers: [] };
  RULES.push(rule);
  $('staticRules').appendChild(ruleCard(rule));
});

function applyMode() {
  const mode = $('replyMode').value;
  const isAi = mode === 'ai';
  $('aiFields').style.display = isAi ? 'block' : 'none';
  $('staticFields').style.display = isAi ? 'none' : 'block';
  $('modeMeta').textContent = isAi ? t('modeActiveAi') : t('modeActiveStatic');
  if (isAi && !API_KEY_SET && !$('openrouterApiKey').value.trim())
    $('keyMeta').textContent = t('keyNeeded');
  else
    $('keyMeta').textContent = API_KEY_SET ? t('keySaved') : t('keyNone');
}

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
  return '≈ ' + (LANG === 'de' ? s.replace('.', ',') : s) + t('costSuffix');
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
    ? t('modelsErr')
    : list.length + (onlyFree ? t('modelsFree') : t('modelsAll'));
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
  CHIPS.triggers = (c.triggers || []).slice();
  renderChips('triggers');
  $('matchMode').value = c.matchMode || 'exact';
  $('replyMode').value = c.replyMode || 'ai';
  RULES = (c.staticRules || []).map((r) => ({ keyword: r.keyword || '', answers: (r.answers || []).slice() }));
  renderRules();
  $('oncePerDay').checked = !!c.oncePerDay;
  $('activeStart').value = c.activeStart || '';
  $('activeEnd').value = c.activeEnd || '';
  API_KEY_SET = !!c.apiKeySet;
  applyLang(c.lang || 'de');
}

$('cfg').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    targetNumber: $('targetNumber').value,
    model: $('model').value,
    fallbackModel: $('fallbackModel').value,
    persona: $('persona').value,
    triggers: CHIPS.triggers.slice(),
    matchMode: $('matchMode').value,
    replyMode: $('replyMode').value,
    staticRules: RULES.map((r) => ({ keyword: r.keyword.trim(), answers: r.answers.slice() }))
      .filter((r) => r.keyword),
    oncePerDay: $('oncePerDay').checked,
    activeStart: $('activeStart').value,
    activeEnd: $('activeEnd').value,
    lang: LANG,
  };
  const key = $('openrouterApiKey').value.trim();
  if (key) payload.openrouterApiKey = key;
  const r = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload) });
  $('saved').textContent = r.ok ? t('saved') : t('saveError');
  $('openrouterApiKey').value = '';
  await loadConfig();
  setTimeout(() => { $('saved').textContent = ''; }, 2500);
});

$('relink').addEventListener('click', async () => {
  if (!confirm(t('relinkConfirm'))) return;
  await fetch('/api/relink', { method:'POST' });
});

$('sendNow').addEventListener('click', async () => {
  $('sendNow').disabled = true;
  try { await fetch('/api/send-now', { method:'POST' }); } catch (e) { /* refresh shows result */ }
  await refresh();
  $('sendNow').disabled = false;
});

function switchLang(lang) {
  if (lang === LANG) return;
  applyLang(lang);
  fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ lang: LANG }) });
}
$('langDe').addEventListener('click', () => switchLang('de'));
$('langEn').addEventListener('click', () => switchLang('en'));

$('freeOnly').addEventListener('change', renderModels);
$('replyMode').addEventListener('change', applyMode);
$('openrouterApiKey').addEventListener('input', applyMode);

applyLang('de');
loadConfig();
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;

module.exports = { startServer };
