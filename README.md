# Meeting Copilot MCP Server

A Node.js Model Context Protocol (MCP) server that turns meeting transcripts into actionable follow-up items.

It uses:
- Ollama for local AI task extraction
- participant mapping for assignee lookup
- SMTP email delivery for follow-ups
- Jira Cloud for issue creation

This project is designed to be used by an MCP-compatible client such as Continue, Cursor, Claude Desktop, or any custom MCP host.

## What this project does

1. Receives a meeting transcript
2. Sends the transcript to a local Ollama model
3. Extracts structured tasks in JSON format
4. Maps each assignee to an email and Jira user
5. Sends follow-up emails
6. Creates Jira issues automatically

## Features

- MCP stdio server mode
- Local LLM processing with Ollama
- Jira issue creation
- Email delivery using SMTP
- Participant mapping via JSON file
- Easy integration with other tools or services
- Server startup and health checks

## Project structure

```text
Meeting-Copilot-Process-MCP-
├── .env
├── .env.sample
├── .gitignore
├── .vscode/
│   └── mcp.json
├── examples/
│   └── mcp-smoke-test.js
├── node_modules/
├── participants.json
├── server.js
├── transcripts/
│   └── sample-meeting.txt
├── package.json
└── README.md
```

## Prerequisites

Before using this project, make sure you have:

- Node.js 18+
- npm
- Ollama installed locally
- A running Ollama model
- SMTP credentials (Brevo or another SMTP provider)
- Jira Cloud access and API token

## 1) Install Node.js

Check if Node and npm are installed:

```bash
node -v
npm -v
```

If not installed, install Node.js 18+ from:
https://nodejs.org/

## 2) Install dependencies

From the project root:

```bash
npm install
```

## 3) Install and run Ollama

Install Ollama from:
https://ollama.com/

Then pull a model. This project was validated with:

```bash
ollama pull llama2:latest
```

Check the running model list:

```bash
curl http://localhost:11434/api/tags
```

## 4) Configure environment variables

Create a `.env` file in the project root based on `.env.sample`.

Example:

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-smtp-login
SMTP_PASS=your-brevo-smtp-key
SMTP_FROM=your-verified-sender@gmail.com

JIRA_HOST=https://your-company.atlassian.net/
JIRA_USER=your-jira-email
JIRA_PASS=your-jira-api-token
JIRA_PROJECT_KEY=SCRUM
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EPIC_NAME_FIELD=customfield_10011
JIRA_EPIC_LINK_FIELD=customfield_10014
JIRA_STORY_POINTS_FIELD=customfield_10016
STORY_POINTS_PER_WORKDAY=1
MCP_CREATE_TIMEOUT_MS=300000

OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=llama2:latest
```

Important:
- For Brevo, `SMTP_USER` is the SMTP login shown in Brevo SMTP settings, not necessarily your sender email.
- `SMTP_PASS` is the provider's SMTP key/password. For Brevo, use an SMTP key, not an API key.
- `SMTP_FROM` is the email that will appear as the sender
- `JIRA_PASS` should be an Atlassian API token, not your normal password
- `JIRA_HOST` accepts a bare hostname or a full URL; the app normalizes it for API requests. `JIRA_BASE_URL` is used to build issue links.
- Jira Cloud assignees are resolved by matching participant email addresses. Add `jira_account_id` to a participant in `participants.json` to override lookup.
- Confirm the Jira custom-field IDs for Epic name, Epic link, and story points in your project; they vary by site. Story points are sent only when `JIRA_STORY_POINTS_FIELD` is configured.
- If a call gives story points but no duration, the app estimates workdays using `STORY_POINTS_PER_WORKDAY` (default: one point per workday).
- `MCP_CREATE_TIMEOUT_MS` controls how long the web client waits for multi-issue creation.

## 5) Configure participant mapping

Edit `participants.json` to match your team names to email and Jira identities.

Example:

```json
{
  "Sarah": {
    "email": "sarah@example.com",
    "jira_user": "sarah.user"
  },
  "John": {
    "email": "john@example.com",
    "jira_user": "john.user"
  }
}
```

The assignee values returned by the LLM must match the keys in this file.

## 6) Run the MCP server locally

From the project root:

```bash
node server.js
```

The server runs in stdio MCP mode and waits for a client to connect.

## 7) Run the smoke test

```bash
node examples/mcp-smoke-test.js
```

This test sends a sample transcript to the tool and verifies the MCP server is responding successfully.

## MCP tool interface

This server exposes the following MCP tools:

### extract_tasks_from_transcript

Input:
- `transcript` (string)
- optional `model` (string)

Output:
- structured JSON array with `assignee`, `task`, `due_date`, issue type, parent, requester, call source, story points, estimated workdays, and task details when available

### create_follow_up_tasks

Input:
- `tasks` (array of objects)
- optional `dryRun` (boolean)

Behavior:
- verifies SMTP before creating issues, then creates Jira issues and sends email follow-ups with Jira links
- includes requester, call action/timestamp, due date, story points, estimated duration, and task details in issue descriptions and emails
- optionally skips external actions when `dryRun` is true
- returns per-issue status and Jira links; email failures after Jira creation are reported as partial failures

### test_jira_connection

Checks that Jira credentials and the configured project are valid.

### health_check

Checks the status of:
- Ollama
- Jira
- SMTP mailer

## VS Code / Continue MCP config

The project includes a VS Code MCP config file at:

```text
.vscode/mcp.json
```

Example content:

```json
{
  "servers": {
    "meeting-copilot": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:\\Users\\techn\\TechnophileFirdous\\Meeting-Copilot-Process-MCP-\\server.js"
      ]
    }
  }
}
```

After adding or reloading the config, the MCP client can call the server tools directly.

## Integrating with Continue or other MCP clients

Most MCP clients connect by pointing to a local command.

Example pattern:

```json
{
  "mcpServers": {
    "meeting-copilot": {
      "command": "node",
      "args": ["/absolute/path/to/server.js"]
    }
  }
}
```

This allows the client to invoke the server tools without building a custom API layer.

## Deploying to AWS or other hosting environments

This project can be adapted to run in many environments, but the key requirement is that it must be reachable by the MCP client or agent that will call it.

### Option 1: Run locally for internal developer use

Use this when:
- you want fast local development
- the client and server are on the same machine
- you want low infrastructure cost

This is the easiest and safest approach for initial setup.

### Option 2: Run on AWS EC2

Use EC2 when you want a dedicated, always-on server.

Typical steps:

1. Launch an EC2 instance
2. Install Node.js and Ollama
3. Upload the project files
4. Set environment variables in the instance or via AWS Systems Manager Parameter Store
5. Start the server with a systemd service or PM2
6. Expose the server to internal clients if needed

Example for PM2:

```bash
npm install -g pm2
pm2 start server.js --name meeting-copilot-mcp
pm2 save
```

For an internal AWS environment, you can also use:
- EC2 + private networking
- ALB for HTTP access if you expose a web API
- security groups to restrict access

### Option 3: Run on AWS ECS or EKS

Use ECS/EKS if you want:
- containerized deployment
- autoscaling
- multiple replicas
- better production posture

You would package the server as a Docker image and run it as a containerized MCP service.

Example Dockerfile:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "server.js"]
```

Then build and run:

```bash
docker build -t meeting-copilot-mcp .
docker run --rm -it meeting-copilot-mcp
```

### Option 4: Run on Azure, Render, Railway, or another host

The same pattern works in any environment that can run a Node.js process.

For example:
- Azure App Service
- Render
- Railway
- DigitalOcean App Platform
- Fly.io
- Kubernetes

The main requirement is that your MCP client must be able to launch the command or connect to the server endpoint.

## Important design note

This project is currently built for local stdio MCP integration. That is the simplest and most common pattern for AI tooling.

If you want to expose it as a network service instead, you would need to:
- switch from stdio to HTTP/SSE or streamable HTTP MCP transport
- add authentication
- add secure networking
- add rate limiting and secrets management

## Security best practices

- Never commit `.env` files
- Use secrets managers such as:
  - AWS Secrets Manager
  - Azure Key Vault
  - GitHub Actions secrets
  - environment injection in deployment systems
- Restrict Jira and SMTP access to least privilege
- Rotate API tokens periodically
- Validate output from the LLM before sending emails or creating Jira issues

## Common troubleshooting

### Ollama is not responding

Check:

```bash
curl http://localhost:11434/api/tags
```

Ensure the model exists:

```bash
ollama list
```

### No tasks were extracted

