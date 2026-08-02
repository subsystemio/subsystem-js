# @subsystemio/runtime

One device, one job. A subsystem announces itself into a fleet, declares what it can do, and lets an
operator drive it — while working perfectly well with nobody watching.

Built on [Bare](https://github.com/holepunchto/bare) and Hyperswarm. No servers, no addresses to
configure, no cloud.

## Install

Bare is the runtime everything here runs on, so install it first:

```sh
npm install -g bare
```

Then the package. It is not on npm yet — take it from GitHub:

```sh
npm install github:subsystemio/runtime
```

## Usage

A subsystem is a single function. It gets an `ipc` seam and declares itself:

```js
module.exports = async function start(ipc, ready) {
  let count = 0

  ipc.serveUI(require('./ui.js')) // an HTML page, served locally

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
    if (name === 'bump') {
      count++
      ipc.emit('bumped', { count })
      return count
    }
    if (name === 'reset') {
      count = 0
      return 'ok'
    }
    throw new Error('unknown command: ' + name)
  })

  if (ready) ready()
  return async function stop() {}
}
```

Run it. Installed as a dependency you get a `sub` command (and `subsystem`, the long form):

```sh
sub ./my-subsystem                  # or from a checkout: npm run example
```

That serves the page on `http://127.0.0.1:9080`. Give it an MCP's public key and it also announces
itself so that MCP can find it:

```sh
bare bin/subsystem.js ./example/counter --mcp=<64-hex>
```

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

## One MCP, many operators

A subsystem trusts exactly one peer: its [MCP](https://github.com/subsystemio/master-control).
Operators talk to the MCP, never to a subsystem — which is what lets a card carry nothing but a
public key and never be touched again.

| Job                         | Mechanism                                             | On the card               |
| --------------------------- | ----------------------------------------------------- | ------------------------- |
| Find the fleet              | topic = one-way hash of the MCP's **public** key      | a public key              |
| **Command** a subsystem     | the peer _is_ that MCP, proven by the Noise handshake | nothing                   |
| Hide the fleet _(optional)_ | a shared room secret mixed into the topic             | a secret, if you want one |

**A stolen SD card yields a public key and nothing else.** There is no bearer credential to leak, no
secret to rotate, and no per-operator configuration anywhere near a device. Adding or removing an
operator is one edit on the MCP.

The room secret is optional and off by default. Without it, anyone who learns the MCP's public key
can derive the topic and see that _some_ devices exist — they still cannot read state or command
anything, because a subsystem drops every peer that is not its MCP before disclosing a thing. Turn
it on with `mcp serve --private-room` if that metadata matters.

## Configuration

Everything a device needs sits in `media/config.txt` next to its assets, so it can be edited on an
SD card without a rebuild:

```
mcp    = <the MCP's 64-hex public key>
room   = a shared phrase        # optional, only if the MCP runs --private-room
target = 5                      # anything else your app wants
```

Values reach the app as `ipc.config`. Secrets stay host-side — validate against them in the
subsystem, and they never reach the browser.

## API

#### `const { IPC, Link, UIHost } = require('subsystem')`

- **`UIHost`** — serves the app's page, its `media/` (with HTTP range support, so `<video>` works)
  and a localhost WebSocket. `/media/` serves media types only; `config.txt` is never reachable.
- **`IPC`** — the seam the app is written against: `serveUI` · `sendUI` · `onUIMessage` ·
  `describe` · `emit` · `reportState` · `onCommand` · `media` · `config`.
- **`Link`** — optional fleet presence: finds the MCP on the topic, refuses every other peer, and
  reports telemetry to it. Never on the boot path.

Also exported: `protocol`, `channels`, `room`, `identity` — what an MCP is built from.

#### `sub <dir> [--port=9080] [--host=127.0.0.1] [--assets=<dir>] [--reset-after=0] [--mcp=<64-hex>] [--room=<secret>]`

Also installed as `subsystem` if you prefer the long name.

Runs a subsystem directory. Never on the boot path: the app serves its display before any network
exists, and keeps running whether or not anyone connects.

## License

MIT
