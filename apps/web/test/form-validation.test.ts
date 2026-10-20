// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  CART_MESSAGES,
  CHECK_EMAIL_MESSAGE,
  CHECK_FIELDS_MESSAGE,
  CONTACT_MESSAGES,
  DELIVERY_MESSAGES,
  EMAIL_MESSAGES,
  PHONE_MESSAGES,
  cartOrderSchema,
  contactSchema,
  newsletterSchema,
  toFieldErrors,
  unsubscribeSchema,
  type FormState,
} from "@/lib/forms/schemas";
import {
  LOGIN_MESSAGES,
  NEWSLETTER_MARK_MESSAGES,
  REPLY_MESSAGES,
  loginSchema,
  newsletterMarkSchema,
  recordReplySchema,
  splitErrors,
  statusChangeSchema,
  threadReplySchema,
} from "@/lib/forms/admin-schemas";

/*
 * The forms in the browser: react-hook-form with the schema the server action
 * validates with, `noValidate`, our messages under the fields when the button
 * is pressed, focus on the first invalid field, and nothing sent until the
 * form is valid. The actions are replaced with spies; what they do with a
 * submission is covered by `forms.test.ts` and the integration tests, and the
 * whole round trip, with and without JavaScript, by `e2e/forms.spec.ts`.
 */

const actions = vi.hoisted(() => ({
  submitCartOrder: vi.fn(),
  submitContactMessage: vi.fn(),
  subscribeToNewsletter: vi.fn(),
}));
vi.mock("@/lib/forms/actions", () => actions);

const admin = vi.hoisted(() => ({
  signIn: vi.fn(),
  replyToThread: vi.fn(),
  replyToRecord: vi.fn(),
  addToNewsletter: vi.fn(),
}));
vi.mock("@/lib/admin-actions", () => admin);

import { ContactForm } from "@/components/forms/contact-form";
import { NewsletterForm } from "@/components/forms/newsletter-form";
import { CartOrderForm } from "@/components/forms/cart-order-form";
import { UnsubscribeForm } from "@/components/forms/unsubscribe-form";
import { LoginForm } from "@/components/admin/login-form";
import { ReplyForm } from "@/components/admin/reply-form";
import { RecordReplyForm } from "@/components/admin/record-reply-form";
import { NewsletterMarkForm } from "@/components/admin/newsletter-mark-form";
import { StatusPicker } from "@/components/admin/status-picker";

beforeEach(() => {
  for (const spy of [...Object.values(actions), ...Object.values(admin)]) {
    spy.mockReset();
    spy.mockImplementation(async () => ({ status: "idle" }));
  }
});
afterEach(cleanup);

/** Press the form's submit button and let validation and React settle. */
async function press(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

/** The message a field is described by, as a screen reader would reach it. */
function describedMessage(field: HTMLElement): string | null {
  const ids = field.getAttribute("aria-describedby")?.split(" ") ?? [];
  const error = ids.map((id) => document.getElementById(id)).find((n) => n?.id.endsWith("-error"));
  return error?.textContent ?? null;
}

/** The order form as the cart page draws it, for one product. */
const LINES = [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 2 }] as const;
const orderForm = (props: { onPlaced?: () => void } = {}) =>
  createElement(CartOrderForm, {
    lines: LINES,
    onPlaced: props.onPlaced ?? vi.fn(),
    onCartRefused: vi.fn(),
  });

/** A text field of the order form by its label, without the required mark. */
const textbox = (name: string) => screen.getByRole("textbox", { name });

/** Everything the order form requires, filled in for a delivery to an address. */
async function fillOrder() {
  await act(async () => {
    fireEvent.change(textbox("Име"), { target: { value: "Иван" } });
    fireEvent.change(textbox("Фамилия"), { target: { value: "Петров" } });
    fireEvent.change(textbox("Телефонен номер"), { target: { value: "0888 123 456" } });
    fireEvent.click(screen.getByRole("radio", { name: "Еконт" }));
    fireEvent.change(textbox("Пощенски код"), { target: { value: "4000" } });
    fireEvent.change(textbox("Населено място"), { target: { value: "Пловдив" } });
    fireEvent.change(textbox("Адрес"), { target: { value: "ул. Иван Вазов 12" } });
  });
}

