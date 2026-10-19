import { describe, expect, it } from "vitest";
import {
  DELIVERY_MESSAGES,
  PHONE_MESSAGES,
  cartOrderSchema,
  toFieldErrors,
} from "@/lib/forms/schemas";
import {
  deliveryColumns,
  deliveryLines,
  deliverySummary,
  fullName,
  type StoredDelivery,
} from "@/lib/orders/delivery";

/**
 * An order says who it is for and where it goes, so the call back only
 * confirms it (the owner's decision, 19 October 2026): a first and last name,
 * a phone number, and a delivery either to an address (place, postcode,
 * street) or to a courier's office (place, office). Email and a note stay
 * optional.
 */

const lines = JSON.stringify([{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }]);

const toAddress = {
  lines,
  firstName: "Иван",
  lastName: "Петров",
  phone: "0888 123 456",
  deliveryMethod: "address",
  deliveryCity: "Пловдив",
  deliveryPostcode: "4000",
  deliveryAddress: "ул. Иван Вазов 12, ет. 3, ап. 7",
  deliveryOffice: "",
};

const toOffice = {
  ...toAddress,
  deliveryMethod: "office",
  deliveryPostcode: "",
  deliveryAddress: "",
  deliveryOffice: "Еконт, Пловдив Център",
};

const errorsOf = (input: Record<string, unknown>) => {
  const result = cartOrderSchema.safeParse(input);
  return result.success ? {} : toFieldErrors(result.error);
};

describe("the order form's delivery", () => {
  it("accepts a complete order to an address, and to a courier's office", () => {
    expect(cartOrderSchema.safeParse(toAddress).success).toBe(true);
    expect(cartOrderSchema.safeParse(toOffice).success).toBe(true);
  });

  /* The browser shows every message on the first press, so the object-level
     check must run even while other fields are wrong. */
  it("reports every missing field at once on an empty form", () => {
    const errors = errorsOf({
      lines,
      firstName: "",
      lastName: "",
      phone: "",
      deliveryMethod: "address",
      deliveryCity: "",
      deliveryPostcode: "",
      deliveryAddress: "",
      deliveryOffice: "",
    });
    expect(errors).toMatchObject({
      firstName: DELIVERY_MESSAGES.firstName,
      lastName: DELIVERY_MESSAGES.lastName,
      phone: PHONE_MESSAGES.missing,
      deliveryCity: DELIVERY_MESSAGES.city,
      deliveryPostcode: DELIVERY_MESSAGES.postcode,
      deliveryAddress: DELIVERY_MESSAGES.address,
    });
    expect(errors).not.toHaveProperty("deliveryOffice");
  });

  it("asks an office delivery for the office, not for a postcode or street", () => {
    const errors = errorsOf({ ...toOffice, deliveryOffice: "" });
    expect(errors).toEqual({ deliveryOffice: DELIVERY_MESSAGES.office });
  });

  it("wants a four-digit postcode", () => {
    for (const postcode of ["400", "40000", "4OOO", ""]) {
      expect(errorsOf({ ...toAddress, deliveryPostcode: postcode })).toEqual({
        deliveryPostcode: DELIVERY_MESSAGES.postcode,
      });
    }
  });

  it("refuses a method it does not offer, and a post with the fields missing, in Bulgarian", () => {
    expect(errorsOf({ ...toAddress, deliveryMethod: "drone" })).toEqual({
      deliveryMethod: DELIVERY_MESSAGES.method,
    });
    const { firstName, lastName, deliveryCity, ...rest } = toAddress;
    void firstName;
    void lastName;
    void deliveryCity;
    expect(errorsOf(rest)).toEqual({
      firstName: DELIVERY_MESSAGES.firstName,
      lastName: DELIVERY_MESSAGES.lastName,
      deliveryCity: DELIVERY_MESSAGES.city,
    });
  });

  it("holds names and addresses to a length a courier label takes", () => {
    expect(errorsOf({ ...toAddress, firstName: "И".repeat(61) })).toEqual({
      firstName: DELIVERY_MESSAGES.nameLong,
    });
    expect(errorsOf({ ...toAddress, deliveryAddress: "у".repeat(201) })).toEqual({
      deliveryAddress: DELIVERY_MESSAGES.addressLong,
    });
  });

  it("does not ask for an email or a note", () => {
    const result = cartOrderSchema.safeParse(toAddress);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBeUndefined();
  });
});

describe("storing and reading a delivery", () => {
  const parsed = (input: typeof toAddress) => {
    const result = cartOrderSchema.safeParse(input);
    if (!result.success) throw new Error("fixture does not parse");
    return result.data;
  };

  it("stores the full name too, and only the chosen method's fields", () => {
    expect(deliveryColumns(parsed(toAddress))).toEqual({
      customerName: "Иван Петров",
      firstName: "Иван",
      lastName: "Петров",
      deliveryMethod: "address",
      deliveryCity: "Пловдив",
      deliveryPostcode: "4000",
      deliveryAddress: "ул. Иван Вазов 12, ет. 3, ап. 7",
      deliveryOffice: null,
    });
    // An address typed before switching to an office is not kept.
    const switched = deliveryColumns(parsed({ ...toOffice, deliveryAddress: "ул. Стара 1" }));
    expect(switched.deliveryAddress).toBeNull();
    expect(switched.deliveryPostcode).toBeNull();
    expect(switched.deliveryOffice).toBe("Еконт, Пловдив Център");
  });

  it("writes a delivery the way a Bulgarian address label reads", () => {
    const address = deliveryColumns(parsed(toAddress));
    expect(deliveryLines(address)).toEqual([
      "До адрес",
      "ул. Иван Вазов 12, ет. 3, ап. 7",
      "4000 Пловдив",
    ]);
    expect(deliverySummary(address)).toBe("Пловдив · до адрес");

    const office = deliveryColumns(parsed(toOffice));
    expect(deliveryLines(office)).toEqual([
      "До офис на куриер",
      "Еконт, Пловдив Център",
      "Пловдив",
    ]);
    expect(deliverySummary(office)).toBe("Пловдив · офис на куриер");
  });

  it("reads an order taken before the form asked for a delivery", () => {
    const older: StoredDelivery = {
      customerName: "Мария",
      firstName: null,
      lastName: null,
      deliveryMethod: null,
      deliveryCity: null,
      deliveryPostcode: null,
      deliveryAddress: null,
      deliveryOffice: null,
    };
    expect(fullName(older)).toBe("Мария");
    expect(fullName({ ...older, customerName: null })).toBeNull();
    expect(deliveryLines(older)).toBeNull();
    expect(deliverySummary(older)).toBeNull();
  });
});
