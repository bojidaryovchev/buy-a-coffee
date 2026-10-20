import { describe, expect, it } from "vitest";
import { contactRecordFixture, orderRecordFixture } from "@/emails/fixtures";
import { contactNotice, orderNotice, signupNotice } from "@/lib/mail/owner-notices";
import { composeNotificationEmail } from "@/lib/mail/notify-sink";

/**
 * The shop's own notification carries no customer contact details, checked
 * where it can fail.
 *
 * The records go in as the forms store them — phone, address, name, a note
 * that repeats both — through the builders the form actions call and the
 * sink's own composition, and the finished mail, both parts, is searched for
 * every one of them. A notice that started copying the phone into its summary
 * would fail here; a template test fed an already-clean summary would not.
 */

/** "+359 888 765 432" as it might be written anywhere: spaced, bare, local. */
function forms(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const local = `0${digits.slice(3)}`;
  return [
    phone,
    digits,
    `+${digits}`,
    local,
    `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`,
  ];
}

async function mailFor(notice: Parameters<typeof composeNotificationEmail>[0]) {
  const { html, text } = await composeNotificationEmail(notice);
  /* React splits adjacent text with `<!-- -->`; join it back before searching. */
  return { html: html.replace(/<!-- -->/g, ""), text };
}

describe("the order notification", () => {
  /* The record as the order form now stores it: with where it goes, as the
     label lines the customer's confirmation prints. */
  const order = {
    ...orderRecordFixture,
    delivery: ["До адрес с Еконт", "ул. Опълченска 46, вх. Б, ап. 12", "1303 София"],
  };

  it("names the products and the sum", async () => {
    const { html, text } = await mailFor(orderNotice(order));
    expect(text).toContain("Super Crema 1кг");
    expect(html).toContain("Napoli ESE 50");
    expect(text).toMatch(/Сума на продуктите: 57,71\s€/);
  });

  it("says what a promotion took off a line and which one, under the owner's name for it", async () => {
    const notice = orderNotice(order);
    expect(notice.lines?.[2]?.reduction).toEqual({
      reader: "owner",
      before: { amount: "19.90", currency: "EUR" },
      percent: 10,
      promotionName: "Есенна кампания Lavazza",
    });
    const { html, text } = await mailFor(notice);
    expect(text).toMatch(
      /1 × Crema e Aroma 1кг — 17,91\s€ \(−10% · Есенна кампания Lavazza, редовна 19,90\s€\)/,
    );
    expect(text).toMatch(/Отстъпка по промоции: 1,99\s€/);
    expect(html).toContain("Есенна кампания Lavazza");
  });

  it("carries none of the customer's contact details, in either part", async () => {
    const { html, text } = await mailFor(orderNotice(order));
    for (const part of [html, text]) {
      for (const phone of forms(order.phone)) expect(part).not.toContain(phone);
      expect(part).not.toContain(order.email);
      expect(part).not.toContain(order.customerName);
      expect(part).not.toContain("Звънете след 17:00");
      // Nor where the parcel goes: the street, the place, or how it is sent.
      for (const line of order.delivery) expect(part).not.toContain(line);
      expect(part).not.toContain("Опълченска");
      expect(part).not.toContain("1303");
    }
    // And says where they are instead.
    expect(text).toContain("Данните за контакт са в записа, не в това писмо.");
  });
});

describe("the contact-form notification", () => {
  it("carries the subject the customer typed, and none of their details", async () => {
    const { html, text } = await mailFor(contactNotice(contactRecordFixture));
    expect(text).toContain("Съобщението и данните за контакт са в записа");
    expect(html).toContain("Форма за контакт: Доставка до офис");
    for (const part of [html, text]) {
      for (const phone of forms(contactRecordFixture.phone)) expect(part).not.toContain(phone);
      expect(part).not.toContain(contactRecordFixture.email);
      expect(part).not.toContain(contactRecordFixture.name);
      expect(part).not.toContain(contactRecordFixture.message);
    }
  });
});

describe("the signup notification", () => {
  it("does not carry the address that signed up", async () => {
    const { html, text } = await mailFor(
      signupNotice({ id: "c3d4e5f6-0000-4000-8000-000000000000", email: "new.reader@example.bg" }),
    );
    expect(html).not.toContain("new.reader@example.bg");
    expect(text).not.toContain("new.reader@example.bg");
  });
});