/** The FormData an action was called with: `(state, formData)` or `(formData)`. */
function sentData(spy: ReturnType<typeof vi.fn>, call = 0): FormData {
  const args = spy.mock.calls[call] ?? [];
  return args.find((arg: unknown) => arg instanceof FormData) as FormData;
}

describe("one schema, one message, whoever finds the problem", () => {
  /** What the browser shows: the resolver react-hook-form runs. */
  async function browserMessages(schema: z.ZodTypeAny, values: Record<string, unknown>) {
    const resolver = zodResolver(schema as never);
    const result = await resolver(values as never, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    } as never);
    return Object.fromEntries(
      Object.entries(result.errors as Record<string, { message?: string }>).map(([k, v]) => [
        k,
        v.message,
      ]),
    );
  }
  /** What the server answers: the action's own flattening. */
  function serverMessages(schema: z.ZodTypeAny, values: Record<string, unknown>) {
    const parsed = schema.safeParse(values);
    return parsed.success ? {} : toFieldErrors(parsed.error);
  }

  /** A complete order, to spoil one thing at a time. */
  const order = {
    lines: JSON.stringify(LINES),
    firstName: "Иван",
    lastName: "Петров",
    phone: "0888 123 456",
    deliveryMethod: "address",
    deliveryCourier: "econt",
    deliveryCity: "Пловдив",
    deliveryPostcode: "4000",
    deliveryAddress: "ул. Иван Вазов 12",
    deliveryOffice: "",
  };

  const cases: [string, z.ZodTypeAny, Record<string, unknown>][] = [
    [
      "empty order",
      cartOrderSchema,
      {
        ...order,
        firstName: "",
        lastName: "",
        phone: "",
        deliveryCourier: "",
        deliveryCity: "",
        deliveryPostcode: "",
        deliveryAddress: "",
      },
    ],
    ["short phone", cartOrderSchema, { ...order, phone: "0888 12" }],
    ["letters in the phone", cartOrderSchema, { ...order, phone: "0888 abc 456" }],
    ["long phone", cartOrderSchema, { ...order, phone: "+359 888 123 456 789 01" }],
    ["bad optional fields", cartOrderSchema, { ...order, email: "ivan@", notes: "x".repeat(1001) }],
    [
      "an office with no office named",
      cartOrderSchema,
      { ...order, deliveryMethod: "office", deliveryCourier: "boxnow", deliveryOffice: "" },
    ],
    [
      "BOX NOW to an address, and a long name",
      cartOrderSchema,
      { ...order, deliveryCourier: "boxnow", lastName: "x".repeat(61) },
    ],
    ["an emptied cart", cartOrderSchema, { ...order, lines: "[]" }],
    ["empty contact", contactSchema, { name: "", email: "", message: "" }],
    [
      "short contact",
      contactSchema,
      { name: "A", email: "a@b", phone: "12", message: "кратко", subject: "x".repeat(161) },
    ],
    ["empty newsletter", newsletterSchema, { email: "" }],
    ["bad newsletter", newsletterSchema, { email: "ivan.example.com" }],
    ["empty password", loginSchema, { password: "" }],
    ["empty reply", threadReplySchema, { threadId: "t", body: "   " }],
    ["empty record reply", recordReplySchema, { kind: "order", recordId: "r", body: "" }],
    ["no basis", newsletterMarkSchema, { kind: "order", recordId: "r", basis: null }],
    ["odd basis", newsletterMarkSchema, { kind: "order", recordId: "r", basis: "footer" }],
    ["bad token", unsubscribeSchema, { token: "short" }],
  ];

  it.each(cases)("%s: the browser and the server say the same", async (_name, schema, values) => {
    const server = serverMessages(schema, values);
    expect(Object.keys(server).length).toBeGreaterThan(0);
    expect(await browserMessages(schema, values)).toEqual(server);
  });

  it.each(cases)("%s: every message is Bulgarian and says what to do", (_name, schema, values) => {
    for (const message of Object.values(serverMessages(schema, values))) {
      expect(message).toMatch(/[А-Яа-я]/);
      expect(message).not.toMatch(/Expected|Required|Invalid|String must/);
      expect(message).not.toContain("!");
    }
  });

  it("picks the message that names the problem", () => {
    const phone = (value: string) =>
      serverMessages(cartOrderSchema, { ...order, phone: value }).phone;
    expect(phone("")).toBe(PHONE_MESSAGES.missing);
    expect(phone("0888 12")).toBe(PHONE_MESSAGES.short);
    expect(phone("0888-abc")).toBe(PHONE_MESSAGES.characters);
    expect(phone("+359 888 123 456 789 01")).toBe(PHONE_MESSAGES.long);
    expect(phone("02 123 4567")).toBeUndefined();
    expect(phone("+359 (888) 123-456")).toBeUndefined();

    const contact = serverMessages(contactSchema, { name: "", email: "", message: "" });
    expect(contact).toEqual({
      name: CONTACT_MESSAGES.nameMissing,
      email: EMAIL_MESSAGES.missing,
      message: CONTACT_MESSAGES.messageMissing,
    });
    expect(serverMessages(newsletterSchema, { email: "ivan@" }).email).toBe(EMAIL_MESSAGES.format);
    expect(serverMessages(cartOrderSchema, { ...order, deliveryPostcode: "400" })).toEqual({
      deliveryPostcode: DELIVERY_MESSAGES.postcode,
    });
    expect(serverMessages(cartOrderSchema, { ...order, deliveryCourier: "boxnow" })).toEqual({
      deliveryCourier: DELIVERY_MESSAGES.courier,
    });
    expect(serverMessages(cartOrderSchema, { ...order, lines: "[]" }).lines).toBe(
      CART_MESSAGES.empty,
    );
    /* A line the page could not have written (too many, half a unit) comes
       only from a hand-made post, and is answered with a reload. The browser
       files it under the line's own path, which no field shows; the server's
       answer is the form's line. */
    for (const quantity of [120, 1.5]) {
      const lines = JSON.stringify([{ ...LINES[0], quantity }]);
      expect(serverMessages(cartOrderSchema, { ...order, lines })).toEqual({
        lines: CART_MESSAGES.changed,
      });
    }
  });

  it("puts an error on a hidden admin field in the form's line, not under a field", () => {
    const missing = recordReplySchema.safeParse({ kind: "nope", recordId: "", body: "" });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(splitErrors(missing.error, ["body"])).toEqual({ error: REPLY_MESSAGES.unknownKind });
    }
    const empty = recordReplySchema.safeParse({ kind: "order", recordId: "r", body: " " });
    if (!empty.success) {
      expect(splitErrors(empty.error, ["body"])).toEqual({
        fieldErrors: { body: REPLY_MESSAGES.empty },
      });
    }
  });

  it("accepts what a person types and what the page fills in", () => {
    expect(statusChangeSchema.safeParse({ id: "a", status: "contacted" }).success).toBe(true);
    expect(statusChangeSchema.safeParse({ id: "a", status: "lost" }).success).toBe(false);
    expect(unsubscribeSchema.safeParse({ token: "a".repeat(64), locale: "bg" }).success).toBe(true);
    // react-hook-form reports a ticked box as `true`; the browser posts "on".
    expect(cartOrderSchema.parse({ ...order, newsletterConsent: true }).newsletterConsent).toBe(
      true,
    );
  });
});

