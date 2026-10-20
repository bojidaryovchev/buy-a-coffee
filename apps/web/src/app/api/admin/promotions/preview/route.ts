import { isSignedIn } from "@/lib/auth";
import { promotionPreviewSchema } from "@/lib/promotions/schemas";

/**
 * The promotion editor's live preview (`lib/promotions/preview.ts`): the
 * promotion as the form holds it, answered with what the shop would show for
 * each product it covers.
 *
 * A route rather than a server action, as the newsletter's preview is one:
 * the editor asks again a moment after every change and abandons the previous
 * question, and actions run one at a time per page, so a slow preview would
 * hold up a save. Nothing is written. The session is checked here, a route
 * handler having no layout; the database is reached only for a valid question.
 */

export async function POST(request: Request) {
  if (!(await isSignedIn())) {
    return Response.json({ error: "Сесията е изтекла. Влезте отново." }, { status: 401 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Невалидна заявка." }, { status: 400 });
  }
  const parsed = promotionPreviewSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json(
      { error: "Изберете дни и поне една марка, категория или продукт, за да видите цените." },
      { status: 422 },
    );
  }

  try {
    const { previewPromotion } = await import("@/lib/promotions/preview");
    return Response.json(await previewPromotion(parsed.data), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "promotions.preview_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json(
      { error: "Прегледът не можа да се обнови. Опитайте отново." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
