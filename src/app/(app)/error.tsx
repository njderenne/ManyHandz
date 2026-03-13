"use client";

import Link from "next/link";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-red-500/10">
          <AlertTriangle className="size-7 text-red-500" />
        </div>

        <h2 className="mt-5 text-xl font-bold text-[var(--text-primary)]">
          Something went wrong
        </h2>

        <p className="mt-2 max-w-sm text-sm text-[var(--text-muted)]">
          An unexpected error occurred. Try refreshing, or head back to the
          dashboard.
        </p>

        {error.digest && (
          <p className="mt-2 text-xs text-[var(--text-muted)]/60">
            Error ID: {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button
            onClick={reset}
            className="gap-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
          >
            <RefreshCw className="size-4" />
            Try Again
          </Button>
          <Button
            variant="outline"
            asChild
            className="gap-2 border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Link href="/dashboard">
              <Home className="size-4" />
              Dashboard
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
