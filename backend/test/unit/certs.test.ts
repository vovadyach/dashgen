import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { RDS_BUNDLE } from "../fixtures/certs.ts";

describe("RDS's certificate bundle", () => {
  it("holds us-east-1's three root CAs, none of them expired", () => {
    const pems =
      readFileSync(RDS_BUNDLE, "utf8").match(
        /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
      ) ?? [];
    const certs = pems.map((pem) => new X509Certificate(pem));

    assert.deepEqual(
      certs.map((cert) => /^CN=(.+)$/m.exec(cert.subject)?.[1]),
      [
        "Amazon RDS us-east-1 Root CA RSA2048 G1",
        "Amazon RDS us-east-1 Root CA RSA4096 G1",
        "Amazon RDS us-east-1 Root CA ECC384 G1",
      ],
    );
    for (const cert of certs) {
      assert.equal(cert.ca, true);
      assert.ok(cert.validToDate > new Date());
    }
  });
});
