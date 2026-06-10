# autowhatsapper

> A tiny WhatsApp bot that auto-replies to one contact when their message matches your
> triggers — with either a predefined text or a fresh, AI-written reply.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Made for Raspberry Pi](https://img.shields.io/badge/runs%20on-Raspberry%20Pi-c51a4a?logo=raspberrypi&logoColor=white)](DEPLOY.md)

When a specific contact sends a message that matches one of your configured triggers,
autowhatsapper waits a natural-looking few minutes and replies — either with a predefined
text or a one-off, AI-generated answer. It links to your personal WhatsApp account
like WhatsApp Web — no business API, no browser — and is configured entirely
through a small built-in web page.

> [!WARNING]
> This uses an **unofficial library with your personal account**, which is
> against WhatsApp's Terms of Service. For a low-volume, single-contact personal
> bot the practical risk is low, but not zero. Don't use it for spam or mass
> messaging — that's both against the ToS and not what this project is for.

## Documentation

- [⚡ 60-second quickstart](#-60-second-quickstart) — clone, install, scan, done
- [Configuration](#configuration) — settings, AI vs. static mode, env vars
- [Raspberry Pi guide (DEPLOY.md)](DEPLOY.md) — run it 24/7 as a `systemd` service

## Features

- **AI or static replies** — generate a fresh answer via [OpenRouter](https://openrouter.ai/)
  (default model Claude Haiku 4.5), or answer from your own predefined texts — no API key needed.
- **Looks human** — replies fire after a random 5–30 minute delay; AI replies carry exactly
  one fitting emoji. Optionally answer only the first matching message per day — or send a
  pending reply immediately from the UI.
- **Configurable triggers** — reply when the message matches one of your keywords/phrases.
  *Exact* mode needs the whole message to match (default, so "Guten Morgen, wie geht's?" is
  ignored); *contains* mode matches a trigger inside a longer message.
- **No file editing** — set everything (key, number, model, persona, triggers, replies) in a
  built-in web UI with a German/English toggle, and scan the WhatsApp linking QR in your browser.
- **Resilient** — survives restarts (a pending reply resumes), retries on model
  errors, and falls back to a second model if the primary one is down.
- **Runs 24/7** — ships with a `systemd` unit for a Raspberry Pi.

## How it works

```
WhatsApp (your phone)
        │  message from the target contact
        ▼
   Baileys socket  ──►  trigger matched?  ──►  wait 5–30 min
   (linked device)                                  │
                                                     ▼
                         static reply or OpenRouter-generated answer
                                                     │
                                                     ▼
                                  reply sent back to the contact
```

Configuration and live status (connection, QR, last reply, pending reply) are
served by a minimal vanilla-Node web UI — no framework, no build step.

## ⚡ 60-second quickstart

```bash
git clone https://github.com/klauspet0r/autowhatsapper.git
cd autowhatsapper
npm install
npm start
```

Then open **http://127.0.0.1:8080** and scan the QR with WhatsApp.

Prefer a guided first run? `npm run setup` walks you through the target number,
API key, and persona on the command line — then just `npm start` and scan the QR.

## Quick start (local)

Requires **Node.js 18+** (for the built-in `fetch`).

```bash
git clone https://github.com/klauspet0r/autowhatsapper.git
cd autowhatsapper
npm install
npm start
```

The web UI starts on **http://127.0.0.1:8080** (localhost only). Open it, then:

1. Enter your [OpenRouter API key](https://openrouter.ai/keys) and the target number.
2. Save.
3. A WhatsApp QR appears — on your phone go to
   **WhatsApp → Linked devices → Link a device** and scan it.
4. Status flips to **Verbunden** (connected). It now replies on its own.

The session is stored in `auth/`, so linking is a one-time step. Your settings
live in `config.json`. Both are git-ignored and never leave the machine.

## Configuration

All settings are edited in the web UI (no config files to hand-edit):

| Setting        | Meaning                                                          |
|----------------|------------------------------------------------------------------|
| Target number  | Friend's number, country code, no `+` (e.g. `491701234567`)      |
| Reply mode     | *AI* (OpenRouter) or *static* (your own predefined texts)        |
| Static answers | Per keyword: a set of answers, one picked at random on a match (static mode) |
| Triggers       | Keywords/phrases that trigger a reply (AI mode; one per chip)    |
| Match type     | *Exact* (whole message) or *contains* (matches inside a message) |
| API key        | OpenRouter key from <https://openrouter.ai/keys> (AI mode)       |
| Model          | OpenRouter model slug (default `anthropic/claude-haiku-4.5`)     |
| Fallback model | Used if the primary model fails after retries                    |
| Persona        | Free text describing how the bot should sound (AI mode)          |
| Once per day   | Reply only to the first matching message each day                |
| Active window  | Only reply to messages arriving in an HH:MM window (empty = always) |
| Language       | UI language — German or English                                  |

The UI's model dropdown lists every OpenRouter model with an estimated per-reply
cost, and can filter to free models only.

**AI is optional:** switch the reply mode to *static* to answer from your own
predefined texts instead — no OpenRouter key needed.

### Environment variables

| Variable    | Default       | Purpose                          |
|-------------|---------------|----------------------------------|
| `WEB_HOST`  | `127.0.0.1`   | Bind address for the web UI      |
| `WEB_PORT`  | `8080`        | Port for the web UI              |

## Run on a Raspberry Pi (24/7)

See **[DEPLOY.md](DEPLOY.md)** for the full `systemd` setup: copy the code,
install dependencies, register the service, then configure and link via the web
UI — reachable either over an SSH tunnel (default, most private) or restricted to
your LAN with a firewall rule.

> [!IMPORTANT]
> The web UI exposes your API key and the WhatsApp-linking QR, so it must never
> be reachable from the internet. On a host with a public IP, a firewall rule —
> not just the bind address — is what keeps it private. DEPLOY.md covers both
> access modes.

## Project layout

| File                     | Role                                                         |
|--------------------------|--------------------------------------------------------------|
| `index.js`               | Bot core — WhatsApp connection, trigger matching, scheduling |
| `web.js`                 | Built-in config web UI (vanilla Node `http`)                 |
| `config.js`              | Loads/saves the web-editable `config.json`                   |
| `setup.js`               | Optional CLI first-run wizard (`npm run setup`)              |
| `config.example.json`    | Shape of the generated `config.json` (placeholders only)     |
| `autowhatsapper.service` | Generic `systemd` unit for the Raspberry Pi                  |
| `override.conf.example`  | Drop-in template for host-specific `systemd` settings        |
| `DEPLOY.md`              | Step-by-step Pi deployment guide                             |

Runtime files — `config.json` (your key + number), `auth/` (the WhatsApp
session), and `state.json` (once-per-day + pending-reply state) — are created at
runtime and are git-ignored. **Never commit them.** `config.example.json` shows
the shape of the generated `config.json` (placeholders only — the web UI writes
the real file for you).

## Built with

- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web protocol
- [OpenRouter](https://openrouter.ai/) — model routing for the reply generation
- [qrcode](https://github.com/soldair/node-qrcode) — renders the linking QR

## License

[MIT](LICENSE) © klauspet0r
