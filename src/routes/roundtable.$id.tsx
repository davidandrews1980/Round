import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, AuthSkeleton } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { AI_PROVIDERS, providerById } from "@/lib/providers";
import { listKeys } from "@/lib/server/keys";
import {
  addMcp,
  getTable,
  postIdea,
  removeMcp,
  saveTableMeta,
  setAway,
  setCompleted,
  setMode,
  setSeats,
  talk,
} from "@/lib/server/roundtable";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/roundtable/$id")({
  component: SittingPage,
});

type Mode = "talk" | "project" | "both";

type DraftSeat = {
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
};

const SLIDERS: { key: keyof DraftSeat; label: string }[] = [
  { key: "caution", label: "Caution" },
  { key: "creativity", label: "Creativity" },
  { key: "openness", label: "Openness" },
  { key: "confidence", label: "Confidence" },
  { key: "empathy", label: "Empathy" },
  { key: "directness", label: "Directness" },
];

function emptySeat(providerId: string): DraftSeat {
  return {
    providerId,
    jobTitle: "",
    job: "",
    personality: "",
    caution: 50,
    creativity: 50,
    openness: 50,
    confidence: 50,
    empathy: 50,
    directness: 50,
  };
}

function SittingPage() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <AppShell>
        <AuthSkeleton />
      </AppShell>
    );
  }
  if (!user) return <RedirectToSignIn />;
  return (
    <AppShell>
      <SittingInner />
    </AppShell>
  );
}

