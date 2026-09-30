/**
 * STATEMENTS, READ (0.506): the transactions in the files a person drops in
 * their Finances folder, whatever shape their bank exports.
 *
 * Colin, 2026-09-30, on 0.501's Finances: "we definitely missed the mark" --
 * ChatGPT's own Finances is a dashboard (spend by category, accounts,
 * transactions, upcoming), fed by linked accounts Locust cannot reach (the
 * Codex app-server's app list answers 403). Locust's dashboard is fed by
 * statements instead: every bank exports one. Banks disagree on the shape --
 * one Amount column or Debit/Credit, spends negative or positive, dates as
 * 2026-09-02, 09/02/2026 or 2 Sep 2026, a category column or none -- so the
 * columns are found by their names, never by position, and a row that cannot
 * be read is counted, not guessed at.
 */

export interface Transaction {
  /** ISO date, yyyy-mm-dd. */
  readonly date: string
  readonly description: string
  /** Money out is negative, money in positive, whatever the bank's own sign. */
  readonly amount: number
  readonly category: string
  /** The file it came from, so the same row in two exports is seen once. */
  readonly source: string
}

export interface ReadStatement {
  readonly transactions: readonly Transaction[]
  /** Rows that had no date or amount Locust could read. */
  readonly skipped: number
  /** Why the file gave nothing, when it gave nothing. */
  readonly problem?: string
}

/** One CSV line into its fields: quotes, doubled quotes and commas inside quotes. */
export function csvFields(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      out.push(field)
      field = ''
    } else field += char
  }
  out.push(field)
  return out.map((value) => value.trim())
}

const MONTHS: Readonly<Record<string, number>> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const pad = (value: number): string => String(value).padStart(2, '0')

/** A date in the shapes banks write, as yyyy-mm-dd; undefined for anything else. US order for 09/02/2026. */
export function isoDate(text: string): string | undefined {
  const value = text.trim()
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
  if (match !== null) return `${match[1]}-${pad(Number(match[2]))}-${pad(Number(match[3]))}`
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value)
  if (match !== null) {
    const year = match[3]!.length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    return `${String(year)}-${pad(Number(match[1]))}-${pad(Number(match[2]))}`
  }
  match = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(value)
  if (match !== null && MONTHS[match[2]!.toLowerCase()] !== undefined) return `${match[3]}-${pad(MONTHS[match[2]!.toLowerCase()]!)}-${pad(Number(match[1]))}`
  match = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(value)
  if (match !== null && MONTHS[match[1]!.toLowerCase()] !== undefined) return `${match[3]}-${pad(MONTHS[match[1]!.toLowerCase()]!)}-${pad(Number(match[2]))}`
  return undefined
}

/** "$1,234.50", "(84.15)", "-84.15", "84.15 CR" as a number; undefined when it is not one. */
export function money(text: string): number | undefined {
  let value = text.trim()
  if (value.length === 0) return undefined
  let sign = 1
  if (/^\(.*\)$/.test(value)) {
    sign = -1
    value = value.slice(1, -1)
  }
  if (/\s*DR$/i.test(value)) {
    sign = -1
    value = value.replace(/\s*DR$/i, '')
  }
  value = value.replace(/\s*CR$/i, '')
  value = value.replace(/[$€£,\s]/g, '')
  if (!/^[-+]?\d+(\.\d+)?$/.test(value)) return undefined
  return sign * Number(value)
}

/** Which column holds what, from the header's own words. */
function columnsOf(header: readonly string[]) {
  const find = (...words: readonly string[]): number => header.findIndex((name) => words.some((word) => name.toLowerCase().replace(/[^a-z]/g, '') === word))
  const loose = (...words: readonly string[]): number => header.findIndex((name) => words.some((word) => name.toLowerCase().includes(word)))
  const date = find('date', 'transactiondate', 'posteddate', 'postingdate') >= 0 ? find('date', 'transactiondate', 'posteddate', 'postingdate') : loose('date')
  const description = find('description', 'payee', 'merchant', 'name', 'details', 'memo') >= 0 ? find('description', 'payee', 'merchant', 'name', 'details', 'memo') : loose('description', 'payee', 'merchant')
  return {
    date,
    description,
    amount: find('amount', 'transactionamount'),
    debit: find('debit', 'withdrawal', 'withdrawals', 'moneyout', 'paidout'),
    credit: find('credit', 'deposit', 'deposits', 'moneyin', 'paidin'),
    category: find('category')
  }
}

