// Dependency-free so it runs anywhere bare does. Throws on the first failure.
const b4a = require('b4a')
const cenc = require('compact-encoding')
const protocol = require('../lib/protocol.js')
const { roomKey, topic } = require('../lib/room.js')

let ran = 0
function is(actual, expected, msg) {
  ran++
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error('FAIL ' + msg + '\n  expected ' + e + '\n  actual   ' + a)
  console.log('  ok  ' + msg)
}

// every message round-trips through compact-encoding
for (const [name, value] of [
  ['hello', { fwVersion: '1.2.3' }],
  ['describe', { appId: 'counter', appVersion: '1.0.0', caps: '{"id":"counter"}' }],
  ['event', { name: 'bumped', payload: '{"count":3}', ts: 1770000000 }],
  ['stateReport', { state: '{"count":3}', ts: 1770000000 }],
  ['commandResult', { id: 7, ok: false, result: '"nope"' }],
  ['command', { id: 7, name: 'bump', args: '{}' }],
  ['capability', { proof: b4a.alloc(32, 9) }]
]) {
  is(cenc.decode(protocol[name], cenc.encode(protocol[name], value)), value, name + ' round-trips')
}

// a room secret is any string, always 32 bytes, and stable
const k1 = roomKey('a shared phrase')
const k2 = roomKey('a shared phrase')
is(k1.length, 32, 'roomKey is 32 bytes')
is(b4a.equals(k1, k2), true, 'roomKey is stable')
is(b4a.equals(roomKey('other'), k1), false, 'different secrets differ')
is(roomKey(''), null, 'blank secret is no secret')
is(b4a.equals(roomKey(b4a.toString(k1, 'hex')), k1), true, 'hex secret is taken verbatim')

// the topic is derived from the secret and must not BE the secret
const t = topic(k1)
is(t.length, 32, 'topic is 32 bytes')
is(b4a.equals(t, k1), false, 'topic is not the secret')
is(b4a.equals(topic(roomKey('a shared phrase')), t), true, 'topic is stable')

console.log('\n' + ran + ' assertions passed')
