const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const { loadOrCreateKeyPair } = require('./identity.js')
const { createChannels } = require('./channels.js')
const { topic, guard } = require('./room.js')

// Optional presence in a fleet. Strictly additive: the app is already running and serving its
// display before this announces, and it keeps running whether or not anyone ever connects. A dead
// venue network must never blank a subsystem, so nothing here is on the boot path.
//
// A subsystem trusts exactly ONE peer: its MCP. That single fact is what keeps a card free of
// secrets — it carries the MCP's PUBLIC key, which is worth nothing to whoever steals it. The Noise
// handshake proves the peer holds the matching private key, so we do no crypto ourselves, and
// operators are never a concept here: they talk to the MCP, never to us.
//
// An optional room secret mixes into the topic. It hides the fleet from someone who has learned the
// MCP key; it never decides authority.
//
// Nothing here can deploy code — apps are updated by flashing an SD card.
class Link {
  constructor(ipc, opts = {}) {
    this.ipc = ipc
    this.mcpKey = asKey(opts.mcpKey)
    this.roomKey = opts.roomKey || null
    this.storeDir = opts.storeDir
    this.fwVersion = opts.fwVersion || '0.4.0'
    this.log = opts.log || (() => {})
    this.bootstrap = opts.bootstrap || undefined

    this.swarm = null
    this.keyPair = null
    this.mcp = null // the one connected peer, or null

    ipc.observe({
      onReport: (state) =>
        this._send('sendStateReport', { state: JSON.stringify(state ?? null), ts: now() }),
      onEvent: (name, payload) =>
        this._send('sendEvent', { name, payload: JSON.stringify(payload ?? null), ts: now() }),
      onDescribe: (caps) => this._send('sendDescribe', describeOf(caps))
    })
  }

  identity() {
    return b4a.toString(this.keyPair.publicKey, 'hex')
  }

  open() {
    this.keyPair = loadOrCreateKeyPair(this.storeDir)
    this.swarm = new Hyperswarm({ keyPair: this.keyPair, bootstrap: this.bootstrap })
    this.swarm.on('connection', (socket) => this._onConnection(socket))

    const t = topic(this.mcpKey, this.roomKey)
    this.log('identity ' + this.identity())
    this.log(
      'mcp ' +
        hex(this.mcpKey) +
        (this.roomKey ? ' · private room' : '') +
        ' — announcing on ' +
        hex(t)
    )
    // We look for the MCP; we never announce. Two subsystems therefore never discover each other,
    // and nothing can enumerate a fleet by listening on the topic.
    this.swarm.join(t, { server: false, client: true })
  }

  // Anyone can find the topic; only the MCP gets a conversation. Everyone else is dropped before we
  // disclose that an app even exists here.
  _onConnection(socket) {
    socket.on('error', () => {})

    const tag = hex(socket.remotePublicKey)
    if (!b4a.equals(socket.remotePublicKey, this.mcpKey)) {
      this.log('refused ' + tag + ' — not our mcp')
      socket.destroy()
      return
    }

    // Same ordering trap as the MCP side: a capability can land while createChannels is still
    // running, before `gate` exists. Buffer it instead of throwing into protomux's dispatch.
    let gate = null
    let earlyCapability = null
    const channels = createChannels(socket, {
      onCapability: (m) => (gate ? gate.onCapability(m) : (earlyCapability = m)),
      onCommand: (m) => {
        if (gate.verified) this._onCommand(m, channels)
      }
    })

    gate = guard(socket, channels, this.roomKey, {
      log: (m) => this.log(tag + ': ' + m),
      onVerified: () => {
        this.mcp = channels
        this.log('mcp attached')
        channels.sendHello({ fwVersion: this.fwVersion })
        // Catch it up: the app booted long before this connection existed.
        if (this.ipc.caps) channels.sendDescribe(describeOf(this.ipc.caps))
        if (this.ipc.state)
          channels.sendStateReport({ state: JSON.stringify(this.ipc.state), ts: now() })
      }
    })
    if (earlyCapability) gate.onCapability(earlyCapability)

    socket.on('close', () => {
      gate.destroy()
      if (this.mcp !== channels) return
      this.mcp = null
      this.log('mcp detached — the app keeps running')
    })
  }

  async _onCommand(m, channels) {
    let ok = true
    let result = null
    try {
      result = await this.ipc.command(m.name, parse(m.args))
    } catch (e) {
      ok = false
      result = String((e && e.message) || e)
    }
    channels.sendCommandResult({ id: m.id, ok, result: JSON.stringify(result ?? null) })
  }

  _send(method, msg) {
    if (!this.mcp) return
    try {
      this.mcp[method](msg)
    } catch {
      /* dropped; close will clean it up */
    }
  }

  async close() {
    if (this.swarm) await this.swarm.destroy()
  }
}

function describeOf(caps) {
  return {
    appId: (caps && caps.id) || 'unknown',
    appVersion: (caps && caps.version) || '0.0.0',
    caps: JSON.stringify(caps || {})
  }
}

function asKey(k) {
  return typeof k === 'string' ? b4a.from(k.trim(), 'hex') : k
}
function hex(k) {
  return b4a.toString(k, 'hex').slice(0, 12) + '…'
}
function now() {
  return Math.floor(Date.now() / 1000)
}
function parse(json) {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

module.exports = { Link }
