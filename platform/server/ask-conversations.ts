import type { Context, Hono } from 'hono';
import { ApiError, id, now, scrubSecrets, stringField } from './security';
import type { Env, Principal, Row } from './types';
import type { AskSource } from './ask-evidence';

type AppEnv = { Bindings: Env; Variables: { user: Row } };
type Auth = { userProject(c: Context<AppEnv>, projectId: unknown): Promise<Principal> };
const ownerFilter = 'project_id=? AND workspace_id=? AND user_id=?';
const LIST_LIMIT = 100, MESSAGE_LIMIT = 50, HISTORY_LIMIT = 10, HISTORY_CHAR_LIMIT = 12000, HISTORY_MESSAGE_LIMIT = 2000;
function owner(principal: Principal) {
  if (!principal.userId) throw new ApiError(401, 'Sign in to use Ask conversations.');
  return [principal.project.id, principal.workspace.id, principal.userId];
}
function sources(value: unknown): AskSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap(item => {
    if (!item || typeof item !== 'object' || !['project_statistics', 'model_breakdown', 'trace_metadata'].includes(item.type) || typeof item.project_id !== 'string' || ![7, 30, 90].includes(item.days) || typeof item.href !== 'string') return [];
    let url: URL;
    try { url = new URL(item.href, 'https://traqiva.invalid'); } catch { return []; }
    if (url.origin !== 'https://traqiva.invalid' || !['/app/analytics', '/app/traces'].includes(url.pathname) || !item.href.startsWith('/app/')) return [];
    return [{ type: item.type, project_id: item.project_id.slice(0, 64), days: item.days, title: typeof item.title === 'string' ? scrubSecrets(item.title).slice(0, 80) : 'Evidence', href: url.pathname + url.search, ...(Array.isArray(item.trace_ids) ? { trace_ids: item.trace_ids.filter((trace: unknown) => typeof trace === 'string' && trace.length <= 64).slice(0, 10) } : {}) }];
  });
}
function publicMessage(row: Row) {
  let recorded: unknown = [];
  try { recorded = row.sources_json ? JSON.parse(row.sources_json) : []; } catch { /* Invalid old metadata does not break the conversation. */ }
  return { id: row.id, role: row.role, content: row.content, created_at: row.created_at, sources: sources(recorded), model: row.model ?? null, method: row.method ?? null };
}

export async function validateAskConversation(env: Env, principal: Principal, conversationId?: unknown): Promise<Row | null> {
  const values = owner(principal);
  if (conversationId === undefined || conversationId === null || conversationId === '') return null;
  const conversation = await env.DB.prepare(`SELECT id,title,created_at,updated_at FROM ask_conversations WHERE id=? AND ${ownerFilter}`).bind(stringField(conversationId, 'conversation_id', 64), ...values).first<Row>();
  if (!conversation) throw new ApiError(404, 'Conversation not found.');
  return conversation;
}

export async function askConversationHistory(env: Env, principal: Principal, conversationId?: unknown) {
  const conversation = await validateAskConversation(env, principal, conversationId);
  if (!conversation) return { messages: [], limit: HISTORY_LIMIT, character_limit: HISTORY_CHAR_LIMIT, truncated: false };
  const rows = (await env.DB.prepare(`SELECT role,content FROM ask_messages WHERE conversation_id=? AND ${ownerFilter} ORDER BY sequence DESC LIMIT ?`).bind(conversation.id, ...owner(principal), HISTORY_LIMIT + 1).all<Row>()).results;
  let used = 0, truncated = rows.length > HISTORY_LIMIT;
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const row of rows.slice(0, HISTORY_LIMIT)) {
    const content = row.content.length > HISTORY_MESSAGE_LIMIT ? row.content.slice(0, HISTORY_MESSAGE_LIMIT - 20) + '\n[Message truncated]' : row.content;
    if (content.length !== row.content.length) truncated = true;
    if (used + content.length > HISTORY_CHAR_LIMIT) { truncated = true; break; }
    used += content.length;
    messages.unshift({ role: row.role, content });
  }
  // A clipped oldest pair must not leave an orphan assistant answer as context.
  if (messages[0]?.role === 'assistant') { messages.shift(); truncated = true; }
  return { messages, limit: HISTORY_LIMIT, character_limit: HISTORY_CHAR_LIMIT, truncated };
}

