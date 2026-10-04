import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
    extractNarrativeMeetingStories,
    extractStructuredJiraTasks,
    inferJiraIssueType,
    parseTasksFromOllamaOutput,
    resolveOllamaHealthUrl,
    resolveOllamaModel,
} from '../server.js';

test('resolveOllamaHealthUrl uses the Ollama tags endpoint for health checks', () => {
    assert.equal(
        resolveOllamaHealthUrl('http://localhost:11434/api/generate'),
        'http://localhost:11434/api/tags'
    );

    assert.equal(
        resolveOllamaHealthUrl('http://localhost:11434/api/generate/'),
        'http://localhost:11434/api/tags'
    );

    assert.equal(
        resolveOllamaHealthUrl('http://localhost:11434'),
        'http://localhost:11434/api/tags'
    );
});

test('resolveOllamaModel prefers a lightweight default model for faster task extraction', () => {
    assert.equal(resolveOllamaModel('llama2:latest'), 'llama2:latest');
    assert.equal(resolveOllamaModel(''), 'llama3.2:1b');
    assert.equal(resolveOllamaModel(undefined), 'llama3.2:1b');
});

test('extractStructuredJiraTasks handles Markdown assignments and a separate story-point list', () => {
    const transcript = `
### [00:01] Technophile Firdous (Host, Project Manager)
Welcome everyone.
### [00:12] Host
Developer 1, please create an **Epic** in Jira titled **“Implement RBAC for MCP”** and assign it to yourself. The deadline is **October 15, 2026**.
### [00:15] Host
Under this epic, create the following tasks:
* **Task 1:** Design RBAC schema — assigned to **Developer 2**.
* **Task 2:** Implement role validation middleware — assigned to **Developer 2**.
* **Task 3:** Integrate RBAC checks into transcript processing — assigned to **Developer 3**.
* **Task 4:** Add RBAC enforcement in email + Jira modules — assigned to **Developer 3**.
### [00:20] Host
Developer 1, please take these additional tasks:
* **Task 5:** Create RBAC permission model documentation.
* **Task 6:** Integrate RBAC configuration with the MCP Gateway.
Developer 2, in addition to the two RBAC tasks, please handle:
* **Task 7:** Add unit tests for RBAC middleware and permission validation.
* **Task 8:** Update email notification handling to respect RBAC authorization failures.
Developer 3, after completing the transcript and module-level RBAC integration, please handle:
* **Task 9:** Add Jira validation and error handling for unauthorized operations.
* **Task 10:** Create integration tests covering RBAC checks across transcript, email, and Jira workflows.
### [00:25] Host
Since the epic deadline is **October 15, 2026**, let's distribute the work as follows:
* **Epic:** 13 points
* Task 1 – Design RBAC schema: **3 points**
* Task 2 – Implement role validation middleware: **5 points**
* Task 3 – RBAC checks in transcript processing: **5 points**
* Task 4 – RBAC enforcement in email + Jira: **5 points**
* Task 5 – RBAC permission model documentation: **2 points**
* Task 6 – MCP Gateway RBAC configuration: **5 points**
* Task 7 – RBAC middleware unit tests: **3 points**
* Task 8 – RBAC in email authorization handling: **3 points**
* Task 9 – Jira authorization validation/error handling: **3 points**
* Task 10 – End-to-end RBAC integration tests: **5 points**
`;

    const tasks = extractStructuredJiraTasks(transcript);

    assert.equal(tasks.length, 11);
    assert.equal(tasks[0].issue_type, 'Epic');
    assert.equal(tasks[0].task, 'Implement RBAC for MCP');
    assert.equal(tasks[0].requested_by, 'Technophile Firdous');
    assert.ok(tasks.slice(1).every(({ requested_by }) => requested_by === 'Technophile Firdous'));
    assert.deepEqual(tasks.slice(1).map(({ assignee }) => assignee), [
        'Developer 2', 'Developer 2', 'Developer 3', 'Developer 3',
        'Developer 1', 'Developer 1', 'Developer 2', 'Developer 2',
        'Developer 3', 'Developer 3',
    ]);
    assert.deepEqual(tasks.slice(1).map(({ story_points }) => story_points), [3, 5, 5, 5, 2, 5, 3, 3, 3, 5]);
    assert.deepEqual(tasks.map(({ due_date }) => due_date), Array(11).fill('2026-10-15'));
    assert.equal(tasks[5].task, 'Create RBAC permission model documentation');
    assert.equal(tasks[5].source_timestamp, '00:20');
});

