const Protomux = require('protomux')
const protocol = require('./protocol.js')

// Wire the two platform Protomux channels onto a HyperDHT socket, identically on both ends. Message
// indices are positional, so BOTH sides addMessage in the SAME order on the SAME channel. Each side
// passes only the handlers it cares about; unhandled inbound messages are dropped.
//
// handlers: onCapability, onHello, onDescribe, onEvent, onStateReport, onCommandResult, onCommand
function createChannels (stream, handlers = {}) {
  const mux = Protomux.from(stream)

  // Room membership, proved before anything else is exchanged. See shared/room.js.
  const auth = mux.createChannel({ protocol: 'subsystem/auth' })
  const capabilityMsg = auth.addMessage({ encoding: protocol.capability, onmessage: handlers.onCapability })
  auth.open()

  const events = mux.createChannel({ protocol: 'subsystem/events' })
  const helloMsg = events.addMessage({ encoding: protocol.hello, onmessage: handlers.onHello })
  const describeMsg = events.addMessage({ encoding: protocol.describe, onmessage: handlers.onDescribe })
  const eventMsg = events.addMessage({ encoding: protocol.event, onmessage: handlers.onEvent })
  const stateReportMsg = events.addMessage({ encoding: protocol.stateReport, onmessage: handlers.onStateReport })
  const commandResultMsg = events.addMessage({ encoding: protocol.commandResult, onmessage: handlers.onCommandResult })
  events.open()

  const control = mux.createChannel({ protocol: 'subsystem/control' })
  const commandMsg = control.addMessage({ encoding: protocol.command, onmessage: handlers.onCommand })
  control.open()

  return {
    mux,
    sendCapability: (m) => capabilityMsg.send(m),
    sendHello: (m) => helloMsg.send(m),
    sendDescribe: (m) => describeMsg.send(m),
    sendEvent: (m) => eventMsg.send(m),
    sendStateReport: (m) => stateReportMsg.send(m),
    sendCommandResult: (m) => commandResultMsg.send(m),
    sendCommand: (m) => commandMsg.send(m)
  }
}

module.exports = { createChannels }
