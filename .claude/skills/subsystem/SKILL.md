---
name: subsystem
description: Build, run, watch and ship subsystems — small single-purpose devices that announce themselves into a room, declare what they can do, and get driven by an operator console. Covers `@subsystemio/runtime` (the library and the `sub` runner), `master-control` (the MCP daemon and console), and `subsystem-image` (flashable Raspberry Pi kiosk cards). Use for any work on a subsystem app, its manifest, room security, the console UI, or building/flashing device images.
version: 1.0.0
---

# subsystem

Three repos, one idea. A **subsystem** is one device doing one job. It works alone; a console is
optional and strictly additive.

| Repo                          | What it is                                          |
| ----------------------------- | --------------------------------------------------- |
| `subsystemio/runtime`         | `@subsystemio/runtime` — library + the `sub` runner |
| `subsystemio/master-control`  | the MCP: `mcp` console, which hosts the fleet too   |
| `subsystemio/subsystem-image` | flashable Raspberry Pi kiosk cards                  |

**Nothing is on npm.** Install from GitHub (`npm install github:subsystemio/runtime`), and install
Bare first (`npm install -g bare`) — every entry point shells out to it. Note `subsystem` on npm is
an unrelated abandoned 2013 package; never tell anyone to install that.

**The governing rule: a subsystem must work with nobody watching.** Nothing about the network is
ever on the boot path. A dead venue Wi-Fi, a missing console, a wrong secret — none of them may
blank a device. Treat any change that violates this as a bug.

---

## 1. Writing a subsystem

A subsystem is one exported function. It receives an `ipc` seam and declares itself:

```js
module.exports = async function start(ipc, ready) {
  let count = 0

  ipc.serveUI(require('./ui.js'))

  ipc.describe({
    id: 'counter',
    version: '1.0.0',
    commands: [{ name: 'bump' }, { name: 'setTarget', args: { n: 'uint' } }],
    events: [{ name: 'bumped' }],
    state: [
      { name: 'reached', type: 'bool', display: 'tick', role: 'terminal' },
      { name: 'count', type: 'uint', display: 'count', label: '#' }
    ]
  })

  ipc.onUIMessage((m) => {
    if (m.t === 'hello') ipc.sendUI({ t: 'count', count })
  })

  ipc.onCommand((name, args) => {
    if (name === 'bump') {
      count++
      ipc.emit('bumped', { count })
      return count
    }
    throw new Error('unknown command: ' + name)
  })

  if (ready) ready()
  return async function stop() {}
}
```

Run it: `sub ./my-subsystem` — or `npm run dev`, see §5.

### The `ipc` seam

| Call                                      | Direction | Notes                                      |
| ----------------------------------------- | --------- | ------------------------------------------ |
| `ipc.serveUI(html)`                       | down      | an HTML string; the host serves it         |
| `ipc.sendUI(msg)` / `ipc.onUIMessage(fn)` | both      | JSON over a localhost WebSocket            |
| `ipc.describe(caps)`                      | up        | the manifest — see below                   |
| `ipc.emit(name, payload)`                 | up        | telemetry                                  |
| `ipc.reportState(state)`                  | up        | current snapshot, idempotent               |
| `ipc.onCommand(fn)`                       | down      | return a value, or throw to report failure |
| `ipc.media`                               | —         | array of `/media/...` URLs found on disk   |
| `ipc.config`                              | —         | key/value from `media/config.txt`          |

**Apps have no filesystem and no network.** That is deliberate: it keeps them pure JS, so they
bundle and cross-build trivially. The host does all the looking and tells them.

### Never hardcode a filename

Pick from `ipc.media` by kind, preferring a conventional name:

```js
const pick = (media, kind, prefer) => {
  const of = media.filter((f) => kind.test(f))
  return of.find((f) => f.includes(prefer)) || of[0] || null
}
const image = pick(ipc.media, /\.(jpe?g|png|webp)$/i, 'puzzle')
```

