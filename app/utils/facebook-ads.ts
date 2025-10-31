import { prisma } from "./database";

interface FacebookAdAccount {
  id: string;
  name: string;
}

interface FacebookInsight {
  spend: string;
  date_start: string;
  date_stop: string;
}

export async function getFacebookAdAccounts(accessToken: string): Promise<FacebookAdAccount[]> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/adaccounts?fields=id,name&access_token=${accessToken}`
    );
    
    const data = await response.json();
    
    if (data.error) {
      console.error("Facebook API error:", data.error);
      return [];
    }
    
    return data.data || [];
  } catch (error) {
    console.error("Error fetching Facebook ad accounts:", error);
    return [];
  }
}

export async function fetchFacebookAdSpend(
  accessToken: string,
  adAccountId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  try {
    // Facebook expects date format: YYYY-MM-DD
    const formattedStartDate = startDate.split('T')[0];
    const formattedEndDate = endDate.split('T')[0];
    
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${adAccountId}/insights?` +
      `fields=spend&` +
      `time_range={"since":"${formattedStartDate}","until":"${formattedEndDate}"}` +
      `&access_token=${accessToken}`
    );
    
    const data = await response.json();
    
    if (data.error) {
      console.error("Facebook Insights API error:", data.error);
      return 0;
    }
    
    // Sum up spend from all insights
    const totalSpend = (data.data || []).reduce((sum: number, insight: FacebookInsight) => {
      return sum + parseFloat(insight.spend || '0');
    }, 0);
    
    return totalSpend;
  } catch (error) {
    console.error("Error fetching Facebook ad spend:", error);
    return 0;
  }
}

export async function syncFacebookAdCosts(
  shop: string,
  startDate: Date,
  endDate: Date
): Promise<{ success: boolean; amount: number; error?: string }> {
  try {
    // Get Facebook integration
    const integration = await prisma.integration.findFirst({
      where: {
        shop,
        platform: "facebook_ads",
        isActive: true,
      },
    });

    if (!integration || !integration.credentials) {
      return { success: false, amount: 0, error: "Facebook Ads not connected" };
    }

    const credentials = JSON.parse(integration.credentials);
    const accessToken = credentials.accessToken;
    const selectedAdAccountId = credentials.selectedAdAccountId;

    // If no ad account selected, try to get accounts
    if (!selectedAdAccountId) {
      const adAccounts = await getFacebookAdAccounts(accessToken);
      if (adAccounts.length === 0) {
        return { success: false, amount: 0, error: "No Facebook ad accounts found" };
      }
      // Use first account by default
      credentials.selectedAdAccountId = adAccounts[0].id;
    }

    let totalSpend = 0;

    // Fetch spend only for selected ad account
    if (credentials.selectedAdAccountId) {
      const spend = await fetchFacebookAdSpend(
        accessToken,
        credentials.selectedAdAccountId,
        startDate.toISOString(),
        endDate.toISOString()
      );
      totalSpend = spend;
    }

    // Store the cost in the database
    if (totalSpend > 0) {
      await prisma.marketingCost.create({
        data: {
          shop,
          platform: "facebook",
          amount: totalSpend,
          date: endDate, // Use the end date of the range being synced
          description: `Facebook Ads spend (${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()})`,
        },
      });
    }

    // Update last sync time
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSync: new Date() },
    });

    return { success: true, amount: totalSpend };
  } catch (error) {
    console.error("Error syncing Facebook ad costs:", error);
    return { 
      success: false, 
      amount: 0, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

