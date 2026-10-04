/**
 * WHERE A PERSON REACHES LOCUST'S MAKERS (0.593, the PRD's R23).
 *
 * One address, forwarded to the maintainer. The host builds the email from
 * it (main/report-problem.ts) and the window shows it in Settings > Help; a
 * placeholder here fails `a-report-can-reach-support-by-email-or-file`, so the
 * app can never offer an address nobody reads. The public bug page stays in
 * the host (REPORT_DESTINATION), where the link is built.
 */
export const SUPPORT_ADDRESS = 'support@locust.lol'
