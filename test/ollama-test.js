// ollama-test.js
const fetch = global.fetch; // Node 18+ has fetch built-in

async function runOllama() {
    try {
        const response = await fetch("http://localhost:11434/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama3",
                prompt: "Respond ONLY with a JSON array: [{\"assignee\":\"Developer 1\",\"task\":\"Test Task\",\"due_date\":\"2026-10-15\"}]"
            })
        });

        const raw = await response.text();
        console.log("Raw Ollama response:\n", raw);

        try {
            const parsed = JSON.parse(raw);
            console.log("Parsed JSON:\n", parsed);
        } catch (err) {
            console.error("Failed to parse Ollama output:", raw);
        }
    } catch (err) {
        console.error("Error calling Ollama:", err);
    }
}

runOllama();
