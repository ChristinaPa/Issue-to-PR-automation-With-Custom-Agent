/**
 * Azure Cosmos DB client setup for the Support Ticket API.
 *
 * Based on Microsoft Learn documentation:
 *   - Quickstart Node.js: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/quickstart-nodejs
 *   - Get started (JS):   https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-get-started
 *
 * Required environment variables:
 *   COSMOS_ENDPOINT      — Your Cosmos DB account URI
 *   COSMOS_KEY           — Your Cosmos DB account primary key
 *   COSMOS_DATABASE_ID   — (optional) Database name, defaults to "SupportTicketsDB"
 *   COSMOS_CONTAINER_ID  — (optional) Container name, defaults to "Tickets"
 */

const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE_ID || "SupportTicketsDB";
const containerId = process.env.COSMOS_CONTAINER_ID || "Tickets";

if (!endpoint || !key) {
  throw new Error(
    "Missing required environment variables: COSMOS_ENDPOINT and COSMOS_KEY must be set."
  );
}

// Create a single CosmosClient instance to reuse across the application.
// Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-get-started
const client = new CosmosClient({ endpoint, key });

/**
 * Returns the Cosmos DB container, creating the database and container
 * if they do not already exist.
 *
 * Partition key is set to "/id" so every ticket is its own logical partition,
 * enabling efficient point reads using (id, id) as the (id, partitionKey) pair.
 *
 * Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/quickstart-nodejs
 */
async function getContainer() {
  const { database } = await client.databases.createIfNotExists({ id: databaseId });
  const { container } = await database.containers.createIfNotExists({
    id: containerId,
    partitionKey: { paths: ["/id"] },
  });
  return container;
}

module.exports = { getContainer };
