/**
 * Middleware to authenticate incoming Azure DevOps Service Hook requests.
 *
 * Azure DevOps Service Hooks support HTTP Basic authentication for webhook
 * consumers. When configuring the subscription you supply a username and a
 * shared secret (password). Azure DevOps sends those credentials in the
 * standard Authorization header on every delivery.
 *
 * Set the following environment variables before starting the server:
 *   ADO_WEBHOOK_USERNAME  – the username you chose when registering the hook
 *   ADO_WEBHOOK_SECRET    – the password / shared secret
 *
 * If neither variable is set the middleware passes the request through
 * (useful for local development), but logs a warning.
 *
 * References:
 *   https://learn.microsoft.com/azure/devops/service-hooks/services/webhooks
 */

const WEBHOOK_USERNAME = process.env.ADO_WEBHOOK_USERNAME;
const WEBHOOK_SECRET = process.env.ADO_WEBHOOK_SECRET;

function validateWebhookAuth(req, res, next) {
  // If no secret is configured, skip auth (warn in non-production environments)
  if (!WEBHOOK_USERNAME || !WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[webhookAuth] ADO_WEBHOOK_USERNAME / ADO_WEBHOOK_SECRET not set – " +
          "refusing request in production."
      );
      return res
        .status(503)
        .json({ error: "Webhook authentication is not configured." });
    }
    console.warn(
      "[webhookAuth] Skipping auth – ADO_WEBHOOK_USERNAME / ADO_WEBHOOK_SECRET not set."
    );
    return next();
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header." });
  }

  // Decode the Base-64 "username:password" value
  let decoded;
  try {
    decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  } catch {
    return res.status(401).json({ error: "Invalid Authorization header encoding." });
  }

  const colonIndex = decoded.indexOf(":");
  if (colonIndex === -1) {
    return res.status(401).json({ error: "Invalid Authorization header format." });
  }

  const providedUsername = decoded.slice(0, colonIndex);
  const providedSecret = decoded.slice(colonIndex + 1);

  // Constant-time comparison to prevent timing attacks
  const crypto = require("crypto");
  const expectedUser = Buffer.from(WEBHOOK_USERNAME);
  const expectedSecret = Buffer.from(WEBHOOK_SECRET);
  const actualUser = Buffer.from(providedUsername);
  const actualSecret = Buffer.from(providedSecret);

  const userMatch =
    actualUser.length === expectedUser.length &&
    crypto.timingSafeEqual(actualUser, expectedUser);
  const secretMatch =
    actualSecret.length === expectedSecret.length &&
    crypto.timingSafeEqual(actualSecret, expectedSecret);

  if (!userMatch || !secretMatch) {
    return res.status(401).json({ error: "Invalid webhook credentials." });
  }

  next();
}

module.exports = { validateWebhookAuth };
