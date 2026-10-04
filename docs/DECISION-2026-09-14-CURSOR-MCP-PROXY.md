# Decision for Colin: should Locust hold the Robinhood session?

Three sources have now arrived at the same proposal — the analysis Colin
screenshotted, my own read of the Cursor CLI, and a Locust teammate reasoning
about why it could not call Robinhood:

> Desktop Agent login did not carry over. I cannot complete Robinhood from this
> chat until Locust/Cursor injects an already-authenticated MCP session into
> this runtime.

**Convergence is not evidence.** A model explaining why it cannot do something
is a model reasoning about its own situation, which is the thing models are
least reliable about — that teammate could just as easily have invented a
plausible-sounding blocker. What makes this one credible is not that three
sources agree, it is that the CLI says so directly and was measured saying it:

    > cursor-agent mcp list
    robinhood-trading: requires_authentication

    > cursor-agent mcp list-tools robinhood-trading
    MCP 'robinhood-trading' requires authentication.
    Please run: agent mcp login robinhood-trading

The teammate happened to be right about a fact we already had.

## What is settled

- It was never approval. Locust passes `--approve-mcps`, the flag still exists.
- The CLI has no token for that server, so its tools are not offered to the
  model at all. There is no failure to catch: the run behaves as though the
  connector does not exist.
- The Cursor IDE app keeps separate credentials, which is why it works there.
- **0.109.0 says all of this once per Cursor run, with the command.** Before
  0.109.0 it said nothing, because the notice could not start a `.cmd`.

## The proposal, stated plainly

Locust does the OAuth itself, holds and refreshes the token, and runs a small
local MCP server that forwards to Robinhood with that token. Cursor is handed
`--mcp-config` pointing at the local proxy. Cursor never talks to Robinhood and
never runs the OAuth. Same pattern as the Claude permission bridge we already
ship.

It would work. That is not the question.

## What it actually costs

1. **Locust becomes a brokerage OAuth client.** Not a metaphor: we would hold
   and refresh a live trading session in a desktop app we ship to other people.
   That is a different category of software than the one this is today.
2. **A token vault**, with everything that implies about storage, rotation and
   what happens on a stolen laptop.
3. **A streamable HTTP MCP client with OAuth refresh** — real work, not a flag.
4. **Robinhood's terms.** We become a new client of theirs, not "Cursor". That
   is a question for their developer terms, not for this document.
5. Whether `cursor-agent --mcp-config` merges with `~/.cursor/mcp.json` or
   replaces it. If it replaces, their other servers have to be merged in or
   they disappear.

Explicitly rejected, for the record: copying Cursor's IDE tokens into the CLI
config. Brokerage credentials scraped out of another app's store is a bad
product whatever it enables.

## The cheaper thing, if the answer is no

Route Robinhood missions to Claude Code, which is already connected, and have
Locust say so: *"Robinhood is on Claude, not Cursor"*, with a one-click switch.
Seamless for the person, honest about the runtime, and costs us nothing.

## My recommendation

**Not yet, and not for this.** The proxy is the only design that can work, and
it is worth building the day Locust wants to own connector identity generally —
not as a way to unblock one connector on one runtime. Holding a live brokerage
session is a decision about what this product is, and it should be made on
purpose rather than as a side effect of a Robinhood annoyance.

Until then: `cursor-agent mcp login robinhood-trading`, run by Colin. I will
not authenticate a brokerage connector, and 0.109.0 now makes the app say this
once per Cursor run with the command in it.

**This is Colin's call, not mine.** If the answer is yes, the proxy is the
path; nothing else is.
