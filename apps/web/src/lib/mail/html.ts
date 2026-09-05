/**
 * The plain-text twin, as HTML.
 *
 * Every message this application sends is composed as plain text and then run
 * through here for the HTML part. Not a fallback nicety: some clients render
 * text only, some render HTML only, and a message with no text part scores
 * worse with spam filters. Generating one from the other is also the only way
 * the two cannot drift, which is the failure mode of every hand-maintained
 * pair of bodies.
 *
 * Colours are written as literal hex, not as `var(--color-ink-900)`. Mail
 * clients do not resolve CSS custom properties — the token would render as no
 * colour at all — so these are the approximate values of the ink tokens in
 * `globals.css`, and they are the one place in the codebase allowed to
 * duplicate them.
 *
 * `white-space: pre-wrap` is doing the real work: the input has meaningful line
 * breaks, and without it a signature block collapses into one line.
 *
 * No `<style>`, no external CSS, no images. Gmail strips the first, most
 * clients ignore the second, and the third turns a transactional message into
 * something that needs "display images below".
 */
export function asHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2b26;white-space:pre-wrap">${escaped}</div>`;
}
