// A reverse proxy with one port per user ("lane"). Requests that `hold` matches are frozen until every lane
// has one, then they are let through in the chosen order.
import http from 'node:http'
import net from 'node:net'

export function startProxy({ upstream, lanes, hold, order = 'together', holdTimeoutMs = 180_000, log = () => {}, beforeRelease }) {
  const target = new URL(upstream)
  const port = target.port || 80
  const held = new Map(lanes.map(lane => [lane.name, []]))
  let releasing = false, released = false
  let finish
  const done = new Promise(resolve => { finish = resolve })

  const forward = (req, body, res) => new Promise(resolve => {
    // The Host header is kept so the app builds links, redirects and CSRF checks against the lane's own address.
    const up = http.request({ host: target.hostname, port, method: req.method, path: req.url, headers: req.headers }, r => {
      // An app that redirects to its own absolute address would walk the browser out of its lane.
      if (r.headers.location?.startsWith(target.origin)) r.headers.location = `http://${req.headers.host}${r.headers.location.slice(target.origin.length)}`
      res.writeHead(r.statusCode, r.headers)
      r.on('error', () => res.destroy()) // the app died mid-answer: the browser must see it fail, not wait forever
      res.on('close', () => resolve(r.statusCode)) // settles whether the answer finished or the browser left
      r.pipe(res)
    })
    // The app never answered: the browser gets a 502, and the log says so, so the save counts as crashed.
    up.on('error', e => { if (!res.headersSent) res.writeHead(502); res.end(String(e)); resolve(502) })
    up.end(body)
  })

  const live = name => held.get(name).filter(item => !item.gone)
  const release = async reason => {
    if (releasing) return
    releasing = true
    await beforeRelease?.() // both users are stuck on their save: the moment worth a picture
    // Saves that arrive during the picture are still frozen, and go out with the others.
    released = true
    const names = (order === 'together' ? lanes.map(l => l.name) : order).filter(n => live(n).length)
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
      // A browser that gave up while waiting for its turn sends nothing to the app.
      const item = { gone: false, go: () => res.destroyed ? log({ event: 'abandoned', ...entry }) : forward(req, body, res).then(status => log({ event: 'answered', ...entry, status })) }
      res.on('close', () => { if (!released) { item.gone = true; log({ event: 'abandoned', ...entry }) } }) // the browser gave up on it
      log({ event: held.get(lane.name).length ? 'held_again' : 'held', ...entry })
      held.get(lane.name).push(item)
      if (lanes.every(l => live(l.name).length)) release('all lanes held')
      else setTimeout(() => release('timeout: the other user never reached the save'), holdTimeoutMs).unref()
    })
  }).on('upgrade', (req, socket, head) => {
    // WebSockets (live updates, dev servers) pass straight through; only plain HTTP writes are frozen.
    const up = net.connect(port, target.hostname, () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`)
      up.write(head)
      socket.pipe(up).pipe(socket)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  }).listen(lane.port, '127.0.0.1'))

  // Rejects if a lane's port is taken, so the run stops cleanly instead of crashing.
  const ready = Promise.all(servers.map(s => new Promise((ok, fail) => s.once('listening', ok).once('error', fail))))
  ready.catch(() => {})
  return { ready, released: done, heldLanes: () => lanes.map(l => l.name).filter(n => held.get(n).length),
    // A hold timer that fires after close must not release anything into the next race.
    close: () => { releasing = true; return Promise.all(servers.map(s => new Promise(r => s.close(r)))) } }
}
