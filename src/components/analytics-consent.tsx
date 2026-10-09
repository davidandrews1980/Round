import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const GA_ID = "G-4HJCSN18F9";
const STORAGE_KEY = "rt-analytics-consent";

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

function readChoice(): "accepted" | "declined" | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

function storeChoice(choice: "accepted" | "declined") {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage unavailable — choice only lasts for this page view */
  }
}

/** Load Google Analytics. Called ONLY after the visitor accepted. Idempotent. */
function loadAnalytics() {
  const w = window as GtagWindow;
  if (document.getElementById("ga-gtag-js")) return;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // gtag.js reads the `arguments` object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag("js", new Date());
  w.gtag("config", GA_ID);
  const script = document.createElement("script");
  script.id = "ga-gtag-js";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);
}

/**
 * Cookie/analytics consent. Nothing from Google is requested until the visitor
 * presses Accept; the choice lives in localStorage. Returning accepters get
 * analytics on load, decliners never do.
 */
export function AnalyticsConsent() {
  const [choice, setChoice] = useState<"accepted" | "declined" | "unset" | "pending">(
    "pending",
  );

  useEffect(() => {
    const saved = readChoice();
    if (saved === "accepted") loadAnalytics();
    setChoice(saved ?? "unset");
  }, []);

  if (choice !== "unset") return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-elevated px-4 py-3 text-xs text-muted shadow-lg"
    >
      <p className="min-w-0 flex-1 leading-relaxed">
        Can we use cookies for anonymous usage analytics (Google Analytics)?
        Nothing loads unless you accept.
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            storeChoice("declined");
            setChoice("declined");
          }}
        >
          Decline
        </Button>
        <Button
          size="sm"
          onClick={() => {
            storeChoice("accepted");
            setChoice("accepted");
            loadAnalytics();
          }}
        >
          Accept
        </Button>
      </div>
    </div>
  );
}
