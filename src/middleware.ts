import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/callback",
  "/terms",
  "/privacy",
  "/join",
];

const AUTH_ROUTES = ["/login", "/signup"];
const ALWAYS_ALLOWED = ["/billing", "/api/stripe", "/api/auth/webauthn"];

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Referrer-Policy",
    "strict-origin-when-cross-origin"
  );
  response.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=()"
  );
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com; frame-src https://js.stripe.com; font-src 'self'"
  );
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and API webhooks
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Webhook routes skip auth but need security headers
  if (
    pathname === "/api/stripe/webhook" ||
    pathname === "/api/webhooks/supabase"
  ) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Cron routes verify CRON_SECRET
  if (pathname.startsWith("/api/cron/")) {
    const cronSecret = request.headers.get("authorization");
    if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    return addSecurityHeaders(NextResponse.next());
  }

  const { user, response } = await updateSession(request);

  // Redirect authenticated users away from auth routes
  if (user && AUTH_ROUTES.some((r) => pathname === r)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return addSecurityHeaders(NextResponse.redirect(url));
  }

  // Check if route is public
  const isPublic = PUBLIC_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );
  const isAlwaysAllowed = ALWAYS_ALLOWED.some((r) =>
    pathname.startsWith(r)
  );

  if (!isPublic && !isAlwaysAllowed && !pathname.startsWith("/api/")) {
    // Protected route — require auth
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
      return addSecurityHeaders(NextResponse.redirect(url));
    }
  }

  // Subscription enforcement is handled at the DB level via RLS policies.
  // No client-side header needed — the billing page and hooks query status directly.

  return addSecurityHeaders(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