This usually means:
- the wrong Ollama model is active
- the prompt was not structured clearly enough
- the model response was not valid JSON

The server does basic parsing, but a stronger model or better prompt tuning may improve quality.

### Jira connection fails

Check:
- `JIRA_HOST`
- `JIRA_USER`
- `JIRA_PASS`
- `JIRA_PROJECT_KEY`
- for Jira Cloud, verify participant email lookup or configure `jira_account_id` in `participants.json`
- verify the requested issue type and configured custom-field IDs are available in the target project

### Emails are not sent

Check:
- SMTP host and port
- the provider SMTP login in `SMTP_USER` and SMTP key in `SMTP_PASS` (these may differ from the sender address and API key)
- sender verification in the email provider

The app verifies SMTP before creating Jira issues, so an SMTP authentication failure should stop a new batch before issue creation. If the response says Jira issues were created but email failed, do not retry the whole batch; use the returned Jira keys/links and fix SMTP before resending follow-ups.

## Example use-case flow

1. A developer or team member gives the MCP server a transcript
2. The tool extracts action items
3. Each item is assigned to a known participant
4. Jira task is created automatically
5. Email is sent to the assignee
6. Team follow-up is faster and more consistent

## License

This project is for internal or personal use unless a license is added explicitly.

## Recommended next improvements

- Add retries for failed Ollama and Jira requests
- Add structured logging
- Add a validation layer before creating Jira tasks
- Add support for multiple Ollama models
- Add Docker support
- Add HTTP MCP mode for browser or remote integration
- Add unit tests and end-to-end task validation

## Summary

This project is already a working MCP server for meeting follow-up automation. It is ready for local developer use and can be extended for cloud or enterprise deployment by wrapping it in a secure hosting environment such as AWS EC2, ECS, Azure App Service, or another managed Node.js platform.

* Atlassian API to




Today
I want to learn Agent and MCP suggest me one project which i can use all AI feature like Langchain,Langraph,MCP,Multiagent,RAG using Ollama and opensource agent
Here’s a project idea that will let you practice Agents + MCP + LangChain + LangGraph + Multi‑Agent + RAG with Ollama, all in one cohesive system:

🚀 Project Idea: AI Knowledge Workflow Copilot
Concept
Build a multi‑agent system that ingests meeting transcripts, documents, and code snippets, then:

Summarizes & extracts tasks (MCP pipeline).

Assigns tasks to agents (LangGraph multi‑agent orchestration).

Retrieves supporting knowledge (RAG with vector DB).

Generates code suggestions locally (Ollama models).

Provides a conversational interface (LangChain agent layer).

🔧 Tech Stack & Features
Component	Role in Project
MCP (Meeting Copilot Process)	Handles transcript ingestion, parsing, and pipeline orchestration.
LangChain	Provides agent framework, tool calling, and RAG integration.
LangGraph	Manages multi‑agent workflows (e.g., Task Planner → Knowledge Retriever → Code Generator → Reviewer).
Multi‑Agent Setup	Separate agents for: Planner, Retriever, Coder, Reviewer, Communicator.
RAG (Retrieval‑Augmented Generation)	Uses a vector DB (like Chroma or Weaviate) to store docs, meeting notes, and code snippets for context.
Ollama	Runs local LLMs (e.g., Llama 3, Mistral) for inference without API costs.
Open‑Source Agent (Continue.dev)	Integrates into VS Code for coding assistance.


🛠 Example Workflow
Input: Upload a transcript or doc → MCP parses it.

Planner Agent: Breaks down into tasks.

Retriever Agent (RAG): Pulls relevant docs/snippets from vector DB.

Coder Agent (Ollama): Suggests code or schema.

Reviewer Agent: Validates correctness.

Communicator Agent: Outputs tasks in JSON, emails, or Jira tickets.

🎯 Why This Project?
Covers all major AI features you mentioned.

Lets you practice multi‑agent orchestration with LangGraph.

Uses RAG for grounding answers in real docs.

Runs locally with Ollama (no API fees).

Connects to developer workflow (Continue.dev in VS Code).

👉 My suggestion: Start small by wiring Ollama + LangChain RAG first (document Q&A). Then layer LangGraph multi‑agent orchestration. Finally, integrate with MCP pipeline for transcripts and task assignment.

