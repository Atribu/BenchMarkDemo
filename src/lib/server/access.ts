interface AccessConfig {
  production: boolean;
  username?: string;
  password?: string;
}

export async function checkAccess(
  request: Request,
  config: AccessConfig = {
    production: process.env.NODE_ENV === "production",
    username: process.env.BENCHMARK_AUTH_USER,
    password: process.env.BENCHMARK_AUTH_PASSWORD,
  },
): Promise<Response | null> {
  const headers = { "Cache-Control": "no-store" };
  if (!config.production && !config.username && !config.password) return null;
  if (
    !config.username ||
    !/^[\x21-\x7e]+$/.test(config.username) ||
    config.username.includes(":") ||
    !config.password ||
    !/^[\x21-\x7e]+$/.test(config.password) ||
    config.password.length < 20
  ) {
    return Response.json(
      {
        error:
          "Yayın erişim ayarları tamamlanmadı. Yöneticiyle iletişime geçin.",
      },
      { status: 503, headers },
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  let received = "";
  try {
    if (/^Basic /i.test(authorization) && authorization.length < 4096)
      received = atob(authorization.slice(6));
  } catch {
    // Malformed credentials are rejected without echoing them back.
  }
  const encoder = new TextEncoder();
  const expectedHash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(`${config.username}:${config.password}`),
    ),
  );
  const receivedHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(received)),
  );
  let difference = 0;
  for (let i = 0; i < expectedHash.length; i++)
    difference |= expectedHash[i] ^ receivedHash[i];
  if (difference === 0) return null;
  return Response.json(
    { error: "Raporu kullanmak için giriş yapın." },
    {
      status: 401,
      headers: {
        ...headers,
        "WWW-Authenticate": 'Basic realm="DGTLFACE Benchmark"',
      },
    },
  );
}

export function checkRequestOrigin(request: Request): Response | null {
  let expected: string;
  try {
    // Next may normalize the internal URL to localhost. Use the actual HTTP Host,
    // not a client-supplied forwarded host; deployments pin their public origin.
    const internal = new URL(request.url);
    const host = request.headers.get("host");
    const address = new URL(
      process.env.BENCHMARK_PUBLIC_ORIGIN ||
        (host ? `${internal.protocol}//${host}` : request.url),
    );
    if (
      !["http:", "https:"].includes(address.protocol) ||
      address.username ||
      address.password
    )
      throw new Error("Invalid origin");
    expected = address.origin;
  } catch {
    return Response.json(
      { error: "Sunucu adresi ayarı geçersiz." },
      { status: 503 },
    );
  }
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== expected) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return Response.json(
      { error: "Başka bir siteden sorgu başlatılamaz." },
      { status: 403 },
    );
  return null;
}
