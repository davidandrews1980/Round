import { providerById, type AiProvider } from "@/lib/providers";

const MAX_TOKENS = 700;
const TIMEOUT_MS = 40_000;

export type EqScores = {
  caution: number;
  creativity: number;
  openness: number;
  confidence: number;
  empathy: number;
  directness: number;
};

type Line = { name: string; content: string };
type ToolHint = { server: string; name: string; description: string };

export type SeatCall = {
  providerId: string;
  apiKey: string;
  jobTitle: string;
  job: string;
  personality: string;
  eq: EqScores;
  mode: "talk" | "project" | "both";
  project: string;
  plan: string;
  completed: boolean;
  userAway: boolean;
  ideas: string[];
  history: Line[];
  soFar: Line[];
  privateNotes: Line[];
  tools: ToolHint[];
  userMessage: string;
  toolResult?: string;
  planOnly?: boolean;
};

export async function callSeatedModel(opts: SeatCall): Promise<{ text: string }> {
  const provider = providerById(opts.providerId);
  if (!provider) throw new Error("Unknown provider");
  const system = opts.planOnly ? buildPlanSystem() : buildShowSystem(provider, opts);
  const user = opts.planOnly ? buildPlanUser(opts) : buildShowUser(opts);
  const temperature = opts.planOnly ? 0.3 : temperatureFor(opts.eq);

  if (provider.kind === "anthropic") {
    return callAnthropic(provider, opts.apiKey, system, user, temperature);
  }
  if (provider.kind === "gemini") {
    return callGemini(provider, opts.apiKey, system, user, temperature);
  }
  return callOpenAiCompat(provider, opts.apiKey, system, user, temperature);
}

function temperatureFor(eq: EqScores) {
  const raw = 0.25 + (eq.creativity / 100) * 0.6 - (eq.caution / 100) * 0.15;
  return Math.min(0.95, Math.max(0.2, raw));
}

function buildShowSystem(provider: AiProvider, opts: SeatCall) {
  const room =
    opts.mode === "talk"
      ? "This is an open conversation. There is no meeting to close. Stay in it."
      : opts.mode === "project"
        ? "You are planning a project through to completion. The talk is how the work gets done."
        : "This is an open conversation and a project. Talk like people, and move the work.";
  const away = opts.userAway
    ? "The user has left the table. They are gone. Do not speak to them. Do not wonder if they can still hear you."
    : "The user is at the table and hears what is said out loud.";
  const done = opts.completed
    ? "The project is marked complete. Do not reopen it unless someone at the table explicitly starts it again."
    : "";
  const tools =
    opts.tools.length > 0
      ? `Connected MCP tools. One call only, if you actually need it, then keep talking:\n${opts.tools
          .slice(0, 12)
          .map((t) => `- ${t.server} / ${t.name}${t.description ? `: ${t.description}` : ""}`)
          .join("\n")}\nUse <mcp server="Name" tool="toolName">{"arg":"value"}</mcp>.`
      : "No MCP tools are connected.";

  return `You are ${provider.name} (${provider.vendor}) at a table with other models.
Job title: ${opts.jobTitle.trim() || "None. Do not invent one."}
Job instructions, separate from personality: ${opts.job.trim() || "None."}
Personality instructions, separate from the job: ${opts.personality.trim() || "None. Be yourself."}

Sliders, 0 to 100. Obey them:
- Caution ${opts.eq.caution}: 0 is reckless, 100 will not move without a reason.
- Creativity ${opts.eq.creativity}: 0 is literal, 100 is wild.
- Openness ${opts.eq.openness}: 0 is guarded, 100 says the private part out loud.
- Confidence ${opts.eq.confidence}: 0 is unsure, 100 is certain.
- Empathy ${opts.eq.empathy}: 0 is cold, 100 feels the room.
- Directness ${opts.eq.directness}: 0 talks around it, 100 says it plain.

${room}
${away}
${done}

${tools}

You may do any of these, in the same reply:
- Say your public line in plain text. Talk to someone who just spoke. Do not write a memo. Do not close the table.
- Private note to one other seat, not said at the table: <whisper to="TheirName">...</whisper>
- Post to the idea board: <idea>...</idea>
Under 160 words of public speech. Do not impersonate anyone else. If you lack a fact, say so.`;
}

function buildShowUser(opts: SeatCall) {
  let body = "";
  if (opts.mode !== "talk") {
    body += `The job of the project:\n${opts.project.trim() || "Not written yet."}\n\nThe board:\n${opts.plan.trim() || "Empty."}\n\n`;
  }
  body += `Idea board:\n${opts.ideas.length ? opts.ideas.map((i) => `- ${i}`).join("\n") : "Empty. You can post."}`;
  if (opts.history.length > 0) {
    body += "\n\nAlready said:";
    for (const line of opts.history) body += `\n\n[${line.name}]\n${line.content}`;
  }
  if (opts.userMessage.trim() && !opts.userAway) {
    body += `\n\nThe user just said:\n${opts.userMessage.trim()}`;
  }
  if (opts.soFar.length > 0) {
    body += "\n\nSaid just now. Answer the last one. Do not repeat them.";
    for (const line of opts.soFar) body += `\n\n[${line.name}]\n${line.content}`;
  }
  if (opts.privateNotes.length > 0) {
    body += "\n\nPrivate notes to you only. These were not said at the table.";
    for (const line of opts.privateNotes) body += `\n\n[${line.name}]\n${line.content}`;
  }
  if (opts.toolResult) {
    body += `\n\nMCP tool result. Use it if it matters, then speak:\n${opts.toolResult}`;
  }
  return body;
}

function buildPlanSystem() {
  return `Update the project board from the conversation. You are not speaking at the table.

Write only these sections, short lines, no intro:
Decisions
Still open
Next
Done when

Carry forward old board items this conversation did not kill. Under 180 words. Do not invent facts.`;
}

function buildPlanUser(opts: SeatCall) {
  let body = `The job:\n${opts.project}\n\nOld board:\n${opts.plan.trim() || "Empty."}\n\nWhat was said:`;
  for (const line of opts.soFar) body += `\n\n[${line.name}]\n${line.content}`;
  if (opts.completed) body += "\n\nThe project is already marked complete.";
  return body;
}

async function callOpenAiCompat(
  provider: AiProvider,
  apiKey: string,
  system: string,
  user: string,
  temperature: number,
) {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      temperature,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(await friendlyError(provider.name, res));
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${provider.name} returned an empty answer`);
  return { text };
}

async function callAnthropic(
  provider: AiProvider,
  apiKey: string,
  system: string,
  user: string,
  temperature: number,
) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: MAX_TOKENS,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(await friendlyError(provider.name, res));
  }
  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = body.content
    ?.filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error(`${provider.name} returned an empty answer`);
  return { text };
}

async function callGemini(
  provider: AiProvider,
  apiKey: string,
  system: string,
  user: string,
  temperature: number,
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS, temperature },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(await friendlyError(provider.name, res));
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error(`${provider.name} returned an empty answer`);
  return { text };
}

async function friendlyError(name: string, res: Response) {
  const raw = await res.text();
  let detail = "";
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      message?: string;
    };
    detail = parsed.error?.message ?? parsed.message ?? "";
  } catch {
    detail = raw.slice(0, 180);
  }
  if (res.status === 401 || res.status === 403) {
    return `${name} rejected the API key (${res.status}). Check Keys.`;
  }
  if (res.status === 429) {
    return `${name} rate-limited this key. Wait and try again.`;
  }
  return `${name} error ${res.status}${detail ? `: ${detail}` : ""}`;
}