test('parseTasksFromOllamaOutput rejects schema-example placeholders', () => {
    assert.deepEqual(
        parseTasksFromOllamaOutput('[{"assignee":"string","task":"string","due_date":"string"}]'),
        []
    );
});

test('inferJiraIssueType supports Epic, Story, Task, and Bug records', () => {
    assert.equal(inferJiraIssueType('Implement RBAC', 'Epic'), 'Epic');
    assert.equal(inferJiraIssueType('API performance analysis', 'Story'), 'Story');
    assert.equal(inferJiraIssueType('Update retry configuration', 'Task'), 'Task');
    assert.equal(inferJiraIssueType('Log the confirmed upload defect'), 'Bug');
    assert.equal(inferJiraIssueType('Implement a bug triage workflow', 'Story'), 'Story');
});

test('extractStructuredJiraTasks returns the epic and each numbered child task separately', () => {
    const transcript = `
Host: Developer 1, please create an Epic in Jira titled “Implement RBAC for MCP” and assign it to yourself. The deadline is October 15, 2026.
Under this epic, create 4 tasks:
Task 1: Design RBAC schema (assigned to Developer 2).
Task 2: Implement role validation middleware (assigned to Developer 2).
Task 3: Integrate RBAC checks into transcript processing (assigned to Developer 3).
Task 4: Add RBAC enforcement in email + Jira modules (assigned to Developer 3).
Host: Add a sub-task under Task 2 for logging and monitoring.
Developer 2: I’ll handle that.
`;

    const tasks = extractStructuredJiraTasks(transcript);

    assert.equal(tasks.length, 6);
    assert.deepEqual(tasks.map(({ issue_type }) => issue_type), [
        'Epic',
        'Task',
        'Task',
        'Task',
        'Task',
        'Sub-task',
    ]);
    assert.deepEqual(tasks.slice(1, 5).map(({ assignee }) => assignee), [
        'Developer 2',
        'Developer 2',
        'Developer 3',
        'Developer 3',
    ]);
    assert.deepEqual(tasks.slice(1, 5).map(({ task }) => task), [
        'Design RBAC schema',
        'Implement role validation middleware',
        'Integrate RBAC checks into transcript processing',
        'Add RBAC enforcement in email + Jira modules',
    ]);
    assert.equal(tasks[5].assignee, 'Developer 2');
    assert.equal(tasks[5].task, 'logging and monitoring');
    assert.equal(tasks[5].parent, 'Implement role validation middleware');
    assert.equal(tasks[5].source_action, 'Add a sub-task under Task 2 for logging and monitoring.');
    assert.deepEqual(tasks.map(({ due_date }) => due_date), Array(6).fill('2026-10-15'));
    assert.deepEqual(tasks.map(({ story_points }) => story_points), Array(6).fill(null));
});

