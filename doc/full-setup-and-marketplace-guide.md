# Meeting Copilot MCP: Complete Beginner Guide

This document explains how to use this project as an MCP server, run it in VS Code, and publish it as a distributable tool.

It is written for someone who is new to MCP and wants a practical step-by-step walkthrough.

---

## 1. What is MCP?

MCP stands for Model Context Protocol.

It is a standard way for AI clients to talk to tools and services.

Instead of building custom integrations one by one, MCP gives AI tools a common way to:
- discover tools,
- call tools,
- pass structured arguments,
- receive structured responses.

### Simple example

Imagine a smart coding assistant wants to:
- read a transcript,
- extract action items,
- create Jira issues,
- send follow-up emails.

Without MCP, every app would need a custom integration.

With MCP, the AI client can call standard tools from a server.

This project exposes those tools as MCP tools.

---

## 2. What this project does

This project is a local MCP server that:

1. receives a transcript,
2. sends it to a local Ollama model,
3. extracts action items,
4. returns JSON tasks,
5. maps names to participant data,
6. optionally sends emails,
7. optionally creates Jira issues.

The main file is:

- [server.js](../server.js)

This file contains the MCP server and the tool definitions.

---

## 3. How the server works

At a high level, the project works like this:

1. A client starts the server
2. The client asks the server for available tools
3. The client calls a tool such as `extract_tasks_from_transcript`
4. The tool calls Ollama
5. Ollama returns a response
6. The server cleans and parses the response
7. The server returns structured task JSON
8. Another tool can create follow-up email/Jira actions

The key transport in this project is `StdioServerTransport`.

This is used in [server.js](../server.js) to connect the MCP server to the client over standard input/output.

That means it is designed for local use in an IDE or desktop MCP host.

---

## 4. What tools are exposed

This MCP server provides four main tools:

### 1. `extract_tasks_from_transcript`

This tool:
- accepts a transcript string,
- calls Ollama,
- parses action items,
- returns structured tasks in JSON.

Example result:

```json
[
  {
    "assignee": "Sarah",
    "task": "Launch checklist",
    "due_date": "Friday"
  }
]
```

### 2. `create_follow_up_tasks`

This tool:
- takes extracted tasks,
- maps assignees to email and Jira user names,
- sends email follow-ups,
- creates Jira issues,
- optionally supports `dryRun` mode.

### 3. `test_jira_connection`

This checks whether Jira credentials and project access are valid.

### 4. `health_check`

This checks the health of:
- Ollama,
- Jira,
- SMTP.

---

## 5. How to run this project locally

### Step 1: Install Node.js

Check whether Node.js is installed:

```bash
node -v
npm -v
```

If it is not installed, install Node.js 18+.

### Step 2: Install dependencies

Open the project folder in a terminal and run:

```bash
npm install
```

### Step 3: Install Ollama

Install Ollama from:
https://ollama.com/

Then pull a model:

```bash
ollama pull llama2:latest
```

Check the model list:

```bash
curl http://localhost:11434/api/tags
```

### Step 4: Create a `.env` file

Create a `.env` file based on the sample file.

Example:

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-smtp-login
SMTP_PASS=your-smtp-key
SMTP_FROM=your-email@example.com

JIRA_HOST=your-company.atlassian.net
JIRA_USER=your-jira-email
JIRA_PASS=your-jira-api-token
JIRA_PROJECT_KEY=TEAM

OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=llama2:latest
```

### Step 5: Set up participant mapping

Edit [participants.json](../participants.json).

Example:

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

### Step 6: Start the server

```bash
node server.js
```

If it starts correctly, it should print:

```bash
Meeting Copilot MCP server started
```

---

## 6. How to use it as MCP in VS Code

This is the easiest way for first-time users.

### What is needed

VS Code needs to know:
- where your MCP server script is located,
- how to start it,
- what tools it exposes.

This is commonly configured in a file like:

```text
.vscode/mcp.json
```

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

### Steps in VS Code

1. Open the project in VS Code
2. Create a `.vscode` folder if it does not already exist
3. Create `mcp.json`
4. Put the JSON above inside it
5. Save the file
6. Reload VS Code
7. The client can now discover the MCP tools

### What you can do after that

You can ask the AI assistant or MCP-enabled client to use tools from this server.

Example operations:
- extract tasks from a transcript,
- get a structured list of tasks,
- create follow-up tasks,
- send emails,
- create Jira issues.

---

## 7. Option 1: Use it in VS Code

This is the recommended beginner route.

### Beginner walkthrough

#### Step 1: Open the project

Open the folder in VS Code.

#### Step 2: Check the config

Open `.vscode/mcp.json` and make sure the path is correct.

#### Step 3: Make sure dependencies are installed

```bash
npm install
```

#### Step 4: Confirm Ollama is running

```bash
curl http://localhost:11434/api/tags
```

#### Step 5: Start the server manually

```bash
node server.js
```

#### Step 6: Invoke the tools from the MCP client

Your AI client can now call:
- `extract_tasks_from_transcript`
- `create_follow_up_tasks`
- `health_check`
- `test_jira_connection`

This means the client can work with your meeting assistant without needing a custom API layer.

---

## 8. What does “publish it” mean?

Publishing usually means making the project available for others to install.

For VS Code, the normal publishing route is through a VS Code extension package.

A plain Node.js MCP server can be used locally, but if you want to share it like a standard Marketplace tool, you usually convert it into an extension or packaging structure.

---

## 9. How to publish it to the VS Code Marketplace

This is the general process.

### Step 1: Install the packaging tool

```bash
npm install -g @vscode/vsce
```

### Step 2: Create a VS Code extension project

A basic extension structure looks like this:

```text
my-extension/
├── package.json
├── extension.js
├── README.md
├── src/
└── images/
```

### Step 3: Add extension metadata

In `package.json`, include:

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
  "main": "./extension.js"
}
```

### Step 4: Package the extension

```bash
vsce package
```

This creates a `.vsix` file.

### Step 5: Login to Marketplace

```bash
vsce login yourpublishername
```

### Step 6: Publish it

```bash
vsce publish
```

Your extension is now published to the VS Code Marketplace.

---

## 10. How users can install and use it

Once published, a user can:

1. open VS Code,
2. go to Extensions,
3. search for the extension name,
4. click Install,
5. use the extension commands or MCP capabilities,
6. let the AI client call the tools behind the scenes.

This is the normal user experience for Marketplace tools.

---

## 11. Difference between local MCP and Marketplace extension

This is a very important beginner concept.

### Local MCP server

- works on your machine,
- uses `.vscode/mcp.json`,
- easy for testing and development,
- does not require publishing.

### Marketplace extension

- installable by others,
- packaged and distributed,
- better for sharing with the public,
- more work to prepare and publish.

So for a beginner, do this:

1. get the local server working,
2. verify the tool works,
3. then package and publish later.

---

## 12. Recommended beginner roadmap

If you are new to MCP, use this order:

1. Understand what MCP is
2. Run the project locally
3. Configure it in VS Code
4. Test the tool functions
5. Learn the server/client pattern
6. Then consider Marketplace packaging

This is much easier than starting directly with publishing.

---

## 13. Beginner skill checklist

Before you call this project working, check these items:

- [ ] Node.js is installed
- [ ] `npm install` succeeded
- [ ] Ollama is installed and the model is downloaded
- [ ] `.env` is filled in correctly
- [ ] [participants.json](../participants.json) has team users
- [ ] `node server.js` starts cleanly
- [ ] `.vscode/mcp.json` points to the correct server file
- [ ] the client can discover the tools
- [ ] `extract_tasks_from_transcript` returns valid JSON

---

## 14. Final summary

This project is a local MCP server that exposes AI tools for meeting-task automation.

It is designed to be used in IDEs like VS Code through MCP configuration.

For a beginner, the simplest path is:
- install dependencies,
- run Ollama,
- start the server,
- register it in VS Code,
- call the tools.

If you want to share it with others, package it into a VS Code extension and publish it to the Marketplace.

---

## 15. Quick command recap

```bash
npm install
ollama pull llama2:latest
node server.js
vsce package
vsce login yourpublishername
vsce publish
```

---

## 16. One sentence lesson

MCP is a standard way for AI tools to call services, and this project is an example of a local MCP server that exposes useful business tools to an AI client.

---

## 17. Next step

Start by running the local MCP server and configuring it in VS Code. Once that works, the publishing flow becomes much easier to understand.
