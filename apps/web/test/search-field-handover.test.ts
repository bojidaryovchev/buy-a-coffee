// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { typedBeforeHydration } from "@/components/catalog/search-field";

/*
 * The header swaps its server-rendered search form for the interactive field
 * once the page hydrates. Whatever the visitor typed in between must survive.
 */
describe("typedBeforeHydration", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hands over the text and the focus of the server-rendered field", () => {
    document.body.innerHTML = '<input id="search-fallback" name="q" type="search" />';
    const fallback = document.getElementById("search-fallback") as HTMLInputElement;
    fallback.value = "лава";
    fallback.focus();
    expect(typedBeforeHydration()).toEqual({ value: "лава", focused: true });
  });

  it("reports an untouched field as empty and unfocused", () => {
    document.body.innerHTML = '<input id="search-fallback" /><button>other</button>';
    (document.querySelector("button") as HTMLButtonElement).focus();
    expect(typedBeforeHydration()).toEqual({ value: "", focused: false });
  });

  it("is null where there was no server-rendered field", () => {
    expect(typedBeforeHydration()).toBeNull();
  });
});
