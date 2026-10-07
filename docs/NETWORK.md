# What Locust sends over the network

Locust itself sends nothing about you or your work to anyone. It has no
analytics and no usage counts, and when it crashes, the crash dump stays on
this machine (nothing is uploaded). The AI agents it runs
connect to their own services, with the accounts you signed them in with:
that is the work you asked for. This page lists every connection Locust
itself makes, when it makes it, and what it sends, so you can check it.

It is held to the code by `apps/desktop/src/main/the-network-is-written-down.test.ts`:
a new place in Locust's main process that reaches the network fails that test
until it is listed here.

## Locust's own connections

| What | Where | When |
| --- | --- | --- |
| Its own updates (Windows) | `github.com/automatedworkflowllc-design/locust-releases` | 8 seconds after it starts, then every 6 hours while it is open, and when you press Check now |
| Its own updates (Mac) | `api.github.com/repos/automatedworkflowllc-design/locust-releases`, then the disk image you choose | When it checks, and when you choose to update |
| Installing an AI agent | the npm registry (`registry.npmjs.org`, or the one your npm is set to use) | When you press Install for OpenCode, Claude Code, Codex CLI or Copilot CLI |
| Keeping Codex CLI and Copilot CLI current | the npm registry, and `raw.githubusercontent.com/automatedworkflowllc-design/locust-releases/main/runtime-canary.json` | 45 seconds after the installed Locust starts, then at most every 6 hours |
| The pet gallery | `openpets.dev`, addresses under `/pets/` only | When you open the gallery, and when you take a pet |
| Testing one of your own models | the address you gave it in Settings > Your own models | When you press Test |
| Voice typing's one-time files | `github.com/ggml-org/whisper.cpp`, `huggingface.co/ggerganov/whisper.cpp`, and their download CDNs | On Windows x64, only when you press Download in the microphone's first-use prompt |
| A web page a teammate made, open in the preview | eight public hosts, for libraries and fonts only | While the page is open |

**Its own updates.** A plain request for the files of the newest release in a
public repository that holds only Locust's installers: `latest.yml`, then the
parts of the installer that changed. No account, nothing that identifies you
beyond what any download shows (your IP address, to GitHub). A check is never
made while a teammate is working; it is tried again 15 minutes later. A copy of
Locust that is not the installed one never updates itself.

**Installing and updating AI agents.** Locust runs npm, and npm downloads the
package: `opencode-ai`, `@anthropic-ai/claude-code`, `@openai/codex` or
`@github/copilot`. Cursor Agent, Muse Code and Antigravity are installed from
their makers' pages, in your browser. For Codex CLI and Copilot CLI, the
installed Locust also asks npm for their newest version (one `npm view` each)
and reads the verdict file above, which can hold a version back. The look runs
whatever "Update Codex CLI and Copilot CLI on their own" (Settings > AI agents)
says; the switch decides only whether a version 12 hours old is installed on
its own. Claude Code, OpenCode and Cursor Agent keep themselves current, with
their own connections.

**The pet gallery.** The catalog of pets and the files of a pet you take, over
https, from `openpets.dev` under `/pets/` and nowhere else, with no redirects
followed. What was read is kept on this machine and used again.

**Testing one of your own models.** Test asks the address you gave which
models it serves (`/models`), then sends the model one chat request, capped at
a single word and carrying one tool that does nothing, to see whether it can
use tools. A key you gave goes with both, to that address and nowhere else.
Nothing of your work is in either request. A teammate's runs on the model go
through OpenCode, below.

**Voice typing's one-time files.** Download retrieves the pinned Windows x64 CPU
archive `b5454/whisper-bin-x64.zip` and the pinned `ggml-tiny.en-q5_1.bin` model
revision `5359861c739e955e79d9a303bcbc70fb988958b1`, following their HTTPS download
redirects. Every asset has a SHA-256 in the code. The checked runtime and model
stay in this profile's `voice/` folder. No account, API key, recording, transcript,
or work goes in these requests; the servers see what any file download reveals,
including your IP address. No connection is made before Download, and local
transcription makes no speech-service request. A cancelled download is restarted
cleanly when you choose Download again. Audio files are transient, removed after
transcription or cancellation; no recognition process is retained at rest.

**A web page in the preview.** A page a teammate made runs inside Locust. It may
load libraries, stylesheets and fonts -- GET and HEAD over https only -- from
`cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `esm.sh`,
`cdn.tailwindcss.com`, `code.jquery.com`, `fonts.googleapis.com` and
`fonts.gstatic.com`. Everything else it asks of the web is refused, so what it
reads of your folder stays on this machine.

## What stays on this machine

- **Locust's own window loads nothing from the network** in the installed app:
  one filter refuses every request it makes, apart from a previewed page's,
  above. On Windows its own main frame may request microphone audio for voice
  typing after a mic press. Cameras, preview frames, location, and all other
  device and web permissions remain refused.
- **Locust's permission host listens on `127.0.0.1` only.** Claude Code asks it
  before a connector call or a command, and each run gets its own token. Locust
  also reads Antigravity's own local server, at `127.0.0.1`.
- **The spellchecker downloads no dictionary.**
- **Memory recall** runs a small model that ships with Locust.
- **A report reaches Locust's makers only when you send it.** Send feedback,
  and Report a problem in Settings, let you choose: open a public GitHub issue
  in your browser, open your mail app with the report addressed to Locust's
  makers, or save it as a file.
- **Links** (the Locust website, an agent's install page) open in your
  browser, when you click them. A link inside a previewed page asks you first,
  since an address can carry what the page read.

## The AI agents' own connections

Each AI agent connects to its own service with the account you signed it in
with, and sends what that service needs to do the work: your messages, and the
files and command output the agent reads. Codex CLI talks to OpenAI, Claude
Code to Anthropic, Copilot CLI to GitHub, Cursor Agent to Cursor, Antigravity
to Google, Muse Code to Meta, and OpenCode to the provider of the model you
pick -- for one of your own models, the address you gave it in Settings > Your
own models. A connector a teammate uses is called by its agent, at the service
that connector names.

Locust does not sit between an agent and its service: it reads what the agent
reports on this machine as it works, and nothing of its network traffic. It
never sees the agents' sign-ins: each agent keeps its own. A key you give Locust for one of
your own models is kept on this machine, encrypted by the system, sent by Test
to that model's address, and handed only to OpenCode, for that model.
