require("dotenv").config(); // load environment variables from .env

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const nodemailer = require("nodemailer");
const JiraClient = require("jira-client");

const app = express();
const upload = multer({ dest: "transcripts/" });

// --- Load participant mapping ---
const participants = JSON.parse(fs.readFileSync("participants.json", "utf8"));
console.log("Loaded participants mapping:", participants);

// --- Configure Nodemailer ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    requireTLS: true
});

// --- Configure Jira Client ---
const jira = new JiraClient({
    protocol: "https",
    host: process.env.JIRA_HOST,
    username: process.env.JIRA_USER,
    password: process.env.JIRA_PASS, // or API token
    apiVersion: "2",
    strictSSL: true
});

function formatJiraDate(dateString) {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid due date: ${dateString}`);
    }

    return date.toISOString().slice(0, 10);
}

// --- Upload transcript ---
app.post("/upload", upload.single("transcript"), async (req, res) => {
    const filePath = req.file.path;
    console.log(`Received file: ${filePath}`);
    const transcript = fs.readFileSync(filePath, "utf8");
    console.log(`Received transcript: ${transcript.substring(0, 100)}...`);

    try {
        // --- Call Ollama for task extraction ---
        const response = await fetch("http://localhost:11434/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: process.env.OLLAMA_MODEL || "llama3.2:3b",
                prompt: `Extract tasks from this transcript:\n${transcript}\nRespond ONLY with a valid JSON array of objects. Each object must have: "assignee", "task", "due_date". Use curly braces {} for objects. Do not include any text outside the JSON.`
            })
        });

        // Ollama streams line-by-line JSON fragments
        const reader = response.body.getReader();
        let fullText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = new TextDecoder().decode(value);

            for (const line of chunk.split("\n")) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.response) {
                        fullText += parsed.response; // accumulate fragments
                    }
                } catch (err) {
                    console.error("Skipping invalid line:", line);
                }
            }
        }

        console.log("Collected Ollama response:", fullText);

        // --- Parse Ollama output ---
        let tasks = [];
        try {
            // Split concatenated objects by pattern "} {"
            const rawObjects = fullText
                .split(/}\s*{/)
                .map((chunk, index, arr) => {
                    if (!chunk.trim()) return null;
                    // Add braces back
                    if (index === 0 && !chunk.trim().startsWith("{")) chunk = "{" + chunk;
                    if (index === arr.length - 1 && !chunk.trim().endsWith("}")) chunk = chunk + "}";
                    if (index > 0 && !chunk.trim().startsWith("{")) chunk = "{" + chunk;
                    if (index < arr.length - 1 && !chunk.trim().endsWith("}")) chunk = chunk + "}";
                    return chunk;
                })
                .filter(Boolean);

            for (const objStr of rawObjects) {
                try {
                    const obj = JSON.parse(objStr);
                    if (obj.assignee && obj.task && obj.due_date) {
                        tasks.push(obj);
                    }
                } catch (err) {
                    console.error("Skipping invalid JSON object:", objStr);
                }
            }
        } catch (err) {
            console.error("Failed to process Ollama output:", fullText);
            return res.status(500).json({ error: "Invalid Ollama output" });
        }

        if (!Array.isArray(tasks) || tasks.length === 0) {
            return res.status(500).json({ error: "No valid tasks extracted from Ollama output" });
        }

        console.log("Parsed tasks:", tasks);

        // --- Process tasks ---
        for (const task of tasks) {
            const participant = participants[task.assignee];
            if (!participant) {
                console.warn(`No mapping found for ${task.assignee}`);
                continue;
            }
            console.log(`Processing task for ${participant.email}: ${task.task} (due ${task.due_date})`);

            // --- Send Email ---
            await transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: participant.email,
                subject: "Meeting Action Items",
                text: `Task: ${task.task}\nDue: ${task.due_date}`
            });
            console.log(`Email sent to ${participant.email}`);

            // --- Create Jira Issue ---
            await jira.addNewIssue({
                fields: {
                    project: { key: process.env.JIRA_PROJECT_KEY || "TEAM" },
                    summary: task.task,
                    description: `Task from meeting transcript`,
                    assignee: { name: participant.jira_user },
                    duedate: formatJiraDate(task.due_date),
                    issuetype: { name: "Task" }
                }
            });
        }

        res.json({ status: "success", tasks });
    } catch (err) {
        console.error("Error in /upload:", err);
        res.status(500).json({ error: err.message });
    }
});




app.get("/jira-test", async (req, res) => {
    try {
        console.log("Jira host:", process.env.JIRA_HOST);
        console.log("Jira user:", process.env.JIRA_USER);
        console.log("Jira project:", process.env.JIRA_PROJECT_KEY);

        const project = await jira.getProject(
            process.env.JIRA_PROJECT_KEY
        );

        res.json({
            success: true,
            project: {
                id: project.id,
                key: project.key,
                name: project.name
            }
        });
    } catch (err) {
        console.error("Jira project test failed:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get("/jira-user-test", async (req, res) => {
    try {
        const user = await jira.getCurrentUser();

        res.json({
            success: true,
            user: {
                accountId: user.accountId,
                displayName: user.displayName,
                emailAddress: user.emailAddress
            }
        });
    } catch (err) {
        console.error("Jira user test failed:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.listen(process.env.PORT || 3000, () =>
    console.log(`MCP server running on port ${process.env.PORT || 3000}`)
);
