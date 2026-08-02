const fs = require('bare-fs')
const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const Capability = require('hyperswarm-capability')

// Room membership. Every device in a room holds the same secret; nobody ever sends it. Instead each
// side proves knowledge of it with a hash bound to THIS connection's Noise handshake, so a captured
// proof is worthless on any other stream.
//
// This gates who we will talk to at all. It does NOT decide who may command — that stays with the
// peer's public key, which the handshake proves independently. A shared secret cannot distinguish
// one admin from another.
const HANDSHAKE_MS = 5000
const cap = new Capability()
const [TOPIC_NS] = crypto.namespace('subsystem-platform/room', 1)

// The swarm topic is a one-way hash of the room secret, so announcing it to the DHT reveals nothing
// about the secret itself. Finding the room and being let into it are separate problems: the topic
// gets you a connection, the capability gets you a conversation.
function topic(key) {
  return crypto.data(b4a.concat([TOPIC_NS, key]))
}

// Any string works as a room secret; it is hashed to 32 bytes so an operator can write a passphrase
// on the SD card instead of hex.
function roomKey(secret) {
  if (!secret) return null
  const s = String(secret).trim()
  if (!s) return null
  return /^[0-9a-f]{64}$/i.test(s) ? b4a.from(s, 'hex') : crypto.data(b4a.from(s))
}

function loadOrCreateRoomKey(file) {
  try {
    return roomKey(b4a.toString(fs.readFileSync(file), 'utf8'))
  } catch {
    const key = crypto.randomBytes(32)
    fs.writeFileSync(file, b4a.toString(key, 'hex'))
    return key
  }
}

// Send our proof, hold everything back until theirs checks out, and drop the peer if it never does.
// `channels.sendCapability` must already be wired; call this once the stream is open, because the
// handshake hash does not exist before that.
function guard(stream, channels, key, opts = {}) {
  const log = opts.log || (() => {})
  const onVerified = opts.onVerified || (() => {})
  let verified = false

  const timer = setTimeout(() => {
    if (verified) return
    log('peer never proved the room secret — dropping')
    stream.destroy()
  }, HANDSHAKE_MS)

  channels.sendCapability({ proof: cap.generate(stream, key) })

  return {
    get verified() {
      return verified
    },
    onCapability(m) {
      if (verified) return
      clearTimeout(timer)
      if (!cap.verify(stream, key, m.proof)) {
        log('wrong room secret — dropping')
        stream.destroy()
        return
      }
      verified = true
      onVerified()
    },
    destroy() {
      clearTimeout(timer)
    }
  }
}

module.exports = { roomKey, loadOrCreateRoomKey, topic, guard }
