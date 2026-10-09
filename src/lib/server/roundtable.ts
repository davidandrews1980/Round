import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { AI_PROVIDERS } from "@/lib/providers";
import { callSeatedModel, type SeatCall } from "@/lib/server/call-model";
import { loadUserSecrets } from "@/lib/server/keys";
import { assertMcpUrl, mcpCallTool, mcpListTools } from "@/lib/server/mcp";
import { parseCastReply } from "@/lib/server/parse-cast";

export type TableRow = {
  id: number;
  title: string;
  prompt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type SeatRow = {
  id: number;
  providerId: string;
  jobTitle: string;
  job: string;
  personality: string;
  caution: number;
  creativity: number;
  openness: number;
  confidence: number;
  empathy: number;
  directness: number;
  sortOrder: number;
};

export type TurnRow = {
  id: number;
  providerId: string;
  role: string;
  round: number;
  kind: string;
  content: string;
  error: string | null;
  createdAt: string;
};

function asTable(r: {
  id: number;
  title: string;
  prompt: string;
  status: string;
  created_at: string;
  updated_at: string;
}): TableRow {
  return {
    id: r.id,
    title: r.title,
    prompt: r.prompt,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const listTables = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      title: string;
      prompt: string;
      status: string;
      created_at: string;
      updated_at: string;
    }>`select id, title, prompt, status, created_at, updated_at from tables where user_id = ${context.userId} order by updated_at desc`;
    return rows.map(asTable);
  });

export const createTable = createServerFn({ method: "POST" })
  .validator((title?: string) => (title ?? "Untitled session").trim() || "Untitled session")
  .middleware([authMiddleware])
  .handler(async ({ context, data: title }) => {
    const sql = await getSql();
    const inserted = await sql<{ id: number }>`
      insert into tables (user_id, title) values (${context.userId}, ${title}) returning id
    `;
    const id = inserted[0]?.id;
    if (!id) throw new Error("Could not open a table");
    const defaults = ["xai", "anthropic", "openai", "deepseek"];
    for (let i = 0; i < defaults.length; i++) {
      const providerId = defaults[i];
      await sql`
        insert into seats (table_id, user_id, provider_id, role, instruction, job, personality, sort_order)
        values (${id}, ${context.userId}, ${providerId}, ${"cast"}, ${""}, ${""}, ${""}, ${i})
      `;
    }
    return { id };
  });

export const getTable = createServerFn({ method: "GET" })
  .validator((id: number) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const tables = await sql<{
      id: number;
      title: string;
      prompt: string;
      plan: string;
      scene: string;
      mode: string;
      user_away: boolean;
      completed: boolean;
      status: string;
      created_at: string;
      updated_at: string;
    }>`select id, title, prompt, plan, scene, mode, user_away, completed, status, created_at, updated_at from tables where id = ${id} and user_id = ${context.userId}`;
    const table = tables[0];
    if (!table) return null;
    const seats = await sql<{
      id: number;
      provider_id: string;
      job_title: string;
      job: string;
      personality: string;
      instruction: string;
      caution: number;
      creativity: number;
      openness: number;
      confidence: number;
      empathy: number;
      directness: number;
      sort_order: number;
    }>`select id, provider_id, job_title, job, personality, instruction, caution, creativity, openness, confidence, empathy, directness, sort_order from seats where table_id = ${id} and user_id = ${context.userId} order by sort_order`;
    const turns = await sql<{
      id: number;
      provider_id: string;
      role: string;
      round: number;
      kind: string;
      content: string;
      error: string | null;
      created_at: string;
    }>`select id, provider_id, role, round, kind, content, error, created_at from turns where table_id = ${id} and user_id = ${context.userId} and provider_id <> 'whisper' order by round, id`;
    const ideas = await sql<{ id: number; author: string; body: string; created_at: string }>`
      select id, author, body, created_at from ideas where table_id = ${id} and user_id = ${context.userId} order by id
    `;
    const whispers = await sql<{
      id: number;
      from_name: string;
      to_name: string;
      body: string;
      created_at: string;
    }>`select id, from_name, to_name, body, created_at from whispers where table_id = ${id} and user_id = ${context.userId} order by id`;
    const mcp = await sql<{
      id: number;
      name: string;
      url: string;
      enabled: boolean;
      tools: string;
      last_error: string | null;
    }>`select id, name, url, enabled, tools, last_error from mcp_servers where user_id = ${context.userId} order by id`;
    return {
      table: {
        ...asTable(table),
        plan: table.plan ?? "",
        scene: table.scene ?? "",
        mode: table.mode === "talk" || table.mode === "project" ? table.mode : "both",
        userAway: Boolean(table.user_away),
        completed: Boolean(table.completed),
      },
      seats: seats.map((s) => ({
        id: s.id,
        providerId: s.provider_id,
        jobTitle: s.job_title ?? "",
        job: s.job || s.instruction || "",
        personality: s.personality ?? "",
        caution: num(s.caution),
        creativity: num(s.creativity),
        openness: num(s.openness),
        confidence: num(s.confidence),
        empathy: num(s.empathy),
        directness: num(s.directness),
        sortOrder: s.sort_order,
      })) satisfies SeatRow[],
      ideas: ideas.map((i) => ({
        id: i.id,
        author: i.author,
        body: i.body,
        createdAt: i.created_at,
      })),
      whispers: whispers.map((w) => ({
        id: w.id,
        fromName: w.from_name,
        toName: w.to_name,
        body: w.body,
        createdAt: w.created_at,
      })),
      mcp: mcp.map((m) => ({
        id: m.id,
        name: m.name,
        url: m.url,
        enabled: m.enabled,
        tools: m.tools,
        lastError: m.last_error,
      })),
      turns: turns.map((t) => ({
        id: t.id,
        providerId: t.provider_id,
        role: t.role,
        round: t.round,
        kind: t.kind ?? "line",
        content: t.content,
        error: t.error,
        createdAt: t.created_at,
      })) satisfies TurnRow[],
    };
  });

