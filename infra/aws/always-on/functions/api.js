import cf from "cloudfront";

// CloudFront runs this on every /api/* request (ADR-0003). While a session
// runs, the key-value store holds its "session" entry, and the request goes to
// that session's load balancer with its secret header. Between sessions the
// store is empty, and the function answers 503 itself.
//
// CloudFront's JavaScript runtime 2.0 isn't Node: no optional chaining,
// destructuring or spread, and `import cf` must stay on the first line.
const store = cf.kvs();

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- CloudFront calls handler by name.
async function handler(event) {
  if (!(await store.exists("session"))) {
    return offline();
  }
  const session = await store.get("session", { format: "json" });

  // Only the function sets the secret: a visitor's own copy is dropped.
  delete event.request.headers["x-origin-verify"];
  cf.updateRequestOrigin({
    domainName: session.loadBalancer,
    customHeaders: { "x-origin-verify": session.secret },
  });
  return event.request;
}

// The page shows its offline banner for this answer.
function offline() {
  return {
    statusCode: 503,
    statusDescription: "Service Unavailable",
    headers: {
      "content-type": { value: "application/json" },
      "cache-control": { value: "no-store" },
    },
    body: JSON.stringify({ status: "offline" }),
  };
}
