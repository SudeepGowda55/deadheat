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
      return { endpoint, close: () => { child.kill(); rmSync(profile, { recursive: true, force: true, maxRetries: 5 }) } }
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
  const data = await new Promise(resolve => {
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
    socket.onmessage = message => { const reply = JSON.parse(message.data); if (reply.id === 1) resolve(reply.result?.data) }
    socket.onerror = () => resolve(null)
    setTimeout(() => resolve(null), 5000)
  })
  socket.close()
  if (!data) return null
  writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}
