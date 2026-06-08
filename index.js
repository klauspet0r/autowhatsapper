const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const config = require('./config');
const { startServer } = require('./web');

const AUTH_DIR = path.join(__dirname, 'auth');
const STATE_FILE = path.join(__dirname, 'state.json');

let cfg = config.load();

// Live status surfaced to the web UI.
const status = { connection: 'closed', qr: null, lastReply: null, lastError: null, pendingReply: null };
let sock = null;
let replyScheduled = false; // a delayed reply is currently pending

// Wait a random 5-30 min after a greeting before replying, so it doesn't look automated.
const MIN_DELAY_MS = 5 * 60 * 1000;
const MAX_DELAY_MS = 30 * 60 * 1000;

// ---- Trigger detection -----------------------------------------------------
// Reply when the message matches one of the configured triggers. Emojis,
// punctuation and digits are stripped first, so "Moin 😊" or "Guten Morgen!"
// still match. In 'exact' mode the whole cleaned message must equal a trigger,
// so "Guten Morgen, wie geht's?" does not match; in 'contains' mode it suffices
// that the cleaned message contains a trigger.
function clean(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ') // keep letters + whitespace, drop emoji/punctuation/digits
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesTrigger(text, cfg) {
  const cleaned = clean(text);
  const triggers = (cfg.triggers || []).map(clean).filter(Boolean);
  if (cfg.matchMode === 'contains')
    return triggers.some((t) => cleaned.includes(t));
  return triggers.some((t) => cleaned === t);
}

// ---- Once-per-day guard ----------------------------------------------------
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function todayKey() {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
}

function alreadyRepliedToday() {
  if (!cfg.oncePerDay) return false;
  return loadState().lastReplyDate === todayKey();
}

function markRepliedToday() {
  const state = loadState();
  state.lastReplyDate = todayKey();
  saveState(state);
}

function setPending(at, text) {
  const state = loadState();
  state.pending = { at, text };
  saveState(state);
}

function clearPending() {
  const state = loadState();
  delete state.pending;
  saveState(state);
}

// ---- AI reply --------------------------------------------------------------
// Emoji cluster matcher (base pictograph + optional VS16 / ZWJ sequences / skin tones).
const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;
const FALLBACK_EMOJIS = ['☀️', '🌞', '😊', '👋', '🌅'];

// Guarantee the reply carries exactly one fitting emoji.
function ensureOneEmoji(text) {
  const matches = text.match(EMOJI_RE) || [];
  if (matches.length === 0) {
    const e = FALLBACK_EMOJIS[Math.floor(Math.random() * FALLBACK_EMOJIS.length)];
    return `${text} ${e}`.trim();
  }
  if (matches.length > 1) {
    let kept = false;
    return text
      .replace(EMOJI_RE, (m) => (kept ? '' : ((kept = true), m)))
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function systemPrompt() {
  return `${cfg.persona}\nDu antwortest auf eine "Guten Morgen"-Nachricht. Halte es natuerlich, variiere die Formulierung jeden Tag, kein Smalltalk-Fragenkatalog. Beende mit genau einem einzigen, zur Antwort passenden Emoji. Nur die Antwort selbst, ohne Anfuehrungszeichen.`;
}

async function callModel(model, incomingText) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 150,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: `Die Nachricht lautet: "${incomingText}"` },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

// Try one model up to `attempts` times with a short delay between tries.
async function tryModel(model, incomingText, attempts) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const text = await callModel(model, incomingText);
      if (text) return text;
      lastErr = new Error('empty response');
    } catch (err) {
      lastErr = err;
      console.warn(`Model ${model} try ${i + 1}/${attempts} failed: ${err.message}`);
    }
    if (i < attempts - 1) await sleep(2000);
  }
  throw lastErr;
}

// Primary model with retries, then fall back to the configured fallback model.
async function generateReply(incomingText) {
  const models = [cfg.model];
  if (cfg.fallbackModel && cfg.fallbackModel !== cfg.model) models.push(cfg.fallbackModel);

  let lastErr;
  for (const model of models) {
    try {
      const text = await tryModel(model, incomingText, 3);
      if (model !== cfg.model) console.log(`Primary model failed; used fallback ${model}.`);
      return ensureOneEmoji(text);
    } catch (err) {
      lastErr = err;
      console.warn(`Model ${model} exhausted retries: ${err.message}`);
    }
  }
  throw lastErr || new Error('reply generation failed');
}

// ---- OpenRouter model list (for the UI dropdown) ---------------------------
// Rough token counts for one good-morning reply, used to estimate per-reply cost.
const EST_INPUT_TOKENS = 200;
const EST_OUTPUT_TOKENS = 80;
let modelsCache = { at: 0, list: null };

