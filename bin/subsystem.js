#!/usr/bin/env bare
const fs = require('bare-fs')
const path = require('bare-path')
const b4a = require('b4a')
const { UIHost } = require('../lib/ui-host.js')
const { IPC } = require('../lib/ipc.js')
const { roomKey } = require('../lib/room.js')

// What runs on a Pi. One subsystem, one app, one physical element.
//
//   subsystem [appDir] [--port=9080] [--host=127.0.0.1] [--reset-after=20]
//                      [--assets=<dir>] [--room]
//
// The app boots, serves its display and works with no network at all. A master controller is
// strictly optional and strictly additive: it observes state and invokes commands the app declared
// for itself. It cannot deploy code — apps ship on the SD card.
const FW_VERSION = '0.3.0'

const args = Bare.argv.slice(2)
const appDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'apps', 'tile-puzzle'))
const port = Number(flag('port') || 9080)
const host = flag('host') || '127.0.0.1'
const resetAfter = Number(flag('reset-after') || 0)
// On a Pi this points at the FAT boot partition, so the art is editable by plugging the card into
// a laptop. Locally it is just the app's own media dir.
const assets = flag('assets') || path.join(appDir, 'media')

function flag (name) {
  const hit = args.find((a) => a.startsWith('--' + name + '='))
  return hit && hit.slice(name.length + 3)
}

// What is actually on the card, as URLs the app can hand straight to its page. Apps are pure JS
// with no filesystem, so the host has to tell them — that is what makes "drop a new jpg in
// subsystem-media and reboot" work with no code change and no controller.
const MEDIA = /\.(jpe?g|png|webp|gif|svg|mp4|webm|ogv|mp3|woff2)$/i

function listMedia (dir) {
  try {
    return fs.readdirSync(dir).filter((n) => MEDIA.test(n)).sort().map((n) => '/media/' + n)
  } catch {
    return []
  }
}

// `key = value` lines from <assets>/config.txt, with `#` comments. Lives beside the art on the FAT
// boot partition so credentials and the like are editable on the card without a rebuild. Values
// stay host-side: an app validates against them, so a secret never has to reach the page.
function readConfig (dir) {
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

// Room membership and the admin allowlist both come off the card, from config.txt. Running both
// ends on one machine, fall back to what the controller generated so a dev never copies secrets by
// hand — and the repo's config.txt stays blank.
function repoFile (name) {
  const file = path.join(__dirname, '..', name)
  return fs.existsSync(file) ? b4a.toString(fs.readFileSync(file), 'utf8').trim() : null
}

function admins (config) {
  const list = config.admins || config.admin || repoFile('.controller-key') || ''
  return String(list).split(',').map((x) => x.trim()).filter((x) => /^[0-9a-f]{64}$/i.test(x))
}

async function main () {
  const ui = new UIHost({ host, port, assets, log: (m) => console.log('[ui]', m) })
  await ui.start()

  const media = listMedia(assets)
  const config = readConfig(assets)
  console.log('[subsystem] media from ' + assets + ' ' + (media.length ? '(' + media.join(', ') + ')' : '(empty)'))
  const keys = Object.keys(config)
  if (keys.length) console.log('[subsystem] config: ' + keys.join(', '))

  let resetTimer = null
  const ipc = new IPC(ui, {
    media,
    config,
    log: (m) => console.log('[app]', m),
    onReport: (state) => {
      if (!resetAfter || state.phase !== 'complete' || resetTimer) return
      resetTimer = setTimeout(() => { resetTimer = null; ipc.command('reset') }, resetAfter * 1000)
    }
  })

  const start = require(path.join(appDir, 'index.js'))
  const stop = await start(ipc, () => console.log('[subsystem] app ready'))

  ipc.setState(1) // arm on boot — a subsystem is useful before anything upstream exists
  console.log('[subsystem] ' + path.basename(appDir) + ' armed at ' + ui.url())

  const room = roomKey(config.room) || roomKey(repoFile('.room-key'))
  let link = null
  if (!room) {
    console.log('[subsystem] no `room` secret in config.txt — running unwatched, which is a valid mode')
  } else {
    const { Link } = require('../lib/link.js')
    link = new Link(ipc, {
      roomKey: room,
      admins: admins(config),
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

main().catch((e) => { console.error('[subsystem] fatal', e); Bare.exit(1) })
