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

  // While the session closes (scripts/aws-close.sh), new questions and the
  // health check get the offline answer, but the streams of runs that already
  // started still reach the backend, so their answers aren't lost.
  if (session.closing && !isRunStream(event.request)) {
    return offline();
  }

  // Only the function sets these two headers, so a visitor's own copies are
  // dropped. A custom header also can't share its name with one in the
  // request.
  delete event.request.headers["x-origin-verify"];
  delete event.request.headers["x-viewer-ip"];
  cf.updateRequestOrigin({
    domainName: session.loadBalancer,
    customHeaders: {
      "x-origin-verify": session.secret,
      // The visitor's IP, for the backend's per-IP rate limit, since every
      // connection to the backend comes from the load balancer.
      "x-viewer-ip": event.viewer.ip,
    },
  });
  return event.request;
}

// GET /api/runs/<id>/events: the stream of a run whose question got a 202,
// which the page opens, and opens again after a reconnect.
function isRunStream(request) {
  return (
    request.method === "GET" && /^\/api\/runs\/[^/]+\/events$/.test(request.uri)
  );
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
