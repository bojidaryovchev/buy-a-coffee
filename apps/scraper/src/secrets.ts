/**
 * Resolve the database connection string.
 *
 * Order of preference:
 *   1. `DATABASE_URL` — how local development and CI supply it.
 *   2. `DATABASE_URL_SECRET_ARN` — how production supplies it, fetched from
 *      Secrets Manager at cold start.
 *
 * Production deliberately does *not* put the connection string in a Lambda
 * environment variable: those are readable by anyone with console access to
 * the function, and they show up in `GetFunctionConfiguration` output.
 *
 * The resolved value is cached for the life of the container, so a warm
 * invocation costs no extra API call.
 */

let cachedUrl: string | null = null;

export class SecretResolutionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretResolutionError";
  }
}

export async function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const direct = env.DATABASE_URL?.trim();
  if (direct) return direct;

  if (cachedUrl) return cachedUrl;

  const secretArn = env.DATABASE_URL_SECRET_ARN?.trim();
  if (!secretArn) {
    throw new SecretResolutionError(
      "Neither DATABASE_URL nor DATABASE_URL_SECRET_ARN is set. " +
        "Set DATABASE_URL locally, or point DATABASE_URL_SECRET_ARN at a Secrets Manager secret in production.",
    );
  }

  let value: string | undefined;
  try {
    const sdk = (await import("@aws-sdk/client-secrets-manager")) as unknown as {
      SecretsManagerClient: new (config: Record<string, unknown>) => {
        send(command: unknown): Promise<{ SecretString?: string; SecretBinary?: Uint8Array }>;
      };
      GetSecretValueCommand: new (input: Record<string, unknown>) => unknown;
    };
    const client = new sdk.SecretsManagerClient({ region: env.AWS_REGION });
    const result = await client.send(new sdk.GetSecretValueCommand({ SecretId: secretArn }));
    value =
      result.SecretString ??
      (result.SecretBinary ? Buffer.from(result.SecretBinary).toString("utf8") : undefined);
  } catch (error) {
    throw new SecretResolutionError(
      `Failed to read the database secret. Check the Lambda role's secretsmanager:GetSecretValue permission.`,
      { cause: error },
    );
  }

  if (!value) {
    throw new SecretResolutionError("The database secret exists but is empty.");
  }

  // The secret may hold either a bare connection string or a JSON object.
  const trimmed = value.trim();
  let url = trimmed;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const candidate = parsed.DATABASE_URL ?? parsed.databaseUrl ?? parsed.url ?? parsed.connectionString;
      if (typeof candidate === "string" && candidate.trim()) url = candidate.trim();
    } catch {
      // Not JSON after all; fall through and use the raw string.
    }
  }

  if (url.startsWith("REPLACE_ME")) {
    throw new SecretResolutionError(
      "The database secret still holds its placeholder value. Populate it with the real connection string.",
    );
  }
  if (!/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new SecretResolutionError(
      "The database secret does not look like a PostgreSQL connection string.",
    );
  }

  cachedUrl = url;
  return url;
}

/** Test hook: forget the cached value. */
export function resetSecretCache(): void {
  cachedUrl = null;
}