test('extractNarrativeMeetingStories maps spoken ownership, point estimates, and the project deadline', async () => {
    const transcript = `
### [00:09] Technophile Firdous – Manager
Firdous, I want you to take ownership of the API performance investigation.
Please create a performance baseline for the current upload API, identify the top three slow operations, and document the findings.
After that, refactor the synchronous metadata processing so it can run asynchronously.
### [00:12] Technophile Firdous – Manager
That gives you three stories:
1. API performance analysis and baseline.
2. Asynchronous document metadata processing.
3. Automated API performance testing.
### [00:21] Technophile Firdous – Manager
Developer 2, I want you to own the reliability work.
First, implement the retry mechanism with configurable retry limits.
Second, implement the dead-letter handling for jobs that continue to fail.
Third, add automated tests covering temporary failures, retry exhaustion, and successful recovery.
### [00:24] Technophile Firdous – Manager
Please include environment-based retry configuration as part of the retry story.
### [00:36] Technophile Firdous – Manager
Developer 2, can you look at idempotency for the worker?
### [00:38] Technophile Firdous – Manager
Please make that a separate Jira story so we can track it independently.
### [00:29] Technophile Firdous – Manager
Developer 3, I want three things from you.
First, standardize the application logs for document processing.
Second, create metrics for processing duration, success rate, and failure rate.
Third, configure alerts when the failure rate crosses an agreed threshold.
### [00:32] Technophile Firdous – Manager
Start with 5% failure rate over a 10-minute window. Include request ID and failure category in the alert.
### [00:41] Technophile Firdous – Manager
Developer 3, add another story to update the monitoring events for the new asynchronous workflow.
### [00:49] Technophile Firdous – Manager
Let's target October 12, 2026 for development completion.
Developer 1, your performance stories should be roughly 3, 5, and 3 points.
Developer 2, use 5 points for retry handling, 3 points for dead-letter processing, and 3 points for idempotency.
Developer 3, use 3 points for structured logging, 5 points for metrics and dashboards, and 3 points for alerting. The asynchronous monitoring update can be 3 additional points.
`;

    const stories = extractNarrativeMeetingStories(transcript);

    assert.equal(stories.length, 10);
    assert.deepEqual(stories.map(({ assignee }) => assignee), [
        'Developer 1', 'Developer 1', 'Developer 1',
        'Developer 2', 'Developer 2', 'Developer 2',
        'Developer 3', 'Developer 3', 'Developer 3', 'Developer 3',
    ]);
    assert.deepEqual(stories.map(({ story_points }) => story_points), [3, 5, 3, 5, 3, 3, 3, 5, 3, 3]);
    assert.deepEqual(stories.map(({ due_date }) => due_date), Array(10).fill('2026-10-12'));
    assert.equal(stories[2].task, 'Automated API performance testing');
    assert.match(stories[2].details, /integration test/i);
    assert.match(stories[3].details, /exponential backoff/i);
    assert.match(stories[8].details, /5% failure rate over a 10-minute window/i);
    assert.equal(stories[9].source_timestamp, '00:41');

    const projectRoot = fileURLToPath(new URL('../', import.meta.url));
    const client = new Client({ name: 'meeting-copilot-narrative-test', version: '1.0.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(projectRoot, 'server.js')],
        cwd: projectRoot,
        env: process.env,
    });

    try {
        await client.connect(transport);
        const result = await client.callTool({
            name: 'extract_tasks_from_transcript',
            arguments: { transcript },
        });
        const extracted = JSON.parse(result.content[0].text);

        assert.equal(result.isError, undefined);
        assert.equal(extracted.length, 10);
        assert.ok(extracted.every(({ issue_type }) => issue_type === 'Story'));
        assert.equal(extracted[9].task, 'Update monitoring events for the asynchronous processing workflow');

        const dryRun = await client.callTool({
            name: 'create_follow_up_tasks',
            arguments: {
                dryRun: true,
                tasks: ['Epic', 'Story', 'Task', 'Bug'].map((issue_type) => ({
                    assignee: 'Developer 1',
                    task: `Verify ${issue_type} creation`,
                    due_date: '2026-10-12',
                    issue_type,
                })),
            },
        });
        const dryRunIssues = JSON.parse(dryRun.content[0].text).created;
        assert.deepEqual(dryRunIssues.map(({ issueType }) => issueType), ['Epic', 'Story', 'Task', 'Bug']);
        assert.ok(dryRunIssues.every(({ status }) => status === 'dry-run'));
    } finally {
        await client.close();
    }
});
