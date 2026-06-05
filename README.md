# autowhatsapper

Auto-replies to one specific contact's "good morning" messages on WhatsApp,
with a fresh AI-generated reply each day.

- **Connection:** [Baileys](https://github.com/WhiskeySockets/Baileys) — links your
  personal WhatsApp account via QR (like WhatsApp Web), no browser needed.
- **Replies:** generated via [OpenRouter](https://openrouter.ai/) (default model
  Claude Haiku 4.5), so the wording varies daily.
- **Config:** a small built-in web UI — set everything and scan the linking QR in
  your browser, no file editing.
- **Runs:** as a `systemd` service on a Raspberry Pi, 24/7.

> ⚠️ Using an unofficial library with your personal account is against WhatsApp's
> Terms of Service. For a low-volume, single-contact personal bot the practical
> risk is low, but it is not zero. Don't use this for spam or mass messaging.

## Setup

```bash
npm install
npm start
```

The web UI starts on `http://127.0.0.1:8080` (localhost only). Open it, fill in
your OpenRouter key + target number, save, then scan the WhatsApp QR it shows
(**WhatsApp → Linked devices → Link a device**). The session is saved to `auth/`,
so linking is one-time. Settings persist in `config.json`.

## Config (web UI)

| Setting        | Meaning                                                     |
|----------------|-------------------------------------------------------------|
| Target number  | Friend's number, country code, no `+` (e.g. `491701234567`) |
| API key        | OpenRouter key from https://openrouter.ai/keys              |
| Model          | OpenRouter model slug (default `anthropic/claude-haiku-4.5`) |
| Persona        | How the bot should sound                                    |
| Once per day   | Reply only to the first greeting each day                   |

`WEB_HOST` / `WEB_PORT` env vars override the bind address (default `127.0.0.1:8080`).

## Run on the Raspberry Pi (systemd)

See [DEPLOY.md](DEPLOY.md) — copy the code over, install deps, register the
service, then configure + link via the web UI. The UI is reached either over an
SSH tunnel (default, most private) or restricted to your LAN with a firewall rule.
