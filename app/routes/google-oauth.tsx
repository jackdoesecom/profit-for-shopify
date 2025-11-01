import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "../utils/database";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // This is the shop domain
  const error = url.searchParams.get("error");

  console.log("[Google OAuth] Starting OAuth callback");
  console.log("[Google OAuth] Code exists:", !!code);
  console.log("[Google OAuth] State (shop):", state);
  console.log("[Google OAuth] Error:", error);

  if (error) {
    console.error("[Google OAuth] OAuth error:", error);
    return redirect(`/app/settings?error=${encodeURIComponent("Google OAuth failed: " + error)}`);
  }

  if (!code || !state) {
    console.error("[Google OAuth] Missing code or state");
    return redirect("/app/settings?error=" + encodeURIComponent("Missing authorization code or shop"));
  }

  try {
    // Exchange authorization code for access token
    const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || "https://profit-for-shopify-production.up.railway.app/google-oauth";
    
    console.log("[Google OAuth] Starting token exchange");
    console.log("[Google OAuth] Redirect URI:", redirectUri);
    console.log("[Google OAuth] Client ID:", process.env.GOOGLE_ADS_CLIENT_ID || "NOT SET");
    console.log("[Google OAuth] Client Secret exists:", !!process.env.GOOGLE_ADS_CLIENT_SECRET);

    if (!process.env.GOOGLE_ADS_CLIENT_ID || !process.env.GOOGLE_ADS_CLIENT_SECRET) {
      console.error("[Google OAuth] Missing Google credentials!");
      console.error("[Google OAuth] GOOGLE_ADS_CLIENT_ID:", process.env.GOOGLE_ADS_CLIENT_ID || "NOT SET");
      console.error("[Google OAuth] GOOGLE_ADS_CLIENT_SECRET:", process.env.GOOGLE_ADS_CLIENT_SECRET ? "SET" : "NOT SET");
      return redirect("/app/settings?error=" + encodeURIComponent("Google credentials not configured on server"));
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code: code,
        client_id: process.env.GOOGLE_ADS_CLIENT_ID,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    console.log("[Google OAuth] Token response status:", tokenResponse.status);

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("[Google OAuth] Token exchange failed:", errorText);
      return redirect("/app/settings?error=" + encodeURIComponent("Failed to get access token"));
    }

    const tokenData = await tokenResponse.json();
    console.log("[Google OAuth] Token data received:", {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    });

    if (!tokenData.access_token) {
      console.error("[Google OAuth] No access token in response");
      return redirect("/app/settings?error=" + encodeURIComponent("No access token received"));
    }

    // Store the credentials in the database
    const credentials = JSON.stringify({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      scope: tokenData.scope,
    });

    await prisma.integration.upsert({
      where: {
        shop_platform: {
          shop: state,
          platform: "google_ads",
        },
      },
      update: {
        credentials: credentials,
        isActive: true,
        lastSync: null, // Reset last sync when reconnecting
      },
      create: {
        shop: state,
        platform: "google_ads",
        credentials: credentials,
        isActive: true,
      },
    });

    console.log("[Google OAuth] Successfully stored Google Ads credentials for shop:", state);

    // Trigger initial sync in the background
    const { syncGoogleHistoricalData } = await import("../utils/google-ads");
    syncGoogleHistoricalData(state, 365).catch(error => {
      console.error("[Google OAuth] Background sync failed:", error);
    });

    return redirect("/app/settings?success=google");
  } catch (error) {
    console.error("[Google OAuth] Unexpected error:", error);
    return redirect("/app/settings?error=" + encodeURIComponent("Failed to connect Google Ads"));
  }
};

// Initiate Google OAuth flow
export const action = async ({ request }: LoaderFunctionArgs) => {
  const formData = await request.formData();
  const shop = formData.get("shop") as string;

  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || "https://profit-for-shopify-production.up.railway.app/google-oauth";
  
  if (!process.env.GOOGLE_ADS_CLIENT_ID || !process.env.GOOGLE_ADS_CLIENT_SECRET) {
    console.error("[Google OAuth] Missing credentials");
    return json({ error: "Google Ads credentials not configured" }, { status: 500 });
  }

  const authUrl = 
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.GOOGLE_ADS_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent("https://www.googleapis.com/auth/adwords")}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${encodeURIComponent(shop)}`;

  console.log("Redirecting to Google OAuth:", authUrl.substring(0, 100) + "...");
  console.log("Using App ID:", process.env.GOOGLE_ADS_CLIENT_ID);
  console.log("Using Redirect URI:", redirectUri);

  return redirect(authUrl);
};

