import { isIndexNowKey } from "@catalog/shared/indexnow";

/**
 * The IndexNow key file, published at `/<key>.txt`.
 *
 * A search engine that receives a submission (`@catalog/shared/indexnow`)
 * fetches `https://buy-a-coffee.com/<key>.txt` and accepts the URLs only when
 * the file holds the key. The public address is rewritten here by
 * `next.config.ts`; this folder's own address, `/indexnow/<key>`, is not a
 * locale, so the proxy answers it with the 404 like any other stray path.
 *
 * The key comes from `INDEXNOW_KEY` at request time. Unset, or asked for under
 * any other name, the answer is a 404: nothing tells a visitor which keys
 * might exist, and a deployment without a key publishes none.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  const configured = process.env.INDEXNOW_KEY?.trim();
  if (!isIndexNowKey(configured) || key !== configured) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }
  return new Response(configured, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
      // A key file is for the engines that ask for it, not for results.
      "x-robots-tag": "noindex",
    },
  });
}