/**
 * A CSV statement, read. `spendsArePositive` is for the banks that write a
 * card purchase as +42.00: found from the file itself -- a statement whose
 * Amount column is mostly positive and names no income is read that way.
 */
export function readCsvStatement(text: string, source: string): ReadStatement {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim().length > 0)
  // The header is the first line naming a date and an amount (some banks put account details above it).
  const headerAt = lines.findIndex((line) => {
    const cells = csvFields(line).map((cell) => cell.toLowerCase())
    return cells.some((cell) => cell.includes('date')) && cells.some((cell) => /amount|debit|credit|withdrawal|deposit/.test(cell))
  })
  if (headerAt < 0) return { transactions: [], skipped: 0, problem: 'no header naming a date and an amount' }
  const columns = columnsOf(csvFields(lines[headerAt]!))
  if (columns.date < 0 || (columns.amount < 0 && columns.debit < 0 && columns.credit < 0)) {
    return { transactions: [], skipped: 0, problem: 'no date or amount column' }
  }
  const rows: { date: string; description: string; amount: number; category: string | undefined }[] = []
  let skipped = 0
  for (const line of lines.slice(headerAt + 1)) {
    const cells = csvFields(line)
    const date = isoDate(cells[columns.date] ?? '')
    let amount: number | undefined
    if (columns.amount >= 0) amount = money(cells[columns.amount] ?? '')
    if (amount === undefined && (columns.debit >= 0 || columns.credit >= 0)) {
      const out = columns.debit >= 0 ? money(cells[columns.debit] ?? '') : undefined
      const into = columns.credit >= 0 ? money(cells[columns.credit] ?? '') : undefined
      if (out !== undefined || into !== undefined) amount = (into ?? 0) - Math.abs(out ?? 0)
    }
    if (date === undefined || amount === undefined) {
      skipped += 1
      continue
    }
    const description = (columns.description >= 0 ? cells[columns.description] : undefined) ?? ''
    const category = columns.category >= 0 ? cells[columns.category] : undefined
    rows.push({ date, description, amount, category: category === undefined || category.length === 0 ? undefined : category })
  }
  // A card statement that writes purchases as positive: mostly positive, and nothing reading as pay.
  const positive = rows.filter((row) => row.amount > 0).length
  const flip = columns.amount >= 0 && rows.length > 0 && positive / rows.length > 0.8 && !rows.some((row) => INCOME.test(row.description))
  return {
    transactions: rows.map((row) => {
      const amount = flip ? -row.amount : row.amount
      return { date: row.date, description: row.description, amount, category: row.category ?? categoryOf(row.description, amount), source }
    }),
    skipped
  }
}

const INCOME = /payroll|salary|direct dep|paycheck|deposit from|interest paid|refund/i
const RULES: readonly (readonly [RegExp, string])[] = [
  [INCOME, 'Income'],
  [/grocer|market|supermarket|whole foods|trader joe|aldi|kroger|safeway|publix|costco|walmart grocery|food lion|wegmans|h-e-b|heb /i, 'Groceries'],
  [/netflix|spotify|hulu|disney\+|youtube premium|apple\.com\/bill|icloud|prime video|amazon prime|patreon|gym|fitness|subscription|streamflix|gymco|openai|chatgpt|anthropic/i, 'Subscriptions'],
  [/restaurant|cafe|coffee|starbucks|mcdonald|chipotle|doordash|uber eats|grubhub|pizza|bar & grill|diner|dining|taco|burger/i, 'Dining'],
  [/electric|power|water|gas co|utility|utilities|comcast|xfinity|verizon|at&t|t-mobile|internet|spectrum/i, 'Bills & utilities'],
  [/rent|mortgage|landlord|hoa|property/i, 'Housing'],
  [/uber|lyft|shell|exxon|chevron|bp |gas station|fuel|parking|toll|transit|metro/i, 'Transport'],
  [/amazon|target|best buy|ebay|etsy|shop|store/i, 'Shopping'],
  [/insurance|geico|progressive|state farm|allstate/i, 'Insurance'],
  [/transfer|zelle|venmo|paypal|cash app/i, 'Transfers'],
  [/fee|interest charge|atm/i, 'Fees'],
  [/pharmacy|cvs|walgreens|doctor|dental|clinic|hospital|health/i, 'Health']
]

