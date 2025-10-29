import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { syncFacebookAdCosts } from "../utils/facebook-ads";
import { getDateRangeForPeriod } from "../utils/shopify-data";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const period = formData.get("period") as string || "last30days";

  try {
    const { startDate, endDate } = getDateRangeForPeriod(period);
    
    const result = await syncFacebookAdCosts(session.shop, startDate, endDate);

    if (result.success) {
      return json({ 
        success: true, 
        message: `Successfully synced $${result.amount.toFixed(2)} in Facebook ad spend`,
        amount: result.amount
      });
    } else {
      return json({ 
        success: false, 
        error: result.error || "Failed to sync Facebook ads"
      }, { status: 400 });
    }
  } catch (error) {
    console.error("Sync error:", error);
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    }, { status: 500 });
  }
};

