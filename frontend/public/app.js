const transcriptInput = document.getElementById('transcript');
const extractInput = document.getElementById('extract');
const extractBtn = document.getElementById('extractBtn');
const generateBtn = document.getElementById('generateBtn');
const healthBtn = document.getElementById('healthBtn');
const resultCard = document.getElementById('resultCard');
const resultOutput = document.getElementById('resultOutput');
const FollowUpCard = document.getElementById('FollowUpCard');
const FollowUpOutput = document.getElementById('FollowUpOutput');
async function callApi(endpoint, payload = null) {
    const options = {
        method: payload === null ? 'GET' : 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    };

    if (payload !== null) {
        options.body = JSON.stringify(payload);
    }

    const response = await fetch(endpoint, options);
    const data = await response.json();
    return { response, data };
}

extractBtn.addEventListener('click', async () => {
    const transcript = transcriptInput.value.trim();

    if (!transcript) {
        resultOutput.textContent = 'Please paste a meeting transcript first.';
        resultCard.classList.remove('hidden');
        return;
    }

    resultOutput.textContent = 'Extracting tasks...';
    resultCard.classList.remove('hidden');

    try {
        const { response, data } = await callApi('/api/extract', { transcript });

        if (!response.ok) {
            throw new Error(data.error || 'Extraction failed');
        }

        resultOutput.textContent = JSON.stringify(data.data, null, 2);
        extractInput.value = JSON.stringify(data.data, null, 2);
    } catch (error) {
        resultOutput.textContent = `Error: ${error.message}`;
    }
});

generateBtn.addEventListener('click', async () => {
    const extractText = extractInput.value.trim();

    if (!extractText) {
        FollowUpOutput.textContent = 'Please paste a meeting extract first.';
        FollowUpCard.classList.remove('hidden');
        return;
    }

    let extractedItems;
    try {
        extractedItems = JSON.parse(extractText);
    } catch {
        FollowUpOutput.textContent = 'Meeting extract must be a JSON array of tasks. Extract tasks first or paste valid JSON.';
        FollowUpCard.classList.remove('hidden');
        return;
    }

    if (!Array.isArray(extractedItems)) {
        FollowUpOutput.textContent = 'Meeting extract must be a JSON array of tasks.';
        FollowUpCard.classList.remove('hidden');
        return;
    }

    const tasks = extractedItems.filter((item) =>
        item && typeof item.assignee === 'string' && typeof item.task === 'string' &&
        typeof item.due_date === 'string' &&
        (!item.issue_type || ['Epic', 'Story', 'Task', 'Sub-task'].includes(item.issue_type))
    );

    if (tasks.length === 0) {
        FollowUpOutput.textContent = 'No valid Jira issues found in the meeting extract.';
        FollowUpCard.classList.remove('hidden');
        return;
    }

    FollowUpOutput.textContent = `Creating ${tasks.length} Jira issue(s) and sending follow-up emails...`;
    FollowUpCard.classList.remove('hidden');

    try {
        const { response, data } = await callApi('/api/create-follow-ups', { tasks });

        if (!response.ok) {
            throw new Error(data.error || 'create-follow-ups failed');
        }

        FollowUpOutput.textContent = JSON.stringify(data.data, null, 2);
    } catch (error) {
        FollowUpOutput.textContent = `Error: ${error.message}`;
    }
});


if (healthBtn) {
    healthBtn.addEventListener('click', async () => {
        resultOutput.textContent = 'Checking service health...';
        resultCard.classList.remove('hidden');

        try {
            const { response, data } = await callApi('/api/health');

            if (!response.ok) {
                throw new Error(data.error || 'Health check failed');
            }

            resultOutput.textContent = JSON.stringify(data.data, null, 2);
        } catch (error) {
            resultOutput.textContent = `Error: ${error.message}`;
        }
    });
}
