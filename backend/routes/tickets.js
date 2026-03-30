/**
 * Ticket routes — backed by Azure Cosmos DB for NoSQL.
 *
 * All CRUD patterns follow official Microsoft Learn documentation:
 *   Create item:  https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-create-item
 *   Read item:    https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-read-item
 *   Query items:  https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-query-items
 *   Replace item: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-replace-item
 *   Quickstart:   https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/quickstart-nodejs
 */

const express = require("express");
const { randomUUID } = require("crypto");
const { validateTicket } = require("../middleware/validation");
const { teams, routeTicket } = require("../data/teams");
const { getContainer } = require("../cosmosClient");

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/tickets — list all tickets, with optional filters
//
// Uses a parameterized SQL query against Cosmos DB.
// Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-query-items
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const { status, team, priority } = req.query;

    // Build a dynamic WHERE clause from whichever filters were supplied.
    const conditions = [];
    const parameters = [];

    if (status) {
      conditions.push("c.status = @status");
      parameters.push({ name: "@status", value: status });
    }
    if (team) {
      conditions.push("c.assignedTeam.id = @team");
      parameters.push({ name: "@team", value: team });
    }
    if (priority) {
      conditions.push("c.priority = @priority");
      parameters.push({ name: "@priority", value: priority });
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const querySpec = {
      query: `SELECT * FROM c ${whereClause} ORDER BY c.createdAt DESC`,
      parameters,
    };

    const container = await getContainer();

    // .fetchAll() returns { resources: [...] }
    // Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-query-items
    const { resources: tickets } = await container.items.query(querySpec).fetchAll();

    res.json({ count: tickets.length, tickets });
  } catch (err) {
    console.error("Error listing tickets:", err.message);
    res.status(500).json({ error: "Failed to retrieve tickets" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tickets/teams — list available teams (static, no DB call needed)
// ---------------------------------------------------------------------------
router.get("/teams", (req, res) => {
  res.json(teams.map(t => ({ id: t.id, name: t.name, description: t.description })));
});

// ---------------------------------------------------------------------------
// GET /api/tickets/:id — get a single ticket by id
//
// Uses a point read — the most efficient Cosmos DB operation.
// container.item(id, partitionKeyValue).read()
// Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-read-item
// ---------------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const container = await getContainer();

    // Second argument is the partition key value.
    // Because our partition key path is "/id", it equals the document id.
    const { resource: ticket } = await container.item(id, id).read();

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    res.json(ticket);
  } catch (err) {
    if (err.code === 404) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    console.error("Error reading ticket:", err.message);
    res.status(500).json({ error: "Failed to retrieve ticket" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tickets — create a new ticket and persist to Cosmos DB
//
// Uses container.items.create(item)
// Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-create-item
//
// NOTE: Cosmos DB requires "id" to be a string. We use crypto.randomUUID()
// (built into Node.js 14.17+) to generate a unique string id for each ticket.
// ---------------------------------------------------------------------------
router.post("/", validateTicket, async (req, res) => {
  try {
    const { title, description, priority, category, contactEmail } = req.body;
    const routing = routeTicket(title, description, category);

    const ticket = {
      id: randomUUID(),           // Cosmos DB "id" must be a string
      title,
      description,
      priority,
      category: category || null,
      contactEmail: contactEmail || null,
      status: "open",
      assignedTeam: {
        id: routing.team.id,
        name: routing.team.name,
      },
      routing: {
        confidence: routing.confidence,
        method: routing.method,
        matchedKeywords: routing.matchedKeywords || [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const container = await getContainer();

    // .create() stores the document and returns the persisted resource.
    // Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-create-item
    const { resource: created } = await container.items.create(ticket);

    res.status(201).json({
      message: "Ticket created and routed successfully",
      ticket: created,
    });
  } catch (err) {
    console.error("Error creating ticket:", err.message);
    res.status(500).json({ error: "Failed to create ticket" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/tickets/:id — update ticket status
//
// Uses container.item(id, partitionKeyValue).replace(updatedItem)
// Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-replace-item
// ---------------------------------------------------------------------------
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const container = await getContainer();

    // First do a point read to get the current document.
    // Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-read-item
    const { resource: existing } = await container.item(id, id).read();

    if (!existing) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const validStatuses = ["open", "in-progress", "resolved", "closed"];
    if (req.body.status && !validStatuses.includes(req.body.status)) {
      return res.status(400).json({
        error: `Status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Merge the changes and replace the document in Cosmos DB.
    // Source: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-javascript-replace-item
    const updated = {
      ...existing,
      status: req.body.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    };

    const { resource: replaced } = await container.item(id, id).replace(updated);

    res.json({ message: "Ticket updated", ticket: replaced });
  } catch (err) {
    if (err.code === 404) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    console.error("Error updating ticket:", err.message);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

module.exports = router;
