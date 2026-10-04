# MCP Beginner Guide for Meeting Copilot

This document is written for a complete beginner.

The goal is to help you understand:
- what MCP is,
- how this project works as an MCP server,
- how to use it in VS Code,
- how to publish it and share it with others,
- and how to install/use it from a Marketplace-style distribution flow.

---

## 1. What is MCP?

MCP means Model Context Protocol.

Think of MCP as a standard language between:
- an AI application (like VS Code, Continue, Cursor, Claude Desktop, or another custom app), and
- tools or services that can do work (like a Jira connector, email sender, database client, file reader, or custom API server).

Without MCP:
- every AI tool has its own custom way to talk to services.

With MCP:
- all tools speak the same protocol.
- your AI client can discover tools automatically.
- the client can call tools in a consistent way.

### Simple example

Your AI assistant wants to:
- read a transcript,
- extract action items,
- create Jira tasks,
- send emails.

Instead of writing custom integration code for every app, MCP exposes these functions as tools.

This project exposes tools such as:
- `extract_tasks_from_transcript`
- `create_follow_up_tasks`
- `test_jira_connection`
- `health_check`

These are standard MCP tools. The AI client can call them when needed.

---

## 2. What is this project doing?

This project is an MCP server that takes a meeting transcript, extracts tasks with Ollama, and then optionally:
- sends an email,
- creates Jira issues,
- keeps a clean workflow for teams.

The main file is [server.js](../server.js).

It does 3 important jobs:

1. It starts an MCP server
2. It exposes business tools
3. It connects to external services such as Ollama, SMTP mail, and Jira

---

## 3. The architecture in simple terms

This project uses:

- Local Ollama model for AI reasoning
- Node.js runtime for the process
- MCP stdio transport for communication
- SMTP for sending emails
- Jira API for issue creation

### Flow

1. A client (like VS Code or another MCP host) starts the server
2. The server registers tools
3. The client calls `extract_tasks_from_transcript`
4. The tool sends the transcript to Ollama
5. Ollama returns a response
6. The server parses the response into structured tasks
7. The tool returns JSON to the client
8. The client can then call `create_follow_up_tasks` to email and create Jira issues

---

## 4. What is stdio?

This project uses the stdio transport.

`stdio` means:
- the server communicates with the client through standard input/output,
- it does not require a web server,
- it is commonly used for local tools in IDEs and desktop apps.

This is why the server is started like a normal command:

```bash
node server.js
```

The client launches the process and talks to it through the terminal channel.

This is the simplest kind of MCP server for local development.

---

## 5. How to run this project locally

Before using it inside VS Code or another client, you need to install the required tools.

### Step 1: Install Node.js

Check if Node.js is installed:

```bash
node -v
npm -v
```

If not installed, install Node.js 18 or later.

### Step 2: Install project dependencies

Open the project folder in terminal and run:

```bash
npm install
```

### Step 3: Install Ollama

Download and install Ollama from:
https://ollama.com/

Then pull a model that works locally:

```bash
ollama pull llama2:latest
```

Check if Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

### Step 4: Set environment variables

Create a `.env` file in the project root by copying the sample file.

Example:

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=your-email@example.com

JIRA_HOST=your-company.atlassian.net
JIRA_USER=your-jira-email
JIRA_PASS=your-jira-api-token
JIRA_PROJECT_KEY=TEAM

OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=llama2:latest
```

### Step 5: Configure participants

Edit [participants.json](../participants.json) and add team members like this:

```json
{
  "Sarah": {
    "email": "sarah@example.com",
    "jira_user": "sarah.username"
  },
  "John": {
    "email": "john@example.com",
    "jira_user": "john.username"
  }
}
```

The assignee names must match the names extracted by the model.

### Step 6: Start the server

```bash
node server.js
```

If it starts successfully, you should see a message like:

```bash
Meeting Copilot MCP server started
```

---

## 6. How to use it as MCP in VS Code

This is the easiest way for a beginner.

### What VS Code needs

VS Code needs to know:
- where the MCP server command is,
- which script to start,
- what the server exposes.

This is usually configured in a file like `.vscode/mcp.json`.

### Example config

```json
{
  "servers": {
    "meeting-copilot": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:\\Users\\yourname\\path\\to\\Meeting-Copilot-Process-MCP-\\server.js"
      ]
    }
  }
}
```

### How to add it in VS Code

1. Open the project folder in VS Code
2. Create a folder named `.vscode` if it does not already exist
3. Create a file named `mcp.json`
4. Add the JSON block above
5. Save the file
6. Reload the VS Code window or restart the editor
7. The MCP client in VS Code can now discover the tools

### What happens after registration

Once VS Code sees the server, it can call tools from it.

For example, a tool like:

```text
extract_tasks_from_transcript
```

can be invoked by an AI agent or custom workflow in the IDE.

### Quick beginner understanding

Think of it like this:
- the MCP server is the worker,
- VS Code is the manager,
- the manager asks the worker to do actions,
- the worker responds with structured data.

That is the core idea of MCP.

---

## 7. Option 1: Use it in VS Code (Beginner-friendly version)

This is your first and easiest path.

### Step-by-step

#### Step 1: Open the project

Open the entire project folder in VS Code.

#### Step 2: Check the MCP config

Open `.vscode/mcp.json`.

Make sure the path points to your actual `server.js` file.

#### Step 3: Ensure Node and Ollama are running

Run these checks:

```bash
node -v
ollama list
```

If Ollama is not running, start it.

#### Step 4: Start the server manually

In a terminal inside the project:

```bash
node server.js
```

If the server starts successfully, it is ready to accept MCP calls.

#### Step 5: Let your MCP client call the tools

At this point, VS Code or a compatible client can use the exposed tools.

Example tool call:

- `extract_tasks_from_transcript`
- Arguments:
  - `transcript`: meeting meeting text
  - `model`: `llama2:latest`

The tool responds with a JSON array of tasks.

#### Step 6: Create tasks

After extracting tasks, call:

```text
create_follow_up_tasks
```

with the output from extraction.

It will:
- map each assignee,
- send email,
- create Jira issues,
- return a result summary.

---

## 8. What is the difference between a local MCP server and a Marketplace package?

This is important for freshers.

### Local MCP server

This project is currently a local MCP server.

It works well when:
- the client and server are on the same machine,
- you want fast local usage,
- you are testing or developing.

### Marketplace package

Publishing to the VS Code Marketplace is different.

It usually means packaging a VS Code extension or a tool that can be installed from the Marketplace.

A plain Node MCP server is not automatically the same as a VS Code extension. It may still be used locally through MCP config, but not necessarily published as a Marketplace extension by default.

So for a beginner, remember:

- local MCP server = easiest setup
- VS Code extension = installable package on Marketplace
- your project can be both, but they are not identical concepts

---

## 9. How to publish it to VS Code Marketplace

This part is for people who want to share their tool with others.

### Important note

If you want to publish to VS Code Marketplace, the normal process is to create a VS Code extension package.

That means your tool is packaged as an extension, not just as a plain Node script.

### Basic publishing flow

#### Step 1: Install the required tools

You need:
- Node.js
- npm
- a GitHub account
- a VS Code Marketplace publisher account
- `@vscode/vsce` packaging tool

Install `vsce`:

```bash
npm install -g @vscode/vsce
```

#### Step 2: Create a VS Code extension project

Create a folder structure for an extension.

Example structure:

```text
my-mcp-extension/
├── package.json
├── extension.js
├── README.md
├── images/
└── src/
```

Your extension can then:
- register commands,
- start the MCP server,
- expose UI or helper actions,
- package the server with the extension.

#### Step 3: Add extension metadata in package.json

Your `package.json` should include:

```json
{
  "name": "meeting-copilot",
  "displayName": "Meeting Copilot",
  "version": "0.1.0",
  "publisher": "yourpublishername",
  "engines": {
    "vscode": "^1.90.0"
  },
  "categories": ["Other"],
  "activationEvents": [
    "onCommand:meetingCopilot.start"
  ],
  "main": "./extension.js"
}
```

#### Step 4: Package the extension

Run:

```bash
vsce package
```

This creates a `.vsix` file.

#### Step 5: Publish it

Login to the Marketplace:

```bash
vsce login yourpublishername
```

Then publish:

```bash
vsce publish
```

This uploads the extension to the VS Code Marketplace.

---

## 10. How users download and use it after publishing

Once published, a user can:

1. open VS Code,
2. go to Extensions,
3. search your extension name,
4. click Install,
5. open the extension,
6. use its commands or registered MCP features.

If your extension starts an MCP server internally, it can then expose those tools to the client automatically.

### Beginner understanding

The end user does not need to know the details of Node.js or MCP transport.

They just:
- install the extension,
- open VS Code,
- use the extension features,
- or let the AI client call the tools behind the scenes.

---

## 11. What to do if you are not ready for Marketplace publishing yet

For a first project, the best learning path is:

### Recommended beginner path

1. Get the local MCP server working
2. Use it in VS Code with `.vscode/mcp.json`
3. Test all tools manually
4. Create a GitHub repo
5. Add proper README instructions
6. Then consider extension packaging and Marketplace publishing

This is safer and easier than starting directly with Marketplace publishing.

---

## 12. Best practice for this project

For this project, the easiest route is:

### Best beginner route

- Keep it as a local MCP server first
- Use it through `.vscode/mcp.json`
- Validate the model and tool logic
- Package it later if you want a distributable extension

This keeps the project simple and easy to understand while you are learning MCP.

---

## 13. Real-world beginner checklist

Use this checklist before you call yourself ready:

- [ ] Node.js is installed
- [ ] npm install runs successfully
- [ ] Ollama is installed and a model is pulled
- [ ] `.env` is configured properly
- [ ] [participants.json](../participants.json) is updated
- [ ] `node server.js` starts successfully
- [ ] `.vscode/mcp.json` points to the correct server file
- [ ] the MCP tool is callable from VS Code or another MCP client
- [ ] extraction works
- [ ] follow-up tasks can be created

---

## 14. Final beginner summary

If you are new to MCP, here is the simplest possible explanation:

MCP is a standard way for AI tools to call external functions.

This project exposes tools that let an AI client:
- read transcripts,
- extract tasks,
- map people,
- send emails,
- create Jira tasks.

You can use it locally in VS Code by registering it as an MCP server.

If you want to publish it to the Marketplace, you usually need to package it as a VS Code extension and publish that extension.

That is the beginner roadmap.

---

## 15. Next recommended step

Start with:

1. run the server locally,
2. add the VS Code mcp config,
3. test the tools,
4. then move to extension packaging if needed.

Once you are comfortable, you can turn this concept into a proper shareable Marketplace extension.

---

## 16. Useful commands recap

```bash
npm install
ollama pull llama2:latest
node server.js
vsce package
vsce login yourpublishername
vsce publish
```

---

## 17. Simple lesson to remember

A server exposes tools.
A client discovers tools.
A client calls tools.
That is the heart of MCP.

If you understand that, you understand the basic idea behind this project.
