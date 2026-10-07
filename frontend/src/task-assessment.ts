// What the task editor's assessment asks the model to look for, and how to word its answer.
//
// moried sends the task, today's date and the titles above it after these instructions, and holds
// the answer to the shape the editor reads, so the instructions may ask for anything without
// leaving the editor with an answer it cannot read. They may say what each part of the answer
// should hold, but never its JSON.

// The whole file is the prompt, so it reads and edits as one in any text editor.
export const TASK_ASSESSMENT_PROMPT_PATH = '.mory/task-assessment.md';

export const DEFAULT_TASK_ASSESSMENT_PROMPT = `Analyze the task and provide comprehensive assistance.

Primary Focus: Evaluate the TASK AS A WHOLE and suggest improvements for overall clarity and completeness.

Evaluate the task holistically by considering the combination of title, note, and other task information:
1. Overall clarity: Is it clear what needs to be done when considering title + note + other information together?
2. Completeness: Does the combined information provide sufficient context to understand and execute the task?
3. Actionability: Are the required actions clear from the overall task description?
4. Information sufficiency: Does the title need to be complete on its own, or does the note provide adequate context?

The title may be intentionally brief or incomplete if the note provides sufficient detail. Focus on the overall task comprehensibility rather than title completeness alone.

When the task has parent tasks, consider the hierarchy context when evaluating the task title. The task title may be short and rely on context, but it should still be understandable within the hierarchy.

Suggest improvements that enhance overall task clarity, which may include:
- Title refinements (if needed for clarity)
- Note content additions or improvements
- Better organization of existing information
- Missing critical details that would help task execution

In your answer:
- Score overall task clarity; 10 means excellent.
- Make the suggestions specific improvements for overall task clarity.
- In the feedback, assess the task as a whole, emphasizing how well the combined title+note+info communicates the task.
- Make the note suggestions helpful additions to or improvements of the note's content.

Important:
- Use the same language as the task title.
- Evaluate the task as a complete unit (title + note + other fields).
- Accept brief titles if the note provides adequate context.
- Keep suggestions practical and actionable.
- Consider the complete task context when making suggestions.
- Be concise but thorough in your suggestions.`;

/// The prompt a file holds, or `null` when it holds none and the default applies. Blank is not set,
/// as an empty value is elsewhere in `.mory/`: no instructions at all would only ask the model to
/// guess what to look for.
export function readTaskAssessmentPrompt(content: string): string | null {
    const prompt = content.trim();
    return prompt === '' ? null : prompt;
}
