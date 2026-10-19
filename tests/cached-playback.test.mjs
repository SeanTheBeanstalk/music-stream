import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { cachedPlayback } from "../lib/server/cached-playback.ts";

const asset = { id: "asset", object_key: "audio/test/original-audio-v1/1.webm", mime_type: "audio/webm", byte_size: "10" };
const request = (range, signal) => new Request("http://example.test/api/stream/dQw4w9WgXcQ", { headers: range ? { range } : {}, signal });
function repository(overrides = {}) {
  return { getReadyAsset: async () => asset, touchAsset: async () => {}, invalidateAsset: async () => {}, ...overrides };
}
const sdkError = status => Object.assign(new Error("Storage failure"), { $metadata: { httpStatusCode: status } });

test("cache hits stream the stored audio and preserve full and partial response headers", async () => {
  for (const range of [undefined, "bytes=2-4"]) {
    let touched = false;
    const response = await cachedPlayback(request(range), "dQw4w9WgXcQ", repository({ touchAsset: async () => { touched = true; } }), async (key, options) => {
      assert.equal(key, asset.object_key); assert.equal(options.range, range);
      return { Body: Readable.from([Buffer.from(range ? "234" : "0123456789")]), ContentLength: range ? 3 : 10, ContentRange: range ? "bytes 2-4/10" : undefined };
    });
    assert.equal(response.status, range ? 206 : 200);
    assert.equal(response.headers.get("content-type"), "audio/webm");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-length"), range ? "3" : "10");
    assert.equal(response.headers.get("content-range"), range ? "bytes 2-4/10" : null);
    assert.equal(await response.text(), range ? "234" : "0123456789");
    assert.ok(touched);
  }
});

test("missing objects invalidate only that asset and fall back to the existing source", async () => {
  const invalidated = [];
  const response = await cachedPlayback(request(), "dQw4w9WgXcQ", repository({ invalidateAsset: async value => invalidated.push(value) }), async () => { throw sdkError(404); });
  assert.equal(response, null); assert.deepEqual(invalidated, [asset]);
});

test("storage outages fall back without evicting and invalid ranges return 416", async () => {
  for (const status of [403, 500, 416]) {
    const response = await cachedPlayback(request("bytes=999-"), "dQw4w9WgXcQ", repository({ invalidateAsset: async () => assert.fail("Must not evict") }), async () => { throw sdkError(status); });
    if (status === 416) {
      assert.equal(response.status, 416); assert.equal(response.headers.get("content-range"), "bytes */10");
    } else assert.equal(response, null);
  }
});

test("cache misses and disabled persistence never read R2", async () => {
  const read = async () => assert.fail("Unexpected R2 call");
  assert.equal(await cachedPlayback(request(), "dQw4w9WgXcQ", null, read), null);
  assert.equal(await cachedPlayback(request(), "dQw4w9WgXcQ", repository({ getReadyAsset: async () => null }), read), null);
});

test("consumer cancellation aborts the R2 operation and destroys the body", async () => {
  let operationSignal;
  const body = new Readable({ read() {} });
  const response = await cachedPlayback(request(), "dQw4w9WgXcQ", repository(), async (_key, options) => {
    operationSignal = options.signal;
    return { Body: body, ContentLength: 10 };
  });
  await response.body.cancel();
  assert.ok(operationSignal.aborted); assert.ok(body.destroyed);
});

test("request cancellation during lookup never starts a storage transfer", async () => {
  const controller = new AbortController();
  await assert.rejects(cachedPlayback(request(undefined, controller.signal), "dQw4w9WgXcQ", repository({
    getReadyAsset: async () => { controller.abort(); return asset; },
  }), async () => assert.fail("Unexpected storage transfer")), { name: "AbortError" });
});

test("request cancellation during R2 I/O is propagated instead of falling back", async () => {
  const controller = new AbortController();
  await assert.rejects(cachedPlayback(request(undefined, controller.signal), "dQw4w9WgXcQ", repository(), async (_key, options) => {
    controller.abort(); assert.ok(options.signal.aborted); throw sdkError(500);
  }), { name: "AbortError" });
});
