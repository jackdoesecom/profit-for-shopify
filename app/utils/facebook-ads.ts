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

export async function syncFacebookHistoricalData(
  shop: string,
  days: number = 90
): Promise<{ success: boolean; totalAmount: number; error?: string }> {
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
      return { success: false, totalAmount: 0, error: "Facebook Ads not connected" };
    }

    const credentials = JSON.parse(integration.credentials);
    const accessToken = credentials.accessToken;
    const selectedAdAccountId = credentials.selectedAdAccountId;

    if (!selectedAdAccountId) {
      return { success: false, totalAmount: 0, error: "No ad account selected" };
    }

    let totalAmount = 0;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    console.log(`[FB Sync] ===== SYNC START =====`);
    console.log(`[FB Sync] Current system date: ${new Date().toISOString()}`);
    console.log(`[FB Sync] Requesting ${days} days of data`);
    console.log(`[FB Sync] Calculated date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Fetch daily insights for the entire range
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];
    
    console.log(`[FB API] Formatted date range for API: ${formattedStartDate} to ${formattedEndDate}`);
    
    // Handle pagination - Facebook returns data in pages
    let allInsights: FacebookInsight[] = [];
    let nextUrl = `https://graph.facebook.com/v18.0/${selectedAdAccountId}/insights?` +
      `fields=spend,date_start,date_stop&` +
      `time_range={"since":"${formattedStartDate}","until":"${formattedEndDate}"}` +
      `&time_increment=1` + // Daily breakdown
      `&limit=90` + // Request more items per page
      `&access_token=${accessToken}`;
    
    let pageCount = 0;
    while (nextUrl && pageCount < 20) { // Safety limit to prevent infinite loops
      console.log(`[FB API] Fetching page ${pageCount + 1}...`);
      const response = await fetch(nextUrl);
      const data = await response.json();
      
      if (data.error) {
        console.error("Facebook Insights API error:", data.error);
        if (pageCount === 0) {
          return { success: false, totalAmount: 0, error: data.error.message };
        }
        break; // Use what we have so far
      }
      
      const pageInsights = data.data || [];
      allInsights = allInsights.concat(pageInsights);
      console.log(`[FB API] Page ${pageCount + 1}: Got ${pageInsights.length} insights (total: ${allInsights.length})`);
      
      // Check for next page
      nextUrl = data.paging?.next || null;
      pageCount++;
    }

    // Store each day's spend in the database
    const insights = allInsights;
    console.log(`[FB API] Received ${insights.length} total daily insights from Facebook across ${pageCount} pages`);
    
    if (insights.length > 0) {
      console.log(`[FB API] First insight returned: ${insights[0].date_start}`);
      console.log(`[FB API] Last insight returned: ${insights[insights.length - 1].date_start}`);
      
      // Show date range coverage
      const firstDate = new Date(insights[0].date_start);
      const lastDate = new Date(insights[insights.length - 1].date_start);
      const daysCovered = Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`[FB API] Date range coverage: ${daysCovered} days between first and last insight`);
    } else {
      console.log(`[FB API] WARNING: No insights returned from Facebook!`);
    }

    let storedCount = 0;
    let skippedCount = 0;
    const storedDates: string[] = [];
    
    for (const insight of insights) {
      const spend = parseFloat(insight.spend || '0');
      const insightDate = new Date(insight.date_start);
      
      if (spend > 0) {
        // Check if we already have data for this date
        const dayStart = new Date(insightDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(insightDate);
        dayEnd.setHours(23, 59, 59, 999);
        
        const existing = await prisma.marketingCost.findFirst({
          where: {
            shop,
            platform: "facebook",
            date: {
              gte: dayStart,
              lt: dayEnd,
            },
          },
        });

        // Normalize date to start of day (midnight) to match query ranges
        const costDate = new Date(insight.date_start);
        costDate.setHours(0, 0, 0, 0);
        
        if (existing) {
          // Update existing entry
          await prisma.marketingCost.update({
            where: { id: existing.id },
            data: {
              amount: spend,
              date: costDate,
              description: `Facebook Ads spend for ${insight.date_start}`,
            },
          });
        } else {
          // Create new entry
          await prisma.marketingCost.create({
            data: {
              shop,
              platform: "facebook",
              amount: spend,
              date: costDate,
              description: `Facebook Ads spend for ${insight.date_start}`,
            },
          });
        }
        
        storedCount++;
        storedDates.push(insight.date_start);
        totalAmount += spend;
      } else {
        skippedCount++;
      }
    }

    // Update last sync time
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSync: new Date() },
    });

    console.log(`[FB Sync] ===== SYNC COMPLETE =====`);
    console.log(`[FB Sync] Stored ${storedCount} days with data, skipped ${skippedCount} days with $0`);
    console.log(`[FB Sync] Total amount: $${totalAmount}`);
    if (storedDates.length > 0) {
      console.log(`[FB Sync] Date range stored: ${storedDates[0]} to ${storedDates[storedDates.length - 1]}`);
    }
    
    return { success: true, totalAmount };
  } catch (error) {
    console.error("Error syncing Facebook historical data:", error);
    return { 
      success: false, 
      totalAmount: 0, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
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