Would you like me to sketch the architecture diagram (agents + data flow) so you can visualize how all these pieces connect?

anything you can suggest me i want handson experience but project should be small but meaningfull
The best small but meaningful project to get hands‑on with LangChain, LangGraph, MCP, Multi‑Agent, RAG, and Ollama is a “Local AI Research Assistant” that ingests your notes or PDFs, retrieves relevant context, and answers questions with multi‑agent orchestration. It’s compact enough to build in a weekend but touches every feature you want to practice.

🛠 Suggested Project: Local AI Research Assistant
Core Idea
A lightweight agent system that:

Ingests documents (PDFs, notes, transcripts).

Stores embeddings in a vector DB (Chroma or Qdrant).

Uses RAG to answer queries grounded in your docs.

Runs locally with Ollama (no API fees).

Employs LangGraph to orchestrate multiple agents:

Retriever Agent → fetches context.

Summarizer Agent → condenses info.

Answer Agent → generates final response.

Reviewer Agent → checks quality.

MCP integration → standardizes tool access (e.g., file loader, calculator).

Multi‑Agent setup → each agent has a clear role, coordinated via LangGraph.

🔑 Why It’s Small but Powerful
Small scope: Just one input (your notes/docs) and one output (answers).

Meaningful: You’ll practice ingestion, retrieval, orchestration, and local inference.

Expandable: Later add features like task extraction, quiz generation, or code suggestions.

📂 Example Workflow
Upload a PDF → MCP parses it.

Retriever Agent (LangChain + RAG) pulls relevant chunks.

Summarizer Agent condenses context.

Answer Agent (Ollama model) generates response.

Reviewer Agent validates and refines.

Output: concise, grounded answer.

⚡ Next Steps
Start with LangChain + Ollama RAG Q&A (simplest).

Add LangGraph orchestration for multi‑agent flow.

Integrate MCP for standardized tool access.

Expand with multi‑agent roles (retriever, summarizer, reviewer).

👉 This project is small enough to finish quickly but meaningful because it forces you to use every AI feature in practice.

Would you like me to draft a step‑by‑step roadmap (with code snippets) so you can start building this assistant immediately?

Provide me Full Implementation Readme with all steps
Here’s a full implementation README you can use as a starting point for your small but meaningful project: a Local AI Research Assistant that integrates LangChain, LangGraph, MCP, Multi‑Agent, RAG, and Ollama.

📘 Local AI Research Assistant
A lightweight multi‑agent system that ingests documents (PDFs, notes, transcripts), retrieves relevant context, and answers questions using LangChain + LangGraph + MCP + RAG + Ollama — all open‑source.

🚀 Features
Document ingestion via MCP (Meeting Copilot Process).

RAG (Retrieval‑Augmented Generation) with ChromaDB/Qdrant.

Multi‑Agent orchestration using LangGraph:

Retriever Agent

Summarizer Agent

Answer Agent

Reviewer Agent

Local inference with Ollama (Llama 3, Mistral, etc.).

Extensible: add task extraction, quiz generation, or coding suggestions later.

🛠 Prerequisites
Python 3.10+

Node.js (for MCP if needed)

Ollama installed: https://ollama.ai

Vector DB: Chroma or Qdrant

VS Code (optional) with Continue.dev

📂 Project Structure
Code
local-ai-assistant/
│── README.md
│── requirements.txt
│── main.py
│── agents/
│    ├── retriever.py
│    ├── summarizer.py
│    ├── answer.py
│    └── reviewer.py
│── data/
│    └── sample_docs/
│── config/
     └── settings.yaml
⚙️ Installation
bash
git clone https://github.com/yourname/local-ai-assistant.git
cd local-ai-assistant
python -m venv venv
source venv/bin/activate   # Linux/Mac
venv\Scripts\activate      # Windows
pip install -r requirements.txt
requirements.txt

Code
langchain
langgraph
chromadb
ollama
pydantic
fastapi
uvicorn
🔧 Configuration
Edit config/settings.yaml:

yaml
OLLAMA_URL: "http://localhost:11434"
OLLAMA_MODEL: "llama3"
VECTOR_DB: "chroma"
DOCS_PATH: "./data/sample_docs"
🧩 Implementation
1. Document Ingestion (MCP)
python
from langchain.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.vectorstores import Chroma
from langchain.embeddings import OllamaEmbeddings

