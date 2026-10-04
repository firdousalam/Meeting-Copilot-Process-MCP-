import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildFollowUpEmail,
    buildJiraDescription,
    buildJiraIssueUrl,
    extractStructuredJiraTasks,
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

test('extractStructuredJiraTasks returns the epic and each numbered child task separately', () => {
    const transcript = `
[00:12] Host: Developer 1, please create an Epic in Jira titled “Implement RBAC for MCP” and assign it to yourself. The deadline is October 15, 2026.
[00:15] Host: Under this epic, create 4 tasks:
Task 1: Design RBAC schema (assigned to Developer 2).
Task 2: Implement role validation middleware (assigned to Developer 2).
Task 3: Integrate RBAC checks into transcript processing (assigned to Developer 3).
Task 4: Add RBAC enforcement in email + Jira modules (assigned to Developer 3).
[00:37] Host: Add a sub-task under Task 2 for logging and monitoring.
[00:40] Developer 2: I’ll handle that.
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
    assert.deepEqual(tasks.map(({ due_date }) => due_date), Array(6).fill('2026-10-15'));
    assert.deepEqual(tasks.map(({ story_points }) => story_points), [13, 3, 3, 4, 3, null]);
    assert.deepEqual(tasks.map(({ estimated_days }) => estimated_days), [13, 3, 3, 4, 3, null]);
    assert.deepEqual(tasks.map(({ requested_by }) => requested_by), [
        'Host', 'Host', 'Host', 'Host', 'Host', 'Host',
    ]);
    assert.deepEqual(tasks.map(({ source_timestamp }) => source_timestamp), [
        '00:12', '00:15', '00:15', '00:15', '00:15', '00:37',
    ]);
    assert.match(tasks[1].source_action, /Task 1: Design RBAC schema/);
});

test('Jira description and email include call context, estimates, due date, and issue link', () => {
    const task = {
        task: 'Design RBAC schema',
        due_date: '2026-10-15',
        requested_by: 'Host',
        source_action: 'Under this epic, create 4 tasks: Task 1: Design RBAC schema',
        source_timestamp: '00:15',
        story_points: 3,
        estimated_days: 3,
    };
    const issueUrl = buildJiraIssueUrl('https://example.atlassian.net/', 'SCRUM-42');
    const description = buildJiraDescription(task);
    const email = buildFollowUpEmail(task, 'SCRUM-42', issueUrl);

    assert.equal(issueUrl, 'https://example.atlassian.net/browse/SCRUM-42');
    assert.match(description, /Requested by: Host/);
    assert.match(description, /Call action \[00:15\]: Under this epic/);
    assert.match(description, /Story points: 3/);
    assert.match(description, /Estimated duration: 3 workday/);
    assert.match(description, /Due date: 2026-10-15/);
    assert.match(email, /Jira link: https:\/\/example\.atlassian\.net\/browse\/SCRUM-42/);
    assert.match(email, /Requested by: Host/);
    assert.match(email, /Due date: 2026-10-15/);
});
