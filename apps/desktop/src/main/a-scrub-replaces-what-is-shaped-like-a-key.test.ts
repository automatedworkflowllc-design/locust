import { describe, expect, it } from 'vitest'

import { scrubSecrets } from '../shared/secrets.js'

/**
 * SCRUBBING A SAVED RECORD. `scrubSecrets` is what stands between the ledger's
 * words and a file the person sends on. The keys below are made up in the right
 * SHAPE -- none is real.
 */

const REMOVED = '[secret-shaped text removed]'

describe('scrubSecrets', () => {
  const shapes: readonly (readonly [string, string])[] = [
    ['an Anthropic key', 'sk-ant-abcdefghijklmnopqrst'],
    ['an OpenAI key', 'sk-proj-abcdefghijklmnopqrstuvwx'],
    ['an AWS access key', 'AKIAABCDEFGHIJKLMNOP'],
    ['a Google API key', 'AIzaSyA-abcdefghijklmnopqrstuvwxyz01234'],
    ['a GitHub token', 'ghp_abcdefghijklmnopqrst'],
    ['a fine-grained GitHub token', 'github_pat_abcdefghijklmnopqrstuv'],
    ['a GitLab token', 'glpat-abcdefghijklmnopqrst'],
    ['a Slack token', 'xoxb-1234567890-abcdefghij'],
    ['an npm token', `npm_${'a1B2c3D4e5'.repeat(3)}a1B2c3`],
    ['a Hugging Face token', `hf_${'abcdefghij'.repeat(3)}`],
    ['a JWT', 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4'],
    ['a bearer token', 'Bearer abcdefghijklmnopqrstu'],
    ['a login inside an address', 'postgres://admin:hunter2@'],
    ['a value after a name', 'password=hunter2hunter2'],
    ['a value after a JSON name', '"accessToken": "abcdefgh12345678"'],
    ['a passphrase', 'ssh key passphrase is correct-horse']
  ]

  for (const [name, key] of shapes) {
    it(`replaces ${name}`, () => {
      const scrubbed = scrubSecrets(`before ${key} after`)
      expect(scrubbed.text).toContain(REMOVED)
      expect(scrubbed.text).not.toContain(key)
      expect(scrubbed.replaced).toBe(1)
    })
  }

  it('replaces a whole private key, header to footer', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
    expect(scrubSecrets(`key:\n${key}\ndone`)).toEqual({ text: `key:\n${REMOVED}\ndone`, replaced: 1 })
  })

  it('replaces a private key whose footer was cut off with the diff', () => {
    expect(scrubSecrets('+-----BEGIN PRIVATE KEY-----\n+MIIEvQIBADAN')).toEqual({ text: `+${REMOVED}\n+MIIEvQIBADAN`, replaced: 1 })
  })

  it('replaces the value of a spoken password and a card number', () => {
    expect(scrubSecrets('the password is hunter2hunter2.')).toEqual({ text: `the password is ${REMOVED}.`, replaced: 1 })
    expect(scrubSecrets('charged 4242 4242 4242 4242 today')).toEqual({ text: `charged ${REMOVED} today`, replaced: 1 })
  })

  it('counts every piece, across lines and kinds', () => {
    const text = 'a sk-ant-abcdefghijklmnopqrst\nb ghp_abcdefghijklmnopqrst\nc ghp_abcdefghijklmnopqrst\nd AKIAABCDEFGHIJKLMNOP'
    const scrubbed = scrubSecrets(text)
    expect(scrubbed.replaced).toBe(4)
    expect(scrubbed.text.split(REMOVED)).toHaveLength(5)
  })

  it('leaves ordinary text alone: a UUID, a git sha, a long path, a version, a line that names a setting', () => {
    const ordinary = [
      'run 3f2b8c1e-9d4a-4e7b-a1c5-0b6d2f8e7a91 finished',
      'commit 9fceb02d0ae598e95dc970b74767f19372d61af7',
      'C:\\Users\\<home>\\Documents\\Codex\\locust-scrub-record\\apps\\desktop\\src\\renderer\\src\\components\\SaveRecordDialog.tsx',
      '/home/runner/work/locust/locust/packages/runtime-adapters/src/codex-events.ts:432',
      'Locust 0.590.0 · Tests 1204 passed',
      'set the password in .env, then restart',
      'the password is stored in the vault',
      'order 20261002093015123 shipped'
    ].join('\n')
    expect(scrubSecrets(ordinary)).toEqual({ text: ordinary, replaced: 0 })
  })

  it('is stable: scrubbed text scrubs to itself with nothing replaced', () => {
    const once = scrubSecrets('password is password=abcdefgh12 and sk-ant-abcdefghijklmnopqrst')
    expect(scrubSecrets(once.text)).toEqual({ text: once.text, replaced: 0 })
    expect(once.replaced).toBe(2)
  })
})
