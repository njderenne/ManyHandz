"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, Fingerprint } from "lucide-react";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

const loginSchema = z.object({
  email: z.email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get("redirect") ?? "/dashboard";
  // Prevent open redirect: only allow relative paths
  const redirectTo = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/dashboard";
  const errorParam = searchParams.get("error");

  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [supportsPasskey, setSupportsPasskey] = useState(false);
  const [passkeyEmail, setPasskeyEmail] = useState("");

  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const emailValue = watch("email");

  useEffect(() => {
    setSupportsPasskey(browserSupportsWebAuthn());
  }, []);

  useEffect(() => {
    if (errorParam === "auth_callback_error") {
      toast.error("Authentication failed. Please try again.");
    }
  }, [errorParam]);

  async function onSubmit(data: LoginFormData) {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("Signed in successfully");
      router.push(redirectTo);
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setIsGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/callback?next=${encodeURIComponent(redirectTo)}`,
        },
      });

      if (error) {
        toast.error(error.message);
        setIsGoogleLoading(false);
      }
    } catch {
      toast.error("Failed to initiate Google sign in");
      setIsGoogleLoading(false);
    }
  }

  async function handlePasskeySignIn() {
    const email = passkeyEmail || emailValue;
    if (!email) {
      toast.error("Please enter your email address first");
      return;
    }

    setIsPasskeyLoading(true);
    try {
      const optionsRes = await fetch("/api/auth/webauthn/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!optionsRes.ok) {
        const err = await optionsRes.json();
        toast.error(err.error || "No passkey found for this account");
        return;
      }

      const options = await optionsRes.json();
      // Strip userId from options — server derives it from the credential
      const { userId: _uid, ...authOptions } = options;

      const credential = await startAuthentication({ optionsJSON: authOptions });

      const verifyRes = await fetch("/api/auth/webauthn/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });

      if (!verifyRes.ok) {
        toast.error("Passkey verification failed");
        return;
      }

      const { verified, token_hash } = await verifyRes.json();
      if (verified && token_hash) {
        // Exchange the server-generated token for a proper Supabase session
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash,
          type: "magiclink",
        });

        if (otpError) {
          toast.error("Failed to create session: " + otpError.message);
          return;
        }

        toast.success("Signed in with passkey");
        router.push(redirectTo);
        router.refresh();
      } else {
        toast.error("Passkey verification failed");
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        toast.error("Passkey authentication was cancelled");
      } else {
        toast.error("Passkey authentication failed");
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] p-4">
      <Card className="w-full max-w-md border-[var(--border-default)] bg-[var(--bg-secondary)]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-[var(--text-primary)]">
            Welcome back
          </CardTitle>
          <CardDescription className="text-[var(--text-secondary)]">
            Sign in to your ManyHandz account
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Google Sign In */}
          <Button
            variant="outline"
            size="lg"
            className="w-full gap-3 border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            onClick={handleGoogleSignIn}
            disabled={isGoogleLoading}
          >
            {isGoogleLoading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <svg className="size-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
            )}
            Sign in with Google
          </Button>

          {/* Passkey Sign In */}
          {supportsPasskey && (
            <>
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="Email for passkey"
                  value={passkeyEmail || emailValue}
                  onChange={(e) => setPasskeyEmail(e.target.value)}
                  className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full gap-3 border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  onClick={handlePasskeySignIn}
                  disabled={isPasskeyLoading}
                >
                  {isPasskeyLoading ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Fingerprint className="size-5" />
                  )}
                  Sign in with Passkey
                </Button>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="relative flex items-center gap-4 py-2">
            <Separator className="flex-1 bg-[var(--border-default)]" />
            <span className="text-xs uppercase text-[var(--text-muted)]">
              or continue with email
            </span>
            <Separator className="flex-1 bg-[var(--border-default)]" />
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[var(--text-secondary)]">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-sm text-[var(--accent-danger)]">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[var(--text-secondary)]">
                  Password
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-sm text-[var(--accent-danger)]">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)]"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center">
          <p className="text-sm text-[var(--text-muted)]">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="font-medium text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-colors"
            >
              Sign up
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
