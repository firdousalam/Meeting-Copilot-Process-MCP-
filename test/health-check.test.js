import test from 'node:test';
import assert from 'node:assert/strict';

import { extractStructuredJiraTasks, resolveOllamaHealthUrl, resolveOllamaModel } from '../server.js';

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
    assert.deepEqual(tasks.map(({ due_date }) => due_date), Array(6).fill('2026-10-15'));
    assert.deepEqual(tasks.map(({ story_points }) => story_points), [13, 3, 3, 4, 3, null]);
});
