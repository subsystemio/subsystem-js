// The smallest useful subsystem: a button that counts. It declares what it is, what it accepts and
// how a console should draw it — the console needs no knowledge of counters.
module.exports = async function start(ipc, ready) {
  let count = 0
  let target = Number((ipc.config || {}).target) || 5

  ipc.serveUI(require('./ui.js'))

  ipc.describe({
    id: 'counter',
    version: '1.0.0',
    commands: [{ name: 'reset' }, { name: 'bump' }, { name: 'setTarget', args: { n: 'uint' } }],
    events: [{ name: 'bumped' }, { name: 'reached' }],
    state: [
      { name: 'reached', type: 'bool', display: 'tick', role: 'terminal' },
      { name: 'count', type: 'uint', display: 'count', label: '#' },
      { name: 'target', type: 'uint', display: 'count', label: '/' }
    ]
  })

  const report = () => ipc.reportState({ reached: count >= target, count, target })
  const bump = () => {
    count++
    ipc.emit('bumped', { count })
    if (count === target) ipc.emit('reached', { count })
    ipc.sendUI({ t: 'count', count, target })
    report()
  }

  ipc.onUIMessage((m) => {
    if (m.t === 'hello') ipc.sendUI({ t: 'count', count, target })
    else if (m.t === 'bump') bump()
  })

  ipc.onCommand((name, args) => {
    if (name === 'bump') {
      bump()
      return count
    }
    if (name === 'reset') {
      count = 0
      ipc.sendUI({ t: 'count', count, target })
      report()
      return 'ok'
    }
    if (name === 'setTarget') {
      const n = Number(args && args.n)
      target = Number.isFinite(n) && n >= 0 ? n : target
      ipc.sendUI({ t: 'count', count, target })
      report()
      return target
    }
    throw new Error('unknown command: ' + name)
  })

  report()
  if (ready) ready()
  return async function stop() {}
}
