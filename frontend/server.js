import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const serverScript = path.join(projectRoot, 'server.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function callMcpTool(toolName, args) {
    const transport = new StdioClientTransport({
        command: 'node',
        args: [serverScript],
        cwd: projectRoot,
        env: process.env,
    });

    const client = new Client({ name: 'meeting-copilot-web', version: '1.0.0' }, { capabilities: {} });
    console.log(`Calling MCP tool: ${toolName} with args:`, args);
    try {
        await client.connect(transport);
        const result = await client.callTool({
            name: toolName,
            arguments: args,
        });

        const textContent = result?.content?.[0]?.text ?? JSON.stringify(result);
        console.log(`MCP tool result for ${toolName}:`, textContent);
        try {
            return { ok: true, data: JSON.parse(textContent) };
        } catch {
            return { ok: true, data: textContent };
        }
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown MCP error',
        };
    } finally {
        await client.close();
    }
}

app.get('/api/health', async (_req, res) => {
    const result = await callMcpTool('health_check', {});
    if (!result.ok) {
        return res.status(500).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: result.data });
});

app.post('/api/extract', async (req, res) => {
    const transcript = String(req.body?.transcript || '').trim();

    if (!transcript) {
        return res.status(400).json({ success: false, error: 'Transcript is required.' });
    }
    console.log(`Received transcript for extraction: ${transcript.substring(0, 100)}...`);

    const result = await callMcpTool('extract_tasks_from_transcript', {
        transcript,
        model: process.env.OLLAMA_MODEL || 'llama3.2:1b',
    });

    if (!result.ok) {
        return res.status(500).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.data });
});

app.post('/api/create-follow-ups', async (req, res) => {
    const tasks = req.body?.tasks;

    if (!Array.isArray(tasks) || tasks.length === 0) {
        return res.status(400).json({ success: false, error: 'Tasks array is required.' });
    }

    const result = await callMcpTool('create_follow_up_tasks', {
        tasks,
        dryRun: Boolean(req.body?.dryRun),
    });

    if (!result.ok) {
        return res.status(500).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.data });
});

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Meeting Copilot frontend running at http://localhost:${PORT}`);
});
