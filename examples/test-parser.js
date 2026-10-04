const text = `Here are the action items extracted from the transcript using the specified JSON schema:
[{"assignee":"Sarah","task":"finalize the launch checklist for the mobile app","due_date":"Friday"}, {"assignee":"John","task":"review the onboarding copy and send it to the design team","due_date":null}, {"assignee":"Aisha","task":"update the analytics dashboard with the new conversion metrics","due_date":"end of week"}, {"assignee":"David","task":"prepare the customer feedback summary for the next leadership review","due_date":"next Monday"}]`;

function normalizeOllamaText(rawText) {
    if (!rawText) return "";
    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const fragments = [];
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            if (parsed?.response) fragments.push(parsed.response);
            else if (typeof parsed === 'string') fragments.push(parsed);
            else if (parsed && typeof parsed === 'object') fragments.push(JSON.stringify(parsed));
        } catch {
            fragments.push(line);
        }
    }
    return fragments.join("").replace(/```json/gi, "").replace(/```/g, "").trim();
}

function parseTasksFromOllamaOutput(rawText) {
    const normalized = normalizeOllamaText(rawText);
    console.log('NORMALIZED=', normalized);
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
            console.log('PARSED=', parsed);
            const list = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of list) {
                if (item?.assignee && item?.task) tasks.push({ ...item, due_date: item?.due_date ?? 'TBD' });
            }
            if (tasks.length) return tasks;
        } catch (e) {
            console.log('candidate parse failed', e.message);
        }
        const splitCandidates = candidate.split(/}\s*\{/).map((chunk, index, arr) => {
            if (!chunk.trim()) return null;
            let value = chunk.trim();
            if (index === 0 && !value.startsWith('{')) value = `{${value}`;
            if (index === arr.length - 1 && !value.endsWith('}')) value = `${value}}`;
            if (index > 0 && !value.startsWith('{')) value = `{${value}`;
            if (index < arr.length - 1 && !value.endsWith('}')) value = `${value}}`;
            return value;
        }).filter(Boolean);
        for (const splitCandidate of splitCandidates) {
            try {
                const parsed = JSON.parse(splitCandidate);
                if (parsed?.assignee && parsed?.task) tasks.push({ ...parsed, due_date: parsed?.due_date ?? 'TBD' });
            } catch (e) {
                console.log('split parse failed', splitCandidate, e.message);
            }
        }
    }
    return tasks;
}

console.log(parseTasksFromOllamaOutput(text));
