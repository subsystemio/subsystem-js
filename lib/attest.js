const IdentityKey = require('keet-identity-key')
const b4a = require('b4a')

// Who is allowed to command a subsystem.
//
// A card carries a **root identity public key** — nothing else, and nothing secret. The MCP proves
// its own device key was attested by that identity. So the machine running the MCP can be replaced,
// or kept as a spare, without touching a single card: attest the new box from the same root and
// every prop accepts it.
//
// The card cannot mint an attestation, only check one. Attesting needs the identity's SECRET key,
// which lives with the mnemonic, offline, and never on the MCP box.
//
// Two things must both hold, and checking only the first is the mistake to avoid: the proof chains
// to the identity on our card, AND it attests to the public key of the peer actually on this
// connection. Without the second, a valid proof minted for some other device could be replayed by
// anyone who can reach the topic.
//
// `receipt` is an opaque 8-byte marker of when a proof was minted. Passing the last one we accepted
// makes older proofs invalid, which is how a leaked device key stops being trusted without
// reflashing anything. Keep it opaque — decoding it means reaching into the library's internals.
function verify(proof, identityKey, devicePublicKey, receipt) {
  if (!proof || !proof.byteLength) return null

  // A proof arrives from an unauthenticated peer, so it is arbitrary bytes until proven otherwise.
  // Decoding malformed input THROWS out of compact-encoding, and on a supervised prop an uncaught
  // throw is a restart — which would hand anyone who can reach the topic a remote reboot loop.
  // Untrusted input gets validated; this is not the same thing as guarding against caller bugs.
  let info = null
  try {
    info = IdentityKey.verify(proof, null, {
      expectedIdentity: identityKey,
      expectedDevice: devicePublicKey,
      receipt
    })
  } catch {
    return null
  }
  if (!info) return null

  return {
    receipt: info.receipt,
    identityKey: info.identityPublicKey,
    devicePublicKey: info.devicePublicKey
  }
}

// The identity a proof chains to, asserting nothing about which one we wanted. For a box reporting
// which fleet it belongs to — never for deciding trust.
function identityOf(proof) {
  const info = decode(proof)
  return info ? info.identityPublicKey : null
}

// The device key a proof attests to.
function deviceOf(proof) {
  const info = decode(proof)
  return info ? info.devicePublicKey : null
}

// Read a proof without asserting anything about it. Same untrusted-bytes rule as verify().
function decode(proof) {
  if (!proof || !proof.byteLength) return null
  try {
    return IdentityKey.verify(proof, null)
  } catch {
    return null
  }
}

// Offline only: mint a proof binding a device key to the root identity. Needs the mnemonic, which is
// why this never runs on the MCP box.
async function attest(mnemonic, devicePublicKey) {
  const id = await IdentityKey.from({ mnemonic })
  try {
    return await id.bootstrap(devicePublicKey)
  } finally {
    id.clear()
  }
}

function generateMnemonic() {
  return IdentityKey.generateMnemonic()
}

async function identityKeyOf(mnemonic) {
  const id = await IdentityKey.from({ mnemonic })
  const key = b4a.from(id.identityPublicKey)
  id.clear()
  return key
}

module.exports = { verify, identityOf, deviceOf, attest, generateMnemonic, identityKeyOf }
