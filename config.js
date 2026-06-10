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
  staticRules: [], // [{ keyword, answers: [] }] — per-keyword static answers
  activeStart: '', // HH:MM; empty start/end = always active
  activeEnd: '',
  lang: 'de',
};

// One-time migration: turn a legacy flat `staticReplies` list into per-keyword
// `staticRules`, giving every configured trigger the old answer set so existing
// static setups keep working.
function migrate(cfg) {
  if ((!cfg.staticRules || cfg.staticRules.length === 0)
      && Array.isArray(cfg.staticReplies) && cfg.staticReplies.length > 0) {
    const answers = cfg.staticReplies.filter((s) => s && s.trim());
    cfg.staticRules = (cfg.triggers || []).map((k) => ({ keyword: k, answers: [...answers] }));
  }
  delete cfg.staticReplies; // one-shot: drop the legacy key so it can't re-migrate
  return cfg;
}

function load() {
  try {
    return migrate({ ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) });
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
  if (cfg.replyMode === 'static')
    return (cfg.staticRules || []).some(
      (r) => r && r.keyword && r.keyword.trim() && (r.answers || []).some((a) => a && a.trim())
    );
  return Boolean(cfg.openrouterApiKey);
}

module.exports = { load, save, isConfigured, DEFAULTS, CONFIG_FILE };