Now dropping _any_ jpg on the card works, with no rebuild. Hardcoding `'/media/puzzle.jpg'` means a
rename silently breaks the device.

### Secrets stay host-side

`config.txt` reaches the app as `ipc.config`. Validate against it **in the subsystem** — never send
a secret to the page:

```js
const accepts = (u, p) => norm(u) === norm(cfg.user) && norm(p) === norm(cfg.password)
```

Be forgiving on input: trim and lowercase. A guest should not be defeated by a capital letter.

---

## 2. The manifest is the entire control plane

`describe()` is the API. A console renders and drives any subsystem from it alone — no per-app code
anywhere, no plugins, no codegen. **The platform reserves no field names.**

```js
state: [
  { name: 'open', type: 'bool', display: 'tick', role: 'terminal' },
  { name: 'bolt', type: 'string', display: 'badge' },
  { name: 'cycles', type: 'uint', display: 'count', label: '×' },
  { name: 'serial', type: 'string', display: 'hidden' }
]
```

- **`display`** — how it is drawn: `tick` · `badge` · `count` · `text` · `hidden`
- **`role`** — what it _means_. `role: 'terminal'` marks "this one has finished", so a console can
  summarise a whole room without understanding any single app.

Keep those two separate. `display` is cosmetic; `role` is semantic and is what makes fleet-level
questions answerable.

Fields reported but never declared still render as `name=value`. **A console must never silently
hide state it was told about.**

Declaring `args` on a command makes the console prompt for them.

---

## 3. One MCP, many operators

There is exactly one MCP per installation. Subsystems trust it and nothing else; operators talk to
the MCP and never to a subsystem. That one rule is what makes access management a single edit
instead of a trip round every SD card.

| Job                         | Mechanism                                                 | On the card               |
| --------------------------- | --------------------------------------------------------- | ------------------------- |
| Find the fleet              | topic = one-way hash of the **root identity** public key  | a public key              |
| **Command** a subsystem     | a proof that the peer's key was attested by that identity | nothing                   |
| Hide the fleet _(optional)_ | a room secret mixed into the topic                        | a secret, if you want one |

**A fleet is an identity, not a machine.** A card carries the root identity's public key; the MCP
presents a proof (`lib/attest.js`, `keet-identity-key`) that its own device key belongs to that
identity. So the MCP box can be replaced or kept as a spare and every prop still accepts it, with
nothing reflashed — and re-attesting mints a newer epoch, which is how a stolen box gets revoked.

**A card carries no secrets.** It can verify an attestation and never mint one: minting needs the
identity's mnemonic, which lives offline and never touches the MCP box (`mcp identity` / `mcp attest`
run on a different machine; only the proof comes back, and a proof grants nothing alone).

The honest trade: the mnemonic becomes the one unrevocable secret. A stolen box can be retired; a
stolen mnemonic cannot, short of reflashing every card.

### The two rules of verifying an attestation

Both, or it is broken:

1. the proof chains to **the identity on our card**, and
2. it attests **the public key of the peer actually on this connection**.

Skip the second and a genuine proof minted for some other box is replayable by anyone who can reach
the topic. `attest.verify(proof, identityKey, socket.remotePublicKey, receipt)` does both.

**A proof is untrusted bytes.** Malformed input throws out of `compact-encoding`, and an uncaught
throw on a prop under `Restart=always` is a remote reboot loop for anyone who can reach the topic.
`verify` returns `null` instead. Validating hostile wire input is not the same thing as defensive
guards against caller bugs — do it.

A prop therefore cannot judge a peer on its key alone any more: the connection opens, and **both**
gates (room secret, attestation) must pass before any state, manifest or command crosses. Unattested
peers are dropped after 10s.

The room secret is optional and off by default (`mcp --private-room`). Without it, someone who
learns the MCP's public key can derive the topic and see that devices exist — they still cannot read
state or command anything. `guard()` is a no-op when no secret is configured; authority was never
its job.

