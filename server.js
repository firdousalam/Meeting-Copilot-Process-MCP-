import dotenv from "dotenv";
import fs from "node:fs";
import nodemailer from "nodemailer";
import JiraClient from "jira-client";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));
dotenv.config({ path: `${projectRoot}.env` });

const participants = JSON.parse(
    fs.readFileSync(new URL("./participants.json", import.meta.url), "utf8")
);

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT || "587", 10),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    requireTLS: true,
});

const jira = new JiraClient({
    protocol: "https",
    host: process.env.JIRA_HOST,
    username: process.env.JIRA_USER,
    password: process.env.JIRA_PASS,
    apiVersion: "2",
    strictSSL: true,
});

const taskSchema = z.object({
    assignee: z.string(),
    task: z.string(),
    due_date: z.string(),
});

const server = new McpServer({
    name: "meeting-copilot",
    version: "1.0.0",
});

function formatJiraDate(dateString) {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid due date: ${dateString}`);
    }

    return date.toISOString().slice(0, 10);
}

function normalizeOllamaText(rawText) {
    if (!rawText) return "";

    const lines = rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const fragments = [];

    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            if (parsed?.response) {
                fragments.push(parsed.response);
            } else if (typeof parsed === "string") {
                fragments.push(parsed);
            } else if (parsed && typeof parsed === "object") {
                fragments.push(JSON.stringify(parsed));
            }
        } catch {
            fragments.push(line);
        }
    }

    return fragments
        .join("")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
}

function parseTasksFromOllamaOutput(rawText) {
    const normalized = normalizeOllamaText(rawText);
    if (!normalized) return [];

    const candidateValues = [normalized];

    const arrayStart = normalized.indexOf("[");
    const arrayEnd = normalized.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
        candidateValues.push(normalized.slice(arrayStart, arrayEnd + 1));
    }

    const objectStart = normalized.indexOf("{");
    const objectEnd = normalized.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
        candidateValues.push(normalized.slice(objectStart, objectEnd + 1));
    }

    const seen = new Set();
    const tasks = [];

    for (const candidate of candidateValues) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);

        try {
            const parsed = JSON.parse(candidate);
            const list = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of list) {
                if (item?.assignee && item?.task) {
                    tasks.push({
                        ...item,
                        due_date: item?.due_date ?? "TBD",
                    });
                }
            }
            if (tasks.length) return tasks;
        } catch {
            // fall through and try fragmented object parsing
        }

        const splitCandidates = candidate
            .split(/}\s*\{/) 
            .map((chunk, index, arr) => {
                if (!chunk.trim()) return null;
                let value = chunk.trim();
                if (index === 0 && !value.startsWith("{")) value = `{${value}`;
                if (index === arr.length - 1 && !value.endsWith("}")) value = `${value}}`;
                if (index > 0 && !value.startsWith("{")) value = `{${value}`;
                if (index < arr.length - 1 && !value.endsWith("}")) value = `${value}}`;
                return value;
            })
            .filter(Boolean);

        for (const splitCandidate of splitCandidates) {
            try {
                const parsed = JSON.parse(splitCandidate);
                if (parsed?.assignee && parsed?.task) {
                    tasks.push({
                        ...parsed,
                        due_date: parsed?.due_date ?? "TBD",
                    });
                }
            } catch {
                // ignore partial fragments
            }
        }
    }

    return tasks;
}

server.tool(
    "extract_tasks_from_transcript",
    "Extract meeting action items from a transcript and return structured tasks.",
    {
        transcript: z.string(),
        model: z.string().optional().default(process.env.OLLAMA_MODEL || "llama2:latest"),
    },
    async ({ transcript, model }) => {
        const url = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                stream: false,
                options: {
                    temperature: 0,
                    top_p: 0.1,
                },
                prompt: `You are an extraction engine. Extract action items from the transcript into a JSON array. Keep ONLY valid JSON. Use this exact schema: [{"assignee":"string","task":"string","due_date":"string"}] . Do not add commentary. If a due date is not explicit, infer it from the transcript text (examples: Friday, Thursday, end of week, next Monday). Transcript:\n${transcript}`,
            }),
        });

        if (!response.ok) {
            throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
        }

        const responsePayload = await response.json();
        const raw = responsePayload?.response || JSON.stringify(responsePayload);
        const tasks = parseTasksFromOllamaOutput(raw);

        if (!tasks.length) {
            throw new Error("No valid tasks were extracted from the transcript.");
        }

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(tasks, null, 2),
                },
            ],
        };
    }
);

server.tool(
    "create_follow_up_tasks",
    "Create Jira issues and send email follow-ups for extracted meeting tasks.",
    {
        tasks: z.array(taskSchema).min(1),
        dryRun: z.boolean().optional().default(false),
    },
    async ({ tasks, dryRun }) => {
        const created = [];

        for (const task of tasks) {
            const participant = participants[task.assignee];

            if (!participant) {
                created.push({
                    assignee: task.assignee,
                    status: "skipped",
                    reason: "No participant mapping found",
                });
                continue;
            }

            if (!dryRun) {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || process.env.SMTP_USER,
                    to: participant.email,
                    subject: "Meeting Action Items",
                    text: `Task: ${task.task}\nDue: ${task.due_date}`,
                });

                await jira.addNewIssue({
                    fields: {
                        project: { key: process.env.JIRA_PROJECT_KEY || "TEAM" },
                        summary: task.task,
                        description: "Task created from meeting transcript",
                        assignee: { name: participant.jira_user },
                        duedate: formatJiraDate(task.due_date),
                        issuetype: { name: "Task" },
                    },
                });
            }

            created.push({
                assignee: task.assignee,
                email: participant.email,
                jiraUser: participant.jira_user,
                task: task.task,
                dueDate: task.due_date,
                status: dryRun ? "dry-run" : "created",
            });
        }

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ created }, null, 2),
                },
            ],
        };
    }
);

server.tool(
    "test_jira_connection",
    "Check whether Jira can be reached and the configured project is valid.",
    {},
    async () => {
        const projectKey = process.env.JIRA_PROJECT_KEY || "TEAM";
        const project = await jira.getProject(projectKey);

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(
                        {
                            success: true,
                            project: {
                                id: project.id,
                                key: project.key,
                                name: project.name,
                            },
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

server.tool(
    "health_check",
    "Return the local health status of the integrated services.",
    {},
    async () => {
        const status = {
            ollama: "unknown",
            jira: "unknown",
            email: "unknown",
        };

        try {
            const response = await fetch(process.env.OLLAMA_URL || "http://localhost:11434/api/tags");
            status.ollama = response.ok ? "ok" : "error";
        } catch {
            status.ollama = "unavailable";
        }

        try {
            await jira.getProject(process.env.JIRA_PROJECT_KEY || "TEAM");
            status.jira = "ok";
        } catch {
            status.jira = "unavailable";
        }

        try {
            await transporter.verify();
            status.email = "ok";
        } catch {
            status.email = "unavailable";
        }

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(status, null, 2),
                },
            ],
        };
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Meeting Copilot MCP server started");
}

main().catch((error) => {
    console.error("MCP server startup failed:", error);
    process.exit(1);
});
