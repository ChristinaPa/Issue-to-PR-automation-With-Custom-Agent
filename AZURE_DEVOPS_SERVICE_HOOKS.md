# Azure DevOps Service Hooks — Setup Guide

This document explains how to configure an Azure DevOps **Service Hook** that fires
whenever a **Bug** work item is created, and how that event triggers a downstream
Azure Pipeline run to begin the automated ticket-to-PR workflow.

---

## Overview

```
Azure DevOps Work Item (Bug created)
        │
        ▼  Service Hook (HTTP POST)
Backend Webhook  ─── POST /api/webhooks/azuredevops
        │
        ▼  Pipelines REST API
Azure Pipeline Run  (workItemId, workItemTitle passed as variables)
        │
        ▼
Automated PR workflow (branch creation, code fix, pull request)
```

---

## 1. Prerequisites

| Requirement | Details |
|---|---|
| Azure DevOps organization | `https://dev.azure.com/{org}` |
| Project with a Pipelines definition | The pipeline that will handle each Bug |
| Personal Access Token **or** Managed Identity | See [Authentication](#4-authentication) |
| A publicly reachable URL for this backend | Or an Azure Service Bus relay / ngrok for local testing |

---

## 2. Configure the Service Hook via the Azure DevOps UI

1. Go to **Project Settings → Service hooks** in your Azure DevOps project.
2. Click **+ Create subscription**.
3. Under **Service**, select **Web Hooks** and click **Next**.
4. Configure the trigger:
   - **Trigger on this type of event**: `Work item created`
   - **Area path**: *(leave blank for all, or scope to a specific area)*
   - **Work item type**: `Bug`
5. Click **Next**, then fill in the **action** details:
   - **URL**: `https://<your-backend-host>/api/webhooks/azuredevops`
   - **Basic authentication username**: choose a username (store as `ADO_WEBHOOK_USERNAME`)
   - **Basic authentication password**: choose a strong secret (store as `ADO_WEBHOOK_SECRET`)
   - **HTTP headers**: *(leave blank)*
   - **Resource details to send**: `All`
6. Click **Test** to verify connectivity, then **Finish**.

> **Reference**: [Azure DevOps Service Hooks — Web Hooks](https://learn.microsoft.com/azure/devops/service-hooks/services/webhooks)

---

## 3. Configure the Service Hook via the REST API

You can also create a subscription programmatically using the
[Service Hooks Subscriptions API](https://learn.microsoft.com/rest/api/azure/devops/hooks/subscriptions/create).

### Endpoint

```
POST https://dev.azure.com/{organization}/_apis/hooks/subscriptions?api-version=7.1
```

### Request headers

```http
Content-Type: application/json
Authorization: Basic <base64(:{PAT})>
```

### Request body

```json
{
  "publisherId": "tfs",
  "eventType": "workitem.created",
  "resourceVersion": "1.0",
  "consumerId": "webHooks",
  "consumerActionId": "httpRequest",
  "publisherInputs": {
    "projectId": "<your-project-id>",
    "workItemType": "Bug"
  },
  "consumerInputs": {
    "url": "https://<your-backend-host>/api/webhooks/azuredevops",
    "basicAuthUsername": "<ADO_WEBHOOK_USERNAME>",
    "basicAuthPassword": "<ADO_WEBHOOK_SECRET>",
    "resourceDetailsToSend": "all",
    "messagesToSend": "none",
    "detailedMessagesToSend": "none"
  }
}
```

### Example — create with `curl`

```bash
ORG="my-org"
PROJECT_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # project GUID, not name
PAT="<your-pat>"
BACKEND_URL="https://my-backend.example.com/api/webhooks/azuredevops"
WEBHOOK_USER="ado-hook"
WEBHOOK_SECRET="$(openssl rand -base64 32)"

curl -s -X POST \
  "https://dev.azure.com/${ORG}/_apis/hooks/subscriptions?api-version=7.1" \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n ":${PAT}" | base64)" \
  -d @- <<EOF
{
  "publisherId": "tfs",
  "eventType": "workitem.created",
  "resourceVersion": "1.0",
  "consumerId": "webHooks",
  "consumerActionId": "httpRequest",
  "publisherInputs": {
    "projectId": "${PROJECT_ID}",
    "workItemType": "Bug"
  },
  "consumerInputs": {
    "url": "${BACKEND_URL}",
    "basicAuthUsername": "${WEBHOOK_USER}",
    "basicAuthPassword": "${WEBHOOK_SECRET}",
    "resourceDetailsToSend": "all",
    "messagesToSend": "none",
    "detailedMessagesToSend": "none"
  }
}
EOF
```

---

## 4. Trigger a Pipeline Run via the REST API

When the webhook handler receives a `workitem.created` event for a Bug, it calls
the [Pipelines — Run Pipeline](https://learn.microsoft.com/rest/api/azure/devops/pipelines/runs/run-pipeline)
endpoint.

### Endpoint

```
POST https://dev.azure.com/{organization}/{project}/_apis/pipelines/{pipelineId}/runs?api-version=7.1
```

### Request headers

```http
Content-Type: application/json
Authorization: Basic <base64(:{PAT})>        # PAT authentication
# — or —
Authorization: Bearer <AAD-access-token>     # Managed Identity / Service Principal
```

### Request body

```json
{
  "resources": {
    "repositories": {
      "self": { "refName": "refs/heads/main" }
    }
  },
  "variables": {
    "workItemId":    { "value": "42",          "isSecret": false },
    "workItemTitle": { "value": "Login fails", "isSecret": false },
    "workItemType":  { "value": "Bug",         "isSecret": false }
  }
}
```

The pipeline can then reference these values as `$(workItemId)`, `$(workItemTitle)`,
and `$(workItemType)` inside YAML pipeline steps.

### Example pipeline YAML snippet

```yaml
trigger: none   # only triggered via API

parameters:
  - name: workItemId
    type: string
  - name: workItemTitle
    type: string

variables:
  - name: workItemId
    value: ${{ parameters.workItemId }}

steps:
  - script: |
      echo "Processing Bug #$(workItemId): $(workItemTitle)"
      git checkout -b "fix/bug-$(workItemId)"
    displayName: Create fix branch
```

---

## 5. Authentication

### 5.1 Personal Access Token (PAT) — development / simple deployments

1. In Azure DevOps go to **User Settings → Personal access tokens → New Token**.
2. Grant the **Build** scope with **Read & execute** permission.
3. Copy the token and set the environment variable:
   ```
   ADO_PAT=<token>
   ```
4. The backend encodes it as `Basic :<PAT>` (empty username) before calling the API.

> **Reference**: [Use PATs to authenticate](https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)

### 5.2 Managed Identity — production / Azure-hosted deployments

Managed Identities eliminate the need to store long-lived secrets.

#### App Service / Azure Container Apps

1. Enable a **system-assigned Managed Identity** on your App Service instance
   (**Settings → Identity → System assigned → On**).
2. Add the identity to your Azure DevOps organization:
   - Go to **Organization Settings → Users** and add the Managed Identity's
     service principal by its object ID or display name.
   - Grant it the **Build Service Accounts** group (or at minimum the
     **Build (Read & execute)** permission on the target pipeline).
3. No secret is needed on the server — the backend automatically fetches a token
   from the Azure Instance Metadata Service (IMDS) when `ADO_PAT` is not set.

#### Azure Kubernetes Service (AKS) — Workload Identity

1. Follow the [Workload Identity](https://learn.microsoft.com/azure/aks/workload-identity-overview)
   setup to federate a Kubernetes service account with an Azure Managed Identity.
2. The `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` environment variables are
   injected automatically by the AKS workload-identity mutating webhook.
3. The backend detects these variables and obtains a token on behalf of the pod's identity.

> **Reference**: [Service principals & managed identities for Azure DevOps](https://learn.microsoft.com/azure/devops/integrate/get-started/authentication/service-principal-managed-identity)

---

## 6. Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `ADO_WEBHOOK_USERNAME` | Yes | Username set when registering the Service Hook subscription |
| `ADO_WEBHOOK_SECRET` | Yes | Shared secret (password) set when registering the Service Hook subscription |
| `ADO_ORG` | Yes | Azure DevOps organization name |
| `ADO_PROJECT` | Yes | Azure DevOps project name |
| `ADO_PIPELINE_ID` | Yes | Numeric ID of the pipeline to trigger |
| `ADO_PAT` | No* | Personal Access Token with Build (Read & execute) scope |
| `IDENTITY_ENDPOINT` | No* | Azure IMDS endpoint (auto-set on App Service / AKS) |
| `IDENTITY_HEADER` | No* | Azure IMDS header (auto-set on App Service / AKS) |

\* Either `ADO_PAT` **or** Managed Identity (`IDENTITY_ENDPOINT` + `IDENTITY_HEADER`) must be configured.

---

## 7. Testing Locally

Use [ngrok](https://ngrok.com/) (or a similar tunnel) to expose your local server
and register it temporarily as the Service Hook URL:

```bash
# Terminal 1 — start the backend
cd backend
ADO_WEBHOOK_USERNAME=test ADO_WEBHOOK_SECRET=secret \
  ADO_ORG=my-org ADO_PROJECT=my-project ADO_PIPELINE_ID=42 \
  ADO_PAT=<your-pat> \
  npm start

# Terminal 2 — expose port 3000
ngrok http 3000
```

Simulate a payload with `curl`:

```bash
curl -s -X POST http://localhost:3000/api/webhooks/azuredevops \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'test:secret' | base64)" \
  -d '{
    "eventType": "workitem.created",
    "resource": {
      "id": 99,
      "fields": {
        "System.WorkItemType": "Bug",
        "System.Title": "Login page crashes on mobile"
      }
    }
  }'
```

---

## 8. Service Hook Payload Shape

Azure DevOps delivers a JSON body similar to:

```json
{
  "subscriptionId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "notificationId": 1,
  "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "eventType": "workitem.created",
  "publisherId": "tfs",
  "message": {
    "text": "Bug #99 created by John Doe",
    "html": "Bug #99 created by John Doe",
    "markdown": "Bug #99 created by John Doe"
  },
  "resource": {
    "id": 99,
    "rev": 1,
    "fields": {
      "System.Id": 99,
      "System.WorkItemType": "Bug",
      "System.Title": "Login page crashes on mobile",
      "System.State": "New",
      "System.AssignedTo": "",
      "System.AreaPath": "my-project",
      "System.TeamProject": "my-project"
    },
    "url": "https://dev.azure.com/my-org/my-project/_apis/wit/workItems/99"
  },
  "resourceVersion": "1.0",
  "resourceContainers": {
    "collection": { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    "account":    { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    "project":    { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
  },
  "createdDate": "2024-01-15T10:30:00.000Z"
}
```

---

## References

- [Azure DevOps Service Hooks overview](https://learn.microsoft.com/azure/devops/service-hooks/overview)
- [Service Hooks — Web Hooks consumer](https://learn.microsoft.com/azure/devops/service-hooks/services/webhooks)
- [Service Hooks Subscriptions REST API](https://learn.microsoft.com/rest/api/azure/devops/hooks/subscriptions/create)
- [Pipelines — Run Pipeline REST API](https://learn.microsoft.com/rest/api/azure/devops/pipelines/runs/run-pipeline)
- [Use PATs to authenticate](https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
- [Service principals & Managed Identities for Azure DevOps](https://learn.microsoft.com/azure/devops/integrate/get-started/authentication/service-principal-managed-identity)
- [AKS Workload Identity overview](https://learn.microsoft.com/azure/aks/workload-identity-overview)
