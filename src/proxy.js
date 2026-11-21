// A reverse proxy with one port per user ("lane"). The first request in each lane that `hold` matches is
// frozen until every lane has one, then they are let through in the chosen order.
import http from 'node:http'
import net from 'node:net'

export function startProxy({ upstream, lanes, hold, order = 'together', holdTimeoutMs = 180_000, log = () => {}, beforeRelease }) {
  const target = new URL(upstream)
  const held = new Map()
  const done = new Set()
  let finish
  const released = new Promise(resolve => { finish = resolve })

  const forward = (req, body, res) => new Promise(resolve => {
    // The Host header is kept so the app builds links, redirects and CSRF checks against the lane's own address.
    const up = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers }, r => {
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
      r.on('end', resolve)
    })
    up.on('error', e => { if (!res.headersSent) res.writeHead(502); res.end(String(e)); resolve() })
    up.end(body)
  })

  const release = async reason => {
    if (!held.size) return
    const names = order === 'together' ? [...held.keys()] : order.filter(n => held.has(n))
    const waiting = names.map(n => held.get(n))
    held.clear()
    await beforeRelease?.() // both users are stuck on their save: the moment worth a picture
    log({ event: 'release', reason, order: names, together: order === 'together' })
    if (order === 'together') await Promise.all(waiting.map(go => go()))
    else for (const go of waiting) await go()
    finish({ reason, order: names })
  }

  const servers = lanes.map(lane => http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const entry = { lane: lane.name, method: req.method, path: req.url, bytes: body.length }
      if (done.has(lane.name) || !hold(req, body)) { log({ event: 'pass', ...entry }); return forward(req, body, res) }
      done.add(lane.name)
      log({ event: 'held', ...entry })
      held.set(lane.name, () => forward(req, body, res))
      if (held.size === lanes.length) release('all lanes held')
      else setTimeout(() => release('timeout: the other user never reached the save'), holdTimeoutMs).unref()
    })
  }).on('upgrade', (req, socket, head) => {
    // WebSockets (live updates, dev servers) pass straight through; only plain HTTP writes are frozen.
    const up = net.connect(target.port, target.hostname, () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`)
      up.write(head)
      socket.pipe(up).pipe(socket)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  }).listen(lane.port, '127.0.0.1'))

  return { released, heldLanes: () => [...done], close: () => Promise.all(servers.map(s => new Promise(r => s.close(r)))) }
}
