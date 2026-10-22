// Replace one top-level member without re-encoding unrelated numeric literals or tool payloads.
export function jsonMember(raw, key, replacement) {
  JSON.parse(raw);
  let index = raw.indexOf('{') + 1, match;
  if (!index) throw new Error('Expected a JSON object.');
  const space = () => { while (/\s/.test(raw[index] || '\0')) index++; };
  while (index < raw.length) {
    space(); if (raw[index] === '}') break;
    const start = index++;
    while (index < raw.length) { if (raw[index] === '\\') index += 2; else if (raw[index++] === '"') break; }
    const name = JSON.parse(raw.slice(start, index));
    space(); index++; space();
    const valueStart = index;
    let depth = 0, quoted = false;
    while (index < raw.length) {
      const char = raw[index];
      if (quoted) { if (char === '\\') index++; else if (char === '"') quoted = false; }
      else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === ']' || char === '}') { if (!depth) break; depth--; }
      else if (char === ',' && !depth) break;
      index++;
    }
    if (name === key) { if (match) throw new Error('Duplicate JSON member cannot be safely transformed.'); match = [valueStart, index]; }
    if (raw[index] === ',') index++; else break;
  }
  if (replacement === undefined) return match ? raw.slice(...match) : undefined;
  if (match) return raw.slice(0, match[0]) + replacement + raw.slice(match[1]);
  const end = raw.lastIndexOf('}');
  return raw.slice(0, end) + (Object.keys(JSON.parse(raw)).length ? ',' : '') + JSON.stringify(key) + ':' + replacement + raw.slice(end);
}