function SittingInner() {
  const { id } = Route.useParams();
  const tableId = Number(id);
  const qc = useQueryClient();
  const tableQ = useQuery({
    queryKey: ["table", tableId],
    queryFn: () => getTable({ data: tableId }),
    enabled: Number.isFinite(tableId),
  });
  const keysQ = useQuery({ queryKey: ["keys"], queryFn: () => listKeys() });
  const [project, setProject] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [idea, setIdea] = useState("");
  const [draftSeats, setDraftSeats] = useState<DraftSeat[] | null>(null);
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");

  const data = tableQ.data;
  const projectValue = project ?? data?.table.prompt ?? "";
  const mode = (data?.table.mode ?? "both") as Mode;
  const seats = draftSeats ?? data?.seats ?? [];
  const keyed = useMemo(
    () => new Set((keysQ.data ?? []).filter((k) => k.hasKey).map((k) => k.providerId)),
    [keysQ.data],
  );
  const refresh = () => qc.invalidateQueries({ queryKey: ["table", tableId] });

  const persistSeats = useMutation({
    mutationFn: (next: DraftSeat[]) => setSeats({ data: { tableId, seats: next } }),
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  const speak = useMutation({
    mutationFn: async (text: string) => {
      await saveTableMeta({
        data: { id: tableId, title: data?.table.title ?? "New project", prompt: projectValue },
      });
      await setSeats({ data: { tableId, seats } });
      return talk({ data: { tableId, project: projectValue, message: text, mode } });
    },
    onSuccess: async () => {
      setDraftSeats(null);
      setMessage("");
      await refresh();
      await qc.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const away = useMutation({
    mutationFn: (next: boolean) => setAway({ data: { tableId, away: next } }),
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  const done = useMutation({
    mutationFn: (completed: boolean) => setCompleted({ data: { tableId, completed } }),
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  const modeMut = useMutation({
    mutationFn: (next: Mode) => setMode({ data: { tableId, mode: next } }),
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  const ideaMut = useMutation({
    mutationFn: () => postIdea({ data: { tableId, body: idea } }),
    onSuccess: async () => {
      setIdea("");
      await refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mcpAdd = useMutation({
    mutationFn: () => addMcp({ data: { name: mcpName, url: mcpUrl } }),
    onSuccess: async (res) => {
      setMcpName("");
      setMcpUrl("");
      if (res.error) toast.error(res.error);
      else toast.success(`${res.count} tool${res.count === 1 ? "" : "s"} connected`);
      await refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mcpRemove = useMutation({
    mutationFn: (mcpId: number) => removeMcp({ data: mcpId }),
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  if (tableQ.isPending) return <AuthSkeleton />;
  if (!data) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <p className="text-muted">That table is gone.</p>
        <Link to="/roundtable" className="mt-4 inline-block text-sm underline">
          Back
        </Link>
      </main>
    );
  }

  const showProject = mode !== "talk";
  const missing = seats.filter((s) => !keyed.has(s.providerId));

  function patchSeat(index: number, patch: Partial<DraftSeat>, save = false) {
    const next = seats.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setDraftSeats(next);
    if (save) persistSeats.mutate(next);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link
        to="/roundtable"
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        Tables
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["talk", "Open talk"],
                ["project", "Project"],
                ["both", "Both"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => modeMut.mutate(value)}
                className={
                  mode === value
                    ? "rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-xs text-accent-fg"
                    : "rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-xs text-muted"
                }
              >
                {label}
              </button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => away.mutate(!data.table.userAway)}
              disabled={away.isPending}
            >
              {data.table.userAway ? "Sit back down" : "Step out"}
            </Button>
          </div>
          {data.table.userAway ? (
            <p className="mt-3 text-xs text-muted">You stepped out. They were told you left.</p>
          ) : null}

          {showProject ? (
            <div className="mt-6">
              <Label htmlFor="job">The job</Label>
              <Textarea
                id="job"
                className="mt-2 min-h-24 font-display text-lg"
                placeholder="What is this project, and what does finished look like?"
                value={projectValue}
                onChange={(e) => setProject(e.target.value)}
              />
              <div className="mt-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                    The board
                  </p>
                  <button
                    type="button"
                    className="text-xs text-muted underline underline-offset-4"
                    onClick={() => done.mutate(!data.table.completed)}
                  >
                    {data.table.completed ? "Reopen" : "Mark complete"}
                  </button>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg">
                  {data.table.plan.trim() ||
                    "Empty until they talk. Decisions, what is still open, next, and what done means."}
                </p>
              </div>
            </div>
          ) : null}

          <section className="mt-8">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
              Idea board
            </p>
            <ul className="mt-3 space-y-2">
              {data.ideas.length === 0 ? (
                <li className="text-sm text-muted">Nothing posted yet. You or any seat can put one up.</li>
              ) : (
                data.ideas.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <span className="text-muted">{item.author}. </span>
                    {item.body}
                  </li>
                ))
              )}
            </ul>
            <div className="mt-3 flex gap-2">
              <input
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                maxLength={400}
                placeholder="Post an idea"
                className="h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm"
              />
              <Button variant="secondary" onClick={() => ideaMut.mutate()} disabled={ideaMut.isPending}>
                Post
              </Button>
            </div>
          </section>

          <div className="mt-8 space-y-3">
            {data.turns.length === 0 && !speak.isPending ? (
              <p className="text-sm text-muted">
                Nobody has spoken. Say something, or let them talk.
              </p>
            ) : null}
            {data.turns.map((t) => {
              const name = t.providerId === "user" ? "You" : (providerById(t.providerId)?.name ?? t.providerId);
              return (
                <article
                  key={t.id}
                  className="rounded-[var(--radius-lg)] border border-border bg-surface p-4"
                >
                  <h3 className="font-display text-xl tracking-tight">{name}</h3>
                  {t.error ? (
                    <p className="mt-2 text-sm text-danger">{t.error}</p>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{t.content}</p>
                  )}
                </article>
              );
            })}
          </div>

          <div className="mt-4">
            <Textarea
              className="min-h-20"
              placeholder={data.table.userAway ? "You stepped out." : "Say it at the table."}
              value={message}
              disabled={data.table.userAway}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                onClick={() => speak.mutate(message)}
                disabled={speak.isPending || data.table.userAway || seats.length < 2}
              >
                {speak.isPending ? "They're talking…" : "Send"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => speak.mutate("")}
                disabled={speak.isPending || seats.length < 2}
              >
                Let them talk
              </Button>
              {missing.length > 0 ? (
                <p className="text-xs text-muted">
                  {missing.length} missing a key.{" "}
                  <Link to="/keys" className="underline underline-offset-4">
                    Add keys
                  </Link>
                </p>
              ) : null}
            </div>
          </div>

          <section className="mt-10 border-t border-border pt-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-subtle">Between seats</p>
            {data.whispers.length === 0 ? (
              <p className="mt-2 text-xs text-subtle">Nothing passed between seats.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.whispers.map((w) => (
                  <li key={w.id} className="text-xs leading-relaxed text-muted">
                    <span className="text-subtle">
                      {w.fromName} → {w.toName}.
                    </span>{" "}
                    {w.body}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <h2 className="font-display text-2xl tracking-tight">Cast</h2>
          <p className="text-xs leading-relaxed text-muted">
            Job title, job instructions, and personality are three different notes.
            The sliders are how hard each one leans.
          </p>
          {seats.map((seat, index) => (
            <div
              key={`${seat.providerId}-${index}`}
              className="space-y-2 rounded-[var(--radius-md)] border border-border bg-elevated p-3"
            >
              <select
                className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-sm"
                value={seat.providerId}
                onChange={(e) => patchSeat(index, { providerId: e.target.value }, true)}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.vendor}
                    {keyed.has(p.id) ? "" : " (no key)"}
                  </option>
                ))}
              </select>
              <input
                value={seat.jobTitle}
                maxLength={80}
                placeholder="Job title"
                onChange={(e) => patchSeat(index, { jobTitle: e.target.value })}
                onBlur={(e) => patchSeat(index, { jobTitle: e.target.value }, true)}
                className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-sm"
              />
              <textarea
                value={seat.job}
                maxLength={400}
                placeholder="Job instructions"
                onChange={(e) => patchSeat(index, { job: e.target.value })}
                onBlur={(e) => patchSeat(index, { job: e.target.value }, true)}
                className="min-h-16 w-full resize-y rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-2 text-sm"
              />
              <textarea
                value={seat.personality}
                maxLength={400}
                placeholder="Personality instructions"
                onChange={(e) => patchSeat(index, { personality: e.target.value })}
                onBlur={(e) => patchSeat(index, { personality: e.target.value }, true)}
                className="min-h-16 w-full resize-y rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-2 text-sm"
              />
              {SLIDERS.map((slider) => (
                <label key={slider.key} className="block">
                  <span className="flex justify-between text-[10px] uppercase tracking-[0.14em] text-subtle">
                    <span>{slider.label}</span>
                    <span>{seat[slider.key] as number}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={seat[slider.key] as number}
                    onChange={(e) => patchSeat(index, { [slider.key]: Number(e.target.value) })}
                    onPointerUp={(e) =>
                      patchSeat(index, { [slider.key]: Number(e.currentTarget.value) }, true)
                    }
                    className="mt-1 w-full accent-[var(--color-accent)]"
                  />
                </label>
              ))}
              <button
                type="button"
                className="text-xs text-muted hover:text-fg"
                onClick={() => {
                  const next = seats.filter((_, i) => i !== index);
                  setDraftSeats(next);
                  if (next.length) persistSeats.mutate(next);
                }}
              >
                Remove seat
              </button>
            </div>
          ))}
          {seats.length < 6 ? (
            <Button
              variant="secondary"
              onClick={() => {
                const used = new Set(seats.map((s) => s.providerId));
                const nextP = AI_PROVIDERS.find((p) => !used.has(p.id));
                if (!nextP) return;
                const next = [...seats, emptySeat(nextP.id)];
                setDraftSeats(next);
                persistSeats.mutate(next);
              }}
            >
              Add a seat
            </Button>
          ) : null}

          <div className="rounded-[var(--radius-md)] border border-border p-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">MCP</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Connect a server. If it answers, its tools are available at the table.
            </p>
            <input
              value={mcpName}
              onChange={(e) => setMcpName(e.target.value)}
              placeholder="Name"
              className="mt-3 h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-sm"
            />
            <input
              value={mcpUrl}
              onChange={(e) => setMcpUrl(e.target.value)}
              placeholder="https://your-server/mcp"
              className="mt-2 h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-sm"
            />
            <Button
              variant="secondary"
              className="mt-2"
              disabled={mcpAdd.isPending}
              onClick={() => mcpAdd.mutate()}
            >
              {mcpAdd.isPending ? "Connecting…" : "Connect"}
            </Button>
            <ul className="mt-3 space-y-2">
              {data.mcp.map((server) => {
                let count = 0;
                try {
                  count = (JSON.parse(server.tools) as unknown[]).length;
                } catch {
                  count = 0;
                }
                return (
                  <li key={server.id} className="text-xs text-muted">
                    <span className="text-fg">{server.name}</span>
                    {server.lastError ? ` — ${server.lastError}` : ` — ${count} tools`}
                    <button
                      type="button"
                      className="ml-2 underline"
                      onClick={() => mcpRemove.mutate(server.id)}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
