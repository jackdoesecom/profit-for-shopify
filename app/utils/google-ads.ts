import { prisma } from "./database";

interface GoogleAdAccount {
  id: string;
  name: string;
  customerId: string;
}

export async function getGoogleAdAccounts(accessToken: string): Promise<GoogleAdAccount[]> {
  try {
    // Use Google Ads API to list accessible customers
    const response = await fetch(
      `https://googleads.googleapis.com/v16/customers:listAccessibleCustomers`,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
        },
      }
    );
    
    const data = await response.json();
    
    if (data.error) {
      console.error("Google Ads API error:", data.error);
      return [];
    }
    
    // Transform the response
    const accounts = (data.resourceNames || []).map((resourceName: string) => {
      const customerId = resourceName.split('/')[1];
      return {
        id: resourceName,
        customerId: customerId,
        name: `Customer ${customerId}`,
      };
    });
    
    return accounts;
  } catch (error) {
    console.error("Error fetching Google ad accounts:", error);
    return [];
  }
}

export async function syncGoogleHistoricalData(
  shop: string,
  days: number = 90
): Promise<{ success: boolean; totalAmount: number; error?: string }> {
  try {
    // Get Google integration
    const integration = await prisma.integration.findFirst({
      where: {
        shop,
        platform: "google_ads",
        isActive: true,
      },
    });

    if (!integration || !integration.credentials) {
      return { success: false, totalAmount: 0, error: "Google Ads not connected" };
    }

    const credentials = JSON.parse(integration.credentials);
    let accessToken = credentials.accessToken;

    // Check if token needs refresh
    if (credentials.expiresAt && Date.now() >= credentials.expiresAt) {
      console.log("[Google Sync] Access token expired, refreshing...");
      const newTokens = await refreshGoogleToken(credentials.refreshToken);
      if (!newTokens) {
        return { success: false, totalAmount: 0, error: "Failed to refresh Google token" };
      }
      accessToken = newTokens.accessToken;
      
      // Update stored credentials
      const updatedCredentials = {
        ...credentials,
        accessToken: newTokens.accessToken,
        expiresAt: Date.now() + (newTokens.expiresIn * 1000),
      };
      
      await prisma.integration.update({
        where: { id: integration.id },
        data: { credentials: JSON.stringify(updatedCredentials) },
      });
    }

    const selectedCustomerId = credentials.selectedCustomerId;

    if (!selectedCustomerId) {
      return { success: false, totalAmount: 0, error: "No Google Ads customer selected" };
    }

    let totalAmount = 0;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    console.log(`[Google Sync] ===== SYNC START =====`);
    console.log(`[Google Sync] Current system date: ${new Date().toISOString()}`);
    console.log(`[Google Sync] Requesting ${days} days of data`);
    console.log(`[Google Sync] Calculated date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Format dates for Google Ads API (YYYY-MM-DD)
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];
    
    console.log(`[Google API] Formatted date range for API: ${formattedStartDate} to ${formattedEndDate}`);

    // Use Google Ads Query Language (GAQL) to get daily metrics
    const query = `
      SELECT
        segments.date,
        metrics.cost_micros
      FROM campaign
      WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'
    `;

    const response = await fetch(
      `https://googleads.googleapis.com/v16/customers/${selectedCustomerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Google API] Request failed:", errorText);
      return { success: false, totalAmount: 0, error: "Google Ads API request failed" };
    }

    const data = await response.json();
    
    if (data.error) {
      console.error("[Google API] Error:", data.error);
      return { success: false, totalAmount: 0, error: data.error.message };
    }

    // Process results and aggregate by date
    const dailySpend = new Map<string, number>();
    
    for (const result of data.results || []) {
      const date = result.segments?.date;
      const costMicros = result.metrics?.costMicros || 0;
      const cost = costMicros / 1000000; // Convert micros to dollars
      
      if (date && cost > 0) {
        const currentCost = dailySpend.get(date) || 0;
        dailySpend.set(date, currentCost + cost);
      }
    }

    console.log(`[Google API] Received ${dailySpend.size} days with spend data`);
    
    if (dailySpend.size > 0) {
      const dates = Array.from(dailySpend.keys()).sort();
      console.log(`[Google API] First date returned: ${dates[0]}`);
      console.log(`[Google API] Last date returned: ${dates[dates.length - 1]}`);
    }

    // Store each day's spend in the database
    let storedCount = 0;
    const storedDates: string[] = [];
    
    for (const [dateStr, spend] of dailySpend.entries()) {
      const costDate = new Date(dateStr);
      costDate.setHours(0, 0, 0, 0);

      await prisma.marketingCost.upsert({
        where: {
          shop_platform_date: {
            shop,
            platform: "google",
            date: costDate,
          },
        },
        update: {
          amount: spend,
          description: `Google Ads spend for ${dateStr}`,
        },
        create: {
          shop,
          platform: "google",
          amount: spend,
          date: costDate,
          description: `Google Ads spend for ${dateStr}`,
        },
      });

      storedCount++;
      storedDates.push(dateStr);
      totalAmount += spend;
    }

    // Update last sync time
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSync: new Date() },
    });

    console.log(`[Google Sync] ===== SYNC COMPLETE =====`);
    console.log(`[Google Sync] Stored ${storedCount} days with data`);
    console.log(`[Google Sync] Total amount: $${totalAmount}`);
    if (storedDates.length > 0) {
      console.log(`[Google Sync] Date range stored: ${storedDates[0]} to ${storedDates[storedDates.length - 1]}`);
    }
    
    return { success: true, totalAmount };
  } catch (error) {
    console.error("Error syncing Google historical data:", error);
    return { 
      success: false, 
      totalAmount: 0, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

async function refreshGoogleToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Error refreshing Google token:", data.error);
      return null;
    }

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  } catch (error) {
    console.error("Error refreshing Google token:", error);
    return null;
  }
}

