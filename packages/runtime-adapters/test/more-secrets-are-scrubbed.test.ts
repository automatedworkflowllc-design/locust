import { describe, expect, it } from "vitest";

import { redactSecrets, redactText } from "../src/codex-events.js";

/**
 * FOUR MORE SHAPES OF SECRET (0.543, the 0.536 code review SEC-07): a private
 * key block, a bare JWT, a Google API key and a Hugging Face token reached the
 * ledger whole unless a label like `api_key=` stood beside them. Built by
 * concatenation so no real-looking secret sits in the source.
 */
const PEM = ["-----BEGIN", " PRIVATE KEY-----\n", "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n", "-----END", " PRIVATE KEY-----"].join("");
const RSA = ["-----BEGIN RSA", " PRIVATE KEY-----\nabc\n-----END RSA", " PRIVATE KEY-----"].join("");
const JWT = ["eyJ", "hbGciOiJIUzI1NiJ9", ".eyJ", "zdWIiOiIxMjM0NTY3ODkwIn0", ".", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"].join("");
const GOOGLE = "AIza" + "S".repeat(35);
const HF = "hf_" + "a".repeat(34);

describe("secrets in what a runtime says", () => {
  for (const scrub of [redactSecrets, redactText]) {
    it(`${scrub.name} scrubs a private key, a bare JWT, a Google key and a Hugging Face token`, () => {
      const said = scrub(`key:\n${PEM}\nrsa: ${RSA}\njwt ${JWT} google ${GOOGLE} hf ${HF} end`);
      for (const secret of [PEM, RSA, JWT, GOOGLE, HF]) expect(said).not.toContain(secret);
      expect(said).toContain("end");
    });
  }

  it("leaves ordinary words alone, including ones that merely start alike", () => {
    expect(redactSecrets("eyJ is how a JWT starts; AIza and hf_ too.")).toBe("eyJ is how a JWT starts; AIza and hf_ too.");
  });
});