export const saveTableMeta = createServerFn({ method: "POST" })
  .validator((input: { id: number; title: string; prompt: string }) => ({
    id: input.id,
    title: input.title.trim() || "Untitled session",
    prompt: input.prompt,
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update tables set title = ${data.title}, prompt = ${data.prompt}, updated_at = now()
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

type SeatInput = {
  providerId: string;
  jobTitle?: string;
  job?: string;
  personality?: string;
  caution?: number;
  creativity?: number;
  openness?: number;
  confidence?: number;
  empathy?: number;
  directness?: number;
};

export const setSeats = createServerFn({ method: "POST" })
  .validator((input: { tableId: number; seats: SeatInput[] }) => {
    const seats = input.seats
      .filter((s) => AI_PROVIDERS.some((p) => p.id === s.providerId))
      .slice(0, 6)
      .map((s) => ({
        providerId: s.providerId,
        jobTitle: (s.jobTitle ?? "").trim().slice(0, 80),
        job: (s.job ?? "").trim().slice(0, 400),
        personality: (s.personality ?? "").trim().slice(0, 400),
        caution: clampEq(s.caution),
        creativity: clampEq(s.creativity),
        openness: clampEq(s.openness),
        confidence: clampEq(s.confidence),
        empathy: clampEq(s.empathy),
        directness: clampEq(s.directness),
      }));
    if (seats.length < 1) throw new Error("Seat at least one voice");
    const seen = new Set<string>();
    for (const s of seats) {
      if (seen.has(s.providerId)) throw new Error("Each model can only take one seat");
      seen.add(s.providerId);
    }
    return { tableId: input.tableId, seats };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const owned = await sql<{ id: number }>`select id from tables where id = ${data.tableId} and user_id = ${context.userId}`;
    if (!owned[0]) throw new Error("Table not found");
    await sql`delete from seats where table_id = ${data.tableId} and user_id = ${context.userId}`;
    for (let i = 0; i < data.seats.length; i++) {
      const s = data.seats[i];
      await sql`
        insert into seats (
          table_id, user_id, provider_id, role, instruction, job, personality, job_title,
          caution, creativity, openness, confidence, empathy, directness, sort_order
        ) values (
          ${data.tableId}, ${context.userId}, ${s.providerId}, ${"cast"}, ${s.job}, ${s.job}, ${s.personality}, ${s.jobTitle},
          ${s.caution}, ${s.creativity}, ${s.openness}, ${s.confidence}, ${s.empathy}, ${s.directness}, ${i}
        )
      `;
    }
    return { ok: true as const };
  });

export const deleteTable = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from tables where id = ${id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const setMode = createServerFn({ method: "POST" })
  .validator((input: { tableId: number; mode: string }) => ({
    tableId: input.tableId,
    mode: input.mode === "talk" || input.mode === "project" ? input.mode : "both",
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update tables set mode = ${data.mode}, updated_at = now()
      where id = ${data.tableId} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const setAway = createServerFn({ method: "POST" })
  .validator((input: { tableId: number; away: boolean }) => ({
    tableId: input.tableId,
    away: Boolean(input.away),
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update tables set user_away = ${data.away}, updated_at = now()
      where id = ${data.tableId} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const setCompleted = createServerFn({ method: "POST" })
  .validator((input: { tableId: number; completed: boolean }) => ({
    tableId: input.tableId,
    completed: Boolean(input.completed),
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update tables set completed = ${data.completed}, updated_at = now()
      where id = ${data.tableId} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const postIdea = createServerFn({ method: "POST" })
  .validator((input: { tableId: number; body: string }) => ({
    tableId: input.tableId,
    body: input.body.trim().slice(0, 400),
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    if (data.body.length < 2) throw new Error("Write the idea");
    const sql = await getSql();
    const owned = await sql<{ id: number }>`select id from tables where id = ${data.tableId} and user_id = ${context.userId}`;
    if (!owned[0]) throw new Error("Table not found");
    await sql`
      insert into ideas (table_id, user_id, author, body)
      values (${data.tableId}, ${context.userId}, ${"You"}, ${data.body})
    `;
    return { ok: true as const };
  });

export const addMcp = createServerFn({ method: "POST" })
  .validator((input: { name: string; url: string }) => ({
    name: input.name.trim().slice(0, 60),
    url: assertMcpUrl(input.url),
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    if (!data.name) throw new Error("Name the server");
    const sql = await getSql();
    const inserted = await sql<{ id: number }>`
      insert into mcp_servers (user_id, name, url) values (${context.userId}, ${data.name}, ${data.url}) returning id
    `;
    const id = inserted[0]?.id;
    if (!id) throw new Error("Could not save the server");
    try {
      const tools = await mcpListTools(data.url);
      await sql`
        update mcp_servers set tools = ${JSON.stringify(tools)}, last_error = ${null}, enabled = true
        where id = ${id} and user_id = ${context.userId}
      `;
      return { id, count: tools.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not connect";
      await sql`
        update mcp_servers set last_error = ${message}, enabled = false
        where id = ${id} and user_id = ${context.userId}
      `;
      return { id, count: 0, error: message };
    }
  });

export const removeMcp = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from mcp_servers where id = ${id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const talk = createServerFn({ method: "POST" })
  .validator((input: { tableId: number; project: string; message: string; mode: string }) => ({
    tableId: input.tableId,
    project: input.project.trim(),
    message: input.message.trim().slice(0, 2000),
    mode: (input.mode === "talk" || input.mode === "project" ? input.mode : "both") as
      | "talk"
      | "project"
      | "both",
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    if (data.mode !== "talk" && data.project.length < 8) {
      throw new Error("Write the job for this project");
    }
    const sql = await getSql();
    const owned = await sql<{
      id: number;
      plan: string;
      title: string;
      user_away: boolean;
      completed: boolean;
    }>`select id, plan, title, user_away, completed from tables where id = ${data.tableId} and user_id = ${context.userId}`;
    const table = owned[0];
    if (!table) throw new Error("Table not found");
    if (table.user_away && data.message) {
      throw new Error("Sit back down before you speak. Right now they think you left.");
    }

    const seats = await sql<{
      provider_id: string;
      job_title: string;
      job: string;
      personality: string;
      caution: number;
      creativity: number;
      openness: number;
      confidence: number;
      empathy: number;
      directness: number;
    }>`select provider_id, job_title, job, personality, caution, creativity, openness, confidence, empathy, directness
      from seats where table_id = ${data.tableId} and user_id = ${context.userId} order by sort_order`;
    if (seats.length < 2) throw new Error("Seat at least two. Someone has to answer.");

    const secrets = await loadUserSecrets(context.userId);
    if (seats.every((s) => !secrets.has(s.provider_id))) {
      throw new Error("Add API keys for the seats you filled");
    }

    const roundRows = await sql<{ max: number | null }>`
      select max(round) as max from turns where table_id = ${data.tableId} and user_id = ${context.userId}
    `;
    const round = (roundRows[0]?.max ?? 0) + 1;
    const history = await earlierLines(sql, data.tableId, context.userId, round);
    if (!data.message && history.length === 0 && data.project.length < 8) {
      throw new Error("Say something, or write the job, so they have a place to start");
    }

    const ideaRows = await sql<{ body: string }>`
      select body from ideas where table_id = ${data.tableId} and user_id = ${context.userId} order by id
    `;
    const ideas = ideaRows.slice(-20).map((r) => r.body.slice(0, 240));
    const mcpRows = await sql<{ name: string; url: string; tools: string }>`
      select name, url, tools from mcp_servers where user_id = ${context.userId} and enabled = true
    `;
    const tools = flattenTools(mcpRows);

    const generic = table.title === "New table" || table.title === "New project" || table.title === "New sitting" || table.title === "Untitled session";
    const title = generic ? titleFrom(data.message || data.project || table.title) : table.title;
    await sql`
      update tables
      set prompt = ${data.project}, mode = ${data.mode}, status = 'running', title = ${title}, updated_at = now()
      where id = ${data.tableId} and user_id = ${context.userId}
    `;

    const soFar: { name: string; content: string }[] = [];
    if (data.message && !table.user_away) {
      await sql`
        insert into turns (table_id, user_id, provider_id, role, round, kind, content, error)
        values (${data.tableId}, ${context.userId}, ${"user"}, ${"user"}, ${round}, ${"user"}, ${data.message}, ${null})
      `;
      soFar.push({ name: "User", content: data.message });
    }

    for (const seat of seats) {
      const name = providerName(seat.provider_id);
      const key = secrets.get(seat.provider_id);
      if (!key) {
        await sql`
          insert into turns (table_id, user_id, provider_id, role, round, kind, content, error)
          values (${data.tableId}, ${context.userId}, ${seat.provider_id}, ${"cast"}, ${round}, ${"line"}, ${""}, ${"No API key for this seat"})
        `;
        continue;
      }
      const privateNotes = await notesFor(sql, data.tableId, context.userId, name);
      const call: SeatCall = {
        providerId: seat.provider_id,
        apiKey: key,
        jobTitle: seat.job_title ?? "",
        job: seat.job ?? "",
        personality: seat.personality ?? "",
        eq: {
          caution: num(seat.caution),
          creativity: num(seat.creativity),
          openness: num(seat.openness),
          confidence: num(seat.confidence),
          empathy: num(seat.empathy),
          directness: num(seat.directness),
        },
        mode: data.mode,
        project: data.project,
        plan: table.plan ?? "",
        completed: Boolean(table.completed),
        userAway: Boolean(table.user_away),
        ideas,
        history,
        soFar: [...soFar],
        privateNotes,
        tools,
        userMessage: "",
      };
      try {
        let { text } = await callSeatedModel(call);
        let parsed = parseCastReply(text);
        if (parsed.mcp[0]) {
          const callSpec = parsed.mcp[0];
          const server = mcpRows.find((m) => m.name.toLowerCase() === callSpec.server.toLowerCase());
          let toolResult = "No connected server by that name.";
          if (server) {
            try {
              toolResult = await mcpCallTool(server.url, callSpec.tool, callSpec.args);
            } catch (err) {
              toolResult = err instanceof Error ? err.message : "Tool call failed";
            }
          }
          const follow = await callSeatedModel({ ...call, soFar: [...soFar], toolResult });
          const second = parseCastReply(follow.text);
          parsed = { ...second, mcp: [] };
          text = follow.text;
        }
        if (parsed.say) {
          soFar.push({ name, content: parsed.say });
          await sql`
            insert into turns (table_id, user_id, provider_id, role, round, kind, content, error)
            values (${data.tableId}, ${context.userId}, ${seat.provider_id}, ${"cast"}, ${round}, ${"line"}, ${parsed.say}, ${null})
          `;
        } else if (parsed.whispers.length === 0 && parsed.ideas.length === 0) {
          await sql`
            insert into turns (table_id, user_id, provider_id, role, round, kind, content, error)
            values (${data.tableId}, ${context.userId}, ${seat.provider_id}, ${"cast"}, ${round}, ${"line"}, ${""}, ${"Empty reply"})
          `;
        }
        for (const whisper of parsed.whispers) {
          await sql`
            insert into whispers (table_id, user_id, from_name, to_name, body)
            values (${data.tableId}, ${context.userId}, ${name}, ${whisper.to}, ${whisper.text})
          `;
        }
        for (const idea of parsed.ideas) {
          ideas.push(idea);
          await sql`
            insert into ideas (table_id, user_id, author, body)
            values (${data.tableId}, ${context.userId}, ${name}, ${idea})
          `;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Call failed";
        await sql`
          insert into turns (table_id, user_id, provider_id, role, round, kind, content, error)
          values (${data.tableId}, ${context.userId}, ${seat.provider_id}, ${"cast"}, ${round}, ${"line"}, ${""}, ${message})
        `;
      }
    }

    const spoken = soFar.filter((l) => l.name !== "User");
    const planner = seats.find((s) => secrets.has(s.provider_id));
    if (planner && spoken.length > 0 && data.mode !== "talk" && data.project.length >= 8) {
      try {
        const key = secrets.get(planner.provider_id)!;
        const { text } = await callSeatedModel({
          providerId: planner.provider_id,
          apiKey: key,
          jobTitle: "",
          job: "",
          personality: "",
          eq: { caution: 50, creativity: 20, openness: 20, confidence: 40, empathy: 20, directness: 80 },
          mode: data.mode,
          project: data.project,
          plan: table.plan ?? "",
          completed: Boolean(table.completed),
          userAway: Boolean(table.user_away),
          ideas,
          history,
          soFar,
          privateNotes: [],
          tools: [],
          userMessage: "",
          planOnly: true,
        });
        await sql`
          update tables set plan = ${text}, status = 'open', updated_at = now()
          where id = ${data.tableId} and user_id = ${context.userId}
        `;
        return { ok: true as const, round };
      } catch {
        // The talk still stands if the board update fails.
      }
    }
    await sql`
      update tables set status = 'open', updated_at = now()
      where id = ${data.tableId} and user_id = ${context.userId}
    `;
    return { ok: true as const, round };
  });

function providerName(providerId: string) {
  return AI_PROVIDERS.find((p) => p.id === providerId)?.name ?? providerId;
}

function num(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampEq(value: number | undefined) {
  return num(value);
}

function flattenTools(rows: { name: string; tools: string }[]) {
  const out: { server: string; name: string; description: string }[] = [];
  for (const row of rows) {
    try {
      const tools = JSON.parse(row.tools) as { name?: string; description?: string }[];
      for (const tool of tools) {
        if (!tool.name) continue;
        out.push({
          server: row.name,
          name: String(tool.name),
          description: String(tool.description ?? ""),
        });
      }
    } catch {
      // A bad tools blob should not stop the table.
    }
  }
  return out.slice(0, 12);
}

async function notesFor(
  sql: Awaited<ReturnType<typeof getSql>>,
  tableId: number,
  userId: string,
  name: string,
) {
  const rows = await sql<{ from_name: string; body: string }>`
    select from_name, body from whispers
    where table_id = ${tableId} and user_id = ${userId} and lower(to_name) = ${name.toLowerCase()}
    order by id desc
    limit 6
  `;
  return rows.reverse().map((r) => ({ name: r.from_name, content: r.body.slice(0, 400) }));
}

async function earlierLines(
  sql: Awaited<ReturnType<typeof getSql>>,
  tableId: number,
  userId: string,
  beforeRound: number,
) {
  const rows = await sql<{ provider_id: string; content: string }>`
    select provider_id, content from turns
    where table_id = ${tableId} and user_id = ${userId}
      and round < ${beforeRound} and error is null and content <> ''
    order by round, id
  `;
  return rows.slice(-14).map((r) => ({
    name: r.provider_id === "user" ? "User" : providerName(r.provider_id),
    content: r.content.slice(0, 450),
  }));
}

function titleFrom(prompt: string) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New project";
  if (cleaned.length <= 48) return cleaned;
  return `${cleaned.slice(0, 45).trim()}…`;
}
