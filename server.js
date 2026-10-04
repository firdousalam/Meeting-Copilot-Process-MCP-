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

export function normalizeJiraHost(jiraHost) {
    if (!jiraHost) return jiraHost;
    const value = jiraHost.trim();
    try {
        return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname;
    } catch {
        return value.replace(/^https?:\/\//i, "").split("/")[0];
    }
}

const jira = new JiraClient({
    protocol: "https",
    host: normalizeJiraHost(process.env.JIRA_HOST),
    username: process.env.JIRA_USER,
    password: process.env.JIRA_PASS,
    apiVersion: "2",
    strictSSL: true,
});

const taskSchema = z.object({
    assignee: z.string(),
    task: z.string(),
    due_date: z.string(),
    issue_type: z.enum(["Epic", "Story", "Task", "Bug", "Sub-task"]).optional().default("Task"),
    parent: z.string().nullable().optional(),
    requested_by: z.string().optional(),
    source_action: z.string().optional(),
    source_timestamp: z.string().nullable().optional(),
    details: z.string().optional(),
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
    const lines = transcript.split(/\r?\n/);
    const lineIndex = lines.findIndex((value) =>
        actionPattern.test(value.replace(/\*\*/g, "").replace(/__/g, ""))
    );
    if (lineIndex < 0) {
        return { requested_by: "Not identified", source_action: "Not captured", source_timestamp: null };
    }

    const line = lines[lineIndex];
    const cleanLine = line.replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
    const match = cleanLine.match(/^\s*(?:\[([^\]]+)\]\s*)?([^:\r\n]+):\s*(.*)$/);
    let speaker = match?.[2]?.trim();
    let timestamp = match?.[1]?.trim() || null;
    if (!speaker) {
        for (let index = lineIndex - 1; index >= 0; index -= 1) {
            const headingLine = lines[index].replace(/^\s*#{1,6}\s*/, "").trim();
            const heading = headingLine.match(/^\[([^\]]+)\]\s*(.+)$/);
            if (heading) {
                timestamp = heading[1].trim();
                speaker = heading[2].trim().replace(/:$/, "");
                break;
            }
        }
    }
    const speakerIntroduction = speaker
        ? transcript.split(/\r?\n/)
            .map((value) => value.replace(/^\s*#{1,6}\s*/, "").trim())
            .map((value) => value.match(/^(?:\[[^\]]+\]\s*)?(.+?)\s*\(([^)]*)\)/))
            .find((introduction) => introduction && new RegExp(`\\b${speaker}\\b`, "i").test(introduction[2]))
        : null;
    return {
        requested_by: speakerIntroduction?.[1]?.trim() || speaker || "Not identified",
        source_action: match?.[3]?.trim() || cleanLine,
        source_timestamp: timestamp,
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

export function formatJiraError(error) {
    let details = error;
    if (error instanceof Error) {
        try {
            details = JSON.parse(error.message);
        } catch {
            return error.message || "Unknown Jira error";
        }
    }

    if (details && typeof details === "object") {
        const messages = [
            ...(Array.isArray(details.errorMessages) ? details.errorMessages : []),
            ...Object.entries(details.errors || {}).map(([field, message]) => `${field}: ${message}`),
        ];
        if (messages.length) return messages.join("; ");
        if (details.message) return String(details.message);
        return "Jira rejected issue creation without details. Check issue type availability, assignee identifier, required fields, and custom-field IDs.";
    }

    return String(details || "Unknown Jira error");
}

function isJiraCloudHost(jiraHost) {
    if (!jiraHost) return false;
    try {
        const url = new URL(/^https?:\/\//i.test(jiraHost) ? jiraHost : `https://${jiraHost}`);
        return url.hostname.toLowerCase().endsWith(".atlassian.net");
    } catch {
        return false;
    }
}

export function buildJiraAssignee(participant, jiraHost, accountId) {
    const resolvedAccountId = accountId || participant.jira_account_id;
    if (resolvedAccountId) {
        return { accountId: resolvedAccountId };
    }
    if (isJiraCloudHost(jiraHost)) {
        throw new Error("Jira Cloud assignees require an accountId; verify the participant email mapping or set jira_account_id.");
    }
    if (!participant.jira_user) {
        throw new Error("Jira username is not configured for this participant.");
    }
    return { name: participant.jira_user };
}

const jiraAccountIdsByEmail = new Map();

async function resolveJiraAssignee(participant) {
    const jiraHost = process.env.JIRA_HOST;
    if (!isJiraCloudHost(jiraHost) || participant.jira_account_id) {
        return buildJiraAssignee(participant, jiraHost);
    }
    if (!participant.email) {
        throw new Error("Participant email is required to resolve a Jira Cloud accountId.");
    }

    const email = participant.email.toLowerCase();
    let accountId = jiraAccountIdsByEmail.get(email);
    if (!accountId) {
        const matches = await jira.searchUsers({ query: participant.email, maxResults: 10 });
        const exactMatch = matches.find((user) => user.emailAddress?.toLowerCase() === email);
        const uniqueMatch = exactMatch || (matches.length === 1 ? matches[0] : null);
        accountId = uniqueMatch?.accountId;
        if (!accountId) {
            throw new Error(`Could not resolve one Jira Cloud account for ${participant.email}; add jira_account_id to participants.json.`);
        }
        jiraAccountIdsByEmail.set(email, accountId);
    }

    return buildJiraAssignee(participant, jiraHost, accountId);
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
        task.details ? `Details / acceptance criteria: ${task.details}` : null,
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
        task.details ? `Details / acceptance criteria: ${task.details}` : null,
        `Story points: ${task.story_points ?? "Not estimated"}`,
        `Estimated duration: ${duration}`,
        `Due date: ${dueDate}`,
        task.parent ? `Parent: ${task.parent}` : null,
    ].filter(Boolean).join("\n");
}

export function inferJiraIssueType(taskText, proposedType) {
    const supportedTypes = new Set(["Epic", "Story", "Task", "Bug", "Sub-task"]);
    if (supportedTypes.has(proposedType)) {
        return proposedType;
    }

    const text = String(taskText || "");
    if (/\b(epic)\b/i.test(text)) return "Epic";
    if (/\b(bug|defect)\b|\bfix(?:ing)?\s+(?:the\s+)?(?:issue|problem)\b/i.test(text)) return "Bug";
    if (/\b(story|stories)\b/i.test(text)) return "Story";
    if (/\b(task|tasks)\b/i.test(text)) return "Task";
    return "Task";
}

export function extractStructuredJiraTasks(transcript) {
    const cleanLine = (line) => line
        .replace(/^\s*#{1,6}\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/__/g, "")
        .replace(/`/g, "")
        .replace(/^\s*[-*+]\s+/, "")
        .trim();
    const lines = transcript.split(/\r?\n/).map((raw) => ({ raw, text: cleanLine(raw) }));
    const normalizedTranscript = lines.map(({ text }) => text).join("\n");
    const epicActionLine = lines.find(({ text }) => /please create an Epic in Jira titled/i.test(text));
    const epicTitleMatch = epicActionLine?.text.match(/titled\s+[“"]([^”"]+)[”"]/i);
    const epicAssigneeMatch = epicActionLine?.text.match(/Developer\s+(\d+),\s*please create/i);
    const epicTitle = epicTitleMatch?.[1]?.trim();
    const epicPointsMatch = normalizedTranscript.match(/^Epic\s*:\s*(\d+)\s+points?\b/im);
    const dueDateMatch = normalizedTranscript.match(/(?:deadline|due date|due|target(?: date)?)\s*(?:is|of|for|:)?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
    const dueDate = dueDateMatch
        ? new Date(`${dueDateMatch[1]} UTC`).toISOString().slice(0, 10)
        : "TBD";
    const pointsByTask = new Map();

    for (const { text } of lines) {
        const match = text.match(/^Task\s+(\d+)\s*[-–—:]\s*.*?:\s*(\d+)\s+points?\b/i);
        if (match) {
            pointsByTask.set(Number(match[1]), Number(match[2]));
        }
    }

    const tasks = [];
    const tasksByNumber = new Map();
    let currentTimestamp = null;
    let currentSpeaker = "Not identified";
    let currentAssignee = null;
    let currentAction = "Not captured";

    if (epicTitle && epicAssigneeMatch) {
        const action = findTranscriptAction(transcript, /please create an Epic in Jira titled/i);
        const storyPoints = epicPointsMatch ? Number(epicPointsMatch[1]) : null;
        tasks.push({
            assignee: `Developer ${epicAssigneeMatch[1]}`,
            task: epicTitle,
            due_date: dueDate,
            issue_type: "Epic",
            parent: null,
            story_points: storyPoints,
            estimated_days: estimateWorkdays(storyPoints),
            ...action,
        });
    }

    for (const { text } of lines) {
        const heading = text.match(/^\[([^\]]+)\]\s*([^:]+?)(?:\s*:\s*(.*))?$/);
        if (heading) {
            currentTimestamp = heading[1].trim();
            currentSpeaker = heading[2].trim();
            currentAssignee = null;
            currentAction = heading[3]?.trim() || text;
        }

        const assignmentContext = text.match(/Developer\s+(\d+),.*?\bplease\s+(?:take|handle|own)/i);
        if (assignmentContext) {
            currentAssignee = `Developer ${assignmentContext[1]}`;
            currentAction = text;
        } else if (/please (?:take|handle|own|create|add|implement)|under this epic, create/i.test(text)) {
            currentAction = text;
        }

        const taskMatch = text.match(/^Task\s+(\d+)\s*:\s*(.+)$/i);
        if (!taskMatch) {
            continue;
        }

        const taskNumber = Number(taskMatch[1]);
        let title = taskMatch[2].trim();
        let assignee = currentAssignee;
        const parentheticalAssignee = title.match(/\s*\(assigned to\s+(Developer\s+\d+)\)\.?$/i);
        const suffixAssignee = title.match(/\s*[—–-]\s*assigned to\s+(Developer\s+\d+)\.?$/i);
        const taskAssignee = parentheticalAssignee || suffixAssignee;
        if (taskAssignee) {
            assignee = taskAssignee[1];
            title = title.slice(0, taskAssignee.index).trim();
        }
        title = title.replace(/[.]$/, "").trim();

        if (!assignee) {
            continue;
        }

        const storyPoints = pointsByTask.get(taskNumber) ?? null;
        const requester = currentSpeaker === "Host"
            ? findTranscriptAction(transcript, /please create an Epic in Jira titled/i).requested_by
            : currentSpeaker.replace(/\s*[–—-]\s*(?:Manager|Host|Developer\s+\d+)$/i, "");
        const task = {
            assignee,
            task: title,
            due_date: dueDate,
            issue_type: "Task",
            parent: epicTitle || null,
            story_points: storyPoints,
            estimated_days: estimateWorkdays(storyPoints),
            requested_by: requester,
            source_action: `${currentAction} ${text}`.trim(),
            source_timestamp: currentTimestamp,
        };
        tasks.push(task);
        tasksByNumber.set(taskNumber, task);
    }

    const subTaskMatch = normalizedTranscript.match(/Add a sub-task under Task\s+(\d+) for\s+([^.]+)\./i);
    if (subTaskMatch) {
        const parentTask = tasksByNumber.get(Number(subTaskMatch[1]));
        if (parentTask) {
            const subTaskAction = findTranscriptAction(transcript, /Add a sub-task under Task/i);
            tasks.push({
                assignee: parentTask.assignee,
                task: subTaskMatch[2].trim(),
                due_date: dueDate,
                issue_type: "Sub-task",
                parent: parentTask.task,
                story_points: null,
                estimated_days: null,
                requested_by: parentTask.requested_by,
                ...subTaskAction,
                source_action: subTaskAction.source_action || subTaskMatch[0],
            });
        }
    }

    return tasks;
}

export function extractNarrativeMeetingStories(transcript) {
    const cleanLine = (line) => line
        .replace(/^\s*#{1,6}\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/__/g, "")
        .replace(/`/g, "")
        .trim();
    const lines = transcript.split(/\r?\n/).map(cleanLine);
    const normalizedTranscript = lines.join("\n");
    const deadlineMatch = normalizedTranscript.match(
        /target\s+(?:date\s+)?(?:is\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})|deadline\s+(?:is\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
    );
    const dueDateValue = deadlineMatch?.[1] || deadlineMatch?.[2];
    const dueDate = dueDateValue
        ? new Date(`${dueDateValue} UTC`).toISOString().slice(0, 10)
        : "TBD";

    const metadataAt = (lineIndex) => {
        for (let index = lineIndex; index >= 0; index -= 1) {
            const heading = lines[index].match(/^\[([^\]]+)\]\s*(.+)$/);
            if (heading) {
                return {
                    requested_by: heading[2].replace(/\s*[–—-]\s*Manager$/i, "").trim(),
                    source_timestamp: heading[1].trim(),
                };
            }
        }
        return { requested_by: "Not identified", source_timestamp: null };
    };
    const pointValuesFor = (developerNumber) => {
        const line = lines.find((value) =>
            new RegExp(`Developer ${developerNumber},`).test(value) && /\bpoints?\b/i.test(value)
        );
        if (!line) return [];

        const storySeries = line.match(/stories should be roughly\s+(.+?)\s+points?/i);
        const pointText = storySeries?.[1] || line.slice(line.indexOf(",") + 1);
        return [...pointText.matchAll(/\b(\d+)\b/g)].map((match) => Number(match[1]));
    };
    const developerPoints = new Map([1, 2, 3].map((number) => [number, pointValuesFor(number)]));
    const stories = [];
    const addStory = ({ assignee, task, points, lineIndex, sourceAction, details }) => {
        const metadata = metadataAt(lineIndex);
        stories.push({
            assignee,
            task,
            due_date: dueDate,
            issue_type: inferJiraIssueType(task, "Story"),
            parent: null,
            story_points: points ?? null,
            estimated_days: estimateWorkdays(points ?? null),
            ...metadata,
            source_action: sourceAction,
            details,
        });
    };

    const storyListIndex = lines.findIndex((line) => /That gives you three stories:/i.test(line));
    if (storyListIndex >= 0 && /Firdous, I want you to take ownership of the API performance investigation/i.test(normalizedTranscript)) {
        const storyLines = [];
        for (let index = storyListIndex + 1; index < lines.length && storyLines.length < 3; index += 1) {
            const storyLine = lines[index].match(/^\d+\.\s*(.+?)\.?$/);
            if (storyLine) storyLines.push({ task: storyLine[1].trim(), lineIndex: index });
        }

        const points = developerPoints.get(1) || [];
        const details = [
            "Create an upload API performance baseline, identify the three slowest operations, and document findings.",
            "Move synchronous document metadata processing to a background worker that returns a request ID.",
            "Compare old and new API response times with automated performance tests; include an upload-to-background-processing integration test.",
        ];
        storyLines.forEach((story, index) => addStory({
            assignee: "Developer 1",
            task: story.task,
            points: points[index],
            lineIndex: story.lineIndex,
            sourceAction: story.task,
            details: details[index],
        }));
    }

    const retryRequestIndex = lines.findIndex((line) => /Developer 2, I want you to own the reliability work/i.test(line));
    if (retryRequestIndex >= 0) {
        const points = developerPoints.get(2) || [];
        addStory({
            assignee: "Developer 2",
            task: "Implement configurable retry handling with exponential backoff",
            points: points[0],
            lineIndex: retryRequestIndex,
            sourceAction: lines.slice(retryRequestIndex, retryRequestIndex + 4).join(" "),
            details: "Use configurable retry limits and exponential backoff delays. Cover temporary downstream failures, retry exhaustion, successful recovery, and environment-based configuration.",
        });
        addStory({
            assignee: "Developer 2",
            task: "Implement dead-letter handling for exhausted document-processing jobs",
            points: points[1],
            lineIndex: retryRequestIndex,
            sourceAction: lines.slice(retryRequestIndex, retryRequestIndex + 4).join(" "),
            details: "Move jobs to a dead-letter queue after the maximum retries and test failure-recovery handling.",
        });

        const idempotencyIndex = lines.findIndex((line) => /Please make that a separate Jira story/i.test(line));
        if (idempotencyIndex >= 0 && /Developer 2, can you look at idempotency/i.test(normalizedTranscript)) {
            addStory({
                assignee: "Developer 2",
                task: "Prevent duplicate document processing with idempotency keys",
                points: points[2],
                lineIndex: idempotencyIndex,
                sourceAction: lines.slice(Math.max(0, idempotencyIndex - 2), idempotencyIndex + 1).join(" "),
                details: "Use the document request ID as an idempotency key and persist processing state so duplicate message delivery does not process a document twice.",
            });
        }
    }

    const monitoringRequestIndex = lines.findIndex((line) => /Developer 3, I want three things from you/i.test(line));
    if (monitoringRequestIndex >= 0) {
        const points = developerPoints.get(3) || [];
        const details = [
            "Capture request ID, processing duration, status, and failure reason in structured logs; add monitoring validation tests.",
            "Create duration, success-rate, and failure-rate metrics and dashboards for the document processing lifecycle.",
            "Use a 5% failure rate over a 10-minute window threshold. Include request ID and failure category in alerts, and add alert validation tests.",
        ];
        const taskSummaries = [
            "Standardize structured logs for document processing",
            "Create document processing metrics and dashboards",
            "Configure alerts for document processing failures",
        ];
        for (let offset = 0; offset < 3; offset += 1) {
            addStory({
                assignee: "Developer 3",
                task: taskSummaries[offset],
                points: points[offset],
                lineIndex: monitoringRequestIndex,
                sourceAction: lines.slice(monitoringRequestIndex, monitoringRequestIndex + 4).join(" "),
                details: details[offset],
            });
        }

        const asyncMonitoringIndex = lines.findIndex((line) => /Developer 3, add another story to update the monitoring events/i.test(line));
        if (asyncMonitoringIndex >= 0) {
            addStory({
                assignee: "Developer 3",
                task: "Update monitoring events for the asynchronous processing workflow",
                points: points[3],
                lineIndex: asyncMonitoringIndex,
                sourceAction: lines[asyncMonitoringIndex],
                details: "Track Uploaded, Queued, Processing, Completed, and Failed states, distinguishing API response time from processing duration.",
            });
        }
    }

    return stories;
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

export function parseTasksFromOllamaOutput(rawText) {
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
                if (isActionableTask(item)) {
                    tasks.push({
                        ...item,
                        issue_type: inferJiraIssueType(item.task, item.issue_type),
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
                if (isActionableTask(parsed)) {
                    tasks.push({
                        ...parsed,
                        issue_type: inferJiraIssueType(parsed.task, parsed.issue_type),
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

function isActionableTask(item) {
    const placeholder = /^(?:string|assignee|task|due_date|n\/a|none|null|example|optional)$/i;
    return typeof item?.assignee === "string"
        && typeof item?.task === "string"
        && !placeholder.test(item.assignee.trim())
        && !placeholder.test(item.task.trim());
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

        const narrativeStories = extractNarrativeMeetingStories(transcript);
        if (narrativeStories.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(narrativeStories, null, 2),
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
                    prompt: `Extract each requested Jira issue separately from the transcript. Return only a JSON array of objects with these fields: assignee, task, due_date, issue_type (Epic, Story, Task, Bug, or Sub-task), parent (parent issue title or null), requested_by (speaker who requested creation), source_action (short quote describing the requested action), source_timestamp (call timestamp or null), details (requirements and acceptance criteria), story_points (number or null), estimated_days (approximate working days or null). Do not combine issues. Preserve explicitly stated issue types, deadlines, points, acceptance criteria, and assignments. If the call explicitly asks for a bug/defect to be logged, use issue_type Bug; use Story for work described as stories and Task for work described as tasks. Transcript:\n${transcript}`,
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
        const issuePriority = { Epic: 0, Story: 1, Task: 1, Bug: 1, "Sub-task": 2 };
        const orderedTasks = [...tasks].sort(
            (left, right) => (issuePriority[left.issue_type] ?? 1) - (issuePriority[right.issue_type] ?? 1)
        );

        if (!dryRun) {
            try {
                await transporter.verify();
            } catch (error) {
                return {
                    isError: true,
                    content: [{
                        type: "text",
                        text: `SMTP verification failed before Jira creation; no new issues were created. Check SMTP_HOST, SMTP_PORT, SMTP_USER (provider login), and SMTP_PASS (provider SMTP key). ${error instanceof Error ? error.message : String(error)}`,
                    }],
                };
            }
        }

        console.log(`Creating ${orderedTasks.length} Jira issues (dryRun=${dryRun})...`);
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

                if (typeof task.story_points === "number" && process.env.JIRA_STORY_POINTS_FIELD) {
                    fields[process.env.JIRA_STORY_POINTS_FIELD] = task.story_points;
                }

                if (issueType === "Epic") {
                    fields[process.env.JIRA_EPIC_NAME_FIELD || "customfield_10011"] = task.task;
                } else if (parentKey && issueType === "Sub-task") {
                    fields.parent = { key: parentKey };
                } else if (parentKey) {
                    fields[process.env.JIRA_EPIC_LINK_FIELD || "customfield_10014"] = parentKey;
                }
                console.log(`Creating Jira issue for task: ${task.task} (assignee: ${task.assignee}, type: ${issueType})`);
                try {
                    fields.assignee = await resolveJiraAssignee(participant);
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
                        error: formatJiraError(error),
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
