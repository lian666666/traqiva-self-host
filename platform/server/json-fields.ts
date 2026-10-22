type Member = { key: string; start: number; end: number };
const whitespace = /[\t\n\r ]/;
// Input has already passed JSON.parse. Scan source spans instead of serializing
// parsed values: provider tool schemas can contain integers beyond JS precision.
function members(text: string): { entries: Member[]; close: number } {
  let index = 0;
  const skip = () => { while (whitespace.test(text[index] ?? '') && index < text.length) index++; };
  const stringEnd = () => {
    index++;
    while (index < text.length) {
      const char = text[index++];
      if (char === '\\') index++;
      else if (char === '"') return;
    }
    throw new Error('Unclosed JSON string.');
  };
  const valueEnd = () => {
    if (text[index] === '"') { stringEnd(); return; }
    if (text[index] === '{' || text[index] === '[') {
      let depth = 0;
      while (index < text.length) {
        const char = text[index];
        if (char === '"') { stringEnd(); continue; }
        index++;
        if (char === '{' || char === '[') depth++;
        else if ((char === '}' || char === ']') && --depth === 0) return;
      }
      throw new Error('Unclosed JSON value.');
    }
    while (index < text.length && !/[,}\t\n\r ]/.test(text[index])) index++;
  };
  skip();
  if (text[index++] !== '{') throw new Error('A JSON object is required.');
  const entries: Member[] = [];
  for (;;) {
    skip(); if (text[index] === '}') return { entries, close: index };
    const keyStart = index;
    if (text[index] !== '"') throw new Error('A JSON object key is required.');
    stringEnd(); const key = JSON.parse(text.slice(keyStart, index)) as string;
    skip(); if (text[index++] !== ':') throw new Error('A JSON colon is required.');
    skip(); const start = index; valueEnd(); entries.push({ key, start, end: index });
    skip(); if (text[index] === '}') return { entries, close: index };
    if (text[index++] !== ',') throw new Error('A JSON separator is required.');
  }
}

export function rawObjectField(text: string, key: string): string | undefined {
  const found = members(text).entries.filter(entry => entry.key === key).at(-1);
  return found ? text.slice(found.start, found.end) : undefined;
}
export function replaceObjectFields(text: string, updates: Record<string, string>): string {
  const { entries, close } = members(text), seen = new Set<string>();
  let result = '', offset = 0;
  for (const entry of entries) if (Object.hasOwn(updates, entry.key)) {
    result += text.slice(offset, entry.start) + updates[entry.key]; offset = entry.end; seen.add(entry.key);
  }
  const added = Object.entries(updates).filter(([key]) => !seen.has(key)).map(([key, value]) => `${JSON.stringify(key)}:${value}`);
  return result + text.slice(offset, close) + (added.length ? (entries.length ? ',' : '') + added.join(',') : '') + text.slice(close);
}

export function autoRequestBody(text: string, original: Record<string, any>, routed: Record<string, any>, path: string): string {
  const updates: Record<string, string> = { model: JSON.stringify(routed.model) };
  if (path === '/v1/responses' && routed.reasoning !== original.reasoning) {
    const rawReasoning = rawObjectField(text, 'reasoning');
    updates.reasoning = rawReasoning && original.reasoning && typeof original.reasoning === 'object'
      ? replaceObjectFields(rawReasoning, { effort: JSON.stringify(routed.reasoning.effort) })
      : JSON.stringify(routed.reasoning);
  } else if (path === '/v1/chat/completions' && !Object.hasOwn(original, 'reasoning_effort') && Object.hasOwn(routed, 'reasoning_effort')) updates.reasoning_effort = JSON.stringify(routed.reasoning_effort);
  return replaceObjectFields(text, updates);
}
