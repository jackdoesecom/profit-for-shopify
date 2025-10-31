import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { prisma } from "../utils/database";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  
  // Check if this is a callback from Facebook
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state"); // This contains the shop domain

  if (error) {
    console.error("Facebook auth error:", error);
    if (state) {
      const shopSlug = state.replace('.myshopify.com', '');
      return redirect(`https://admin.shopify.com/store/${shopSlug}/apps/profit-analytics-7/app/settings?error=facebook_auth_failed`);
    }
    return redirect("/auth/login");
  }

  if (code && state) {
    // Exchange code for access token
    try {
      // Use Railway URL for production
      const redirectUri = process.env.FACEBOOK_REDIRECT_URI || "https://profit-for-shopify-production.up.railway.app/facebook-oauth";
      
      console.log("[FB OAuth] Starting token exchange");
      console.log("[FB OAuth] Redirect URI:", redirectUri);
      console.log("[FB OAuth] App ID:", process.env.FACEBOOK_APP_ID || "NOT SET");
      console.log("[FB OAuth] App Secret exists:", !!process.env.FACEBOOK_APP_SECRET);
      console.log("[FB OAuth] Code length:", code?.length);
      console.log("[FB OAuth] State (shop):", state);
      
      // Check if credentials are missing
      if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
        console.error("[FB OAuth] MISSING FACEBOOK CREDENTIALS IN ENVIRONMENT!");
        console.error("[FB OAuth] FACEBOOK_APP_ID:", process.env.FACEBOOK_APP_ID || "NOT SET");
        console.error("[FB OAuth] FACEBOOK_APP_SECRET:", process.env.FACEBOOK_APP_SECRET ? "SET" : "NOT SET");
        const shopSlug = state.replace('.myshopify.com', '');
        return redirect(`https://admin.shopify.com/store/${shopSlug}/apps/profit-analytics-7/app/settings?error=missing_fb_credentials`);
      }
      
      const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
        `client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
        `&code=${code}`;
      
      console.log("[FB OAuth] Making token request...");
      
      const tokenResponse = await fetch(tokenUrl, {
        method: 'GET'
      });

      console.log("[FB OAuth] Token response status:", tokenResponse.status);
      const responseText = await tokenResponse.text();
      console.log("[FB OAuth] Raw response:", responseText);
      
      let tokenData;
      try {
        tokenData = JSON.parse(responseText);
      } catch (e) {
        console.error("[FB OAuth] Failed to parse response:", e);
        const shopSlug = state.replace('.myshopify.com', '');
        return redirect(`https://admin.shopify.com/store/${shopSlug}/apps/profit-analytics-7/app/settings?error=invalid_fb_response`);
      }
      
      console.log("[FB OAuth] Parsed token response:", tokenData);
      
      // Check for Facebook API errors
      if (tokenData.error) {
        console.error("[FB OAuth] Facebook API Error:", tokenData.error);
        console.error("[FB OAuth] Error type:", tokenData.error.type);
        console.error("[FB OAuth] Error message:", tokenData.error.message);
        console.error("[FB OAuth] Error description:", tokenData.error_description);
        const shopSlug = state.replace('.myshopify.com', '');
        
        // Pass error details in URL for debugging
        const errorMsg = encodeURIComponent(tokenData.error_description || tokenData.error.message || tokenData.error.type || "Unknown error");
        return redirect(`https://admin.shopify.com/store/${shopSlug}/apps/profit-analytics-7/app/settings?error=facebook_api_error&msg=${errorMsg}`);
      }

      if (tokenData.access_token) {
        // Get ad accounts to let user select
        const adAccountsResponse = await fetch(
          `https://graph.facebook.com/v18.0/me/adaccounts?fields=id,name,currency,account_status&access_token=${tokenData.access_token}`
        );
        const adAccountsData = await adAccountsResponse.json();
        console.log("Ad accounts:", adAccountsData);
        
        // Store the credentials with ad accounts
        await prisma.integration.upsert({
          where: {
            shop_platform: {
              shop: state,
              platform: "facebook_ads",
            },
          },
          update: {
            credentials: JSON.stringify({
              accessToken: tokenData.access_token,
              tokenType: tokenData.token_type,
              expiresIn: tokenData.expires_in,
              adAccounts: adAccountsData.data || [],
              selectedAdAccountId: adAccountsData.data?.[0]?.id || null, // Default to first account
            }),
            isActive: true,
            lastSync: new Date(),
          },
          create: {
            shop: state,
            platform: "facebook_ads",
            credentials: JSON.stringify({
              accessToken: tokenData.access_token,
              tokenType: tokenData.token_type,
              expiresIn: tokenData.expires_in,
              adAccounts: adAccountsData.data || [],
              selectedAdAccountId: adAccountsData.data?.[0]?.id || null,
            }),
            isActive: true,
            lastSync: new Date(),
          },
        });

        // Redirect back to app in Shopify admin
        const shopSlug = state.replace('.myshopify.com', '');
        return redirect(`https://admin.shopify.com/store/${shopSlug}/apps/profit-analytics-7/app/settings?success=facebook_connected`);
      } else {
        console.error("No access token in response:", tokenData);
        const shopSlug = state.replace('.myshopify.com', '');
        return redirect(`https://admin.shopify.com/store/${shopSlug}/apps/profit-analytics-7/app/settings?error=no_token`);
      }
    } catch (error) {
      console.error("Error exchanging Facebook code:", error);
      if (state) {
        const shopSlug = state.replace('.myshopify.com', '');
        return redirect(`https://admin.shopify.com/store/${shopSlug}/apps/profit-analytics-7/app/settings?error=facebook_token_failed`);
      }
      return redirect("/auth/login");
    }
  }

  // Initial OAuth redirect to Facebook
  const shop = url.searchParams.get("shop");
  
  if (!shop) {
    return redirect("/auth/login?error=missing_shop");
  }

  // Use Railway URL for production
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI || "https://profit-for-shopify-production.up.railway.app/facebook-oauth";
  
  // Check if Facebook credentials exist
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
    console.error("Facebook credentials not set in environment variables!");
    console.error("FACEBOOK_APP_ID:", process.env.FACEBOOK_APP_ID ? "Set" : "MISSING");
    console.error("FACEBOOK_APP_SECRET:", process.env.FACEBOOK_APP_SECRET ? "Set" : "MISSING");
    return redirect("/auth/login?error=fb_credentials_missing");
  }
  
  const fbAuthUrl = 
    `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${process.env.FACEBOOK_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=ads_read,business_management` +
    `&state=${shop}`;

  console.log("Redirecting to Facebook OAuth:", fbAuthUrl);
  console.log("Using App ID:", process.env.FACEBOOK_APP_ID);
  console.log("Using Redirect URI:", redirectUri);
  
  return redirect(fbAuthUrl);
};

