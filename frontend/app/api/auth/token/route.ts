/**
 * app/api/auth/token/route.ts
 * Next.js API Route — issues a short-lived dashboard JWT for the authenticated
 * SIX portal user. In production this validates the SIX session cookie/SAML
 * assertion and calls the FastAPI backend to exchange it for a dashboard token.
 *
 * For now it returns a placeholder so the WebSocket hook has a token to use
 * during development without a real auth system.
 *
 * POST /api/auth/token
 * Body: { nim: string, password: string }   ← replace with real auth
 */
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { nim } = body as { nim?: string };

  if (!nim) {
    return NextResponse.json({ error: "NIM is required." }, { status: 400 });
  }

  // ── In production: validate credentials against SIX LDAP / SSO ──────────
  // For development, return the token from .env.local
  const token = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN;
  if (!token || token === "REPLACE_WITH_DASHBOARD_JWT") {
    return NextResponse.json(
      { error: "Dashboard token not configured. Set NEXT_PUBLIC_DASHBOARD_TOKEN in .env.local." },
      { status: 503 },
    );
  }

  return NextResponse.json({ token, nim }, { status: 200 });
}
