import { useId } from "react";

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
 *
 * The id is generated, not fixed: a form can be on a page more than once (a
 * product card opens the quick order in a dialog beside the one on the page),
 * and two elements with one id break the label association for both. The
 * field NAME stays `website`, which is what the server reads.
 */
export function HoneypotField() {
  const id = useId();
  return (
    <div
      aria-hidden="true"
      className="absolute h-px w-px overflow-hidden"
      style={{ left: "-9999px" }}
    >
      <label htmlFor={id}>Оставете това поле празно</label>
      <input id={id} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}
