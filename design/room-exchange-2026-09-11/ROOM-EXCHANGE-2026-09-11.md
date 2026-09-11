# The room holds the argument

Drawing: `Locust Room Exchange.dc.html`, `lc-tokens.css` beside it. The four stopped states are live.

You wrote the answer yourself and then declined to believe it:

> *"The answers are a grid of peers; the exchange is a sequence — those are different shapes and I do not think one contains the other naturally."*

Correct. **Neither contains the other, because the grid is wrong once an exchange exists.**

## 1 · Where does the exchange go? It replaces the grid

All three of your options keep the answer grid and find somewhere to put the rest, which leaves the reader merging two shapes in their head to recover one conversation.

**A grid is a claim: these arrived in parallel, and none is a reply to another.** That claim is true for independent answers and false the instant message three answers message two. So the move is not to house the exchange — it is to stop making the claim.

One component, one prop, two correct results — same shape as the plan ruling:

- **Post produced no exchange** → the grid you have, unchanged. A grid of three peers genuinely is a different object from a conversation, and it reads better as cards than as three lonely speakers.
- **Post produced an exchange** → the whole post is a sequence, in time order, **first answers included**.

A fold is wrong for a second reason: a fold means *work, summarised*. This is not work, it is what they said, and **Said does not collapse** — your own register rule.

**Consecutive messages from one speaker group under a single face.** This matters more here than in a normal thread: in a fits-and-starts argument Gem will often say two things while Wren is busy, and drawing that as two speakers misrepresents the rhythm.

## 2 · The answer card — no, and the worry dissolves

You are right that a card showing a member's *first* answer above four better ones is showing the least interesting thing they said. But once the post is a sequence there is no first-answer card to fix. The first answer is simply the first item, earning its position by being first rather than by being framed.

Worth naming why this was always slightly off: **a card is Standing, and a teammate talking is Said.** The answer cards got away with the wrong register while each post produced exactly one utterance per member — because a one-utterance sequence and a card look identical. The argument is what exposed it.

## 3 · Waiting, out of budget, silent — two voices, not in competition

**Waiting for a slot** follows `ROOM-AT-SCALE` exactly. It is roster state, it resolves itself, and the composer note carries it:

```
Wren is finishing another mission. Their reply is queued.
```

Not amber — nothing is wrong and nobody needs to do anything.

**Out of automatic replies** is different in tense, not just in severity. It is a fact about *that post*, and if you put it in the composer it will be wrong the moment someone scrolls to an older post that stopped for another reason. So it goes at the foot of its own exchange, in the standing register, once. **That is not a second status voice** — it is the same split the app already makes between a live mission header and the receipt at the bottom of a thread.

```
6 of 6 automatic replies · 75k in · 1.8k out — post again to continue.
```

Also not amber. The budget is Colin's number doing exactly what it was set to do, and **a rule working as intended is not an alert.** It names the cause and points at the composer, the same pattern as the Plan-mode note.

**Ended without a reply is the exception: it is per-message, not per-exchange**, and it belongs in the sequence, in that teammate's slot, attributed to them. In a sequence **absence is information** — drop the silent turn and the reader watches the argument stop and blames the budget. Draw the gap or they infer the wrong cause. Informational in tone: nothing failed, and sending again usually works.

## 4 · The exchange strip — yes, as the foot, with the names removed

In a mission thread the strip is a header because the whole thread *is* one participant's slice of the exchange. In a room, an exchange belongs to a post, there can be several posts, and its facts describe something that already happened — so it sits under the thing it describes.

**Drop `Gem · Wren` from it.** In the room the participants are the speakers, on screen, with their faces beside every message; naming them again underneath is the app repeating itself. Keep the budget and the cost, which nothing else says.

**Merge it with the ending.** The count and the reason are adjacent facts, and two lines saying adjacent facts in one place is one line. While the argument is live it reads `4 of 6 automatic replies` with no reason attached, which doubles as the runway indicator.

## Two things you did not ask

**A late message under an older post will look like a bug.** If Colin posts twice while an argument from the first post is still running, a reply lands under the older post — above a newer one — and the room appears to have inserted a message into the past. It has not; the record is right. But it needs a disambiguator: **a message that arrives after a later post exists shows its time, and no other message needs to.** That is the one case where a timestamp is load-bearing rather than decoration.

**This makes the room a group chat, and that is correct.** The grid was the anomaly, justified for parallel answers and nothing else. Everything needed is already there — `exchangeOf` gives you the sequence, `WorkroomSender.missionId` attributes every message exactly, `RoomPost.missions` assigns each one to its post. Nothing is invented. The data has been sitting in the wrong shape.

## Constraints held

Three registers, and the room's *present-tense* status voice is still the composer note. Grid to six, list past it, for the no-exchange case which is the only one that still has a grid. Nothing amber. Every message drawn has a sender, a recipient, a mission and a time, and nothing else is claimed.
