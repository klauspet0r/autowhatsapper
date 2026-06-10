// Live, web-editable config stored in config.json (git-ignored).
// The bot reads this at runtime, so most changes take effect without a restart.
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULTS = {
  targetNumber: '',
  openrouterApiKey: '',
  model: 'anthropic/claude-haiku-4.5',
  fallbackModel: 'anthropic/claude-haiku-4.5',
  persona:
    'Du bist mein freundlicher, leicht verschlafener Morgen-Buddy. ' +
    'Antworte herzlich und kurz auf Deutsch, mit maximal einem Emoji.',
  oncePerDay: true,
  triggers: ['moin', 'moin moin', 'guten morgen'],
  matchMode: 'exact',
  replyMode: 'ai',
  staticReplies: [],
  activeStart: '', // HH:MM; empty start/end = always active
  activeEnd: '',
  lang: 'de',
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

// Merge a partial patch over the current config and persist it.
function save(patch) {
  const merged = { ...load(), ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

function isConfigured(cfg) {
  if (!cfg.targetNumber) return false;
  if (cfg.replyMode === 'static') return (cfg.staticReplies || []).some((s) => s && s.trim());
  return Boolean(cfg.openrouterApiKey);
}

module.exports = { load, save, isConfigured, DEFAULTS, CONFIG_FILE };
