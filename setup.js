// Interactive first-run wizard: writes config.json via the config module.
// Run with `npm run setup`. Uses only Node built-ins (no extra deps).
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const config = require('./config');

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const current = config.load();

  console.log('\nautowhatsapper setup — a quick, friendly first run.\n');
  console.log("Press Enter to keep the suggested value in [brackets].\n");

  // Target number: digits only, required.
  let targetNumber = '';
  while (!targetNumber) {
    const hint = current.targetNumber ? ` [${current.targetNumber}]` : '';
    const answer = await rl.question(
      `Target number (country code, no +, e.g. 491701234567)${hint}: `
    );
    const digits = answer.replace(/\D/g, '');
    targetNumber = digits || current.targetNumber;
    if (!targetNumber) console.log('  Please enter a number.\n');
  }

  // API key: optional, never overwrite an existing key with blank.
  const keyHint = current.openrouterApiKey ? ' [keeping current key]' : '';
  const keyAnswer = await rl.question(
    `OpenRouter API key (leave blank to set later in the web UI)${keyHint}: `
  );

  // Persona: optional, blank keeps current.
  const persona = (await rl.question(
    `Persona [${current.persona}]: `
  )).trim();

  rl.close();

  const patch = { targetNumber };
  if (keyAnswer.trim()) patch.openrouterApiKey = keyAnswer.trim();
  if (persona) patch.persona = persona;
  config.save(patch);

  console.log('\nSaved. Next steps:');
  console.log('  1. Run:  npm start');
  console.log('  2. Open: http://127.0.0.1:8080');
  console.log('  3. Scan the WhatsApp QR (Phone → Linked devices → Link a device).');
  if (!config.load().openrouterApiKey) {
    console.log('\nNo API key yet — add it in the web UI before the bot can reply.');
  }
  console.log('');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
