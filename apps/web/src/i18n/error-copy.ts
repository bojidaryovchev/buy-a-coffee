import type { WeekDay } from "@/config/site";
import type { Locale } from "@/i18n/config";

/**
 * The error page's strings.
 *
 * Apart from the dictionaries because `error.tsx` must be a client component —
 * an error boundary is — and cannot be handed props by the layout above it.
 * Importing a whole dictionary into it would ship the frame's every string,
 * in every locale, to every visitor's browser for six lines of text.
 *
 * A `Record<Locale, …>`, so a locale declared without its copy is a type error.
 */
export interface ErrorCopy {
  readonly title: string;
  readonly body: string;
  readonly retry: string;
  readonly home: string;
  readonly phone: string;
  /** `{digest}` is the server log's identifier for this error. */
  readonly reference: string;
  /**
   * Day names for the opening hours printed beside the phone. The same as the
   * dictionary's `hours.days`, repeated rather than imported so this module
   * stays seven lines a locale; a test holds the two together.
   */
  readonly days: Readonly<Record<WeekDay, string>>;
}

export const ERROR_COPY: Readonly<Record<Locale, ErrorCopy>> = {
  bg: {
    title: "Нещо се обърка",
    body: "Не е от вас. Опитайте пак след малко или ни се обадете.",
    retry: "Опитайте отново",
    home: "Към началната страница",
    phone: "Телефон за поръчки:",
    reference: "Референция: {digest}",
    days: {
      monday: "Пон",
      tuesday: "Вт",
      wednesday: "Ср",
      thursday: "Чет",
      friday: "Пет",
      saturday: "Съб",
      sunday: "Нед",
    },
  },
  en: {
    title: "Something went wrong",
    body: "It is not your doing. Try again in a moment, or give us a call.",
    retry: "Try again",
    home: "Go to the home page",
    phone: "Phone for orders:",
    reference: "Reference: {digest}",
    days: {
      monday: "Mon",
      tuesday: "Tue",
      wednesday: "Wed",
      thursday: "Thu",
      friday: "Fri",
      saturday: "Sat",
      sunday: "Sun",
    },
  },
};
