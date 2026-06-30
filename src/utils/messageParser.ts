export type ParsedMessage =
    | { type: 'text'; content: string }
    | { type: 'interactive_question'; question: string; options: string[]; prefix: string };

function tryParseInteractive(raw: string): { question: string; options: string[] } | null {
    try {
        const parsed = JSON.parse(raw);
        if (
            parsed &&
            parsed.type === 'interactive_question' &&
            typeof parsed.question === 'string' &&
            Array.isArray(parsed.options) &&
            parsed.options.every((o: unknown) => typeof o === 'string')
        ) {
            return { question: parsed.question, options: parsed.options };
        }
    } catch {}
    return null;
}

export function parseAIMessage(content: string): ParsedMessage {
    // 1. Try fenced code block (```json ... ``` or ``` ... ```)
    const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = fenceRegex.exec(content)) !== null) {
        const result = tryParseInteractive(m[1].trim());
        if (result) {
            const prefix = content.slice(0, m.index).trim();
            return { type: 'interactive_question', ...result, prefix };
        }
    }

    // 2. Try bare JSON object — find every `{` and attempt to parse outward
    for (let i = 0; i < content.length; i++) {
        if (content[i] !== '{') continue;
        // Scan for the matching closing brace
        let depth = 0;
        let j = i;
        for (; j < content.length; j++) {
            if (content[j] === '{') depth++;
            else if (content[j] === '}') { depth--; if (depth === 0) break; }
        }
        if (depth === 0) {
            const candidate = content.slice(i, j + 1);
            const result = tryParseInteractive(candidate);
            if (result) {
                const prefix = content.slice(0, i).trim();
                return { type: 'interactive_question', ...result, prefix };
            }
        }
    }

    return { type: 'text', content };
}
