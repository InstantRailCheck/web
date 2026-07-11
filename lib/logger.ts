import "server-only";

// A minimal, dependency-free structured logger — Vercel captures stdout/
// stderr from serverless functions automatically, so a JSON line per
// event is immediately queryable in its log viewer (or any log
// aggregation service later) without standing up new infrastructure
// first. Exists specifically to replace the pattern of a Supabase query
// failing and the code silently falling back to an empty array/null with
// no server-side trail at all — see lib/bankProfile.ts's buildProfile()
// and app/page.tsx for the first real call sites.
type LogContext = Record<string, unknown>;

function emit(level: "error" | "warn", message: string, context?: LogContext) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };
  console[level](JSON.stringify(entry));
}

export function logError(message: string, context?: LogContext) {
  emit("error", message, context);
}

export function logWarn(message: string, context?: LogContext) {
  emit("warn", message, context);
}
