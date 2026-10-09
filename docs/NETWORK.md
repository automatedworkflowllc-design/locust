# What Locust sends over the network

Locust sends no analytics or automatic uploads of your work. Optional OpenAI
voice typing sends recordings only after you choose it and allow it. It has no
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
| Skills from GitHub | `api.github.com` and `raw.githubusercontent.com`, for the public repository you name | When you press Look, Look for changes, or Keep in Settings > Teammates |
| Voice typing's one-time files | `github.com/ggml-org/whisper.cpp`, `huggingface.co/ggerganov/whisper.cpp`, and their download CDNs | On Windows x64, only when you press Download in the microphone's first-use prompt |
| OpenAI voice typing | `https://api.openai.com/v1/audio/transcriptions` | Only after choosing Your OpenAI account, saving your API key, allowing audio upload, and recording with the microphone |
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

**Skills from GitHub.** Look asks GitHub's API for the repository you named,
the commit its branch points to, and the list of its files at that commit,
then reads each skill's SKILL.md for its description. Keep downloads the files
of the skills you ticked, at that same commit, and checks each against the
file id GitHub's list gives it. No sign-in is asked for or sent, so only public
repositories can be read, and GitHub allows 60 looks an hour from one address.
Redirects are followed only to those two hosts. Nothing is checked again on its
own: a kept skill changes only when you look for changes and keep again.

**Voice typing's one-time files.** Download retrieves the pinned Windows x64 CPU
archive `b5454/whisper-bin-x64.zip` and the selected pinned model:
Fast's `ggml-tiny.en-q5_1.bin` (32,166,155 bytes) or Accurate's
`ggml-base.en-q5_1.bin` (59,721,011 bytes). Both use
revision `5359861c739e955e79d9a303bcbc70fb988958b1`, following their HTTPS download
redirects. Every asset has a SHA-256 in the code. The checked runtime and model
stay in this profile's `voice/` folder. No account, API key, recording, transcript,
or work goes in these requests; the servers see what any file download reveals,
including your IP address. No connection is made before Download, and local
transcription makes no speech-service request. A cancelled download is restarted
cleanly when you choose Download again. Audio files are transient, removed after
transcription or cancellation; no recognition process is retained at rest.

**OpenAI voice typing.** This is off by default. Settings > General says that
audio goes to OpenAI; the first recording asks permission once. Main sends a
multipart WAV, `model=gpt-4o-transcribe`, `language=en`, and `response_format=json`
to `https://api.openai.com/v1/audio/transcriptions`, authenticated with the
person's own API key. No redirects are followed. No draft, conversation, or
project files are included. OpenAI API charges apply; a ChatGPT subscription
does not include API usage. The saved key is encrypted by Windows for this
account and never returned to the window or included in logs or profile backups.
Only the transcript or a plain, sanitized error comes back to the window.
Cancelling aborts the request and discards late text, but cannot recall audio
already sent to OpenAI. No upload occurs before consent, no request is made at
rest, and nothing falls back to OpenAI from either local choice.

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
- **Let your other AI apps use Locust** (Settings > General) is off by default.
  When enabled, a separate listener binds only to `127.0.0.1` and
  authenticates the token before reading the request body. The local stdio
  bridge reads this profile's account-only connection file and forwards tool
  calls over HTTP; it never starts Locust or sends the token off the machine.
  Turning the switch off closes the listener and revokes the token; enabling
  it again mints a new one. Teammate conversations started through it run in
  Ask mode (read only), use the agents' own accounts, apply Locust's monthly
  limits, and appear in history marked as started from another app. Shares
  remain visible in Locust, but never start automatic teammate handoffs. Listing
  teammates, replies and background runs is read only. Running turns are not
  cancelled when the listener is switched off.
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
that connector names. A Claude Code teammate can also search the web and open
web pages: in Auto on its own, and in every other mode only after you approve
each one on its card, which shows the search words or the page's whole address.

Locust does not sit between an agent and its service: it reads what the agent
reports on this machine as it works, and nothing of its network traffic. It
never sees the agents' sign-ins: each agent keeps its own. A key you give Locust for one of
your own models is kept on this machine, encrypted by the system, sent by Test
to that model's address, and handed only to OpenCode, for that model.
