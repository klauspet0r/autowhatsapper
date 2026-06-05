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
const status = { connection: 'closed', qr: null, lastReply: null, lastError: null };
let sock = null;

// ---- Greeting detection ----------------------------------------------------
const GREETING_RE = /\b(guten\s*morgen|good\s*morning|moin(?:\s*moin)?|morgen|g'?morgen)\b/i;

function isGoodMorning(text) {
  return GREETING_RE.test(text || '');
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
  saveState({ lastReplyDate: todayKey() });
}

// ---- AI reply --------------------------------------------------------------
async function generateReply(incomingText) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 150,
      messages: [
        {
          role: 'system',
          content: `${cfg.persona}\nDu antwortest auf eine "Guten Morgen"-Nachricht. Halte es natuerlich, variiere die Formulierung jeden Tag, kein Smalltalk-Fragenkatalog. Nur die Antwort selbst, ohne Anfuehrungszeichen.`,
        },
        { role: 'user', content: `Die Nachricht lautet: "${incomingText}"` },
      ],
    }),
  });
  if (!resp.ok) {
    throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  return text || 'Guten Morgen! ☀️';
}

// ---- WhatsApp connection ---------------------------------------------------
async function startSock() {
  if (sock) return;
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }) });
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
      if (msg.key.remoteJid !== targetJid) continue;

      const text =
        msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

      if (!isGoodMorning(text)) continue;
      if (alreadyRepliedToday()) {
        console.log('Already replied today, skipping.');
        continue;
      }

      try {
        const reply = await generateReply(text);
        await sock.sendMessage(targetJid, { text: reply });
        markRepliedToday();
        status.lastReply = reply;
        status.lastError = null;
        console.log(`Replied: ${reply}`);
      } catch (err) {
        status.lastError = err.message;
        console.error('Failed to reply:', err.message);
      }
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