export async function appendAskExchange(env: Env, principal: Principal, exchange: { conversationId?: unknown; question: string; answer: string; sources?: unknown; model?: string | null; method: 'llm' | 'rules' }) {
  const values = owner(principal), existing = await validateAskConversation(env, principal, exchange.conversationId);
  const question = scrubSecrets(stringField(exchange.question, 'question', 2000)), answer = scrubSecrets(stringField(exchange.answer, 'answer', 12000));
  const conversationId = existing?.id ?? id(), userMessageId = id(), messageId = id(), at = now(), title = question.replace(/\s+/g, ' ').slice(0, 100), model = exchange.model ? scrubSecrets(stringField(exchange.model, 'model', 120)) : null;
  const sourceJson = JSON.stringify(sources(exchange.sources).filter(source => source.project_id === principal.project.id));
  const statements = existing
    ? [env.DB.prepare(`UPDATE ask_conversations SET updated_at=? WHERE id=? AND ${ownerFilter}`).bind(at, conversationId, ...values)]
    : [env.DB.prepare('INSERT INTO ask_conversations(id,project_id,workspace_id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(conversationId, ...values, title, at, at)];
  // Both messages and the title update commit together. Sequence is allocated
  // inside the transaction, so overlapping successful calls cannot collide.
  const insert = 'INSERT INTO ask_messages(id,conversation_id,project_id,workspace_id,user_id,role,content,sources_json,model,method,created_at,sequence) SELECT ?,?,?,?,?,?,?,?,?,?,?,COALESCE(MAX(sequence),0)+1 FROM ask_messages WHERE conversation_id=?';
  statements.push(
    env.DB.prepare(insert).bind(userMessageId, conversationId, ...values, 'user', question, null, null, null, at, conversationId),
    env.DB.prepare(insert).bind(messageId, conversationId, ...values, 'assistant', answer, sourceJson, model, exchange.method, at, conversationId),
  );
  await env.DB.batch(statements);
  return { id: conversationId, title: existing?.title ?? title, created_at: existing?.created_at ?? at, updated_at: at, message_id: messageId, user_message_id: userMessageId };
}

export function registerAskConversations(app: Hono<AppEnv>, auth: Auth) {
  app.get('/api/ask/conversations', async c => {
    const principal = await auth.userProject(c, c.req.query('project'));
    const rows = (await c.env.DB.prepare(`SELECT id,title,created_at,updated_at FROM ask_conversations WHERE ${ownerFilter} ORDER BY updated_at DESC,id DESC LIMIT ?`).bind(...owner(principal), LIST_LIMIT + 1).all<Row>()).results;
    return c.json({ items: rows.slice(0, LIST_LIMIT), limit: LIST_LIMIT, has_more: rows.length > LIST_LIMIT });
  });
  app.get('/api/ask/conversations/:id', async c => {
    const principal = await auth.userProject(c, c.req.query('project')), conversation = await validateAskConversation(c.env, principal, c.req.param('id'));
    const rows = (await c.env.DB.prepare(`SELECT id,role,content,sources_json,model,method,created_at FROM ask_messages WHERE conversation_id=? AND ${ownerFilter} ORDER BY sequence DESC LIMIT ?`).bind(conversation!.id, ...owner(principal), MESSAGE_LIMIT + 1).all<Row>()).results;
    return c.json({ conversation, messages: rows.slice(0, MESSAGE_LIMIT).reverse().map(publicMessage), limit: MESSAGE_LIMIT, has_more: rows.length > MESSAGE_LIMIT });
  });
}
