// A subsystem is one device doing one job, announcing itself into a room so an operator can watch
// it and invoke the commands it declares. It works with nobody watching — that is the point.
module.exports = {
  IPC: require('./lib/ipc.js').IPC,
  Link: require('./lib/link.js').Link,
  UIHost: require('./lib/ui-host.js').UIHost,
  channels: require('./lib/channels.js'),
  protocol: require('./lib/protocol.js'),
  room: require('./lib/room.js'),
  identity: require('./lib/identity.js')
}
