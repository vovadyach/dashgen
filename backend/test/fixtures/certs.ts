import path from "node:path";

// RDS's certificate bundle for us-east-1, which the image takes for TLS to the
// database (backend/Dockerfile). From
// https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem
export const RDS_BUNDLE = path.join(
  import.meta.dirname,
  "../../certs/rds-us-east-1-bundle.pem",
);
