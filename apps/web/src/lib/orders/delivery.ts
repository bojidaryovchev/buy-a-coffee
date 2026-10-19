import type { DeliveryMethod } from "@/lib/forms/schemas";

/**
 * Who an order is for and where it goes: from the form to the row, and from
 * the row to what a person reads.
 *
 * Pure, so the panel, the mails and the tests share one wording. Orders taken
 * before the form asked for a delivery (19 October 2026) have only an optional
 * `customerName` and no delivery; every reader here copes with that.
 */

/** The delivery fields as the order form's schema returns them. */
export interface DeliveryInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly deliveryMethod: DeliveryMethod;
  readonly deliveryCity: string;
  readonly deliveryPostcode: string;
  readonly deliveryAddress: string;
  readonly deliveryOffice: string;
}

/** The delivery as `order_inquiries` stores it. */
export interface StoredDelivery {
  readonly customerName: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly deliveryMethod: string | null;
  readonly deliveryCity: string | null;
  readonly deliveryPostcode: string | null;
  readonly deliveryAddress: string | null;
  readonly deliveryOffice: string | null;
}

/**
 * The columns to store. The fields of the method not chosen are dropped: a
 * customer who typed an address and then switched to an office must not leave
 * a street behind for the courier to find. `customerName` keeps the full name,
 * so anything that reads only that column still has it.
 */
export function deliveryColumns(input: DeliveryInput): StoredDelivery {
  const toAddress = input.deliveryMethod === "address";
  return {
    customerName: `${input.firstName} ${input.lastName}`,
    firstName: input.firstName,
    lastName: input.lastName,
    deliveryMethod: input.deliveryMethod,
    deliveryCity: input.deliveryCity,
    deliveryPostcode: toAddress ? input.deliveryPostcode : null,
    deliveryAddress: toAddress ? input.deliveryAddress : null,
    deliveryOffice: toAddress ? null : input.deliveryOffice,
  };
}

/** The customer's name, or null for an older order that was sent without one. */
export function fullName(order: StoredDelivery): string | null {
  const parts = [order.firstName, order.lastName].map((part) => part?.trim()).filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return order.customerName?.trim() || null;
}

/**
 * The delivery as the lines of a label, the way a Bulgarian address is
 * written: the street first, then the postcode and the place. Null for an
 * order taken before the form asked for one.
 */
export function deliveryLines(order: StoredDelivery): readonly string[] | null {
  const city = order.deliveryCity?.trim();
  if (order.deliveryMethod === "address" && city) {
    const place = [order.deliveryPostcode?.trim(), city].filter(Boolean).join(" ");
    return ["До адрес", order.deliveryAddress?.trim() || "", place].filter(Boolean);
  }
  if (order.deliveryMethod === "office" && city) {
    return ["До офис на куриер", order.deliveryOffice?.trim() || "", city].filter(Boolean);
  }
  return null;
}

/** One line for a list: where it goes, and how. */
export function deliverySummary(order: StoredDelivery): string | null {
  const city = order.deliveryCity?.trim();
  if (!city) return null;
  if (order.deliveryMethod === "office") return `${city} · офис на куриер`;
  if (order.deliveryMethod === "address") return `${city} · до адрес`;
  return city;
}
