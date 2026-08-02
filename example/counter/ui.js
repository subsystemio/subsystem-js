// Served by the host over HTTP; talks back over a localhost WebSocket. Pure HTML/CSS/JS, no build.
// Tagged `html` so prettier formats the markup inside it.
const html = String.raw

module.exports = html`<!doctype html> <meta charset="utf-8" /><title>counter</title>
  <style>
    html,
    body {
      height: 100%;
      margin: 0;
      display: grid;
      place-items: center;
      background: #0d1117;
      color: #e6edf3;
      font-family: system-ui, sans-serif;
    }
    b {
      display: block;
      font-size: 22vmin;
      font-variant-numeric: tabular-nums;
    }
    small {
      opacity: 0.5;
      letter-spacing: 0.3em;
      text-transform: uppercase;
    }
    button {
      margin-top: 6vmin;
      padding: 1rem 3rem;
      font: inherit;
      font-size: 1.2rem;
      cursor: pointer;
      border: 1px solid #30363d;
      border-radius: 6px;
      background: #161b22;
      color: inherit;
    }
  </style>
  <div style="text-align:center">
    <b id="n">0</b><small id="t"></small><br /><button id="b">Bump</button>
  </div>
  <script>
    var ws,
      n = document.getElementById('n'),
      t = document.getElementById('t')
    document.getElementById('b').onclick = function () {
      send({ t: 'bump' })
    }
    function send(o) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(o))
    }
    function connect() {
      ws = new WebSocket('ws://' + location.host)
      ws.onopen = function () {
        send({ t: 'hello' })
      }
      ws.onmessage = function (e) {
        var m = JSON.parse(e.data)
        if (m.t === 'count') {
          n.textContent = m.count
          t.textContent = 'of ' + m.target
        } else if (m.t === '__reload') location.reload()
      }
      ws.onclose = function () {
        setTimeout(connect, 1000)
      }
    }
    connect()
  </script>`
