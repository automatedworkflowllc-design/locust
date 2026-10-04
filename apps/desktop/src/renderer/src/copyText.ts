/**
 * Puts text on the clipboard, and says whether it got there.
 *
 * `navigator.clipboard` is the right call and is not always available to a
 * packaged page, so a hidden textarea and `execCommand('copy')` stand in --
 * the fallback the shell output's Copy and the install command already used,
 * in one place now (0.545).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the textarea.
  }
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}
