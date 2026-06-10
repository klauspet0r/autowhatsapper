# Deploy to a Raspberry Pi

Runs autowhatsapper 24/7 as a `systemd` service that restarts on boot and on crash.
All configuration and WhatsApp linking happen in the built-in web UI — nothing is
edited by hand on the Pi.

> Just want to run it locally on your own machine? See the
> [60-second quickstart](README.md#-60-second-quickstart) in the README instead.

Examples below assume user `pi` and path `/home/pi/autowhatsapper`. The tracked
`autowhatsapper.service` is generic — you set your user, path, and (optional) bind
host/port in a **drop-in** you own (step 3), so updating the unit later never
overwrites them. No tracked file needs editing.

> The UI exposes your API key and the WhatsApp-linking QR, so it must not be
> reachable from the internet. Pick **one** access mode in step 4. If your Pi has
> a public IP (incl. a routable IPv6), the firewall — not just the bind address —
> is what keeps it private.

## 1. Copy the code to the Pi

```bash
rsync -av --exclude node_modules --exclude auth --exclude config.json --exclude state.json --exclude .git \
  ./ pi@raspberrypi.local:/home/pi/autowhatsapper/
```

(No `rsync`? Use `scp index.js web.js config.js setup.js config.example.json package.json .gitignore README.md DEPLOY.md autowhatsapper.service override.conf.example pi@raspberrypi.local:/home/pi/autowhatsapper/`.)

## 2. Install Node + dependencies (on the Pi)

```bash
ssh pi@raspberrypi.local
sudo apt-get install -y nodejs npm     # Node 18+ needed (built-in fetch)
cd ~/autowhatsapper
npm install --omit=dev
```

## 3. Install the service + your drop-in

The tracked unit is generic; your host-specific settings go in a drop-in you own,
so a later `cp` of an updated `autowhatsapper.service` never clobbers them.

```bash
sudo cp autowhatsapper.service /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/autowhatsapper.service.d
sudo cp override.conf.example /etc/systemd/system/autowhatsapper.service.d/override.conf
sudoedit /etc/systemd/system/autowhatsapper.service.d/override.conf   # set User + WorkingDirectory
sudo systemctl daemon-reload
sudo systemctl enable --now autowhatsapper
```

`User` and `WorkingDirectory` in the drop-in are **required** — the base unit omits
them on purpose (without them the service would run as root from `/` and fail to
find `index.js`). The bot then starts unconfigured and just runs the web UI until
you configure it. By default the UI binds to `127.0.0.1:8080`; uncomment the
`WEB_HOST` / `WEB_PORT` lines in the drop-in to change that — needed if port 8080
is already taken (e.g. by nginx), or to enable LAN access below.

## 4. Configure + link — pick an access mode

The UI is unconfigured and serving; reach it one of two ways, then in the browser:
enter your OpenRouter key + target number → save → a WhatsApp QR appears → on your
phone **WhatsApp → Linked devices → Link a device** → scan → status flips to
**Verbunden**. Done — it now replies on its own.

### Option A — SSH tunnel (default, most private; nothing extra exposed)

Keep the default `127.0.0.1` bind. From your own machine:

```bash
ssh -L 8080:localhost:8080 pi@raspberrypi.local   # leave open
```

Then browse to **http://localhost:8080**.

### Option B — LAN only (no tunnel; reachable from your home network)

Bind to all IPv4 interfaces **and** open the port only to your LAN subnet in the
firewall (binding alone is not enough on a host with a public IP):

```bash
# In the drop-in, uncomment (8765 = a free port):
#   /etc/systemd/system/autowhatsapper.service.d/override.conf
#   Environment=WEB_HOST=0.0.0.0
#   Environment=WEB_PORT=8765
sudo systemctl daemon-reload && sudo systemctl restart autowhatsapper

# Allow the port ONLY from your LAN (adjust subnet), not "Anywhere":
sudo ufw allow from 192.168.0.0/24 to any port 8765 proto tcp comment 'autowhatsapper UI (LAN only)'
```

Then browse to **http://<pi-hostname>.local:8765** (e.g. `rpikls.local`) — the
mDNS hostname survives DHCP IP changes. Binding to `0.0.0.0` is IPv4-only, so a
public IPv6 address is never served; the `ufw` rule blocks everything outside the
LAN subnet.

## 5. Check it

```bash
systemctl status autowhatsapper
journalctl -u autowhatsapper -f      # live logs
```

> The bot links as a passive device (`markOnlineOnConnect: false`), so your phone
> keeps receiving WhatsApp push notifications as usual while it runs.