**Trust is a roster, not a secret.** An unknown subsystem or operator arrives _pending_: shown,
never believed, never obeyed, until an admin adopts it. The first operator on an empty roster is
auto-adopted so there is always a way in.

## 4. The console

```sh
mcp identity         # OFFLINE: mint a fleet identity, 24 words printed once
mcp device           # the box's own key; `mcp attest <it>` offline, `mcp proof <hex>` here
mcp                  # the console — and the daemon, if nothing else here is one
mcp serve            # headless daemon only; what a systemd unit runs
mcp install          # optional: keep it up across reboots
mcp key / mcp room   # the public key for cards; the room secret if private
mcp --host=<64-hex>  # attach to an MCP on another machine
```

**`mcp` hosts the fleet itself** when nothing else on the machine does, so one command gives you a
daemon and a TUI and other operators can attach over the swarm. The singleton lock on loopback 9599
decides which process is the daemon — not a flag — so a second `mcp` attaches rather than splitting
the fleet. Quitting takes the daemon with it; that is what `mcp install` is for when you don't want
that. The daemon is a real hub, not a viewer: with none running, props still play their game
perfectly but nobody can see or command them.

The TUI is driven through a six-member interface (`subsystems`, `admin`, `commands`, `command`,
`adopt`, `logLines`), so it cannot tell a remote `Client` from the in-process `LocalController`. Keep
it that way — it is what let hosting be added without touching the UI.

First run mints the MCP's keypair and prints its public key. Run **as many consoles as you like** —
they are clients of the one daemon, so there is nothing to diverge. `A` adopts the selected
subsystem; a non-admin console hides the command panel rather than letting keys come back refused.

The TUI renders from manifests only. The tick column follows whichever field declared
`role: 'terminal'`. Layout fills the terminal exactly; the subsystem list scrolls rather than
overflowing.

Never hardcode an app's field name in the console. If you find yourself wanting to, add a `role`.

---

## 5. Running and shipping

Both repos install bins, so a subsystem drives everything through its own scripts and never names a
path into `node_modules`:

```json
"scripts": {
  "dev":   "sub .",
  "image": "subsystem-image build .",
  "flash": "subsystem-image flash ."
},
"dependencies":    { "@subsystemio/runtime": "github:subsystemio/runtime" },
"devDependencies": { "@subsystemio/subsystem-image": "github:subsystemio/subsystem-image" }
```

`sub` is the short bin for `subsystem`; both are installed. `subsystem-image` dispatches
`build` / `flash` / `mcp` / `help`. Building needs no card and no Pi — it cross-builds anywhere;
`flash` finds the single mounted DietPi card, or takes the volume as an argument.

The MCP box is built the same way, from a checkout of `master-control`:
`subsystem-image mcp ../master-control /Volumes/bootfs`.

### Where a setting belongs

Two categories, and conflating them is how a secret gets committed.

**Hardware** goes in the app's `package.json` and is committed — the app is 1:1 with a Pi, so what
you run locally is what boots:

```json
"subsystem": { "port": 9080, "resetAfter": 0, "resX": 1280, "resY": 720 }
```

**A venue's** settings go in `.env` beside the app, gitignored: `WIFI_SSID`, `WIFI_KEY`, `PASSWORD`,
and `MCP`/`ROOM` when flashing for an MCP on another machine. It is parsed, never sourced, stripped
from the payload, and caught by the build's key-material guard.

Precedence, highest first: **flag → environment → `.env` → `package.json` → discovered → default.**
All of it is resolved in `bin/subsystem-image.js`; the shell scripts default nothing, so there is
only ever one place that decides what a value is.

`--mcp` and `--room` default to `mcp key` and `mcp room`, which means **master-control must be on
your PATH** (`npm install -g github:subsystemio/master-control`) and `mcp` must have run once before
you flash anything. A card flashed with no MCP key boots and works — it is simply invisible
to every console, forever. Never resolve a key by reaching into someone's checkout: that was the
original design here and it hardcoded one developer's home directory into a shipping tool.

