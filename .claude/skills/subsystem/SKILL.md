---
name: subsystem
description: Build, run, watch and ship subsystems — small single-purpose devices that announce themselves into a room, declare what they can do, and get driven by an operator console. Covers the `subsystem` library and runner, `master-controller` (the console), and `subsystem-image` (flashable Raspberry Pi kiosk cards). Use for any work on a subsystem app, its manifest, room security, the console UI, or building/flashing device images.
version: 1.0.0
---

# subsystem

Three repos, one idea. A **subsystem** is one device doing one job. It works alone; a console is
optional and strictly additive.

| Repo                            | What it is                         |
| ------------------------------- | ---------------------------------- |
| `subsystemio/subsystem-js`      | the library + `subsystem` runner   |
| `subsystemio/master-controller` | operator console (TUI)             |
| `subsystemio/subsystem-image`   | flashable Raspberry Pi kiosk cards |

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

Run it: `npx subsystem ./my-subsystem`

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

## 3. Rooms: three jobs, three mechanisms

Do not collapse these. Each does one thing.

| Job           | Mechanism                                                              | On the device        |
| ------------- | ---------------------------------------------------------------------- | -------------------- |
| Find the room | topic = one-way hash of the room secret                                | the secret           |
| Be let in     | `hyperswarm-capability` proof bound to the connection's handshake hash | the secret           |
| **Command**   | sender's key on the admin allowlist                                    | **public keys only** |

A device carries enough to join and be watched, and **nothing that grants control**. Commanding
needs a private key that only an operator holds; the Noise handshake proves it for free via
`socket.remotePublicKey`.

The capability proof never puts the secret on the wire, and is bound to one stream so a captured
proof is useless elsewhere. Anyone failing the gate is dropped **before any state is sent** — they
cannot even learn a subsystem exists.

The read/write split is the useful part: a second operator watches a whole room with the secret
alone and can touch nothing until their public key is added.

```
# media/config.txt on the device
room   = any shared phrase
admins = <operator public key>[, <another>]
```

Subsystems **announce** (`join(topic, { server: true, client: false })`); consoles **dial**
(`{ server: false, client: true }`). Keep it that way — it preserves roles and stops
subsystem-to-subsystem connections.

---

## 4. The console

```sh
npm run tui     # or: npm start, headless
```

First run mints an admin keypair (`.identity`) and a room secret (`.room`), then prints both. Put
them on each device. Run **as many consoles as you like** — each dials independently, so there is no
primary and nothing to diverge.

The TUI renders from manifests only. The tick column follows whichever field declared
`role: 'terminal'`. Layout fills the terminal exactly; the subsystem list scrolls rather than
overflowing.

Never hardcode an app's field name in the console. If you find yourself wanting to, add a `role`.

---

## 5. Images

```sh
./build-payload.sh ./my-subsystem            # arm64 payload, cross-built anywhere
./prepare-sd.sh ./my-subsystem /Volumes/bootfs
```

Per-device settings live in the subsystem's own `package.json`, so local runs match the card:

```json
"subsystem": { "port": 9080, "resetAfter": 0, "resX": 1280, "resY": 720 }
```

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

## 7. Conventions

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
