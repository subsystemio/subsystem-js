const test = require('brittle')
const b4a = require('b4a')
const cenc = require('compact-encoding')
const protocol = require('../lib/protocol.js')
const { roomKey, topic } = require('../lib/room.js')

test('every protocol message round-trips', function (t) {
  const messages = {
    hello: { fwVersion: '1.2.3' },
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
