# Quick Start: Meeting Copilot MCP

This is the fastest way to get started if you are new to MCP.

## 1. Install dependencies

```bash
npm install
```

## 2. Install and start Ollama

```bash
ollama pull llama2:latest
```

## 3. Create your `.env` file

Use the sample environment values and fill in your Jira and SMTP details.

## 4. Start the MCP server

```bash
node server.js
```

## 5. Register this server in VS Code

Create `.vscode/mcp.json` with:

```json
{
  "servers": {
    "meeting-copilot": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:\\path\\to\\Meeting-Copilot-Process-MCP-\\server.js"
      ]
    }
  }
}
```

## 6. Use the tools

Once registered, the MCP client can call:

- `extract_tasks_from_transcript`
- `create_follow_up_tasks`
- `test_jira_connection`
- `health_check`

## 7. Publish as a VS Code extension

Follow the extension skeleton under the `vscode-extension` folder.

Then package and publish with:

```bash
cd vscode-extension
npm install
vsce package
vsce login yourpublishername
vsce publish
```

---

## Why this matters

This project is an MCP server that allows an AI client to call business tools in a standard way.

That is the heart of MCP.
