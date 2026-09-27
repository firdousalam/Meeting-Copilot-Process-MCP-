# MCP – Meeting Copilot Pipeline

## 📖 Overview

**MCP (Meeting Copilot Pipeline)** is a Node.js prototype that automates meeting follow-ups.

It allows users to upload meeting transcripts, extracts actionable tasks using a locally running **Ollama LLM**, and automatically:

* 📧 Sends personalized task emails to participants.
* 🗂️ Creates Jira issues for assigned tasks.
* 📅 Adds task deadlines to Jira.
* 👤 Maps meeting participants to email addresses and Jira users.
* 🤖 Uses a local LLM to convert unstructured meeting discussions into structured tasks.
* 🔐 Keeps application credentials in environment variables.

The goal is to reduce the manual effort required to convert meeting discussions into actionable project-management tasks.

---

# 🛠️ Features

* 📂 Upload meeting transcripts manually.
* 🤖 Extract tasks and assignments using Ollama.
* 🧠 Support local LLM models such as `llama3.2:3b`.
* 📧 Send personalized emails using SMTP.
* 📬 Brevo SMTP support for transactional email.
* 🗂️ Create Jira Tasks and Epics automatically.
* 📅 Add Jira due dates.
* 👤 Map participants to email and Jira identities.
* 🔑 Secure credentials using `.env`.
* 📮 Test the API using Postman or cURL.

---

# 📂 Project Structure

```text
mcp-js/
│
├── transcripts/          # Uploaded meeting transcripts
├── participants.json     # Participant mapping
├── server.js             # Main Node.js application
├── .env                  # Environment variables / credentials
├── package.json          # Dependencies
└── README.md             # Documentation
```

---

# ⚙️ Setup Instructions

## 1. Install Node.js

Make sure Node.js v18+ and npm are installed.

```bash
node -v
npm -v
```

---

## 2. Install Dependencies

```bash
npm install express multer node-fetch nodemailer jira-client dotenv
```

> If you are using the built-in `fetch` available in modern Node.js versions, `node-fetch` may not be required.

---

# 3. Configure Ollama

Install Ollama:

[Ollama](https://ollama.com/?utm_source=chatgpt.com)

Download a model:

```bash
ollama pull llama3.2:3b
```

Test it:

```bash
ollama run llama3.2:3b
```

The application uses:

```env
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=llama3.2:3b
```

Ollama runs locally, so meeting transcripts can be processed without sending them to a paid external LLM API.

---

# 4. Configure Brevo SMTP

MCP uses **Brevo SMTP** to send meeting task emails.

Create a Brevo account and configure SMTP credentials.

In Brevo, generate an SMTP key from the SMTP settings.

You will need:

* SMTP login
* SMTP key
* Verified sender email

The SMTP login may look similar to:

```text
bb5d9b001@smtp-brevo.com
```

This value is used as `SMTP_USER`.

## Brevo `.env` configuration

```env
# SMTP - Brevo

SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587

SMTP_USER=YOUR_BREVO_SMTP_LOGIN
SMTP_PASS=YOUR_BREVO_SMTP_KEY

SMTP_FROM=firdous.alam2058@gmail.com
```

### Important

`SMTP_USER` and `SMTP_FROM` have different purposes.

```text
SMTP_USER
    ↓
Brevo SMTP authentication login

SMTP_PASS
    ↓
Brevo SMTP key

SMTP_FROM
    ↓
Email address displayed as the sender
```

The `SMTP_FROM` address must be **verified in Brevo**.

For example, if you want to send emails as:

```text
firdous.alam2058@gmail.com
```

add that address as a sender in Brevo and complete the verification email.

Do **not** use the Brevo SMTP login as the `SMTP_FROM` address.

---

# 5. Configure Jira Cloud

MCP uses Jira Cloud to automatically create project-management issues.

Example Jira site:

```text
https://technophilefirdous.atlassian.net
```

Current project:

```text
SCRUM
```

## Create an Atlassian API token

Do not use your normal Atlassian password.

Create an API token from your Atlassian account security settings:

[Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens?utm_source=chatgpt.com)

Create a token such as:

```text
Meeting-Copilot-Jira
```

Copy the generated token and use it as `JIRA_PASS`.

---

# 6. Configure `.env`

Create a `.env` file in the project root.

```env
# --------------------------------
# Server
# --------------------------------

PORT=3000


# --------------------------------
# Ollama
# --------------------------------

OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=llama3.2:3b


# --------------------------------
# SMTP - Brevo
# --------------------------------

SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587

SMTP_USER=YOUR_BREVO_SMTP_LOGIN
SMTP_PASS=YOUR_BREVO_SMTP_KEY
SMTP_FROM=YOUR_VERIFIED_BREVO_SENDER


# --------------------------------
# Jira Cloud
# --------------------------------

JIRA_HOST=technophilefirdous.atlassian.net
JIRA_USER=technophilefirdous@outlook.com
JIRA_PASS=YOUR_ATLASSIAN_API_TOKEN
JIRA_PROJECT_KEY=SCRUM
```

### Security

Never commit `.env` to GitHub.

Add this to `.gitignore`:

```gitignore
.env
node_modules/
transcripts/
```

Never publish:

* Brevo SMTP keys
* Atlassian API to
