import { ERROR_CLASS } from "@/components/forms/field-styles";

/**
 * The message under a field (DESIGN.md, "Inputs", Invalid): `${id}-error`, the
 * id the field's `aria-describedby` names. Nothing at all while the field is
 * fine, so nothing is announced or laid out for it.
 */
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} className={ERROR_CLASS}>
      {message}
    </p>
  );
}
