// One Chrome per user. Kane CLI runs started together otherwise attach to the same browser and share its cookies.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = [process.env.KANE_CLI_CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']

export async function launchChrome(port, { headless = true } = {}) {
  const binary = CHROME.find(p => p && existsSync(p))
  if (!binary) throw new Error('Chrome was not found. Install Google Chrome or set KANE_CLI_CHROME_PATH.')
  const profile = mkdtempSync(join(tmpdir(), 'deadheat-'))
  const child = spawn(binary, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,900', ...(headless ? ['--headless=new'] : []), 'about:blank'], { stdio: 'ignore' })
  const endpoint = `http://127.0.0.1:${port}`
  for (let i = 0; i < 80; i++) {
    if (await fetch(`${endpoint}/json/version`).then(r => r.ok, () => false)) {
      // The profile is removed once Chrome has really gone; removing it earlier fails while Chrome still writes to it.
      return { endpoint, close: () => { child.once('exit', () => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {} }); child.kill() } }
    }
    await new Promise(r => setTimeout(r, 250))
  }
  child.kill()
  throw new Error(`Chrome did not open its debugging port ${port}`)
}

// A picture of what this user is looking at right now, taken over Chrome's own debugging socket.
export async function screenshot(endpoint, file) {
  const pages = await fetch(`${endpoint}/json/list`).then(r => r.json(), () => [])
  const page = pages.find(p => p.type === 'page' && /^https?:/.test(p.url))
  if (!page) return null
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  let next = 0
  const waiting = new Map()
  const call = (method, params = {}, ms = 5000) => new Promise(resolve => {
    const id = ++next
    waiting.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
    setTimeout(() => resolve(null), ms)
  })
  socket.onmessage = message => { const reply = JSON.parse(message.data); waiting.get(reply.id)?.(reply.result) }
  const opened = await new Promise(resolve => { socket.onopen = () => resolve(true); socket.onerror = () => resolve(false) })
  // Half-scale JPEG where the page can report its size. A page whose save is frozen cannot answer that
  // (script is paused mid-navigation) but can still be photographed, so it gets a full-size picture.
  const size = opened && (await call('Runtime.evaluate', { expression: '[innerWidth, innerHeight]', returnByValue: true }, 350))?.result?.value
  const data = opened && (await call('Page.captureScreenshot', { format: 'jpeg', quality: size ? 72 : 55, ...(size && { clip: { x: 0, y: 0, width: size[0], height: size[1], scale: 0.5 } }) }))?.data
  socket.close()
  if (!data) return null
  writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}
