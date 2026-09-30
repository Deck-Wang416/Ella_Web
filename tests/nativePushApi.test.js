import assert from "node:assert/strict";
import test from "node:test";
import { upsertNativePushSubscription } from "../src/lib/nativePushApi.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("native push creates then updates a caregiver binding", async () => {
  globalThis.window = { __API_BASE: "https://backend.example/api" };
  globalThis.localStorage = storage();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, status: options.method === "POST" ? 201 : 200,
      json: async () => ({ id: 7 }) };
  };

  await upsertNativePushSubscription(1, "apns", "first-token");
  await upsertNativePushSubscription(1, "apns", "rotated-token");

  assert.equal(requests[0].url, "https://backend.example/api/subscriptions");
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(JSON.parse(requests[0].body), {
    caregiver_id: 1, platform: "apns", endpointOrToken: "first-token",
  });
  assert.equal(requests[1].url, "https://backend.example/api/subscriptions/7");
  assert.equal(requests[1].method, "PUT");
  assert.deepEqual(JSON.parse(requests[1].body), {
    endpointOrToken: "rotated-token", active: true,
  });
});

test("a stale subscription id falls back to POST", async () => {
  globalThis.window = { __API_BASE: "https://backend.example/api" };
  globalThis.localStorage = storage();
  localStorage.setItem("ella_native_push_subscription_id_2", "99");
  const methods = [];
  globalThis.fetch = async (_url, options) => {
    methods.push(options.method);
    if (options.method === "PUT") {
      return { ok: false, status: 404, json: async () => ({ detail: "Not found" }) };
    }
    return { ok: true, status: 201, json: async () => ({ id: 11 }) };
  };

  await upsertNativePushSubscription(2, "fcm", "new-token");
  assert.deepEqual(methods, ["PUT", "POST"]);
  assert.equal(localStorage.getItem("ella_native_push_subscription_id_2"), "11");
});
