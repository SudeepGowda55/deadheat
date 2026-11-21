// A reverse proxy with one port per user ("lane"). The first request in each lane that `hold` matches is
// frozen until every lane has one, then they are let through in the chosen order.
import http from 'node:http'
import net from 'node:net'

export function startProxy({ upstream, lanes, hold, order = 'together', holdTimeoutMs = 180_000, log = () => {}, beforeRelease }) {
  const target = new URL(upstream)
  const held = new Map(lanes.map(lane => [lane.name, []]))
  let released = false
  let finish
  const done = new Promise(resolve => { finish = resolve })

  const forward = (req, body, res) => new Promise(resolve => {
    // The Host header is kept so the app builds links, redirects and CSRF checks against the lane's own address.
    const up = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers }, r => {
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
      r.on('end', () => resolve(r.statusCode))
    })
    up.on('error', e => { if (!res.headersSent) res.writeHead(502); res.end(String(e)); resolve() })
    up.end(body)
  })

  const live = name => held.get(name).filter(item => !item.gone)
  const release = async reason => {
    if (released) return
    released = true
    const names = (order === 'together' ? lanes.map(l => l.name) : order).filter(n => live(n).length)
    await beforeRelease?.() // both users are stuck on their save: the moment worth a picture
    log({ event: 'release', reason, order: names, together: order === 'together' })
    // A lane normally holds one save. A second one (an impatient double click sent by script) follows in arrival order.
    const lane = async name => { for (const item of live(name)) await item.go() }
    if (order === 'together') await Promise.all(names.map(lane))
    else for (const name of names) await lane(name)
    finish({ reason, order: names })
  }

  const servers = lanes.map(lane => http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const entry = { lane: lane.name, method: req.method, path: req.url, bytes: body.length }
      if (released || !hold(req, body)) { log({ event: 'pass', ...entry }); return forward(req, body, res) }
      // Every matching save waits, not only the first: a retried click must not slip past the freeze.
      const item = { gone: false, go: () => forward(req, body, res).then(status => log({ event: 'answered', ...entry, status })) }
      res.on('close', () => { if (!released) { item.gone = true; log({ event: 'abandoned', ...entry }) } }) // the browser gave up on it
      log({ event: held.get(lane.name).length ? 'held_again' : 'held', ...entry })
      held.get(lane.name).push(item)
      if (lanes.every(l => live(l.name).length)) release('all lanes held')
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

  return { released: done, heldLanes: () => lanes.map(l => l.name).filter(n => held.get(n).length), close: () => Promise.all(servers.map(s => new Promise(r => s.close(r)))) }
}
