/**
 * How a reply is told to place a teammate block.
 *
 * Four separate briefings ask the model to end its reply with a block: the
 * memory block, the ask, the room-task block, and a share. Each of them said
 * "end your reply with exactly this block AND NOTHING AFTER IT", written
 * independently and each perfectly sensible on its own.
 *
 * Together they are a contradiction. A turn that both learned something and
 * needs to tell a teammate gets two instructions that cannot both be obeyed,
 * and a model following whichever it read last simply drops the other. A
 * Cursor teammate reading this source from inside Locust reported it on
 * 2026-09-08 and named the consequence exactly: "That matches how this product
 * actually loses peer messages: the runtime never wrote the block."
 *
 * The host never cared about order -- every parser scans the whole transcript.
 * So the instruction says what is true: put them at the end, together, in any
 * order.
 *
 * It lives here, as one string, because the failure was four people writing
 * the same sentence four times and no two of them agreeing.
 */
export const BLOCK_PLACEMENT =
  'put it at the end of your reply; if more than one of these blocks applies, put them one after another, in any order'
