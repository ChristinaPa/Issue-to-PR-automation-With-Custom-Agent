# Issue-to-PR Automation

Automatically assign newly opened GitHub issues to an AI coding agent that analyzes the issue, implements a fix, and opens a draft pull request — powered by [GitHub Agentic Workflows](https://github.github.com/gh-aw/).

This repository also includes a **Support Ticket Portal** — a full-stack web application where users submit support tickets that are automatically routed to the right technical team based on keyword analysis.

## How It Works

```
New Issue Opened → AI Agent Reads Issue → Explores Codebase → Implements Fix → Opens Draft PR
```

1. A new issue is created in the repository
2. The workflow triggers automatically and reacts with 👀 to acknowledge it
3. The AI coding agent (GitHub Copilot) reads the issue title and description
4. It explores the repository to understand the codebase structure and conventions
5. It implements the necessary changes to address the issue
6. A draft pull request is created with a reference back to the original issue

## Repository Structure

```
.github/
├── aw/
│   └── actions-lock.json              # Pinned action versions for reproducibility
└── workflows/
    ├── issue-to-pr.md                 # Agentic workflow definition (natural language)
    └── issue-to-pr.lock.yml           # Compiled GitHub Actions workflow (auto-generated)
backend/
├── server.js                          # Express server entry point
├── package.json                       # Backend dependencies
├── data/
│   └── teams.js                       # Team definitions and keyword-based routing logic
├── middleware/
│   └── validation.js                  # Input validation and sanitization
└── routes/
    └── tickets.js                     # REST API endpoints for tickets
frontend/
├── index.html                         # Ticket submission form and ticket list UI
├── styles.css                         # Responsive styles with priority/status badges
└── app.js                             # Client-side logic with XSS protection
```

## Workflow Details

The core workflow is defined in `.github/workflows/issue-to-pr.md` using natural language markdown:

| Setting | Value |
|---|---|
| **Trigger** | New issue opened |
| **Engine** | GitHub Copilot (default) |
| **Reaction** | 👀 on triggering issue |
| **PR Style** | Draft, prefixed with `[issue-fix]` |
| **Labels** | `automated`, `issue-fix` |
| **Protected Files** | Allowed (agent can modify `pom.xml`, `.github/`, etc.) |
| **Secret** | `COPILOT_GITHUB_TOKEN` |

### Safe Outputs

The workflow uses [safe outputs](https://github.github.com/gh-aw/reference/safe-outputs/) to ensure the AI agent operates securely:

- **`create-pull-request`** — Opens a draft PR with the implemented fix
- **`add-comment`** — Posts up to 2 comments on the issue (progress updates or clarification requests)
- **`add-labels`** — Labels the issue `in-progress` or `agent-working`

## Support Ticket Application

A full-stack web app for submitting and routing support tickets.

### Features

- **Ticket submission** with title, description, priority, and optional category
- **Automatic routing** to one of 6 teams (Frontend, Backend, DevOps, Security, Data Engineering, Mobile) based on keyword matching
- **Confidence scoring** — each routing decision includes a confidence level (high/medium/low)
- **Filtering** — filter tickets by status and team
- **Input validation** — server-side validation with sanitized inputs
- **Security** — Helmet headers, CORS, JSON size limits, and XSS-safe rendering

### Running the Application

```bash
cd backend
npm install
npm start
```

The API starts on `http://localhost:3000`. Open `frontend/index.html` in a browser.

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/tickets` | List tickets (filter by `status`, `team`, `priority`) |
| `GET` | `/api/tickets/teams` | List available teams |
| `GET` | `/api/tickets/:id` | Get a single ticket |
| `POST` | `/api/tickets` | Create and auto-route a ticket |
| `PATCH` | `/api/tickets/:id` | Update ticket status |
| `DELETE` | `/api/tickets/:id` | Delete a ticket |
| `GET` | `/api/health` | Health check |

### Routing Logic

Tickets are routed by matching keywords in the title and description against team keyword lists. If a category is explicitly selected, it takes priority. Each routing result includes:
- The assigned **team**
- A **confidence** level (high = 3+ keyword matches, medium = 2, low = 1 or default)
- The **matched keywords** that determined the routing

---

## Agentic Workflow Setup

### Prerequisites

- A GitHub repository with [GitHub Actions](https://docs.github.com/en/actions) enabled
- [GitHub CLI](https://cli.github.com/) installed (`gh --version` ≥ 2.0.0)
- A [GitHub Copilot](https://github.com/features/copilot) subscription

### Step 1: Install the GitHub Agentic Workflows CLI Extension

```bash
gh extension install github/gh-aw
```

### Step 2: Configure the Repository Secret

Go to **Settings → Secrets and variables → Actions** and add:

| Secret Name | Description |
|---|---|
| `COPILOT_GITHUB_TOKEN` | A GitHub token with Copilot access. See [authentication docs](https://github.github.com/gh-aw/reference/auth/#copilot_github_token) for details. |

### Step 3: Add the Workflow Files

Copy the workflow files to your repository:

```
.github/workflows/issue-to-pr.md
.github/workflows/issue-to-pr.lock.yml
```

Or compile from source:

```bash
gh aw compile
```

### Step 4: Commit and Push

```bash
git add .github/
git commit -m "Add issue-to-PR agentic workflow"
git push
```

## Usage

1. **Open an issue** in your repository describing a bug fix, feature, or improvement
2. The workflow triggers automatically — look for the 👀 reaction
3. Wait a few minutes for the AI agent to analyze and implement
4. **Review the draft PR** that gets created
5. Merge if the changes look good, or request modifications

### Tips for Better Results

- Write clear, specific issue descriptions with context
- Include expected behavior and steps to reproduce (for bugs)
- Reference specific files or components when possible
- The agent works best with well-scoped, focused issues

## Built With

- [GitHub Agentic Workflows](https://github.github.com/gh-aw/) — Repository automation with AI coding agents
- [GitHub Copilot](https://github.com/features/copilot) — AI coding engine
- [GitHub Actions](https://github.com/features/actions) — CI/CD and workflow execution
- [Express.js](https://expressjs.com/) — Backend API framework
- [Helmet](https://helmetjs.github.io/) — HTTP security headers

## Resources

- [GitHub Agentic Workflows Documentation](https://github.github.com/gh-aw/)
- [Creating Agentic Workflows](https://github.github.com/gh-aw/setup/creating-workflows/)
- [IssueOps Pattern](https://github.github.com/gh-aw/patterns/issue-ops/)
- [Safe Outputs Reference](https://github.github.com/gh-aw/reference/safe-outputs/)
- [AI Engines Reference](https://github.github.com/gh-aw/reference/engines/)

## License

This project is provided as-is for experimentation with GitHub Agentic Workflows.
