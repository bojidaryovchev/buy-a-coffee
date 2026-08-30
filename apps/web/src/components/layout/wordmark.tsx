import { siteConfig } from "@/config/site";

/**
 * Text-based wordmark.
 *
 * Deliberately typographic rather than an image: the brand is not final, and a
 * placeholder logo file would be harder to replace than a line of markup. The
 * bean glyph is drawn here, not borrowed from anywhere.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7 shrink-0 text-pine-700" fill="none">
        <ellipse cx="12" cy="12" rx="7" ry="9.5" transform="rotate(-32 12 12)" fill="currentColor" />
        <path
          d="M8.2 17.6C10.6 15 10.9 9.6 15.8 6.4"
          stroke="var(--color-paper)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-display text-xl leading-none font-semibold tracking-tight text-ink-900">
        {siteConfig.name}
      </span>
    </span>
  );
}
