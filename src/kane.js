// Runs one Kane CLI objective and returns its final `run_end` event.
import { spawn } from 'node:child_process'

// Kane CLI's update notices and environment line, which are not reasons for anything.
export const clean = text => text.split('\n').filter(l => !/^\s*(Update available|Skill update available|Running on:)/.test(l)).join('\n').trim()

// Every Kane CLI run still going, so an interrupted run can stop them.
export const runs = new Set()

export function kaneRun(objective, { url, timeout = 240, headless = true, cdpEndpoint, variables, cwd, onStep = () => {} } = {}) {
  const args = ['run', objective, '--agent', '--timeout', String(timeout)]
  if (url) args.push('--url', url)
  else args.push('--allow-missing-url') // carry on from the page the last objective left open
  if (cdpEndpoint) args.push('--cdp-endpoint', cdpEndpoint)
  else if (headless) args.push('--headless')
  if (variables) args.push('--variables', JSON.stringify(variables))
  return new Promise(resolve => {
    const child = spawn(process.env.KANE_CLI || 'kane-cli', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } })
    runs.add(child)
    let buffer = '', end = null, stderr = ''
    const read = line => {
      let event
      try { event = JSON.parse(line) } catch { return }
      if (event.type === 'run_end') end = event
      else if (event.remark) onStep(event)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop()
      lines.forEach(read)
    })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => resolve({ status: 'error', exitCode: 2, reason: String(error) }))
    // Exit codes: 0 passed, 1 failed, 2 error, 3 timeout or cancelled.
    child.on('close', exitCode => { runs.delete(child); read(buffer); resolve({ status: ['passed', 'failed', 'error', 'timeout'][exitCode] ?? 'error', ...end, exitCode,
      evidence: stderr.match(/evidence serve (\S+)/)?.[1], stderr: end ? undefined : clean(stderr).slice(-600) }) })
  })
}
