import "server-only";
import type { Locale } from "@/i18n/config";
import { bg, type Dictionary } from "./bg";
import { en } from "./en";

/**
 * The frame's dictionaries.
 *
 * `server-only`, so a client component cannot import this and ship every
 * locale's strings to every visitor. A client component of the frame — the
 * drawer, the search field — is handed the one locale's strings it draws as
 * props; that object crosses into the RSC payload, which is the intended cost.
 *
 * Synchronous rather than buy-a-vend's dynamic imports: two dictionaries of a
 * few hundred strings each, and a plain object lets the frame stay a set of
 * synchronous components that the unit tests can render.
 *
 * Every locale is checked against `Dictionary`, derived from Bulgarian, so a
 * key missing from English is a compile error.
 */
const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { bg, en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

export type { Dictionary };
