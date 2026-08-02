const noop = () => {}

// The seam every app is written against. The app calls down (serveUI/emit/reportState); the host
// calls in (setState/command).
//
// Outbound traffic fans out to OBSERVERS rather than a single callback. More than one thing
// legitimately watches an app — the runner's own reset timer and the MCP link, at minimum — and a
// plain `ipc.onReport = …` from either one silently destroyed the other.
class IPC {
  constructor(ui, opts = {}) {
    this.ui = ui
    this.log = opts.log || noop
    this.media = opts.media || [] // media URLs found on disk, for the app to choose defaults from
    this.config = opts.config || {} // key/value from media/config.txt — secrets stay this side
    this.caps = null
    this.state = null

    this._observers = []
    this._onUIMessage = noop
    this._onSetState = noop
    this._onCommand = noop

    ui.onMessage = (msg) => this._onUIMessage(msg)
  }

  // Watch an app without the app knowing. Returns an unobserve function.
  observe(handlers) {
    this._observers.push(handlers)
    return () => {
      const i = this._observers.indexOf(handlers)
      if (i !== -1) this._observers.splice(i, 1)
    }
  }

  _fanout(name, ...args) {
    for (const o of this._observers) {
      if (o[name]) o[name](...args)
    }
  }

  serveUI(html) {
    this.ui.setHtml(html)
  }
  sendUI(msg) {
    this.ui.broadcast(msg)
  }
  onUIMessage(fn) {
    this._onUIMessage = fn
  }

  describe(caps) {
    this.caps = caps
    this._fanout('onDescribe', caps)
  }

  emit(name, payload) {
    this.log('event ' + name + ' ' + JSON.stringify(payload ?? null))
    this._fanout('onEvent', name, payload)
  }

  reportState(state) {
    this.state = state
    this.log('state ' + JSON.stringify(state))
    this._fanout('onReport', state)
  }

  onSetState(fn) {
    this._onSetState = fn
  }
  onCommand(fn) {
    this._onCommand = fn
  }

  setState(phase) {
    this._onSetState(phase)
  }
  command(name, args) {
    return this._onCommand(name, args)
  }
}

module.exports = { IPC }
