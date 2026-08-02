const cenc = require('compact-encoding')

// PLATFORM protocol — fixed and app-AGNOSTIC. These are the only messages the platform ever
// interprets. App behaviour is never baked in here: an app ships a declarative capability manifest
// (`describe`) and the controller monitors and drives any app generically from it. Adding a new app
// touches none of this.
//
// Apps are delivered by flashing an SD card, not over the wire, so there is no content channel and
// no bundle versioning. The controller observes and commands; it does not deploy.
//
// Fields are positional: append new ones at the END, never remove or reorder.

// capability { proof } — hyperswarm-capability proof of the room secret, bound to this stream's
// Noise handshake hash. Exchanged before anything else; nothing on the other channels is sent or
// acted on until it verifies, so a peer outside the room learns nothing — not even that a subsystem
// exists. The secret itself never crosses the wire and the proof cannot be replayed elsewhere.
const capability = {
  preencode(state, m) {
    cenc.fixed32.preencode(state, m.proof)
  },
  encode(state, m) {
    cenc.fixed32.encode(state, m.proof)
  },
  decode(state) {
    return { proof: cenc.fixed32.decode(state) }
  }
}

// hello { fwVersion } — sent on connect. No propId; identity is the connection's public key.
const hello = {
  preencode(state, m) {
    cenc.string.preencode(state, m.fwVersion)
  },
  encode(state, m) {
    cenc.string.encode(state, m.fwVersion)
  },
  decode(state) {
    return { fwVersion: cenc.string.decode(state) }
  }
}

// describe { appId, appVersion, caps } — the app's self-description. `caps` is a JSON string:
// { id, commands:[{name,args?}], events:[{name}], state:[{name,type}] }. The controller renders and
// drives the subsystem from this alone, so it needs no app-specific code.
const describe = {
  preencode(state, m) {
    cenc.string.preencode(state, m.appId)
    cenc.string.preencode(state, m.appVersion)
    cenc.string.preencode(state, m.caps)
  },
  encode(state, m) {
    cenc.string.encode(state, m.appId)
    cenc.string.encode(state, m.appVersion)
    cenc.string.encode(state, m.caps)
  },
  decode(state) {
    return {
      appId: cenc.string.decode(state),
      appVersion: cenc.string.decode(state),
      caps: cenc.string.decode(state)
    }
  }
}

// event { name, payload(JSON), ts } — generic telemetry (solved/input/tamper/custom).
const event = {
  preencode(state, m) {
    cenc.string.preencode(state, m.name)
    cenc.string.preencode(state, m.payload)
    cenc.uint.preencode(state, m.ts)
  },
  encode(state, m) {
    cenc.string.encode(state, m.name)
    cenc.string.encode(state, m.payload)
    cenc.uint.encode(state, m.ts)
  },
  decode(state) {
    return {
      name: cenc.string.decode(state),
      payload: cenc.string.decode(state),
      ts: cenc.uint.decode(state)
    }
  }
}

// state-report { state(JSON), ts } — current app state snapshot. Idempotent.
//
// The platform reserves no field NAMES. How each field is drawn, and what it means, come from the
// app's own `describe().state`: `display` ('tick' | 'badge' | 'count' | 'text' | 'hidden') and an
// optional `role`. `role: 'terminal'` marks the flag that says this subsystem has finished — which
// is how a console can summarise a whole room without understanding any single app.
const stateReport = {
  preencode(state, m) {
    cenc.string.preencode(state, m.state)
    cenc.uint.preencode(state, m.ts)
  },
  encode(state, m) {
    cenc.string.encode(state, m.state)
    cenc.uint.encode(state, m.ts)
  },
  decode(state) {
    return { state: cenc.string.decode(state), ts: cenc.uint.decode(state) }
  }
}

// command-result { id, ok, result(JSON) } — reply to a command, correlated by id.
const commandResult = {
  preencode(state, m) {
    cenc.uint.preencode(state, m.id)
    cenc.bool.preencode(state, m.ok)
    cenc.string.preencode(state, m.result)
  },
  encode(state, m) {
    cenc.uint.encode(state, m.id)
    cenc.bool.encode(state, m.ok)
    cenc.string.encode(state, m.result)
  },
  decode(state) {
    return {
      id: cenc.uint.decode(state),
      ok: cenc.bool.decode(state),
      result: cenc.string.decode(state)
    }
  }
}

// command { id, name, args(JSON) } — invoke a command the app declared in `describe`. The platform
// does not know what `name` means; the app's onCommand handler does.
const command = {
  preencode(state, m) {
    cenc.uint.preencode(state, m.id)
    cenc.string.preencode(state, m.name)
    cenc.string.preencode(state, m.args)
  },
  encode(state, m) {
    cenc.uint.encode(state, m.id)
    cenc.string.encode(state, m.name)
    cenc.string.encode(state, m.args)
  },
  decode(state) {
    return {
      id: cenc.uint.decode(state),
      name: cenc.string.decode(state),
      args: cenc.string.decode(state)
    }
  }
}

module.exports = {
  // both, first
  capability,
  // subsystem -> ctrl
  hello,
  describe,
  event,
  stateReport,
  commandResult,
  // ctrl -> subsystem
  command
}
