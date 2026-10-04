# Meeting Copilot MCP Extension

This is a minimal VS Code extension starter for the Meeting Copilot MCP server.

## What it does

The extension starts the local Node.js MCP server for the project so that a compatible client or IDE can discover and use the tools.

## How to build it

```bash
cd vscode-extension
npm install
vsce package
```

## How to publish it

```bash
vsce login yourpublishername
vsce publish
```

## Important note

Before publishing, replace the placeholder publisher in `package.json` with your real Visual Studio Marketplace publisher name.

## Local usage

1. Open the project in VS Code.
2. Run: `Meeting Copilot: Start MCP Server` from the Command Palette.
3. The server starts in the background.
4. A compatible MCP client can connect to it.

---

This starter is intentionally simple and beginner-friendly. It is meant to help you package and publish the project step by step.
