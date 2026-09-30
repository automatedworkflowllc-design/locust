import { describe, expect, it } from 'vitest'

import { csvFields, isoDate, mergeStatements, money, readCsvStatement, recurringOf, spendByCategory } from '../../shared/statements.js'

/**
 * STATEMENTS, READ (0.506): the shapes banks actually export, all read into
 * one list. Made-up rows, never anyone's real account.
 */
describe('the pieces of a row', () => {
  it('splits CSV with quotes and commas inside them', () => {
    expect(csvFields('2026-09-02,"FRESH MARKET, #12",-84.15')).toEqual(['2026-09-02', 'FRESH MARKET, #12', '-84.15'])
    expect(csvFields('"say ""hi""",1')).toEqual(['say "hi"', '1'])
  })

  it('reads the dates banks write', () => {
    expect(isoDate('2026-09-02')).toBe('2026-09-02')
    expect(isoDate('09/02/2026')).toBe('2026-09-02')
    expect(isoDate('9/2/26')).toBe('2026-09-02')
    expect(isoDate('2 Sep 2026')).toBe('2026-09-02')
    expect(isoDate('Sep 2, 2026')).toBe('2026-09-02')
    expect(isoDate('pending')).toBeUndefined()
  })

  it('reads money however it is written', () => {
    expect(money('$1,234.50')).toBe(1234.5)
    expect(money('(84.15)')).toBe(-84.15)
    expect(money('84.15 DR')).toBe(-84.15)
    expect(money('')).toBeUndefined()
    expect(money('n/a')).toBeUndefined()
  })
})

describe('a whole statement', () => {
  it('reads one Amount column, spends negative, and categorizes by description', () => {
    const read = readCsvStatement(['Date,Description,Amount', '2026-09-02,FRESH MARKET,-84.15', '2026-09-12,NETFLIX.COM,-15.99', '2026-09-27,PAYROLL ACME,2400.00'].join('\n'), 'checking.csv')
    expect(read.transactions.map((row) => [row.description, row.amount, row.category])).toEqual([
      ['FRESH MARKET', -84.15, 'Groceries'],
      ['NETFLIX.COM', -15.99, 'Subscriptions'],
      ['PAYROLL ACME', 2400, 'Income']
    ])
  })

  it('reads Debit and Credit columns, with account lines above the header', () => {
    const text = ['Account,Checking ****1234', 'Exported,2026-10-01', 'Posting Date,Payee,Debit,Credit', '09/05/2026,CITY POWER,96.00,', '09/27/2026,DIRECT DEP,,2400.00'].join('\n')
    expect(readCsvStatement(text, 'bank.csv').transactions.map((row) => [row.date, row.amount])).toEqual([['2026-09-05', -96], ['2026-09-27', 2400]])
  })

  it('reads a card statement that writes purchases as positive', () => {
    const read = readCsvStatement(['Transaction Date,Description,Amount', '09/14/2026,CORNER CAFE,22.40', '09/19/2026,FRESH MARKET,106.95'].join('\n'), 'card.csv')
    expect(read.transactions.map((row) => row.amount)).toEqual([-22.4, -106.95])
  })

  it('keeps the bank\'s own category when it gives one', () => {
    const read = readCsvStatement(['Date,Description,Amount,Category', '2026-09-02,SOMEWHERE,-10.00,Pets'].join('\n'), 'x.csv')
    expect(read.transactions[0]?.category).toBe('Pets')
  })

  it('counts rows it cannot read instead of guessing', () => {
    const read = readCsvStatement(['Date,Description,Amount', 'pending,SOMETHING,-5', '2026-09-02,FRESH MARKET,-84.15'].join('\n'), 'x.csv')
    expect(read.skipped).toBe(1)
    expect(read.transactions).toHaveLength(1)
  })

  it('says why a file gave nothing', () => {
    expect(readCsvStatement('just,some,words', 'x.csv').problem).toBe('no header naming a date and an amount')
  })
})

describe('what the dashboard shows', () => {
  const september = readCsvStatement([
    'Date,Description,Amount',
    '2026-08-12,STREAMFLIX,-15.99',
    '2026-09-02,FRESH MARKET,-84.15',
    '2026-09-05,CITY POWER,-96.00',
    '2026-09-09,FRESH MARKET,-121.30',
    '2026-09-12,STREAMFLIX,-15.99',
    '2026-09-19,FRESH MARKET,-106.95',
    '2026-09-20,ZELLE TO SAM,-50.00',
    '2026-09-27,PAYROLL,2400.00'
  ].join('\n'), 'a.csv')

  it('adds a month\'s spending by category, biggest first, income and transfers apart', () => {
    const spend = spendByCategory(september.transactions, '2026-09')
    expect(spend.categories.map((entry) => [entry.category, entry.amount])).toEqual([['Groceries', 312.4], ['Bills & utilities', 96], ['Subscriptions', 15.99]])
    expect(spend.total).toBe(424.39)
    expect(spend.income).toBe(2400)
  })

  it('finds what repeats, and when it is next due', () => {
    expect(recurringOf(september.transactions)).toEqual([{ description: 'STREAMFLIX', amount: 15.99, months: 2, nextAround: '2026-10-12' }])
  })

  it('keeps a row once when two exports overlap', () => {
    const again = readCsvStatement(['Date,Description,Amount', '2026-09-02,FRESH MARKET,-84.15'].join('\n'), 'b.csv')
    expect(mergeStatements([september, again]).filter((row) => row.description === 'FRESH MARKET' && row.date === '2026-09-02')).toHaveLength(1)
  })
})
