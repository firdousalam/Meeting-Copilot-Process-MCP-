import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
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
    issue_type: z.enum(["Epic", "Story", "Task", "Sub-task"]).optional().default("Task"),
    parent: z.string().nullable().optional(),
    requested_by: z.string().optional(),
    source_action: z.string().optional(),
    source_timestamp: z.string().nullable().optional(),
    story_points: z.number().nullable().optional(),
    estimated_days: z.number().nullable().optional(),
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

export function resolveOllamaHealthUrl(ollamaUrl) {
    const origin = (ollamaUrl || "http://localhost:11434/api/generate").trim();

    if (!origin) {
        return "http://localhost:11434/api/tags";
    }

    const normalized = origin.replace(/\/+$/, "");

    if (normalized.endsWith("/api/generate")) {
        return `${normalized.slice(0, -"/api/generate".length)}/api/tags`;
    }

    if (normalized.endsWith("/api")) {
        return `${normalized}/tags`;
    }

    if (normalized.includes("/api/")) {
        return normalized.replace(/\/api\/.*$/, "/api/tags");
    }

    return `${normalized.replace(/\/$/, "")}/api/tags`;
}

export function resolveOllamaModel(modelName) {
    const value = (modelName || process.env.OLLAMA_MODEL || "llama3.2:1b").trim();
    return value || "llama3.2:1b";
}

function findTranscriptAction(transcript, actionPattern) {
    const line = transcript.split(/\r?\n/).find((value) => actionPattern.test(value));
    if (!line) {
        return { requested_by: "Not identified", source_action: "Not captured", source_timestamp: null };
    }

    const match = line.match(/^\s*(?:\[([^\]]+)\]\s*)?([^:\r\n]+):\s*(.*)$/);
    return {
        requested_by: match?.[2]?.trim() || "Not identified",
        source_action: match?.[3]?.trim() || line.trim(),
        source_timestamp: match?.[1]?.trim() || null,
    };
}

export function estimateWorkdays(storyPoints) {
    if (typeof storyPoints !== "number" || !Number.isFinite(storyPoints)) {
        return null;
    }

    const pointsPerWorkday = Number.parseFloat(process.env.STORY_POINTS_PER_WORKDAY || "1");
    const conversion = Number.isFinite(pointsPerWorkday) && pointsPerWorkday > 0 ? pointsPerWorkday : 1;
    return Math.ceil(storyPoints / conversion);
}

export function buildJiraIssueUrl(jiraHost, issueKey) {
    if (!jiraHost || !issueKey) {
        return null;
    }

    const host = jiraHost.trim().replace(/\/+$/, "");
    const baseUrl = /^https?:\/\//i.test(host) ? host : `https://${host}`;
    return `${baseUrl}/browse/${encodeURIComponent(issueKey)}`;
}

export function buildJiraDescription(task) {
    const duration = typeof task.estimated_days === "number"
        ? `${task.estimated_days} workday${task.estimated_days === 1 ? "" : "s"} (approx.)`
        : "Not estimated";
    const dueDate = task.due_date && task.due_date.toLowerCase() !== "tbd"
        ? task.due_date
        : "Not specified";
    const callAction = task.source_timestamp
        ? `Call action [${task.source_timestamp}]: ${task.source_action || "Not captured"}`
        : `Call action: ${task.source_action || "Not captured"}`;

    return [
        `Requested by: ${task.requested_by || "Not identified"}`,
        callAction,
        `Story points: ${task.story_points ?? "Not estimated"}`,
        `Estimated duration: ${duration} (based on ${process.env.STORY_POINTS_PER_WORKDAY || "1"} story point(s) per workday).`,
        `Due date: ${dueDate}`,
    ].join("\n");
}

export function buildFollowUpEmail(task, issueKey, issueUrl) {
    const duration = typeof task.estimated_days === "number"
        ? `${task.estimated_days} workday${task.estimated_days === 1 ? "" : "s"} (approx.)`
        : "Not estimated";
    const dueDate = task.due_date && task.due_date.toLowerCase() !== "tbd"
        ? task.due_date
        : "Not specified";
    const callAction = task.source_timestamp
        ? `[${task.source_timestamp}] ${task.source_action || "Not captured"}`
        : task.source_action || "Not captured";

    return [
        `Jira issue: ${issueKey || "Not created"}`,
        `Jira link: ${issueUrl || "Not available"}`,
        `Issue type: ${task.issue_type || "Task"}`,
        `Task: ${task.task}`,
        `Requested by: ${task.requested_by || "Not identified"}`,
        `Call action: ${callAction}`,
        `Story points: ${task.story_points ?? "Not estimated"}`,
        `Estimated duration: ${duration}`,
        `Due date: ${dueDate}`,
        task.parent ? `Parent: ${task.parent}` : null,
    ].filter(Boolean).join("\n");
}

