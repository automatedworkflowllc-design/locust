// One-off records must be named by the caller, before a drive does any work.
export function requiredPathArgument(name, argv = process.argv.slice(2)) {
  const at = argv.indexOf(name)
  const value = at === -1 ? undefined : argv[at + 1]
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`Give ${name} <path>; this tool needs the original record's path explicitly.`)
  }
  return value
}
