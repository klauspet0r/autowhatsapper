require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const Anthropic = require('@anthropic-ai/sdk');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

// ---- Config ----------------------------------------------------------------
const TARGET_NUMBER = (process.env.TARGET_NUMBER || '').replace(/\D/g, '');
const TARGET_JID = `${TARGET_NUMBER}@s.whatsapp.net`;
const ONCE_PER_DAY = (process.env.ONCE_PER_DAY || 'true') === 'true';
const PERSONA =
  process.env.REPLY_PERSONA ||
  'Du bist ein freundlicher Morgen-Buddy. Antworte kurz und herzlich auf Deutsch.';
const STATE_FILE = path.join(__dirname, 'state.json');

if (!TARGET_NUMBER) {
  console.error('TARGET_NUMBER is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// ---- Greeting detection ----------------------------------------------------
// Matches common German + English good-morning phrasings.
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
  // Local-date string, e.g. "2026-05-30"
  return new Date().toLocaleDateString('sv-SE'); // sv-SE gives ISO-like YYYY-MM-DD
}

function alreadyRepliedToday() {
  if (!ONCE_PER_DAY) return false;
  return loadState().lastReplyDate === todayKey();
}

function markRepliedToday() {
  saveState({ lastReplyDate: todayKey() });
}

// ---- AI reply --------------------------------------------------------------
async function generateReply(incomingText) {
  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 150,
    system: `${PERSONA}\nDu antwortest auf eine "Guten Morgen"-Nachricht. Halte es natuerlich, variiere die Formulierung jeden Tag, kein Smalltalk-Fragenkatalog. Nur die Antwort selbst, ohne Anfuehrungszeichen.`,
    messages: [{ role: 'user', content: `Die Nachricht lautet: "${incomingText}"` }],
  });
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text || 'Guten Morgen! ☀️';
}

// ---- WhatsApp connection ---------------------------------------------------
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth'));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code in WhatsApp > Linked devices:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log(`Connected. Watching for good-morning messages from ${TARGET_NUMBER}.`);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`Connection closed (code ${code}).${loggedOut ? ' Logged out.' : ' Reconnecting...'}`);
      if (!loggedOut) start();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid !== TARGET_JID) continue;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!isGoodMorning(text)) continue;
      if (alreadyRepliedToday()) {
        console.log('Already replied today, skipping.');
        continue;
      }

      try {
        const reply = await generateReply(text);
        await sock.sendMessage(TARGET_JID, { text: reply });
        markRepliedToday();
        console.log(`Replied: ${reply}`);
      } catch (err) {
        console.error('Failed to reply:', err.message);
      }
    }
  });
}

start();
