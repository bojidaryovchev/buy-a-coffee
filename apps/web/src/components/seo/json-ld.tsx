/**
 * Structured data.
 *
 * The payload is serialised with `<` escaped so a product name containing
 * markup cannot break out of the script element. This is the standard
 * JSON-LD injection hole and it is worth closing explicitly.
 */
export function JsonLd({ id, data }: { id: string; data: unknown }) {
  const json = JSON.stringify(data).replace(/</g, "\u003c");
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
