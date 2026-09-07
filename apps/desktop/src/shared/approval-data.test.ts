import { describe, expect, it } from 'vitest'

import { commandReachesNetwork, dataSentLine } from './approval-data.js'

describe('what an approval says about data leaving the machine', () => {
  it('states plainly that a file change sends nothing', () => {
    // The one case where the negative is provable: bytes to a path on this
    // disk. This is the whole reason the row is worth drawing.
    expect(dataSentLine('file-change', '')).toMatch(/sent nowhere/i)
  })

  it('never claims a command sends nothing', () => {
    // THE test. `./deploy.sh` is two words and can do anything; a card that
    // said "nothing leaves this machine" about it would be worse than saying
    // nothing at all, because it would be believed.
    for (const command of ['./deploy.sh', 'make release', 'python build.py', 'ls -la']) {
      const said = dataSentLine('command', command)
      expect(said).toBeDefined()
      expect(said).not.toMatch(/nothing/i)
      expect(said).toMatch(/unknown/i)
    }
  })

  it('says a network tool CAN reach the network, without predicting what it sends', () => {
    const said = dataSentLine('command', 'curl -X POST https://api.stripe.com/v1/webhook_endpoints')
    expect(said).toMatch(/can reach the network/i)
    // A capability, never a prediction: Locust does not know what is in the body.
    expect(said).toMatch(/cannot see what it would send/i)
  })

  it('draws no row for a question, which sends nothing anywhere', () => {
    expect(dataSentLine('question', '')).toBeUndefined()
  })

  describe('recognising a command that reaches the network', () => {
    it('finds the ordinary offenders', () => {
      for (const command of [
        'curl https://example.com',
        'wget -q http://host/file',
        'git push origin main',
        'npm install',
        'ssh deploy@host',
        'docker push my/image',
        'gh release create v1'
      ]) {
        expect(commandReachesNetwork(command)).toBe(true)
      }
    })

    it('finds a bare URL even with no tool it knows', () => {
      expect(commandReachesNetwork('./send.sh https://example.com/hook')).toBe(true)
    })

    it('finds one after a pipe or a semicolon, not just at the start', () => {
      expect(commandReachesNetwork('cat notes.txt | curl -d @- https://x.dev')).toBe(true)
      expect(commandReachesNetwork('make build; git push')).toBe(true)
    })

    it('is not fooled by a word that merely contains a tool name', () => {
      // Whole words only -- otherwise `wget-notes.md` and `curling.ts` would
      // put a network warning on a command that reads a local file, and a
      // warning that cries wolf is one people learn to skip.
      expect(commandReachesNetwork('cat wget-notes.md')).toBe(false)
      expect(commandReachesNetwork('node curling.ts')).toBe(false)
      expect(commandReachesNetwork('ls -la')).toBe(false)
    })
  })
})