async function getModels() {
  const now = Date.now();
  if (modelsCache.list && now - modelsCache.at < 6 * 60 * 60 * 1000) {
    return modelsCache.list;
  }
  const resp = await fetch('https://openrouter.ai/api/v1/models');
  if (!resp.ok) throw new Error(`OpenRouter models ${resp.status}`);
  const data = await resp.json();
  const list = (data.data || [])
    .map((m) => {
      const p = m.pricing || {};
      const prompt = parseFloat(p.prompt || 0);
      const completion = parseFloat(p.completion || 0);
      const request = parseFloat(p.request || 0);
      const free = prompt === 0 && completion === 0 && request === 0;
      // Estimated USD cost of one short reply.
      const costPerReply = EST_INPUT_TOKENS * prompt + EST_OUTPUT_TOKENS * completion + request;
      return { id: m.id, name: m.name || m.id, free, costPerReply };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  modelsCache = { at: now, list };
  return list;
}

// ---- Delayed reply scheduling ----------------------------------------------
// The planned send time is persisted to state.json, so a restart during the
// wait resumes the reply (see resumePending) instead of dropping it.
function armReply(at, incomingText, targetJid) {
  replyScheduled = true;
  status.pendingReply = new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const remaining = Math.max(0, at - Date.now());
  console.log(`Reply armed for ${status.pendingReply} (in ${Math.round(remaining / 60000)} min).`);

  setTimeout(async () => {
    try {
      const reply = await generateReply(incomingText);
      await sock.sendMessage(targetJid, { text: reply });
      markRepliedToday();
      status.lastReply = reply;
      status.lastError = null;
      console.log(`Replied: ${reply}`);
    } catch (err) {
      status.lastError = err.message;
      console.error('Failed to reply:', err.message);
    } finally {
      clearPending();
      replyScheduled = false;
      status.pendingReply = null;
    }
  }, remaining);
}

function scheduleReply(incomingText, targetJid) {
  const delay = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
  const at = Date.now() + delay;
  setPending(at, incomingText);
  armReply(at, incomingText, targetJid);
}

// On (re)connect, resume a reply that was scheduled before a restart.
function resumePending() {
  if (replyScheduled) return;
  const { pending } = loadState();
  if (!pending || !pending.at) return;
  if (Date.now() - pending.at > 60 * 60 * 1000) {
    console.log('Discarding stale pending reply (>1h overdue).');
    clearPending();
    return;
  }
  armReply(pending.at, pending.text || '', `${cfg.targetNumber}@s.whatsapp.net`);
}

// ---- WhatsApp connection ---------------------------------------------------
async function startSock() {
  if (sock) return;
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  // markOnlineOnConnect: false keeps the phone receiving push notifications;
  // otherwise the always-on linked device looks "online" and WhatsApp suppresses them.
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), markOnlineOnConnect: false });
  status.connection = 'connecting';

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      status.qr = qr;
      status.connection = 'qr';
    }

    if (connection === 'open') {
      status.connection = 'open';
      status.qr = null;
      console.log(`Connected. Watching for good-morning messages from ${cfg.targetNumber}.`);
      resumePending();
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      sock = null;
      status.connection = 'closed';
      console.log(`Connection closed (code ${code}).${loggedOut ? ' Logged out.' : ' Reconnecting...'}`);
      if (loggedOut) {
        status.qr = null;
      } else {
        startSock();
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const targetJid = `${cfg.targetNumber}@s.whatsapp.net`;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      // Newer WhatsApp addresses chats by @lid; senderPn carries the real phone-number JID.
      if (msg.key.remoteJid !== targetJid && msg.key.senderPn !== targetJid) continue;

      const text =
        msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

      if (!matchesTrigger(text, cfg)) continue;
      if (replyScheduled) continue; // a reply is already pending
      if (alreadyRepliedToday()) {
        console.log('Already replied today, skipping.');
        continue;
      }

      scheduleReply(text, targetJid);
    }
  });
}

// Log out of WhatsApp and clear the saved session so a fresh QR is shown.
async function relink() {
  try {
    if (sock) await sock.logout();
  } catch {
    /* ignore — we clear the session regardless */
  }
  sock = null;
  status.connection = 'closed';
  status.qr = null;
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  startSock();
}

// Re-read config after the web UI saves; connect if we just became configured.
function reload() {
  cfg = config.load();
  if (config.isConfigured(cfg) && !sock) startSock();
}

// ---- Wire up ---------------------------------------------------------------
startServer({
  getState: () => ({ ...status, configured: config.isConfigured(cfg) }),
  getConfig: () => cfg,
  getModels,
  saveConfig: (patch) => {
    config.save(patch);
    reload();
  },
  relink,
});

if (config.isConfigured(cfg)) {
  startSock();
} else {
  console.log('Not configured yet. Open the web UI to set the API key and target number.');
}
