// One Chrome per user. Kane CLI runs started together otherwise attach to the same browser and share its cookies.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Every Chrome still running, so an interrupted run can close them.
export const browsers = new Set()

const CHROME = [process.env.KANE_CLI_CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']

export async function launchChrome(port, { headless = true } = {}) {
  const binary = CHROME.find(p => p && existsSync(p))
  if (!binary) throw new Error('Chrome was not found. Install Google Chrome or set KANE_CLI_CHROME_PATH.')
  const answers = () => fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.ok, () => false)
  // A Chrome from an earlier order may still be letting go of this port; attaching to it would fail mid-run.
  for (let i = 0; i < 40 && await answers(); i++) await new Promise(r => setTimeout(r, 250))
  if (await answers()) throw new Error(`Something already answers on Chrome's debugging port ${port}`)
  const profile = mkdtempSync(join(tmpdir(), 'deadheat-'))
  const child = spawn(binary, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,900', ...(headless ? ['--headless=new'] : []), 'about:blank'], { stdio: 'ignore' })
  browsers.add(child)
  child.once('exit', () => browsers.delete(child))
  const endpoint = `http://127.0.0.1:${port}`
  for (let i = 0; i < 80; i++) {
    if (await fetch(`${endpoint}/json/version`).then(r => r.ok, () => false)) {
      // The profile is removed once Chrome has really gone; removing it earlier fails while Chrome still writes to it.
      const close = () => new Promise(done => {
        const gone = () => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {} done() }
        if (child.exitCode !== null || child.signalCode !== null) return gone()
        child.once('exit', gone)
        child.kill()
        setTimeout(() => { child.kill('SIGKILL') }, 5000).unref()
      })
      return { endpoint, close }
    }
    await new Promise(r => setTimeout(r, 250))
  }
  child.kill()
  rmSync(profile, { recursive: true, force: true })
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
