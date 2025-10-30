import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../utils/database";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const { credentials } = await request.json();

  try {
    // Update the integration with new selected ad account
    const integration = await prisma.integration.update({
      where: {
        shop_platform: {
          shop: session.shop,
          platform: "facebook_ads",
        },
      },
      data: {
        credentials: credentials,
      },
    });

    return json({ success: true });
  } catch (error) {
    console.error("Error updating Facebook account:", error);
    return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
};