Wi-Fi and the device password are consumed by DietPi on **first boot only**. Changing them later
means `dietpi-config` on the device or a reflash.

### Hardware — verified, not guessed

| Board                       | Verdict                         |
| --------------------------- | ------------------------------- |
| Pi Zero 2 W (**64-bit OS**) | works — the only Zero that does |
| Pi 3 / 4 / 5 (64-bit)       | works comfortably               |
| **Pi Zero / W / WH**        | **impossible**                  |
| any Pi on a 32-bit OS       | won't work                      |

Zero 1 is ARMv6 and two things independently rule it out: Bare publishes Linux prebuilds for
`linux-x64` and `linux-arm64` **only** — there is no `linux-arm` at all — and Chromium dropped
ARMv6. On a Zero 2 W's 512MB, keep video at 720p30 H.264 ~1.5 Mbps with `+faststart`.

### Why no Node/npm/network on the device

Every native `bare-*` package ships prebuilds for **all 13 platforms inside its npm tarball**, so a
`node_modules` built on a Mac already contains the arm64 binaries; the other twelve get pruned.
`bare-runtime-linux-arm64` supplies the real aarch64 runtime — the `bare` npm bin is a _Node script_
and is never used on the device.

---

## 6. Gotchas that cost real debugging time

**`hyperswarm` emits `connection` after the Noise handshake.** The stream is already open, so
`socket.on('open', …)` never fires and channel setup never happens — every peer then times out at
the capability gate. Set up channels immediately on `connection`.

**Connection direction is NOT a reliable discriminator.** Hyperswarm will hand you a _server-side_
socket for a peer you went looking for. Dispatch on which protocol the peer opens
(`mux.pair({ protocol }, cb)`), and pair on the **first** protocol it opens — pairing on a later one
leaves the earlier channel unmatched and its messages are dropped silently.

**A message can arrive before the handler that reads it exists.** A peer's capability lands _during_
`createChannels`, before `gate` is assigned. Throwing there goes into protomux's dispatch, which
destroys the stream — and the peer reconnects straight into the same trap, forever. Buffer it.

**Never mint a new identity because a file is missing.** A regenerated MCP key or room secret orphans
every card silently, and you find out in a venue. Restore from the mirror, or refuse to start.

**State must not live beside the code.** `master-control` kept its identity in `__dirname`, so
`npm install -g` would have parked the fleet's private key inside `node_modules` for the next
upgrade to delete. It is `~/.master-control`, or `--dir`/`MCP_DIR` — one place, no searching.
Anything a reinstall can erase is the wrong home for a key that cards in the field depend on.

A related trap, since it cost a real key here: do **not** pick the state directory by probing for the
identity file. If that file is what went missing, probing relocates the whole MCP and silently mints
a new fleet — routing around the one guard that exists to stop it. Decide the directory first, then
let the guard speak.

**Validate before you bind.** The runner used to start the UI host and _then_ resolve the app, so a
bad path left a listener on 9080 and reported a module error instead of the real cause.

**npm caches `github:` dependencies by ref.** After pushing a fix to `runtime` or `subsystem-image`,
a plain `npm install` in a consumer silently keeps the old copy. Delete it from `node_modules`
first, or you will debug a bug you already fixed — twice, in my case.

**A running subsystem does not match `pkill -f subsystem.js`.** npm invokes it through the bin
symlink, so the command line reads `bare …/node_modules/.bin/sub .`. Find it with
`lsof -nP -tiTCP:9080 -sTCP:LISTEN` and kill the PID. A stale server squatting the port is what
produced a whole session of "why does the page say waiting".

**Chromium ignores `autocomplete="off"` on password fields.** Suppressing the save-password bubble
requires a managed policy at `/etc/chromium{,-browser}/policies/managed/`. Markup hints are
best-effort only.

**Always pass `--password-store=basic`** on Linux kiosks, or Chromium may pop a GNOME Keyring unlock
dialog _over_ your kiosk — far worse than the bubble.

