const fs = require('bare-fs')
const path = require('bare-path')
const crypto = require('hypercore-crypto')

// Identity is a keypair, not a claimed name. Each device generates a seed on first boot, persists
// it, and derives a stable keypair from it. Its public key IS its identity, and the Noise handshake
// proves it to the far end (socket.remotePublicKey) — which is what the admin allowlist relies on.
function loadOrCreateKeyPair (dir) {
  fs.mkdirSync(dir, { recursive: true })
  const seedPath = path.join(dir, 'seed')

  if (!fs.existsSync(seedPath)) fs.writeFileSync(seedPath, crypto.randomBytes(32))

  return crypto.keyPair(fs.readFileSync(seedPath))
}

module.exports = { loadOrCreateKeyPair }