/** A category from the description, when the bank gave none. Money in with no rule is Income. */
export function categoryOf(description: string, amount: number): string {
  for (const [rule, name] of RULES) if (rule.test(description)) return name
  return amount > 0 ? 'Income' : 'Other'
}

/** Transactions from several files, the same row in two overlapping exports kept once. */
export function mergeStatements(read: readonly ReadStatement[]): readonly Transaction[] {
  const seen = new Set<string>()
  const out: Transaction[] = []
  for (const statement of read) {
    for (const row of statement.transactions) {
      const key = `${row.date}|${row.description.toLowerCase()}|${row.amount.toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out.sort((left, right) => right.date.localeCompare(left.date))
}

export interface MonthSpend {
  readonly month: string
  readonly total: number
  readonly income: number
  readonly categories: readonly { readonly category: string; readonly amount: number; readonly count: number }[]
}

/** One month's money out by category, biggest first; money in and transfers kept apart. */
export function spendByCategory(transactions: readonly Transaction[], month: string): MonthSpend {
  const inMonth = transactions.filter((row) => row.date.startsWith(month))
  const out = new Map<string, { amount: number; count: number }>()
  let income = 0
  for (const row of inMonth) {
    if (row.amount >= 0) {
      income += row.amount
      continue
    }
    if (row.category === 'Transfers') continue
    const held = out.get(row.category) ?? { amount: 0, count: 0 }
    out.set(row.category, { amount: held.amount - row.amount, count: held.count + 1 })
  }
  const categories = [...out.entries()].map(([category, value]) => ({ category, amount: Math.round(value.amount * 100) / 100, count: value.count })).sort((left, right) => right.amount - left.amount)
  return { month, total: Math.round(categories.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100, income: Math.round(income * 100) / 100, categories }
}

/** The months the transactions cover, newest first. */
export function monthsOf(transactions: readonly Transaction[]): readonly string[] {
  return [...new Set(transactions.map((row) => row.date.slice(0, 7)))].sort().reverse()
}

/**
 * What repeats: the same payee, a similar amount, in two or more months --
 * subscriptions and bills, and roughly when the next one is due.
 */
export function recurringOf(transactions: readonly Transaction[]): readonly { readonly description: string; readonly amount: number; readonly months: number; readonly nextAround: string }[] {
  const key = (description: string): string => description.toLowerCase().replace(/[#*\d]+/g, '').replace(/\s+/g, ' ').trim()
  const groups = new Map<string, Transaction[]>()
  for (const row of transactions) {
    if (row.amount >= 0) continue
    const held = groups.get(key(row.description)) ?? []
    held.push(row)
    groups.set(key(row.description), held)
  }
  const out: { description: string; amount: number; months: number; nextAround: string }[] = []
  for (const rows of groups.values()) {
    const months = new Set(rows.map((row) => row.date.slice(0, 7)))
    if (months.size < 2) continue
    const amounts = rows.map((row) => -row.amount)
    const typical = amounts.reduce((sum, value) => sum + value, 0) / amounts.length
    if (amounts.some((value) => Math.abs(value - typical) > Math.max(2, typical * 0.15))) continue
    const last = [...rows].sort((left, right) => right.date.localeCompare(left.date))[0]!
    const next = new Date(`${last.date}T12:00:00Z`)
    next.setUTCMonth(next.getUTCMonth() + 1)
    out.push({ description: last.description, amount: Math.round(typical * 100) / 100, months: months.size, nextAround: next.toISOString().slice(0, 10) })
  }
  return out.sort((left, right) => left.nextAround.localeCompare(right.nextAround))
}
