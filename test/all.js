const test = require('brittle')
const b4a = require('b4a')
const cenc = require('compact-encoding')
const protocol = require('../lib/protocol.js')
const { roomKey, topic } = require('../lib/room.js')
const attest = require('../lib/attest.js')
const crypto = require('hypercore-crypto')

test('every protocol message round-trips', function (t) {
  const messages = {
    describe: { appId: 'counter', appVersion: '1.0.0', caps: '{"id":"counter"}' },
    event: { name: 'bumped', payload: '{"count":3}', ts: 1770000000 },
    stateReport: { state: '{"count":3}', ts: 1770000000 },
    commandResult: { id: 7, ok: false, result: '"nope"' },
    command: { id: 7, name: 'bump', args: '{}' },
    capability: { proof: b4a.alloc(32, 9) }
  }

  for (const [name, value] of Object.entries(messages)) {
    t.alike(cenc.decode(protocol[name], cenc.encode(protocol[name], value)), value, name)
  }
})

test('a room secret is any string, hashed to 32 bytes', function (t) {
  const key = roomKey('a shared phrase')

  t.is(key.length, 32)
  t.alike(roomKey('a shared phrase'), key, 'stable across calls')
  t.unlike(roomKey('a different phrase'), key, 'different secrets differ')
  t.is(roomKey(''), null, 'a blank secret is no secret')
  t.is(roomKey(null), null)
})

test('a 64-char hex secret is taken verbatim, not rehashed', function (t) {
  const raw = b4a.alloc(32, 3)

  t.alike(roomKey(b4a.toString(raw, 'hex')), raw)
})

test('the topic is derived from the secret and is not the secret', function (t) {
  const key = roomKey('a shared phrase')
  const t1 = topic(key)

  t.is(t1.length, 32)
  t.unlike(t1, key, 'publishing the topic must not publish the secret')
  t.alike(topic(roomKey('a shared phrase')), t1, 'stable, so peers agree')
  t.unlike(topic(roomKey('another room')), t1, 'rooms do not collide')
})

// The trust boundary. A card holds a PUBLIC identity key; everything below is what stops that from
// being enough for someone else to command a prop.
test('an attestation must chain to our identity AND name this peer', async function (t) {
  const words = attest.generateMnemonic()
  const ours = await attest.identityKeyOf(words)
  const mcpBox = crypto.keyPair()
  const proof = await attest.attest(words, mcpBox.publicKey)

  t.ok(attest.verify(proof, ours, mcpBox.publicKey), 'the real MCP is accepted')

  // Replay: a genuine proof, presented by a peer it was not minted for.
  const attacker = crypto.keyPair()
  t.absent(attest.verify(proof, ours, attacker.publicKey), 'not replayable onto another peer')

  // A different root entirely — someone who ran `mcp identity` themselves.
  const theirWords = attest.generateMnemonic()
  const theirs = await attest.identityKeyOf(theirWords)
  const theirProof = await attest.attest(theirWords, attacker.publicKey)
  t.absent(attest.verify(theirProof, ours, attacker.publicKey), 'a foreign identity is refused')
  t.absent(
    attest.verify(proof, theirs, mcpBox.publicKey),
    'our proof does not satisfy their identity'
  )

  // Nothing, and rubbish.
  t.absent(attest.verify(null, ours, mcpBox.publicKey), 'no proof is refused')
  t.absent(attest.verify(b4a.alloc(0), ours, mcpBox.publicKey), 'an empty proof is refused')
  // Malformed bytes must return null, never throw: an uncaught throw on a supervised prop is a
  // restart, and a remote restart loop is a denial of service against a device in a venue.
  for (const junk of [b4a.alloc(139, 7), b4a.alloc(1, 255), b4a.alloc(300, 0xab), b4a.from([1])]) {
    t.absent(attest.verify(junk, ours, mcpBox.publicKey), 'garbage is refused, not thrown')
  }

  // Tampered: flip a byte of a valid proof.
  const bent = b4a.from(proof)
  bent[bent.byteLength - 1] ^= 0xff
  t.absent(attest.verify(bent, ours, mcpBox.publicKey), 'a tampered proof is refused')
})

test('a card can verify an attestation but never mint one', async function (t) {
  const words = attest.generateMnemonic()
  const ours = await attest.identityKeyOf(words)
  const attacker = crypto.keyPair()

  // `ours` is the whole of what a card carries. Attesting with it must be impossible, not merely
  // produce something that fails later.
  let minted = null
  try {
    minted = await attest.attest(ours, attacker.publicKey)
  } catch {
    minted = null
  }
  t.absent(minted, 'the public identity key cannot stand in for the mnemonic')

  // Nor does a guessed mnemonic produce anything our identity accepts.
  const wrong = attest.generateMnemonic()
  const forged = await attest.attest(wrong, attacker.publicKey)
  t.absent(attest.verify(forged, ours, attacker.publicKey), 'a proof from other words is refused')
})

test('an older attestation is refused once a newer one has been seen', async function (t) {
  const words = attest.generateMnemonic()
  const ours = await attest.identityKeyOf(words)
  const leaked = crypto.keyPair()
  const replacement = crypto.keyPair()

  const oldProof = await attest.attest(words, leaked.publicKey)
  const first = attest.verify(oldProof, ours, leaked.publicKey)
  t.ok(first, 'accepted before rotation')

  // Epochs are second-granular, so a rotation has to be a second apart to be distinguishable.
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const newProof = await attest.attest(words, replacement.publicKey)
  const second = attest.verify(newProof, ours, replacement.publicKey)
  t.ok(second, 'the replacement box is accepted')

  t.absent(
    attest.verify(oldProof, ours, leaked.publicKey, second.receipt),
    'the leaked key is dead once the prop has seen the newer epoch'
  )
  t.ok(
    attest.verify(newProof, ours, replacement.publicKey, first.receipt),
    'a newer proof still passes an older receipt'
  )
})
