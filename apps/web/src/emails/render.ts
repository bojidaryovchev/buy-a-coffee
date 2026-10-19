import type { ReactElement } from "react";
import { render } from "@react-email/render";

/**
 * A template, turned into the HTML string Resend is handed.
 *
 * Never `resend.emails.send({ react })`. The SDK renders that itself, with a
 * dynamic `import("@react-email/render")` inside its own bundle, and in a
 * sibling project that import resolved to nothing in the deployed function: it
 * passed every test and threw "Failed to render React component" on the first
 * real send. Here the renderer is a direct dependency of this app, called from
 * our own code, so the path a test takes is the path production takes —
 * `test/emails.test.ts` renders through this function and checks the source
 * for a `react:` key besides.
 *
 * No `server-only` marker: it holds no secret and reads no request, and the
 * preview script and the tests import it outside Next.js.
 */
export function renderEmail(template: ReactElement): Promise<string> {
  return render(template);
}

/** What every composed message is: the HTML part and its plain-text twin. */
export interface ComposedEmail {
  readonly html: string;
  readonly text: string;
}
