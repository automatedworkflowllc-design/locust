import type { Workroom } from '@teammate/mission-store'

/*
 * WHAT A SET-ASIDE TURN SENT, NOBODY GETS (0.512).
 *
 * Sol's long pass on 0.509: Builder, in turns an edit later set aside, had
 * asked Reviewer to rewrite the README for JSON. With automatic replies off
 * it waited, and 32 minutes later "Ask Reviewer for a review" of the CSV
 * branch opened on it -- words from a branch the person had turned away from.
 *
 * Each such message still unread goes back to the turn that sent it: recorded
 * as delivered to that turn, which is the record's way of saying it reached no
 * one else. A new record kind would be clearer, and would make every older
 * Locust drop the rest of the workroom file (workroom.ts reads strictly).
 *
 * Returns the messages retired. A message already delivered is left as it was.
 */
export async function retireSetAsideMessages(workroom: Pick<Workroom, 'read' | 'markDelivered'>, listed: unknown): Promise<readonly string[]> {
  if (!Array.isArray(listed) || listed.length === 0 || listed.length > 500) return []
  const turns = new Set(listed.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)))
  if (turns.size === 0) return []
  const snapshot = await workroom.read()
  const delivered = new Set(snapshot.deliveries.map((delivery) => delivery.messageId))
  const bySender = new Map<string, string[]>()
  for (const message of snapshot.messages) {
    if (delivered.has(message.messageId) || !turns.has(message.from.missionId)) continue
    bySender.set(message.from.missionId, [...(bySender.get(message.from.missionId) ?? []), message.messageId])
  }
  const retired: string[] = []
  for (const [sender, ids] of bySender) {
    await workroom.markDelivered(ids, sender)
    retired.push(...ids)
  }
  return retired
}
