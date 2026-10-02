import test from "node:test";
import assert from "node:assert/strict";
import { checkAccess, checkRequestOrigin } from "../src/lib/server/access";
import { readBoundedJson } from "../src/lib/server/bounded-json";
import { acquireQuery } from "../src/lib/server/query-gate";

const config = {
  production: true,
  username: "tester",
  password: "only-a-unit-test-password",
};
const request = (headers: Record<string, string> = {}) =>
  new Request("https://benchmark.test/api/benchmark/run", { headers });

test("production access fails closed when secrets are missing or weak", async () => {
  for (const cfg of [
    { production: true },
    { ...config, password: "short" },
    { ...config, username: "bad:name" },
    { ...config, password: "a".repeat(20) + "\n" },
  ])
    assert.equal((await checkAccess(request(), cfg))?.status, 503);
  assert.equal(await checkAccess(request(), { production: false }), null);
});

test("valid credentials are required and never echoed in access responses", async () => {
  for (const value of [
    "",
    "Basic broken",
    "Bearer token",
    `Basic ${btoa("tester:wrong")}`,
  ]) {
    const result = await checkAccess(request({ authorization: value }), config);
    assert.equal(result?.status, 401);
    assert.equal(result?.headers.get("cache-control"), "no-store");
    assert.ok(result?.headers.has("www-authenticate"));
    assert.ok(!(await result!.text()).includes(config.password));
  }
  assert.equal(
    await checkAccess(
      request({
        authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
      }),
      config,
    ),
    null,
  );
});

test("cross-origin queries cannot consume the service quota", () => {
  const previous = process.env.BENCHMARK_PUBLIC_ORIGIN;
  try {
    process.env.BENCHMARK_PUBLIC_ORIGIN = "https://benchmark.test";
    assert.equal(
      checkRequestOrigin(request({ origin: "https://evil.test" }))?.status,
      403,
    );
    assert.equal(
      checkRequestOrigin(request({ "sec-fetch-site": "cross-site" }))?.status,
      403,
    );
    assert.equal(
      checkRequestOrigin(request({ origin: "https://benchmark.test" })),
      null,
    );
    process.env.BENCHMARK_PUBLIC_ORIGIN = "bad";
    assert.equal(checkRequestOrigin(request())?.status, 503);
  } finally {
    if (previous === undefined) delete process.env.BENCHMARK_PUBLIC_ORIGIN;
    else process.env.BENCHMARK_PUBLIC_ORIGIN = previous;
  }
});

test("local HTTP Host is used when Next normalizes its internal URL to localhost", () => {
  const previous = process.env.BENCHMARK_PUBLIC_ORIGIN;
  try {
    delete process.env.BENCHMARK_PUBLIC_ORIGIN;
    const local = new Request("http://localhost:3002/api/benchmark/run", {
      headers: { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002" },
    });
    assert.equal(checkRequestOrigin(local), null);
    const forged = new Request("http://localhost:3002/api/benchmark/run", {
      headers: {
        host: "127.0.0.1:3002",
        origin: "https://evil.test",
        "x-forwarded-host": "evil.test",
      },
    });
    assert.equal(checkRequestOrigin(forged)?.status, 403);
  } finally {
    if (previous === undefined) delete process.env.BENCHMARK_PUBLIC_ORIGIN;
    else process.env.BENCHMARK_PUBLIC_ORIGIN = previous;
  }
});

test("JSON body limits apply to actual streamed bytes, not just Content-Length", async () => {
  assert.deepEqual(await readBoundedJson(Response.json({ ok: true }), 100), {
    ok: true,
  });
  await assert.rejects(
    readBoundedJson(
      new Response("{}", { headers: { "content-length": "5000" } }),
      100,
    ),
  );
  await assert.rejects(readBoundedJson(new Response("x".repeat(101)), 100));
  await assert.rejects(
    readBoundedJson(new Response(new Uint8Array([0xff])), 100),
  );
  await assert.rejects(readBoundedJson(new Response("not-json"), 100));
});

test("one query at a time with cooldown prevents simultaneous browser fleets", () => {
  const start = Date.now();
  const release = acquireQuery(start);
  assert.ok(release);
  assert.equal(acquireQuery(start + 20_000), null);
  release();
  assert.equal(acquireQuery(start + 9999), null);
  const next = acquireQuery(start + 10_000);
  assert.ok(next);
  next();
});
