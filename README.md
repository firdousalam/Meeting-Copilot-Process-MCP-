# Meeting-Copilot-Process-MCP-
MCP Architecture (Manual Upload + JavaScript)


🛠️ MCP Architecture (Manual Upload + JavaScript)
1. Transcript Upload
Accept .vtt, .docx, or .txt files via a simple Express.js REST API.

Store them in a transcripts/ folder for processing.

2. Task Extraction with Ollama
Use Node’s fetch or axios to call Ollama’s local API (http://localhost:11434).

Prompt Ollama to return structured JSON tasks.

Example call:

js
const response = await fetch("http://localhost:11434/api/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "llama3",
    prompt: "Extract tasks from transcript. Format as JSON: assignee, task, due_date."
  })
});
const data = await response.json();
console.log(data);
3. Participant Mapping
Maintain a participants.json file:

json
{
  "John": { "email": "john@example.com", "jira_user": "john.doe" },
  "Sarah": { "email": "sarah@example.com", "jira_user": "sarah.smith" }
}
Load this mapping in Node.js with fs.readFileSync.

4. Email Notifications
Use Nodemailer (open source).

Example:

js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.example.com",
  port: 587,
  secure: false,
  auth: { user: "youruser", pass: "yourpass" }
});

await transporter.sendMail({
  from: "mcp@example.com",
  to: "john@example.com",
  subject: "Meeting Action Items",
  text: "Update the dashboard by Friday"
});
5. Jira Issue Creation
Use jira-client (open source Node.js library).

Example:

js
const JiraClient = require("jira-client");

const jira = new JiraClient({
  protocol: "https",
  host: "yourdomain.atlassian.net",
  username: "jirauser",
  password: "jirapass",
  apiVersion: "2",
  strictSSL: true
});

await jira.addNewIssue({
  fields: {
    project: { key: "TEAM" },
    summary: "Update dashboard by Friday",
    description: "Task assigned during meeting",
    assignee: { name: "john.doe" },
    issuetype: { name: "Task" }
  }
});
6. Workflow Orchestration
Express.js routes:

/upload → handle transcript upload.

/process → run Ollama extraction, send emails, create Jira tickets.

Optional: Use BullMQ (Redis‑based queue) for task scheduling.

7. Deployment
Dockerize Node.js + Ollama.

Deploy on Linux server or cloud VM.

CI/CD with GitHub Actions.

📂 Example Directory Structure
Code
mcp-js/
 ├── transcripts/
 ├── participants.json
 ├── server.js
 ├── ollama.js
 ├── email.js
 ├── jira.js
 ├── package.json
 └── Dockerfile
