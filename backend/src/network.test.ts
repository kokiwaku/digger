import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicHost } from "./network.js";
import { ArticleFetchError } from "./errors.js";

const blockedIPv4Hosts = [
  "127.0.0.1", // loopback
  "10.0.0.5", // private
  "172.16.0.1", // private
  "192.168.1.1", // private
  "169.254.169.254", // link-local / cloud metadata
  "0.0.0.0",
];

for (const host of blockedIPv4Hosts) {
  test(`assertPublicHost blocks ${host}`, async () => {
    await assert.rejects(
      () => assertPublicHost(new URL(`http://${host}/`)),
      (err: unknown) => err instanceof ArticleFetchError,
    );
  });
}

test("assertPublicHost blocks ::1 (IPv6 loopback)", async () => {
  await assert.rejects(
    () => assertPublicHost(new URL("http://[::1]/")),
    (err: unknown) => err instanceof ArticleFetchError,
  );
});

test("assertPublicHost blocks localhost and *.localhost", async () => {
  await assert.rejects(() => assertPublicHost(new URL("http://localhost/")), ArticleFetchError);
  await assert.rejects(() => assertPublicHost(new URL("http://foo.localhost/")), ArticleFetchError);
});

test("assertPublicHost allows a public IP literal", async () => {
  await assert.doesNotReject(() => assertPublicHost(new URL("http://8.8.8.8/")));
});
