/**
 * Webhook route — receives Azure DevOps Service Hook events and triggers
 * a downstream Azure Pipelines run for Bug work-item creation events.
 *
 * POST /api/webhooks/azuredevops
 *
 * Azure DevOps sends a JSON payload whose top-level fields include:
 *   eventType        – e.g. "workitem.created"
 *   resource.fields  – work-item field bag (System.WorkItemType, System.Title, …)
 *
 * When a Bug creation event is received the handler calls the Azure Pipelines
 * REST API to queue a new run of a configured pipeline, passing the work-item
 * ID as a pipeline variable so the pipeline can reference the originating Bug.
 *
 * Required environment variables:
 *   ADO_ORG          – Azure DevOps organization name  (e.g. "my-org")
 *   ADO_PROJECT      – Azure DevOps project name       (e.g. "my-project")
 *   ADO_PIPELINE_ID  – Numeric ID of the pipeline to trigger
 *   ADO_PAT          – Personal Access Token with "Build (Read & execute)" scope
 *                      OR leave unset and configure a Managed Identity on the
 *                      host so that IDENTITY_HEADER / IDENTITY_ENDPOINT are
 *                      available (Azure App Service / AKS workload identity).
 *
 * References:
 *   Service Hooks overview:
 *     https://learn.microsoft.com/azure/devops/service-hooks/overview
 *   Pipelines REST API – Runs – Create:
 *     https://learn.microsoft.com/rest/api/azure/devops/pipelines/runs/run-pipeline
 *   PAT authentication:
 *     https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate
 *   Managed Identity / Azure AD authentication:
 *     https://learn.microsoft.com/azure/devops/integrate/get-started/authentication/service-principal-managed-identity
 */

const express = require("express");
const https = require("https");
const { validateWebhookAuth } = require("../middleware/webhookAuth");

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an Authorization header value for the Azure DevOps REST API.
 *
 * Strategy (in priority order):
 *  1. Personal Access Token (ADO_PAT env var) – simplest, good for dev/test.
 *  2. Managed Identity (Azure IMDS token endpoint) – recommended for
 *     production workloads running inside Azure (App Service, AKS, VM, …).
 *
 * @returns {Promise<string>} – resolved Authorization header value
 */
async function getAdoAuthHeader() {
  const pat = process.env.ADO_PAT;
  if (pat) {
    // PAT: encode as Basic :<PAT> (username is intentionally empty)
    const encoded = Buffer.from(`:${pat}`).toString("base64");
    return `Basic ${encoded}`;
  }

  // Managed Identity via Azure Instance Metadata Service (IMDS)
  // Works on Azure App Service, Azure VMs, AKS pods with workload identity.
  const identityEndpoint = process.env.IDENTITY_ENDPOINT;
  const identityHeader = process.env.IDENTITY_HEADER;

  if (identityEndpoint && identityHeader) {
    const token = await fetchManagedIdentityToken(identityEndpoint, identityHeader);
    return `Bearer ${token}`;
  }

  throw new Error(
    "No Azure DevOps authentication method configured. " +
      "Set ADO_PAT, or ensure Managed Identity is available (IDENTITY_ENDPOINT / IDENTITY_HEADER)."
  );
}

/**
 * Fetch an access token from the Azure Instance Metadata Service.
 * The resource URI for Azure DevOps is 499b84ac-1321-427f-aa17-267ca6975798.
 *
 * @param {string} endpoint – IDENTITY_ENDPOINT env var value
 * @param {string} header   – IDENTITY_HEADER env var value
 * @returns {Promise<string>} – Bearer token string
 */