describe("in the server's HTML", () => {
  const forms = [
    ["the order form", orderForm()],
    ["the contact form", createElement(ContactForm)],
    ["the newsletter", createElement(NewsletterForm, { source: "footer" })],
    [
      "the unsubscribe button",
      createElement(UnsubscribeForm, { token: "a".repeat(64), locale: "bg", action: vi.fn() }),
    ],
    ["the sign-in", createElement(LoginForm)],
    ["the thread reply", createElement(ReplyForm, { threadId: "t", sender: "shop@example.test" })],
    [
      "the record reply",
      createElement(RecordReplyForm, {
        recordId: "r",
        kind: "order",
        recipient: "a@example.test",
        sender: "shop@example.test",
      }),
    ],
    [
      "the newsletter mark",
      createElement(NewsletterMarkForm, {
        recordId: "r",
        kind: "order",
        email: "a@example.test",
        current: null,
      }),
    ],
    [
      "the status picker",
      createElement(StatusPicker, { id: "r", current: "new", action: vi.fn() }),
    ],
  ] as const;

  it.each(forms)("%s is a real form that leaves validation to us", (_name, element) => {
    const html = renderToStaticMarkup(element);
    const tags = html.match(/<form[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      // Posts without a script…
      expect(tag).toMatch(/action=/);
      // …and never shows the browser's own bubbles. (React writes the
      // attribute as `noValidate`; HTML attribute names are case-insensitive.)
      expect(tag).toMatch(/ novalidate=""/i);
    }
    // Nothing is marked invalid before anyone has pressed anything.
    expect(html).not.toContain("aria-invalid");
  });
});

describe("pressing the button", () => {
  it("shows every error of the contact form under its field, focuses the first, sends nothing", async () => {
    // Its props are optional as a whole, which `createElement`'s overloads cannot see.
    const Form = ContactForm as (props: {
      defaultSubject?: string;
    }) => ReturnType<typeof ContactForm>;
    render(createElement(Form, { defaultSubject: "Запитване: вендинг зона" }));
    await press("Изпрати съобщение");

    const name = screen.getByLabelText(/Вашето име/);
    const email = screen.getByLabelText(/Имейл/);
    const message = screen.getByLabelText(/Съобщение/);
    for (const [field, text] of [
      [name, CONTACT_MESSAGES.nameMissing],
      [email, EMAIL_MESSAGES.missing],
      [message, CONTACT_MESSAGES.messageMissing],
    ] as const) {
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(describedMessage(field)).toBe(text);
    }
    // The optional fields are not refused for being empty.
    expect(screen.getByLabelText(/Телефон/).getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByLabelText(/Тема/)).toHaveProperty("value", "Запитване: вендинг зона");

    expect(document.activeElement).toBe(name);
    expect(screen.getByText(CHECK_FIELDS_MESSAGE)).toBeTruthy();
    expect(actions.submitContactMessage).not.toHaveBeenCalled();
  });

  it("clears a field's error as soon as it is corrected", async () => {
    render(createElement(ContactForm));
    await press("Изпрати съобщение");
    const name = screen.getByLabelText(/Вашето име/);
    await act(async () => {
      fireEvent.change(name, { target: { value: "Мария" } });
    });
    await waitFor(() => expect(name.getAttribute("aria-invalid")).toBeNull());
    expect(describedMessage(name)).toBeNull();
    // The others are still wrong, and the form's line still says so…
    expect(screen.getByLabelText(/Имейл/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText(CHECK_FIELDS_MESSAGE)).not.toBeNull();

    // …until they are put right too. Nothing is sent until the next press.
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Имейл/), { target: { value: "maria@example.test" } });
      fireEvent.change(screen.getByLabelText(/Съобщение/), {
        target: { value: "Здравейте, имам въпрос за кафето." },
      });
    });
    await waitFor(() => expect(screen.queryByText(CHECK_FIELDS_MESSAGE)).toBeNull());
    expect(actions.submitContactMessage).not.toHaveBeenCalled();
  });

  it("sends a valid form once, as the browser would post it, honeypot included", async () => {
    actions.submitContactMessage.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ status: "success", message: "Благодарим ви." }), 20),
        ),
    );
    render(createElement(ContactForm));
    fireEvent.change(screen.getByLabelText(/Вашето име/), { target: { value: "Мария" } });
    fireEvent.change(screen.getByLabelText(/Имейл/), { target: { value: "maria@example.test" } });
    fireEvent.change(screen.getByLabelText(/Съобщение/), {
      target: { value: "Здравейте, имам въпрос за кафето." },
    });
    const button = screen.getByRole("button", { name: "Изпрати съобщение" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Благодарим"));
    expect(actions.submitContactMessage).toHaveBeenCalledTimes(1);
    const data = sentData(actions.submitContactMessage);
    expect(data.get("name")).toBe("Мария");
    expect(data.get("email")).toBe("maria@example.test");
    expect(data.has("website")).toBe(true);
    expect(data.get("newsletterConsent")).toBeNull();
  });

  it("shows the server's field errors in the same place, and focuses them", async () => {
    actions.submitContactMessage.mockResolvedValue({
      status: "error",
      message: CHECK_FIELDS_MESSAGE,
      fieldErrors: { email: EMAIL_MESSAGES.format },
    } satisfies FormState);
    render(createElement(ContactForm));
    fireEvent.change(screen.getByLabelText(/Вашето име/), { target: { value: "Мария" } });
    fireEvent.change(screen.getByLabelText(/Имейл/), { target: { value: "maria@example.test" } });
    fireEvent.change(screen.getByLabelText(/Съобщение/), {
      target: { value: "Здравейте, имам въпрос за кафето." },
    });
    await press("Изпрати съобщение");

    const email = screen.getByLabelText(/Имейл/);
    await waitFor(() => expect(email.getAttribute("aria-invalid")).toBe("true"));
    expect(describedMessage(email)).toBe(EMAIL_MESSAGES.format);
    expect(document.activeElement).toBe(email);
    // What was typed is still there.
    expect(screen.getByLabelText(/Съобщение/)).toHaveProperty(
      "value",
      "Здравейте, имам въпрос за кафето.",
    );
  });

  it("shows a refusal of the whole request in the form's line", async () => {
    actions.subscribeToNewsletter.mockResolvedValue({
      status: "error",
      message: "Твърде много опити. Моля, изчакайте малко и опитайте отново.",
    } satisfies FormState);
    render(createElement(NewsletterForm, { source: "footer" }));
    fireEvent.change(screen.getByLabelText("Имейл адрес"), {
      target: { value: "ivan@example.com" },
    });
    await press("Абонирай ме");
    await waitFor(() => expect(screen.getByText(/Твърде много опити/)).toBeTruthy());
  });

  it("shows every error of the order form under its field, focuses the first, sends nothing", async () => {
    render(orderForm());
    await press("Изпрати заявката");

    for (const [field, text] of [
      [textbox("Име"), DELIVERY_MESSAGES.firstName],
      [textbox("Фамилия"), DELIVERY_MESSAGES.lastName],
      [textbox("Телефонен номер"), PHONE_MESSAGES.missing],
      // The courier's choices share one message; the first of them stands for all.
      [screen.getByRole("radio", { name: "Еконт" }), DELIVERY_MESSAGES.courier],
      [textbox("Пощенски код"), DELIVERY_MESSAGES.postcode],
      [textbox("Населено място"), DELIVERY_MESSAGES.city],
      [textbox("Адрес"), DELIVERY_MESSAGES.address],
    ] as const) {
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(describedMessage(field)).toBe(text);
    }
    // The delivery method is chosen to begin with, and the optional fields
    // are not refused for being empty.
    expect(screen.getByRole("radio", { name: "До адрес" })).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Имейл").getAttribute("aria-invalid")).toBeNull();

    expect(document.activeElement).toBe(textbox("Име"));
    expect(screen.getByText(CHECK_FIELDS_MESSAGE)).toBeTruthy();
    expect(actions.submitCartOrder).not.toHaveBeenCalled();
  });

  it("asks for the office instead of a street when the parcel goes to an office", async () => {
    render(orderForm());
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "До офис или автомат" }));
    });
    expect(screen.queryByRole("textbox", { name: "Пощенски код" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Адрес" })).toBeNull();

    // BOX NOW is offered for an office, and the field then asks for its locker.
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "BOX NOW" }));
    });
    await press("Изпрати заявката");
    expect(describedMessage(textbox("Автомат BOX NOW"))).toBe(DELIVERY_MESSAGES.office);

    // Back to an address: BOX NOW does not deliver there, so it is neither
    // offered nor left chosen.
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "До адрес" }));
    });
    expect(screen.queryByRole("radio", { name: "BOX NOW" })).toBeNull();
    for (const courier of screen.getAllByRole("radio", { name: /Еконт|Спиди/ })) {
      expect(courier).toHaveProperty("checked", false);
    }
    expect(textbox("Адрес")).toBeTruthy();
    expect(actions.submitCartOrder).not.toHaveBeenCalled();
  });

  it("opens the order form's optional fields when the error is in them", async () => {
    render(orderForm());
    await fillOrder();
    fireEvent.change(screen.getByLabelText("Имейл"), { target: { value: "ivan@" } });
    const details = document.querySelector("details")!;
    details.open = false;
    await press("Изпрати заявката");

    const email = screen.getByLabelText("Имейл");
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(email);
    expect(describedMessage(email)).toBe(EMAIL_MESSAGES.format);
    expect(actions.submitCartOrder).not.toHaveBeenCalled();
  });

  it("sends the order once, with its lines, the name, the delivery and the number as typed", async () => {
    const answer = { status: "success", message: "Благодарим ви.", reference: "A1B2C3D4" } as const;
    actions.submitCartOrder.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(answer), 20)),
    );
    const onPlaced = vi.fn();
    render(orderForm({ onPlaced }));
    await fillOrder();
    const button = screen.getByRole("button", { name: "Изпрати заявката" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() =>
      expect(onPlaced).toHaveBeenCalledWith({ message: "Благодарим ви.", reference: "A1B2C3D4" }),
    );
    expect(actions.submitCartOrder).toHaveBeenCalledTimes(1);
    const data = sentData(actions.submitCartOrder);
    expect(JSON.parse(String(data.get("lines")))).toEqual(LINES);
    expect(Object.fromEntries(data)).toMatchObject({
      firstName: "Иван",
      lastName: "Петров",
      phone: "0888 123 456",
      deliveryMethod: "address",
      deliveryCourier: "econt",
      deliveryCity: "Пловдив",
      deliveryPostcode: "4000",
      deliveryAddress: "ул. Иван Вазов 12",
    });
    // The honeypot goes too, for the server to look at; the box was not ticked.
    expect(data.has("website")).toBe(true);
    expect(data.get("newsletterConsent")).toBeNull();
  });

  it("refuses an empty newsletter address under the field", async () => {
    render(createElement(NewsletterForm, { source: "footer" }));
    const field = screen.getByLabelText("Имейл адрес");
    /* The check is fetched when the form is first touched (or nears the
       screen) and then takes the form over; `newsletter-form.test.ts` covers
       the plain form before that. */
    fireEvent.focusIn(field);
    await waitFor(() => expect(field.closest("form")?.hasAttribute("data-enhanced")).toBe(true));
    await press("Абонирай ме");
    expect(describedMessage(field)).toBe(EMAIL_MESSAGES.missing);
    expect(document.activeElement).toBe(field);
    expect(actions.subscribeToNewsletter).not.toHaveBeenCalled();
    // Still described by the consent line as well.
    expect(field.getAttribute("aria-describedby")).toMatch(/-consent$/);
    expect(screen.queryByText(CHECK_EMAIL_MESSAGE)).toBeNull();
  });

  it("refuses an empty password and an empty reply without sending", async () => {
    render(createElement(LoginForm));
    await press("Вход");
    expect(screen.getByRole("alert").textContent).toBe(LOGIN_MESSAGES.missing);
    expect(admin.signIn).not.toHaveBeenCalled();
    cleanup();

    render(createElement(ReplyForm, { threadId: "t", sender: "shop@example.test" }));
    await press("Изпрати");
    const body = screen.getByLabelText("Отговор");
    expect(describedMessage(body)).toBe(REPLY_MESSAGES.empty);
    expect(admin.replyToThread).not.toHaveBeenCalled();
  });

  it("asks the operator how consent was given before recording it", async () => {
    render(
      createElement(NewsletterMarkForm, {
        recordId: "r",
        kind: "order",
        email: "a@example.test",
        current: null,
      }),
    );
    await press("Запиши в бюлетина");
    const first = screen.getAllByRole("radio")[0]!;
    expect(describedMessage(first)).toBe(NEWSLETTER_MARK_MESSAGES.basis);
    expect(document.activeElement).toBe(first);
    expect(admin.addToNewsletter).not.toHaveBeenCalled();

    admin.addToNewsletter.mockResolvedValue({ done: "subscribed" });
    await act(async () => {
      fireEvent.click(first);
    });
    await press("Запиши в бюлетина");
    await waitFor(() => expect(admin.addToNewsletter).toHaveBeenCalledTimes(1));
    expect(sentData(admin.addToNewsletter).get("basis")).toBe("operator:phone");
  });

  it("sends a status change once, with its record", async () => {
    const action = vi.fn(async () => undefined);
    render(createElement(StatusPicker, { id: "r", current: "new", action }));
    await press("Потърсен");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const data = sentData(action);
    expect(data.get("id")).toBe("r");
    expect(data.get("status")).toBe("contacted");
  });
});
