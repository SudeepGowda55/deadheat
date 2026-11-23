import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clean } from '../src/kane.js'

test("Kane CLI's update notices are not part of a reason", () => {
  const stderr = '\nUpdate available: 0.10.7 → 0.10.8 — run `npm install -g @testmuai/kane-cli@latest` to update\n\nSkill update available: not installed → 0.1.4\n\nRunning on: Desktop · Chrome\nChrome failed: fetch failed\n'
  assert.equal(clean(stderr), 'Chrome failed: fetch failed')
})
