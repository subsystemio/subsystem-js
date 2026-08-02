#!/usr/bin/env bare
const fs = require('bare-fs')
const path = require('bare-path')
const b4a = require('b4a')
const { UIHost } = require('../lib/ui-host.js')
const { IPC } = require('../lib/ipc.js')
const { roomKey } = require('../lib/room.js')

// What runs on a Pi. One subsystem, one app, one physical element.
//
//   sub [appDir] [--port=9080] [--host=127.0.0.1] [--reset-after=20]
//                      [--assets=<dir>] [--mcp=<64-hex>] [--room=<secret>]
//
// The app boots, serves its display and works with no network at all. A master controller is
// strictly optional and strictly additive: it observes state and invokes commands the app declared
// for itself. It cannot deploy code — apps ship on the SD card.
const FW_VERSION = '0.4.0'

const args = Bare.argv.slice(2)
const appDir = path.resolve(args.find((a) => !a.startsWith('--')) || '.')
// Checked before anything binds a port: starting the UI host and *then* failing to find the app
// leaves a listener up and buries the real cause under a module error.
if (!fs.existsSync(path.join(appDir, 'index.js'))) {
  console.error('[subsystem] no index.js in ' + appDir)
  console.error('[subsystem] usage: sub <appDir>')
  Bare.exit(1)
}
const port = Number(flag('port') || 9080)
const host = flag('host') || '127.0.0.1'
const resetAfter = Number(flag('reset-after') || 0)
// On a Pi this points at the FAT boot partition, so the art is editable by plugging the card into
// a laptop. Locally it is just the app's own media dir.
const assets = flag('assets') || path.join(appDir, 'media')

function flag(name) {
  const hit = args.find((a) => a.startsWith('--' + name + '='))
  return hit && hit.slice(name.length + 3)
}

// What is actually on the card, as URLs the app can hand straight to its page. Apps are pure JS
// with no filesystem, so the host has to tell them — that is what makes "drop a new jpg in
// subsystem-media and reboot" work with no code change and no controller.
const MEDIA = /\.(jpe?g|png|webp|gif|svg|mp4|webm|ogv|mp3|woff2)$/i

function listMedia(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => MEDIA.test(n))
      .sort()
      .map((n) => '/media/' + n)
  } catch {
    return []
  }
}

// `key = value` lines from <assets>/config.txt, with `#` comments. Lives beside the art on the FAT
// boot partition so credentials and the like are editable on the card without a rebuild. Values
// stay host-side: an app validates against them, so a secret never has to reach the page.
function readConfig(dir) {
  let text
  try {
    text = b4a.toString(fs.readFileSync(path.join(dir, 'config.txt')), 'utf8')
  } catch {
    return {}
  }
  const out = {}
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || s[0] === '#') continue
    const eq = s.indexOf('=')
    if (eq < 0) continue
    out[s.slice(0, eq).trim()] = s.slice(eq + 1).trim()
  }
  return out
}

// Which MCP this subsystem answers to, and optionally which private room. Both come off the card
// via config.txt; flags win, so a dev can point one at a local MCP without editing anything.
//
// The MCP key is PUBLIC — losing a card leaks nothing.
function trimmed(file) {
  return fs.existsSync(file) ? b4a.toString(fs.readFileSync(file), 'utf8').trim() : null
}

function mcpKey(config) {
  const v = flag('mcp') || config.mcp || trimmed(path.join(appDir, '.mcp-key'))
  return v && /^[0-9a-f]{64}$/i.test(v.trim()) ? v.trim() : null
}

async function main() {
  const ui = new UIHost({ host, port, assets, log: (m) => console.log('[ui]', m) })
  await ui.start()

  const media = listMedia(assets)
  const config = readConfig(assets)
  console.log(
    '[subsystem] media from ' +
      assets +
      ' ' +
      (media.length ? '(' + media.join(', ') + ')' : '(empty)')
  )
  const keys = Object.keys(config)
  if (keys.length) console.log('[subsystem] config: ' + keys.join(', '))

  const ipc = new IPC(ui, { media, config, log: (m) => console.log('[app]', m) })

  let resetTimer = null
  if (resetAfter) {
    ipc.observe({
      onReport: (state) => {
        if (state.phase !== 'complete' || resetTimer) return
        resetTimer = setTimeout(() => {
          resetTimer = null
          ipc.command('reset')
        }, resetAfter * 1000)
      }
    })
  }

  const start = require(path.join(appDir, 'index.js'))
  const stop = await start(ipc, () => console.log('[subsystem] app ready'))

  ipc.setState(1) // arm on boot — a subsystem is useful before anything upstream exists
  console.log('[subsystem] ' + path.basename(appDir) + ' armed at ' + ui.url())

  const mcp = mcpKey(config)
  let link = null
  if (!mcp) {
    console.log('[subsystem] no `mcp` key configured — running unwatched, which is a valid mode')
  } else {
    const { Link } = require('../lib/link.js')
    link = new Link(ipc, {
      mcpKey: mcp,
      roomKey: roomKey(flag('room') || config.room), // optional: privacy, never authority
      storeDir: path.join(appDir, '.identity'),
      fwVersion: FW_VERSION,
      log: (m) => console.log('[link]', m)
    })
    link.open()
  }

  Bare.on('exit', () => {
    if (stop) stop()
    if (link) link.close()
  })
}

main().catch((e) => {
  console.error('[subsystem] fatal', e)
  Bare.exit(1)
})
