// Test fixture only: one hot desk that anyone can book. It checks, waits a moment, then writes, so two
// simultaneous bookings both succeed. Dead Heat's own tests race against this; it is not a demo target.
import http from 'node:http'

export function startDesk(port, { safe = false } = {}) {
  let holder = null
  const page = (msg = '') => `<!doctype html><title>Hot desk</title><h1>Hot desk 4</h1>
<p id="status">${holder ? `Booked by ${holder}` : 'The desk is free'}</p><p id="message">${msg}</p>
<form method="post" action="/book"><label>Your name <input name="name" required></label> <button>Book the desk</button></form>`
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'POST' && url.pathname === '/book') {
      let body = ''
      for await (const c of req) body += c
      const name = new URLSearchParams(body).get('name')
      const free = holder === null
      if (safe && free) holder = name            // claim in the same tick as the check
      await new Promise(r => setTimeout(r, 50))   // the gap a real app has between its SELECT and its UPDATE
      if (!safe && free) holder = name
      res.writeHead(303, { location: free ? `/?told=${encodeURIComponent(name)}` : '/?taken=1' })
      return res.end()
    }
    const told = url.searchParams.get('told')
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(page(told ? `Confirmed: the desk is yours, ${told}.` : url.searchParams.has('taken') ? 'Sorry, someone else just booked it.' : ''))
  })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)))
}
