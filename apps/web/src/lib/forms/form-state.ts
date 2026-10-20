/**
 * What a form action answers, and the form-level lines, without zod.
 *
 * `schemas.ts` builds its schemas as it loads, so whatever imports anything
 * from it carries zod into the browser. The newsletter band is on almost every
 * page and, until it is used, needs only the shape of an answer and the
 * newsletter's sentences (`components/forms/newsletter-form.tsx`): they live
 * here so that importing them costs a page nothing. `schemas.ts` re-exports
 * them, so every other import is unchanged.
 */

/**
 * The form-level line when any field is refused. One sentence for the browser
 * and the server alike; the field messages say what is wrong with each.
 */
export const CHECK_FIELDS_MESSAGE = "Поправете отбелязаните полета и изпратете отново.";

/** The newsletter has one field, so its line names it. */
export const CHECK_EMAIL_MESSAGE = "Поправете имейл адреса и опитайте отново.";

/**
 * What an email field is told. Here rather than beside `emailSchema`, which
 * uses them, because the newsletter band's plain form makes the first two
 * checks itself, without zod, and must say exactly what the schema says.
 */
export const EMAIL_MESSAGES = {
  missing: "Въведете имейл адреса си.",
  format: "Въведете целия имейл адрес, например ivan@example.com.",
  long: "Въведете имейл адрес до 254 знака.",
} as const;

/** Uniform result shape for every form action. */
export type FormState =
  | { status: "idle" }
  | {
      status: "success";
      message: string;
      /** An order's short reference (`recordReference`), for the customer to quote. */
      reference?: string;
    }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string>;
      /**
       * What was typed, handed back when the server refused it. With
       * JavaScript the fields never lost it; without, the page is drawn anew
       * from the server's answer, and this is what puts the text back in the
       * fields instead of making the person type a whole message again.
       */
      values?: Record<string, string>;
    };

export const IDLE_FORM_STATE: FormState = { status: "idle" };
