import type { Dictionary } from "./bg";

/**
 * English. Written, not machine-translated, in the same plain advisor's voice
 * the Bulgarian uses (`PRODUCT.md`): short, concrete, no superlatives.
 *
 * Complete, because the frame is complete — but English does not ship until its
 * content does (`LOCALE_READY.en`), so nothing renders this yet.
 */
export const en: Dictionary = {
  site: {
    tagline: "Coffee, chosen with care",
    description:
      "Coffee beans, capsules and pods from brands worth drinking. Order in one step — we call you back to confirm.",
  },

  skipLink: "Skip to main content",

  nav: {
    label: "Main navigation",
    home: "{name} — home",
    capsules: "Capsules",
    capsulesBySystem: "Capsules by system",
    allCapsules: "All capsules",
    findByMachine: "Find by machine",
    wizard: "Which coffee suits you",
    brands: "Brands",
    promotions: "Offers",
    delivery: "Delivery and payment",
    journal: "Journal",
    contact: "Contact",
    allCategories: "All categories",
    vending: "Vending",
    consumables: "Consumables",
    systems: {
      "ese-pod": "ESE pods",
      beans: "Coffee beans",
    },
    products: { one: "product", many: "products" },
    unsureHeading: "Not sure which system you have?",
    unsureBody: "Look your machine up by brand and model, and we will tell you what fits it.",
  },

  header: {
    call: "Call us",
  },

  drawer: {
    open: "Menu",
    dialog: "Site menu",
    close: "Close the menu",
    findByMachineHint: "By brand and model",
    wizardHint: "A few questions, three suggestions",
  },

  search: {
    label: "Search the shop",
    placeholder: "Search coffee, brands, capsules…",
    submit: "Search",
    suggestions: "Search suggestions",
    suggestionCount: "{count} suggestions for “{term}”",
    brands: "Brands",
    categories: "Categories",
    seeAll: { one: "See {count} result", many: "See all {count} results" },
  },

  announcement: {
    label: "Delivery and ordering",
    freeDelivery: "Free delivery on orders over {amount}",
  },

  language: {
    label: "Language",
  },

  hours: {
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

  footer: {
    phone: "Phone",
    email: "Email",
    hours: "Opening hours",
    shop: "Shop",
    help: "Help",
    legal: "Legal",
    decaf: "Decaf coffee",
    cheapestPerCup: "Cheapest per cup",
    terms: "Terms and conditions",
    privacy: "Privacy",
    cookies: "Cookies",
    newsletterHeading: "Stay in touch",
    newsletterBody: "Short notes about what is new on the shelf. Never more than once a month.",
    copyright: "© {year} {owner}. All rights reserved.",
    payment: "Payment: {methods}",
    paymentMethods: {
      cash_on_delivery: "cash on delivery",
      card_on_delivery: "card on delivery",
      bank_transfer: "bank transfer",
    },
    companyId: "Company no.",
    vatId: "VAT no.",
    companyPending: "Company details have not been filled in yet",
  },

  notFound: {
    title: "This page is not here",
    body: "The address may be mistyped, or the product may no longer be sold.",
    home: "Go to the home page",
    findByMachine: "Find by machine",
    lookingFor: "Looking for something in particular?",
    contact: "Write to us or call",
  },
};
