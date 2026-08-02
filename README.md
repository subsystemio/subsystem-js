# subsystem

One device, one job. A subsystem announces itself into a room, declares what it can do, and lets an
operator drive it — while working perfectly well with nobody watching.

Built on [Bare](https://github.com/holepunchto/bare) and Hyperswarm. No servers, no addresses to
configure, no cloud.

```
npm install subsystem
```

## Usage

A subsystem is a single function. It gets an `ipc` seam and declares itself:

```js
module.exports = async function start (ipc, ready) {
  let count = 0

  ipc.serveUI(require('./ui.js'))            // an HTML page, served locally

  ipc.describe({
    id: 'counter',
    version: '1.0.0',
    commands: [{ name: 'bump' }, { name: 'reset' }],
    events: [{ name: 'bumped' }],
    state: [
      { name: 'reached', type: 'bool', display: 'tick', role: 'terminal' },
      { name: 'count', type: 'uint', display: 'count', label: '#' }
    ]
  })

  ipc.onCommand((name) => {
    if (name === 'bump') { count++; ipc.emit('bumped', { count }); return count }
    if (name === 'reset') { count = 0; return 'ok' }
    throw new Error('unknown command: ' + name)
  })

  if (ready) ready()
  return async function stop () {}
}
```

Run it:

```
npx subsystem ./example/counter
```

That serves the page on `http://127.0.0.1:9080` and, if a room secret is configured, announces the
subsystem so consoles can find it.

## The manifest is the API

`describe()` is the whole control plane. A console renders and drives a subsystem from that alone —
there is no per-subsystem code anywhere else, and no codegen.

- `commands` — what may be invoked. Declare `args` and a console can prompt for them.
- `events` — what it will report.
- `state` — the fields it publishes, plus how to draw them:
  - `display`: `tick` · `badge` · `count` · `text` · `hidden`
  - `role`: `terminal` marks the field meaning "this one has finished", so a console can summarise a
    whole room without understanding any single subsystem.

Fields you report but never declare still show up. A console should never silently hide state it was
told about.

## Rooms: three jobs, three mechanisms

A subsystem holds a **room secret**; operators hold a **keypair**. That split is deliberate.

| Job | Mechanism |
|---|---|
| Find the room | topic = one-way hash of the room secret |
| Be let in | [`hyperswarm-capability`](https://github.com/holepunchto/hyperswarm-capability) proof bound to the connection's handshake hash |
| **Command** a subsystem | sender's key is on the subsystem's admin allowlist — **public keys only** |

So a device carries enough to join and be watched, and nothing that grants control. The secret never
crosses the wire — only a proof does, and that proof is worthless on any other connection. Anyone
failing the gate is dropped before a single byte of state is sent; they cannot even learn the
subsystem exists.

The read/write split is the useful part: a second operator can watch a whole room with the secret
alone, and gets no ability to touch anything until their public key is added.

## Configuration

Everything a device needs sits in `media/config.txt` next to its assets, so it can be edited on an
SD card without a rebuild:

```
room    = any shared phrase
admins  = <operator public key>[, <another>]
target  = 5
```

Values reach the app as `ipc.config`. Secrets stay host-side — validate against them in the
subsystem, and they never reach the browser.

## API

#### `const { IPC, Link, UIHost } = require('subsystem')`

- **`UIHost`** — serves the app's page, its `media/` (with HTTP range support, so `<video>` works)
  and a localhost WebSocket. `/media/` serves media types only; `config.txt` is never reachable.
- **`IPC`** — the seam the app is written against: `serveUI` · `sendUI` · `onUIMessage` ·
  `describe` · `emit` · `reportState` · `onCommand` · `media` · `config`.
- **`Link`** — optional room presence: announces on the topic, runs the capability gate, enforces
  the admin allowlist, broadcasts telemetry to every watcher.

Also exported: `protocol`, `channels`, `room`, `identity` — for building a console.

#### `subsystem <dir> [--port=9080] [--host=127.0.0.1] [--assets=<dir>] [--reset-after=0]`

Runs a subsystem directory. Never on the boot path: the app serves its display before any network
exists, and keeps running whether or not anyone connects.

## License

MIT