**`/media/` must serve media types only.** `config.txt` lives in the same directory; serving unknown
types made credentials fetchable over HTTP. Anything without a media MIME type 404s.

**Guard `video.onerror`/`onended` to the playing phase.** An empty `<video>` fires `error` on reload,
which otherwise completes the puzzle before anyone touches it.

**A page paints before its WebSocket connects.** Distinguish "connecting" from "idle" — a `linked`
flag that flips only when the app _reports state_, not merely when the socket opens. Otherwise a
dead app looks like a working one, and a boot race looks like a bug.

**A centred flex column clips at the top when it overflows.** Size the main element from the
_leftover_ space (`flex: 1; min-height: 0` + `aspect-ratio`) rather than a fixed `vmin`, and use
`display: none` (not `opacity: 0`) for hidden blocks so they don't reserve height.

**One source of truth for dependencies.** A hand-maintained payload dependency list drifted twice and
both times only failed on the device. Derive it, and gate the build on every `require` — bare _and
relative_ — resolving in the staged payload.

**In a TUI, truncate with an ANSI-aware helper.** Walking a styled string character-by-character
counts escape bytes as visible cells and shreds the line.

**Verify crypto constants against the spec's own worked example.** Do not trust recall — solve for
the value the RFC publishes.

---

### Nothing has shipped yet

No card is in a venue, so there is **no backward compatibility to keep**. The wire format, the state
directory, `services.conf`, `config.txt` — all free to change outright. Do not add compat shims,
version negotiation or migration paths for a fleet that does not exist; strip them if you find them.

That changes the day a device is installed somewhere. From then on: positional fields append at the
END only, and a card in the field cannot be updated over the wire.

## 7. Conventions

- **Argument parsing is `paparam`** in every bin — `command()`, `flag()`, `arg()`, `summary()`,
  `bail()`. It gives strict parsing, generated `--help` and one shape across the three tools. It runs
  on Bare; pass `Bare.argv.slice(2)` explicitly rather than relying on its `process.argv` default.
  Two things to know: the object handed to a runner is not the full `Command`, so call `help()` on the
  outer command variable; and an unhandled bail prints a raw stack, so always register `bail()` and
  print the reason yourself.

- **Formatting**: `prettier-config-holepunch` via a `.prettierrc`. `npm run format` / `npm run lint`.
- **HTML templates**: `const html = String.raw` and tag the literal, so prettier formats the markup
  inside it.
- **Tests**: `brittle`, run with `brittle-bare`. Assert behaviour, not internals.
- **Buffers**: `b4a`, never the `Buffer` global. **Wire formats**: `compact-encoding`, positional —
  append new fields at the end, never remove or reorder once a card is flashed.
- **No defensive programming.** Caller bugs should crash; operational failures surface on the
  resource.

## 8. Things that are deliberately absent

Do not re-add these without a reason:

- **No remote code deployment.** Apps ship on the SD card. The console cannot push code.
- **No self-reset.** A subsystem never recycles itself; that is the console or a power cycle.
  (`resetAfter` exists for unattended demo loops only, and defaults to off.)
- **No worker isolation, hot-swap or A/B rollback.** Removed with remote deployment; systemd
  `Restart=always` covers a crash.
- **No shared mutable state between peers.** A console's view is derived live from open connections
  and dies with them — there is nothing to converge, so no multiwriter machinery is needed.

## 9. Known gaps

- Subsystems are not themselves allowlisted, so a room member could impersonate one in a console —
  annoying, not dangerous. The fix is per-device enrolment: adopt a device in the TUI, record its
  pubkey and role, so every device can only ever act as itself.
- `require('subsystem')` resolves via git, not npm.
- The state machine inside an app is still ad-hoc phase integers. Agreed direction is a declarative
  **in-memory** machine with the manifest derived from it — explicitly _without_ a hypercore, whose
  per-transition disk writes are wrong for an ephemeral device on an SD card.
