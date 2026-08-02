const noop = () => {}

// The seam every app is written against. The app calls down (serveUI/emit/reportState); the host
// calls in (setState/command) and taps the outbound side through the on* hooks, which is how an
// optional controller link observes a subsystem without the app ever knowing it exists.
class IPC {
  constructor(ui, opts = {}) {
    this.ui = ui
    this.log = opts.log || noop
    this.media = opts.media || [] // media URLs found on disk, for the app to choose defaults from
    this.config = opts.config || {} // key/value from media/config.txt — secrets stay this side
    this.caps = null
    this.state = null

    this.onReport = opts.onReport || noop
    this.onEvent = opts.onEvent || noop
    this.onDescribe = opts.onDescribe || noop

    this._onUIMessage = noop
    this._onSetState = noop
    this._onCommand = noop

    ui.onMessage = (msg) => this._onUIMessage(msg)
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
    this.onDescribe(caps)
  }

  emit(name, payload) {
    this.log('event ' + name + ' ' + JSON.stringify(payload ?? null))
    this.onEvent(name, payload)
  }

  reportState(state) {
    this.state = state
    this.log('state ' + JSON.stringify(state))
    this.onReport(state)
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
