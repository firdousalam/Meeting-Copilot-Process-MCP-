import dotenv from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const transcriptPath = path.join(projectRoot, "transcripts", "sample-meeting.txt");
const transcript = fs.readFileSync(transcriptPath, "utf8");

const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(projectRoot, "server.js")],
    cwd: projectRoot,
    env: process.env,
});

const client = new Client({ name: "meeting-copilot-smoke-test", version: "1.0.0" }, { capabilities: {} });

try {
    await client.connect(transport);
    const result = await client.callTool({
        name: "extract_tasks_from_transcript",
        arguments: {
            transcript,
            model: process.env.OLLAMA_MODEL || "llama2:latest"
        }
    });

    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    console.error("MCP smoke test failed:");
    console.error(error);
    process.exitCode = 1;
} finally {
    await client.close();
}
