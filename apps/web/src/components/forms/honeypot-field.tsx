/**
 * Spam honeypot.
 *
 * Hidden from people and from assistive technology, but present in the DOM for
 * naive bots that fill every field they find. A submission with this field
 * populated is discarded server-side.
 *
 * Hidden with an off-screen technique rather than `display: none`, because
 * some bots deliberately skip display-none fields. `aria-hidden`, `tabIndex`
 * and `autoComplete="off"` together keep it out of the tab order, out of the
 * accessibility tree and out of autofill, so it costs real users nothing.
 */
export function HoneypotField() {
  return (
    <div aria-hidden="true" className="absolute h-px w-px overflow-hidden" style={{ left: "-9999px" }}>
      <label htmlFor="website-hp">Оставете това поле празно</label>
      <input id="website-hp" type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}
