const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const ticketRoutes = require("./routes/tickets");
const webhookRoutes = require("./routes/webhooks");

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10kb" }));

// API routes
app.use("/api/tickets", ticketRoutes);
app.use("/api/webhooks", webhookRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Support Ticket API running on http://localhost:${PORT}`);
});
