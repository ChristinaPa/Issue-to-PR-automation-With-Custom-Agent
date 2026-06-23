const express = require("express");
const { validateTicket } = require("../middleware/validation");
const { teams, routeTicket } = require("../data/teams");

const router = express.Router();

// In-memory store (replace with a database in production)
const tickets = [];
let nextId = 1;

// GET /api/tickets — list all tickets
router.get("/", (req, res) => {
  const { status, team, priority } = req.query;

  let filtered = [...tickets];
  if (status) filtered = filtered.filter(t => t.status === status);
  if (team) filtered = filtered.filter(t => t.assignedTeam.id === team);
  if (priority) filtered = filtered.filter(t => t.priority === priority);

  res.json({
    count: filtered.length,
    tickets: filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  });
});

// GET /api/tickets/teams — list available teams
router.get("/teams", (req, res) => {
  res.json(teams.map(t => ({ id: t.id, name: t.name, description: t.description })));
});

// GET /api/tickets/:id — get a single ticket
router.get("/:id", (req, res) => {
  const ticket = tickets.find(t => t.id === parseInt(req.params.id, 10));
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  res.json(ticket);
});

// POST /api/tickets — create a new ticket
router.post("/", validateTicket, (req, res) => {
  const { title, description, priority, category, contactEmail } = req.body;

  const routing = routeTicket(title, description, category);

  const ticket = {
    id: nextId++,
    title,
    description,
    priority,
    category: category || null,
    contactEmail: contactEmail || null,
    status: "open",
    assignedTeam: {
      id: routing.team.id,
      name: routing.team.name
    },
    routing: {
      confidence: routing.confidence,
      method: routing.method,
      matchedKeywords: routing.matchedKeywords || []
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  tickets.push(ticket);

  res.status(201).json({
    message: "Ticket created and routed successfully",
    ticket
  });
});

// PATCH /api/tickets/:id — update ticket status
router.patch("/:id", (req, res) => {
  const ticket = tickets.find(t => t.id === parseInt(req.params.id, 10));
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const validStatuses = ["open", "in-progress", "resolved", "closed"];
  if (req.body.status && !validStatuses.includes(req.body.status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(", ")}` });
  }

  if (req.body.status) ticket.status = req.body.status;
  ticket.updatedAt = new Date().toISOString();

  res.json({ message: "Ticket updated", ticket });
});

// DELETE /api/tickets/:id — delete a ticket
router.delete("/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid ticket ID" });
  }

  const index = tickets.findIndex(t => t.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  tickets.splice(index, 1);
  res.status(204).send();
});

module.exports = router;