loader = PyPDFLoader("./data/sample_docs/example.pdf")
docs = loader.load()

splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
chunks = splitter.split_documents(docs)

vectorstore = Chroma.from_documents(chunks, OllamaEmbeddings(model="llama3"))
2. Multi‑Agent Setup (LangGraph)
python
from langgraph.graph import Graph

graph = Graph()

graph.add_node("retriever", retriever_agent)
graph.add_node("summarizer", summarizer_agent)
graph.add_node("answer", answer_agent)
graph.add_node("reviewer", reviewer_agent)

graph.add_edge("retriever", "summarizer")
graph.add_edge("summarizer", "answer")
graph.add_edge("answer", "reviewer")
3. Agents
retriever.py

python
def retriever_agent(query, vectorstore):
    return vectorstore.similarity_search(query, k=3)
summarizer.py

python
from ollama import chat

def summarizer_agent(chunks):
    return chat(model="llama3", messages=[{"role":"user","content":f"Summarize: {chunks}"}])
answer.py

python
def answer_agent(summary, query):
    return chat(model="llama3", messages=[{"role":"user","content":f"Answer '{query}' using: {summary}"}])
reviewer.py

python
def reviewer_agent(answer):
    return chat(model="llama3", messages=[{"role":"user","content":f"Review and refine: {answer}"}])
4. Main Entry
python
def run_pipeline(query):
    retrieved = retriever_agent(query, vectorstore)
    summary = summarizer_agent(retrieved)
    answer = answer_agent(summary, query)
    final = reviewer_agent(answer)
    return final
▶️ Usage
bash
python main.py
Example:

python
print(run_pipeline("Explain the key points of the uploaded document"))
📈 Future Enhancements
Add task extraction (convert meeting notes → Jira tasks).

Integrate Continue.dev for coding assistance.

Add FastAPI endpoints for a web interface.

Expand to multi‑modal inputs (audio transcripts, images).

✅ This README gives you a step‑by‑step implementation with all components wired together. It’s small enough to run locally but meaningful because it touches LangChain, LangGraph, MCP, Multi‑Agent, RAG, and Ollama in one workflow.

Would you like me to also add a sample docker-compose.yml so you can containerize Ollama + Chroma + your assistant for easy deployment?

import dotenv from _dotenv_;.txt

Plain Text

I have this MCP now how i can increase my knowledge using it 
i want to learn all espect of ai learning on eby one
Great — you already have a working MCP server that extracts tasks from transcripts, sends follow‑up emails, and creates Jira issues. That’s a solid foundation. To use this project as a way to increase your AI knowledge step by step, here’s a structured learning roadmap you can follow:

🧭 Step‑by‑Step AI Learning with Your MCP
1. Understand the MCP Basics
You’ve built a server with tools (extract_tasks_from_transcript, create_follow_up_tasks, etc.).

Each tool is a capability exposed to agents.
👉 Learn: how MCP defines tools, schemas (zod validation), and transports (StdioServerTransport).

2. Experiment with Ollama + Prompt Engineering
Your MCP calls Ollama to extract tasks.

Try different prompts:

Summarization

Sentiment analysis

Meeting highlights

👉 Learn: prompt design, JSON‑only outputs, error handling.

3. Add RAG (Retrieval‑Augmented Generation)
Store transcripts in a vector DB (Chroma/Qdrant).

Add a new MCP tool: search_transcripts.

Agents can then retrieve past meeting context before generating tasks.
👉 Learn: embeddings, vector search, grounding answers.

4. Introduce Multi‑Agent Workflows (LangGraph)
Define agents:

Planner Agent → decides what needs to be done.

Retriever Agent → pulls context from vector DB.

Task Agent → extracts tasks (your current MCP tool).

Reviewer Agent → validates tasks.

Orchestrate them with LangGraph.
👉 Learn: agent roles, graph orchestration, error recovery.

5. Integrate LangChain
Wrap your MCP tools as LangChain Tools.

Build a conversational agent that can call:

extract_tasks_from_transcript

create_follow_up_tasks

search_transcripts

👉 Learn: LangChain agent framework, tool calling, chaining.

6. Expand MCP Tools
Add tools for:

Summarization (summarize_transcript)

Knowledge Q&A (qa_transcript)