function fetchManagedIdentityToken(endpoint, header) {
  return new Promise((resolve, reject) => {
    const resource = "499b84ac-1321-427f-aa17-267ca6975798";
    const url = `${endpoint}?resource=${resource}&api-version=2019-08-01`;
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "X-IDENTITY-HEADER": header
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            resolve(parsed.access_token);
          } else {
            reject(new Error(`IMDS response missing access_token: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse IMDS response: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

/**
 * Trigger an Azure Pipelines run via the REST API.
 *
 * POST https://dev.azure.com/{org}/{project}/_apis/pipelines/{pipelineId}/runs?api-version=7.1
 *
 * @param {object} options
 * @param {string} options.org           – Azure DevOps organization
 * @param {string} options.project       – Azure DevOps project
 * @param {string|number} options.pipelineId – Pipeline to trigger
 * @param {string} options.authHeader    – Authorization header value
 * @param {object} options.variables     – Pipeline variables to pass as run-time values
 * @returns {Promise<object>}            – Parsed API response body
 */
function triggerPipelineRun({ org, project, pipelineId, authHeader, variables }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      resources: {
        repositories: {
          self: { refName: "refs/heads/main" }
        }
      },
      variables
    });

    const path =
      `/${encodeURIComponent(org)}/${encodeURIComponent(project)}` +
      `/_apis/pipelines/${encodeURIComponent(pipelineId)}/runs?api-version=7.1`;

    const options = {
      hostname: "dev.azure.com",
      path,
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Pipeline API returned ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse pipeline API response: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/azuredevops
 *
 * Receives an Azure DevOps Service Hook payload and, when the event is a
 * Bug work-item creation, triggers the configured pipeline.
 */
router.post("/azuredevops", validateWebhookAuth, async (req, res) => {
  const payload = req.body;

  // Basic payload shape validation
  if (!payload || typeof payload.eventType !== "string") {
    return res.status(400).json({ error: "Invalid service hook payload." });
  }

  const eventType = payload.eventType;

  // Only handle work-item creation events
  if (eventType !== "workitem.created") {
    // Return 200 so Azure DevOps does not retry unhandled event types
    return res.status(200).json({ message: `Event type '${eventType}' ignored.` });
  }

  // Extract work-item details from the payload
  const resource = payload.resource || {};
  const fields = resource.fields || {};
  const workItemType = fields["System.WorkItemType"] || "";
  const workItemId = resource.id;
  const workItemTitle = fields["System.Title"] || "";

  // Only process Bug work items
  if (workItemType !== "Bug") {
    return res.status(200).json({
      message: `Work item type '${workItemType}' ignored – only 'Bug' is handled.`
    });
  }

  // Validate required env configuration
  const org = process.env.ADO_ORG;
  const project = process.env.ADO_PROJECT;
  const pipelineId = process.env.ADO_PIPELINE_ID;

  if (!org || !project || !pipelineId) {
    console.error(
      "[webhooks] Missing ADO_ORG, ADO_PROJECT, or ADO_PIPELINE_ID environment variables."
    );
    return res
      .status(503)
      .json({ error: "Pipeline trigger is not configured on this server." });
  }

  try {
    const authHeader = await getAdoAuthHeader();

    // Pass the work-item details as pipeline variables so the pipeline job
    // can create a branch / PR referencing the originating Bug.
    const variables = {
      workItemId: { value: String(workItemId), isSecret: false },
      workItemTitle: { value: workItemTitle, isSecret: false },
      workItemType: { value: workItemType, isSecret: false }
    };

    const runResult = await triggerPipelineRun({
      org,
      project,
      pipelineId,
      authHeader,
      variables
    });

    console.log(
      `[webhooks] Triggered pipeline run ${runResult.id} for Bug #${workItemId}: "${workItemTitle}"`
    );

    return res.status(200).json({
      message: "Pipeline triggered successfully.",
      workItemId,
      workItemTitle,
      pipelineRunId: runResult.id,
      pipelineRunUrl: runResult._links && runResult._links.web && runResult._links.web.href
    });
  } catch (err) {
    console.error("[webhooks] Failed to trigger pipeline:", err.message);
    return res.status(500).json({ error: "Failed to trigger pipeline.", details: err.message });
  }
});

module.exports = router;
