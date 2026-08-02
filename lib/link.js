const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const { loadOrCreateKeyPair } = require('./identity.js')
const { createChannels } = require('./channels.js')
const { topic, guard } = require('./room.js')

// Optional presence in a room. Strictly additive: the app is already running and serving its
// display before this announces, and it keeps running whether or not anyone ever connects. A dead
// venue network must never blank a subsystem, so nothing here is on the boot path.
//
// The subsystem ANNOUNCES on the room topic and admins dial in — so any number of consoles can watch the
// same subsystem at once, with no per-admin configuration on the card. The capability gate runs on every
// connection, so finding the topic is not the same as being let in.
//
// Three separate jobs, three mechanisms — a subsystem is only ever a subsystem:
//   find us      → the room topic (a one-way hash of the room secret)
//   talk to us   → prove the room secret via the capability gate
//   COMMAND us   → be on the admin allowlist, which holds PUBLIC keys only
// So a stolen SD card yields the room secret (watch, and impersonate a subsystem) and some public keys —
// never the ability to command a subsystem. Commanding needs a private key that only admins hold, and
// the Noise handshake proves it without us doing any crypto ourselves.
//
// Nothing here can deploy code — apps are updated by flashing an SD card.
class Link {
  constructor (ipc, opts = {}) {
    this.ipc = ipc
    this.roomKey = opts.roomKey
    this.admins = (opts.admins || []).map((a) => (typeof a === 'string' ? b4a.from(a.trim(), 'hex') : a))
    this.storeDir = opts.storeDir
    this.fwVersion = opts.fwVersion || '0.3.0'
    this.log = opts.log || (() => {})

    this.swarm = null
    this.keyPair = null
    this.peers = new Set() // every verified peer, each { socket, channels, admin }

    ipc.onReport = (state) => this._broadcast('sendStateReport', { state: JSON.stringify(state ?? null), ts: now() })
    ipc.onEvent = (name, payload) => this._broadcast('sendEvent', { name, payload: JSON.stringify(payload ?? null), ts: now() })
    ipc.onDescribe = (caps) => this._broadcast('sendDescribe', describeOf(caps))
  }

  identity () { return b4a.toString(this.keyPair.publicKey, 'hex') }

  open () {
    this.keyPair = loadOrCreateKeyPair(this.storeDir)
    this.swarm = new Hyperswarm({ keyPair: this.keyPair })
    this.swarm.on('connection', (socket) => this._onConnection(socket))

    const t = topic(this.roomKey)
    this.log('identity ' + this.identity())
    this.log(this.admins.length
      ? 'admins: ' + this.admins.map((a) => b4a.toString(a, 'hex').slice(0, 12)).join(', ')
      : 'no admins configured — this subsystem accepts no commands from anyone')
    this.log('announcing in room ' + b4a.toString(t, 'hex').slice(0, 12) + '…')
    this.swarm.join(t, { server: true, client: false })
  }

  _onConnection (socket) {
    socket.on('error', () => {})

    let gate = null
    const peer = { socket, channels: null, admin: false }

    const channels = createChannels(socket, {
      onCapability: (m) => gate.onCapability(m),
      // Refused until this peer has proved it belongs to the room.
      onCommand: (m) => { if (gate.verified) this._onCommand(m, peer, tag) }
    })

    const tag = b4a.toString(socket.remotePublicKey, 'hex').slice(0, 12)

    gate = guard(socket, channels, this.roomKey, {
      log: (m) => this.log(tag + ': ' + m),
      onVerified: () => {
        peer.channels = channels
        peer.admin = this._isAdmin(socket.remotePublicKey)
        this.peers.add(peer)
        this.log((peer.admin ? 'admin ' : 'observer ') + tag + ' attached (' +
          this.peers.size + ' watching)')
        channels.sendHello({ fwVersion: this.fwVersion })
        // Catch them up: the app booted long before this connection existed.
        if (this.ipc.caps) channels.sendDescribe(describeOf(this.ipc.caps))
        if (this.ipc.state) channels.sendStateReport({ state: JSON.stringify(this.ipc.state), ts: now() })
      }
    })

    socket.on('close', () => {
      gate.destroy()
      if (!this.peers.delete(peer)) return
      this.log((peer.admin ? 'admin ' : 'observer ') + tag + ' detached (' +
        this.peers.size + ' watching)')
    })
  }

  _isAdmin (key) {
    return this.admins.some((a) => b4a.equals(a, key))
  }

  // Being in the room is enough to WATCH. Commanding needs a key on the allowlist.
  async _onCommand (m, peer, tag) {
    if (!peer.admin) {
      this.log('refused ' + m.name + ' from ' + tag + ' — not an admin')
      peer.channels.sendCommandResult({ id: m.id, ok: false, result: '"not authorised"' })
      return
    }
    let ok = true
    let result = null
    try {
      result = await this.ipc.command(m.name, parse(m.args))
    } catch (e) {
      ok = false
      result = String((e && e.message) || e)
    }
    peer.channels.sendCommandResult({ id: m.id, ok, result: JSON.stringify(result ?? null) })
  }

  _broadcast (method, msg) {
    for (const peer of this.peers) {
      try { peer.channels[method](msg) } catch { /* dropped; close will clean it up */ }
    }
  }

  async close () {
    if (this.swarm) await this.swarm.destroy()
  }
}

function describeOf (caps) {
  return {
    appId: (caps && caps.id) || 'unknown',
    appVersion: (caps && caps.version) || '0.0.0',
    caps: JSON.stringify(caps || {})
  }
}

function now () { return Math.floor(Date.now() / 1000) }
function parse (json) { try { return JSON.parse(json) } catch { return null } }

module.exports = { Link }
