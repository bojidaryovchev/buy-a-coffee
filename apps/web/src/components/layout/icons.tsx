/**
 * The navigation's line icons. Stroked, `currentColor`, hidden from assistive
 * technology: each always sits beside the words it illustrates.
 */

/** A capsule machine in profile: body, spout, cup. */
export function MachineIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 2.5h9v4h-9zM4.5 6.5v7M2.5 13.5h10" />
      <path d="M8.5 6.5V8M7 10h3.5v1.5a1.5 1.5 0 0 1-1.5 1.5h-.5A1.5 1.5 0 0 1 7 11.5z" />
    </svg>
  );
}

/** Three sliders: a few questions, answered. */
export function WizardIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4h5M11 4h3M2 8h2M8 8h6M2 12h7M13 12h1" />
      <path d="M7.5 2.5h3v3h-3zM4.5 6.5h3v3h-3zM9.5 10.5h3v3h-3z" />
    </svg>
  );
}

export function MenuIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function CloseIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * A shopping cart: basket, handle, two wheels. On the 24 px grid for the
 * header; the same drawing at 16 px beside a button's label.
 */
export function CartIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 3.5h2.6l2.3 11h10.4l2.2-7.5H6.2" />
      <circle cx="9.5" cy="19" r="1.5" />
      <circle cx="16.5" cy="19" r="1.5" />
    </svg>
  );
}

/** A telephone handset, for the call link where its words do not fit. */
export function PhoneIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 3.5h3.2l1.6 4.2-2.2 1.4a11 11 0 0 0 7.3 7.3l1.4-2.2 4.2 1.6V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5Z" />
    </svg>
  );
}