Code generation (using Ollama models like codellama)

👉 Learn: how to expose diverse AI capabilities via MCP.

7. Connect to Developer Workflow
Use Continue.dev in VS Code.

Connect your MCP server so Continue can call your tools.

👉 Learn: how agents integrate into IDEs for coding assistance.

8. Deploy & Scale
Containerize with Docker.

Run Ollama + MCP + Vector DB together.

👉 Learn: deployment, scaling, monitoring.

🎯 Suggested Learning Path
Week 1 → MCP basics + Ollama prompts.

Week 2 → Add RAG with Chroma.

Week 3 → Build multi‑agent orchestration with LangGraph.

Week 4 → Wrap MCP tools in LangChain.

Week 5 → Connect to Continue.dev for coding assistance.

Week 6 → Deploy with Docker.

🧩 Hands‑On Challenge
Try this mini‑project extension:

Upload a transcript.

MCP extracts tasks.

RAG retrieves similar past tasks.

Reviewer Agent compares new vs old tasks.

Output: “Recurring tasks detected” + “New tasks assigned.”

This will give you practical exposure to MCP + RAG + Multi‑Agent orchestration in one workflow.

👉 Do you want me to write a concrete “Week 1 hands‑on guide” (commands, code snippets, and exercises) so you can start practicing immediately with your current MCP setup?

yes
Perfect — let’s make Week 1 hands‑on learning with your MCP server very practical. The goal is to get comfortable with MCP basics + Ollama prompt engineering before layering in RAG, LangGraph, and multi‑agent orchestration later.

📅 Week 1 Hands‑On Guide
🎯 Learning Goals
Understand how MCP tools are defined and exposed.

Practice running your MCP server locally.

Experiment with Ollama prompts for extraction and summarization.

Learn how to debug JSON outputs and schema validation.

1. Run Your MCP Server
Make sure your .env file has the required values:

env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=youruser
SMTP_PASS=yourpass
SMTP_FROM=youruser@example.com

JIRA_HOST=jira.example.com
JIRA_USER=yourjirauser
JIRA_PASS=yourjirapass
JIRA_PROJECT_KEY=TEAM

OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=llama3
Then start the server:

bash
node main.js
You should see:

Code
Meeting Copilot MCP server started
2. Test Health Check
Run the health_check tool:

bash
curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3","prompt":"test"}'
Or call your MCP tool directly (depending on your integration).
👉 This verifies Ollama, Jira, and Email connectivity.

3. Experiment with Transcript Extraction
Take a sample transcript:

text
Alice: Please finish the report by Friday.
Bob: I’ll handle the client presentation next Monday.
Call your MCP tool:

bash
curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model":"llama3",
    "prompt":"Extract tasks from transcript into JSON array: [{\"assignee\":\"string\",\"task\":\"string\",\"due_date\":\"string\"}] Transcript: Alice: Please finish the report by Friday. Bob: I’ll handle the client presentation next Monday."
  }'
Expected output:

json
[
  {"assignee":"Alice","task":"Finish the report","due_date":"Friday"},
  {"assignee":"Bob","task":"Handle client presentation","due_date":"Monday"}
]
4. Play with Prompt Variations
Try changing the prompt:

Add summarization: “Summarize transcript in 3 bullet points.”

Add sentiment analysis: “Classify tone of transcript (positive/neutral/negative).”

Add meeting highlights: “Extract top 3 decisions made.”

👉 This teaches you prompt engineering and how Ollama responds to different instructions.

5. Debug JSON Outputs
Sometimes Ollama may return extra text. Your MCP code already normalizes JSON.
👉 Inspect normalizeOllamaText and parseTasksFromOllamaOutput — step through with console.log to see how fragments are cleaned.

6. Mini‑Challenge
Write a new MCP tool: summarize_transcript.

Schema: { transcript: string }.

Prompt: “Summarize transcript in 5 concise bullet points.”

Test with different transcripts.

✅ End of Week 1 Outcomes
You can run MCP locally.

You understand how tools are defined and exposed.

You’ve experimented with Ollama prompts.

You can debug JSON outputs.

You’ve added one new MCP tool (summarizer).

👉 Next week we’ll add RAG with Chroma so your MCP can search past transcripts before answering.

Would you like me to write the Week 2 guide (RAG integration) right after this so you can keep momentum?