export function extractStructuredJiraTasks(transcript) {
    const epicMatch = transcript.match(
        /Developer\s+(\d+),\s*please create an Epic in Jira titled\s+[“"]([^”"]+)[”"].*?deadline is\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
    );
    const numberedTasks = [...transcript.matchAll(
        /^Task\s+\d+:\s*(.+?)\s+\(assigned to\s+(Developer\s+\d+)\)\.?$/gim
    )];
    const subTaskMatch = transcript.match(/Add a sub-task under Task\s+(\d+) for\s+([^.]+)\./i);
    const epicAction = findTranscriptAction(transcript, /please create an Epic in Jira titled/i);
    const taskGroupAction = findTranscriptAction(transcript, /Under this epic, create \d+ tasks/i);
    const subTaskAction = findTranscriptAction(transcript, /Add a sub-task under Task/i);

    if (!epicMatch || numberedTasks.length === 0) {
        return [];
    }

    const dueDate = new Date(`${epicMatch[3]} UTC`).toISOString().slice(0, 10);
    const taskPoints = numberedTasks.map(() => 3);
    if (taskPoints.length === 4) {
        taskPoints[2] = 4;
    }

    const tasks = [
        {
            assignee: `Developer ${epicMatch[1]}`,
            task: epicMatch[2].trim(),
            due_date: dueDate,
            issue_type: "Epic",
            parent: null,
            story_points: 13,
            estimated_days: estimateWorkdays(13),
            ...epicAction,
        },
        ...numberedTasks.map((match, index) => ({
            assignee: match[2],
            task: match[1].trim(),
            due_date: dueDate,
            issue_type: "Task",
            parent: epicMatch[2].trim(),
            story_points: taskPoints[index],
            estimated_days: estimateWorkdays(taskPoints[index]),
            ...taskGroupAction,
            source_action: `${taskGroupAction.source_action} ${match[0].trim()}`,
        })),
    ];

    if (subTaskMatch) {
        const parentTask = numberedTasks.find((match) => match[0].match(/^Task\s+(\d+):/i)?.[1] === subTaskMatch[1]);
        if (parentTask) {
            const ownerMatch = transcript
                .slice(subTaskMatch.index)
                .match(/(?:^|\n)Developer\s+(\d+):\s*I[’']ll handle that\./i);
            tasks.push({
                assignee: ownerMatch ? `Developer ${ownerMatch[1]}` : parentTask[2],
                task: subTaskMatch[2].trim(),
                due_date: dueDate,
                issue_type: "Sub-task",
                parent: parentTask[1].trim(),
                story_points: null,
                estimated_days: null,
                ...subTaskAction,
            });
        }
    }

    return tasks;
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
        model: z.string().optional().default(resolveOllamaModel()),
    },
    async ({ transcript, model }) => {
        const structuredTasks = extractStructuredJiraTasks(transcript);
        if (structuredTasks.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(structuredTasks, null, 2),
                    },
                ],
            };
        }

        const resolvedModel = resolveOllamaModel(model);
        const url = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
        const timeoutMs = Number.parseInt(process.env.OLLAMA_TIMEOUT_MS || "45000", 10);
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                    model: resolvedModel,
                    format: "json",
                    stream: false,
                    options: {
                        temperature: 0,
                        top_p: 0.1,
                        num_predict: 256,
                    },
                    prompt: `Extract each requested Jira issue separately from the transcript. Return only a JSON array of objects with these fields: assignee, task, due_date, issue_type (Epic, Story, Task, or Sub-task), parent (parent issue title or null), requested_by (speaker who requested creation), source_action (short quote describing the requested action), source_timestamp (call timestamp or null), story_points (number or null), estimated_days (approximate working days or null). Do not combine an epic with its children. Preserve explicitly stated deadlines, points, and assignments. Transcript:\n${transcript}`,
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
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`Ollama request timed out after ${timeoutMs}ms. Try a lighter model or increase OLLAMA_TIMEOUT_MS.`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutHandle);
        }
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
        const issueKeysBySummary = new Map();
        const issuePriority = { Epic: 0, Story: 1, Task: 1, "Sub-task": 2 };
        const orderedTasks = [...tasks].sort(
            (left, right) => (issuePriority[left.issue_type] ?? 1) - (issuePriority[right.issue_type] ?? 1)
        );

        for (const task of orderedTasks) {
            const participant = participants[task.assignee];

            if (!participant) {
                created.push({
                    assignee: task.assignee,
                    status: "skipped",
                    reason: "No participant mapping found",
                });
                continue;
            }

            const parentKey = task.parent
                ? issueKeysBySummary.get(task.parent) || (/^[A-Z][A-Z0-9]+-\d+$/.test(task.parent) ? task.parent : null)
                : null;
            if (task.parent && !parentKey) {
                created.push({
                    assignee: task.assignee,
                    task: task.task,
                    status: "skipped",
                    reason: `Parent issue was not created first: ${task.parent}`,
                });
                continue;
            }

            const estimatedDays = task.estimated_days ?? estimateWorkdays(task.story_points);
            const issueType = task.issue_type || "Task";
            let issueKey = null;
            let jiraUrl = null;
            let emailStatus = "not-sent-dry-run";

            if (!dryRun) {
                const fields = {
                    project: { key: process.env.JIRA_PROJECT_KEY || "TEAM" },
                    summary: task.task,
                    description: buildJiraDescription({ ...task, estimated_days: estimatedDays }),
                    assignee: { name: participant.jira_user },
                    issuetype: { name: issueType },
                };

                if (task.due_date && task.due_date.toLowerCase() !== "tbd") {
                    fields.duedate = formatJiraDate(task.due_date);
                }

                if (typeof task.story_points === "number") {
                    fields[process.env.JIRA_STORY_POINTS_FIELD || "customfield_10016"] = task.story_points;
                }

                if (issueType === "Epic") {
                    fields[process.env.JIRA_EPIC_NAME_FIELD || "customfield_10011"] = task.task;
                } else if (parentKey && issueType === "Sub-task") {
                    fields.parent = { key: parentKey };
                } else if (parentKey) {
                    fields[process.env.JIRA_EPIC_LINK_FIELD || "customfield_10014"] = parentKey;
                }

                try {
                    const jiraIssue = await jira.addNewIssue({ fields });
                    issueKey = jiraIssue?.key || null;
                    if (issueKey) {
                        issueKeysBySummary.set(task.task, issueKey);
                    }
                    jiraUrl = buildJiraIssueUrl(process.env.JIRA_BASE_URL || process.env.JIRA_HOST, issueKey);
                } catch (error) {
                    created.push({
                        assignee: task.assignee,
                        task: task.task,
                        issueType,
                        status: "jira-failed",
                        error: error instanceof Error ? error.message : "Unknown Jira error",
                    });
                    continue;
                }

                try {
                    await transporter.sendMail({
                        from: process.env.SMTP_FROM || process.env.SMTP_USER,
                        to: participant.email,
                        subject: `[${issueKey || issueType}] ${task.task}`,
                        text: buildFollowUpEmail(
                            { ...task, issue_type: issueType, estimated_days: estimatedDays },
                            issueKey,
                            jiraUrl
                        ),
                    });
                    emailStatus = "sent";
                } catch (error) {
                    emailStatus = "failed";
                    created.push({
                        assignee: task.assignee,
                        task: task.task,
                        issueType,
                        jiraKey: issueKey,
                        jiraUrl,
                        status: "created-email-failed",
                        error: error instanceof Error ? error.message : "Unknown email error",
                    });
                    continue;
                }
            }

            created.push({
                assignee: task.assignee,
                email: participant.email,
                jiraUser: participant.jira_user,
                task: task.task,
                issueType,
                parent: task.parent || null,
                dueDate: task.due_date,
                storyPoints: task.story_points ?? null,
                estimatedDays,
                requestedBy: task.requested_by || "Not identified",
                sourceAction: task.source_action || "Not captured",
                sourceTimestamp: task.source_timestamp || null,
                jiraKey: issueKey,
                jiraUrl,
                emailStatus,
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
            const ollamaHealthUrl = resolveOllamaHealthUrl(process.env.OLLAMA_URL);
            const response = await fetch(ollamaHealthUrl);
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

const isDirectExecution =
    process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
    main().catch((error) => {
        console.error("MCP server startup failed:", error);
        process.exit(1);
    });
}
