import { COURIERS, type Courier, type DeliveryMethod } from "@/lib/forms/schemas";

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
  readonly deliveryCourier: string;
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
  readonly deliveryCourier: string | null;
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
    deliveryCourier: input.deliveryCourier,
    deliveryCity: input.deliveryCity,
    deliveryPostcode: toAddress ? input.deliveryPostcode : null,
    deliveryAddress: toAddress ? input.deliveryAddress : null,
    deliveryOffice: toAddress ? null : input.deliveryOffice,
  };
}

/** A stored courier as a customer reads it: "Еконт", or the stored key if unknown. */
export function courierName(key: string | null): string | null {
  if (!key) return null;
  return key in COURIERS ? COURIERS[key as Courier] : key;
}

/** „с“, or „със“ before a word that starts with с or з, as Bulgarian has it. */
function withCourier(courier: string): string {
  return /^[сз]/i.test(courier) ? `със ${courier}` : `с ${courier}`;
}

/** How it goes, as the first line of a label: "До адрес с Еконт", "До автомат BOX NOW". */
function methodLine(order: StoredDelivery): string {
  const courier = courierName(order.deliveryCourier);
  if (order.deliveryMethod === "address")
    return courier ? `До адрес ${withCourier(courier)}` : "До адрес";
  if (order.deliveryCourier === "boxnow") return "До автомат BOX NOW";
  return courier ? `До офис на ${courier}` : "До офис на куриер";
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
    return [methodLine(order), order.deliveryAddress?.trim() || "", place].filter(Boolean);
  }
  if (order.deliveryMethod === "office" && city) {
    return [methodLine(order), order.deliveryOffice?.trim() || "", city].filter(Boolean);
  }
  return null;
}

/** One line for a list: where it goes, and how. */
export function deliverySummary(order: StoredDelivery): string | null {
  const city = order.deliveryCity?.trim();
  if (!city) return null;
  if (order.deliveryMethod !== "address" && order.deliveryMethod !== "office") return city;
  return `${city} · ${methodLine(order).replace(/^До /, "до ")}`;
}
