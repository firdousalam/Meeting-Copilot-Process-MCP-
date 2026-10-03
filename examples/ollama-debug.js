const prompt = `You are an extraction engine. Extract action items from the transcript into a JSON array. Keep ONLY valid JSON. Use this exact schema: [{"assignee":"string","task":"string","due_date":"string"}] . Do not add commentary. If a due date is not explicit, infer it from the transcript text (examples: Friday, Thursday, end of week, next Monday). Transcript:\nTeam standup notes. Sarah: We need to finalize the launch checklist for the mobile app before Friday. John: I will review the onboarding copy and send it to the design team. Aisha: Please update the analytics dashboard with the new conversion metrics. David: We also need to prepare the customer feedback summary for the next leadership review.`;

fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        model: "llama2:latest",
        stream: false,
        options: { temperature: 0, top_p: 0.1 },
        prompt,
    }),
})
    .then((res) => res.json())
    .then((data) => {
        console.log(JSON.stringify(data, null, 2));
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
