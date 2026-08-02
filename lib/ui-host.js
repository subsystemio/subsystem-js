const fs = require('bare-fs')
const path = require('bare-path')
const http = require('bare-http1')
const { Server: WebSocketServer } = require('bare-ws')

// Runs on the runtime MAIN thread (part of the base image, so bare-http1/bare-ws/bare-tcp are
// available natively and never bundled into apps). Serves an app-provided HTML page, streams the
// app's media files under /media/, and bridges a localhost WebSocket to/from the page. A display
// app stays pure JS: it hands us `html` and exchanges messages over the `ipc` seam.
const MIME = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

class UIHost {
  constructor({ host = '127.0.0.1', port = 9080, log, assets = null } = {}) {
    this.host = host
    this.port = port
    this.log = log || (() => {})
    this.assets = assets
    this.html = '<!doctype html><title>subsystem</title><h1>no UI</h1>'
    this.clients = new Set()
    this.onMessage = null // (msgObject) => void  — set to the current app
    this.server = null
    this.wss = null
  }

  async start() {
    if (this.server) return this.url()
    this.server = http.createServer((req, res) => this._route(req, res))
    this.wss = new WebSocketServer({ server: this.server })
    this.wss.on('connection', (ws) => {
      this.clients.add(ws)
      ws.on('data', (buf) => {
        let msg
        try {
          msg = JSON.parse(buf.toString())
        } catch {
          return
        }
        if (this.onMessage) this.onMessage(msg)
      })
      ws.on('error', () => this.clients.delete(ws))
      ws.on('close', () => this.clients.delete(ws))
    })
    await new Promise((resolve) => this.server.listen(this.port, this.host, resolve))
    this.log('UI host listening at ' + this.url())
    return this.url()
  }

  url() {
    return 'http://' + this.host + ':' + this.port
  }

  // a new app took over the display: replace the page and tell open browsers to reload
  setHtml(html) {
    this.html = html
    this.broadcast({ t: '__reload' })
  }

  setAssets(dir) {
    this.assets = dir
  }

  broadcast(obj) {
    const data = JSON.stringify(obj)
    for (const ws of this.clients) {
      try {
        ws.write(data)
      } catch {
        /* dropped */
      }
    }
  }

  _route(req, res) {
    const url = req.url.split('?')[0]

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      res.end(this.html)
      return
    }

    if (this.assets && url.startsWith('/media/'))
      return this._serveAsset(req, res, path.basename(url))

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  }

  // Range support is not optional: Chromium will not play a <video> that cannot be seeked.
  _serveAsset(req, res, name) {
    // /media/ serves MEDIA. The same directory holds config.txt with credentials and the room
    // secret, so anything without a known media type is invisible over HTTP, not merely unlisted.
    const type = MIME[path.extname(name).toLowerCase()]
    if (!type) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }

    const file = path.join(this.assets, name)

    let size
    try {
      size = fs.statSync(file).size
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }

    const range = parseRange(req.headers.range, size)
    const start = range ? range.start : 0
    const end = range ? range.end : size - 1
    const headers = {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes'
    }

    if (range) {
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size
      res.writeHead(206, headers)
    } else {
      res.writeHead(200, headers)
    }

    fs.createReadStream(file, { start, end }).pipe(res)
  }

  async stop() {
    for (const ws of this.clients) {
      try {
        ws.end()
      } catch {}
    }
    this.clients.clear()
    if (this.server) await new Promise((resolve) => this.server.close(resolve))
    this.server = null
    this.wss = null
  }
}

function parseRange(header, size) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const start = m[1] ? Number(m[1]) : 0
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  return start <= end && start < size ? { start, end } : null
}

module.exports = { UIHost }
