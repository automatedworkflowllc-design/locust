import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { PublicOwnModel } from '../../../shared/ipc.js'
import { ArmedButton } from './ArmedButton.js'

/**
 * YOUR OWN MODELS, in Settings (0.357).
 *
 * A company with a model of its own -- Colin's father's builds one -- adds it
 * here once and it is in every teammate's model list, under its own name.
 * Anything that speaks the OpenAI chat API works: a company gateway, vLLM,
 * Ollama's /v1, LM Studio. The key is handed to the host and kept only as the
 * operating system encrypts it; this screen never sees it again, only
 * whether one is kept.
 *
 * Test asks the endpoint what it serves, before or after adding -- the
 * mistake worth catching early is a model name the endpoint does not know.
 */
export function OwnModels({ onChanged }: { readonly onChanged: () => void }): ReactElement {
  const [models, setModels] = useState<readonly PublicOwnModel[]>()
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ readonly text: string; readonly good: boolean }>()
  const [testedKept, setTestedKept] = useState<Readonly<Record<string, { readonly text: string; readonly good: boolean }>>>({})

  const load = (): void => {
    void window.desktop?.listOwnModels().then((response) => {
      if (response.ok) setModels(response.data.models)
    }).catch(() => undefined)
  }
  useEffect(load, [])

  const filled = name.trim().length > 0 && baseUrl.trim().length > 0 && model.trim().length > 0
  const typed = { baseUrl: baseUrl.trim(), model: model.trim(), ...(key.trim().length === 0 ? {} : { key: key.trim() }) }

  return (
    <div className="lc-ownmodels">
      {models !== undefined && models.length > 0 && (
        <div className="lc-settingrows">
          {models.map((kept) => (
            <div className="lc-settingrow lc-ownmodel" key={kept.ownId}>
              <span className="lc-ownmodel__text">
                <span className="lc-ownmodel__name">{kept.name}</span>
                <span className="lc-ownmodel__meta lc-mono">
                  {kept.model} · {hostOf(kept.baseUrl)} · {kept.hasKey ? 'key kept' : 'no key'}
                </span>
                {testedKept[kept.ownId] !== undefined && (
                  <span className={`lc-ownmodel__said${testedKept[kept.ownId]!.good ? '' : ' lc-tone-amber'}`}>{testedKept[kept.ownId]!.text}</span>
                )}
              </span>
              <button
                type="button"
                className="lc-button"
                onClick={() => {
                  void window.desktop?.testOwnModel({ ownId: kept.ownId }).then((response) => {
                    setTestedKept((held) => ({
                      ...held,
                      [kept.ownId]: response.ok ? { text: response.data.said, good: response.data.reached } : { text: response.error.message, good: false }
                    }))
                  })
                }}
              >
                Test
              </button>
              <ArmedButton
                className="lc-button"
                ariaLabel={`Remove ${kept.name}`}
                armedLabel={`Remove ${kept.name}?`}
                onConfirm={() => {
                  void window.desktop?.removeOwnModel(kept.ownId).then(() => {
                    load()
                    onChanged()
                  })
                }}
              >
                Remove
              </ArmedButton>
            </div>
          ))}
        </div>
      )}

      <form
        className="lc-ownmodel__form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!filled || busy) return
          setBusy(true)
          setSaid(undefined)
          void window.desktop
            ?.addOwnModel({ name: name.trim(), ...typed })
            .then((response) => {
              if (!response.ok) {
                setSaid({ text: response.error.message, good: false })
                return
              }
              setSaid({ text: `${name.trim()} is in every teammate's model list, under Your models.`, good: true })
              setName('')
              setBaseUrl('')
              setModel('')
              setKey('')
              load()
              onChanged()
            })
            .finally(() => setBusy(false))
        }}
      >
        <label className="lc-ownmodel__field">
          <span className="lc-fieldlabel lc-mono">Name</span>
          <input className="lc-input" value={name} maxLength={60} placeholder="Acme Chat" autoComplete="off" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="lc-ownmodel__field">
          <span className="lc-fieldlabel lc-mono">Model</span>
          <input
            className="lc-input lc-mono"
            value={model}
            maxLength={200}
            placeholder="acme-70b"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label className="lc-ownmodel__field lc-ownmodel__field--wide">
          <span className="lc-fieldlabel lc-mono">Address</span>
          <input
            className="lc-input lc-mono"
            value={baseUrl}
            maxLength={500}
            placeholder="https://llm.example.com/v1"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label className="lc-ownmodel__field lc-ownmodel__field--wide">
          <span className="lc-fieldlabel lc-mono">Key</span>
          <input
            className="lc-input lc-mono"
            type="password"
            value={key}
            maxLength={4000}
            placeholder="Leave empty if it asks for none"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <div className="lc-ownmodel__actions">
          <button
            type="button"
            className="lc-button"
            disabled={baseUrl.trim().length === 0 || model.trim().length === 0 || busy}
            onClick={() => {
              setSaid(undefined)
              void window.desktop?.testOwnModel(typed).then((response) => {
                setSaid(response.ok ? { text: response.data.said, good: response.data.reached } : { text: response.error.message, good: false })
              })
            }}
          >
            Test
          </button>
          <button type="submit" className="lc-primarybutton" disabled={!filled || busy}>
            Add model
          </button>
        </div>
        {said !== undefined && (
          <p className={`lc-ownmodel__said${said.good ? '' : ' lc-tone-amber'}`} role="status">
            {said.text}
          </p>
        )}
      </form>
    </div>
  )
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}
