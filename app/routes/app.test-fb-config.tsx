import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  // Test Facebook configuration
  const config = {
    hasAppId: !!process.env.FACEBOOK_APP_ID,
    appId: process.env.FACEBOOK_APP_ID ? `${process.env.FACEBOOK_APP_ID.substring(0, 4)}...${process.env.FACEBOOK_APP_ID.substring(process.env.FACEBOOK_APP_ID.length - 4)}` : "NOT SET",
    hasAppSecret: !!process.env.FACEBOOK_APP_SECRET,
    hasRedirectUri: !!process.env.FACEBOOK_REDIRECT_URI,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI || "NOT SET",
    nodeEnv: process.env.NODE_ENV,
    allEnvKeys: Object.keys(process.env).filter(key => key.startsWith('FACEBOOK') || key.startsWith('SHOPIFY')).sort(),
  };
  
  console.log("[Test FB Config] Environment check:", config);
  
  return json(config);
};
