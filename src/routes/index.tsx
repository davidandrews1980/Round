import { createFileRoute, Link } from "@tanstack/react-router";
import { AdSlot } from "@/components/ad-slot";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Mark } from "@/lib/logo";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:py-20">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Roundtable
        </p>
        <h1 className="mt-4 max-w-3xl font-display text-5xl leading-[1.05] tracking-tight text-fg sm:text-6xl">
          Stay at the table.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
          Open talk, a project you can finish, or both. Each seat has a job
          title, job instructions, personality instructions, and sliders for how
          they lean. The idea board is open to you and to them. You can step
          out. The cast is told you left.
        </p>
        <div className="mt-10">
          <Button asChild>
            <Link to="/roundtable">
              Open the table
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <div className="mt-12 max-w-xl">
          <AdSlot slot="home-mid" label="House ad until this slot sells" />
        </div>
        <div className="mt-16 flex items-start gap-3 text-sm text-muted">
          <Mark className="mt-0.5 size-5 shrink-0" />
          <p className="max-w-2xl leading-relaxed">
            Your keys. The job and the personality are separate instructions.
            A connected MCP server can put its tools on the table. A seat with
            no key stays quiet.
          </p>
        </div>
      </main>
    </AppShell>
  );
}
