import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function getMarketingCosts(
  shop: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  // Normalize dates to start/end of day for proper range matching
  const normalizedStart = new Date(startDate);
  normalizedStart.setHours(0, 0, 0, 0);
  
  const normalizedEnd = new Date(endDate);
  normalizedEnd.setHours(23, 59, 59, 999);
  
  const costs = await prisma.marketingCost.findMany({
    where: {
      shop,
      date: {
        gte: normalizedStart,
        lte: normalizedEnd,
      },
    },
  });

  const total = costs.reduce((sum, cost) => sum + cost.amount, 0);
  console.log(`Marketing costs: ${costs.length} entries, total: $${total}`);
  console.log(`Query range: ${normalizedStart.toISOString()} to ${normalizedEnd.toISOString()}`);
  
  if (costs.length > 0) {
    console.log(`First entry: date=${costs[0].date.toISOString()}, amount=$${costs[0].amount}`);
    console.log(`Last entry: date=${costs[costs.length - 1].date.toISOString()}, amount=$${costs[costs.length - 1].amount}`);
  }
  
  // Also check what's actually in the database for this shop
  const allCosts = await prisma.marketingCost.findMany({
    where: { shop, platform: "facebook" },
    orderBy: { date: 'asc' },
    take: 5
  });
  console.log(`Total Facebook costs in DB for ${shop}: ${allCosts.length} entries`);
  if (allCosts.length > 0) {
    console.log(`Sample dates in DB: ${allCosts.map(c => c.date.toISOString()).join(', ')}`);
  }
  
  return total;
}

export async function getFixedCosts(
  shop: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const costs = await prisma.fixedCost.findMany({
    where: {
      shop,
      OR: [
        {
          // Recurring costs that started before end date
          recurring: true,
          startDate: {
            lte: endDate,
          },
          OR: [
            { endDate: null },
            {
              endDate: {
                gte: startDate,
              },
            },
          ],
        },
        {
          // One-time costs in the date range
          recurring: false,
          startDate: {
            gte: startDate,
            lte: endDate,
          },
        },
      ],
    },
  });

  // Calculate prorated costs for the date range
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysInMonth = 30; // Approximate for monthly costs

  let totalFixedCosts = 0;

  for (const cost of costs) {
    if (cost.recurring) {
      // For recurring monthly costs, prorate based on the date range
      totalFixedCosts += (cost.amount * days) / daysInMonth;
    } else {
      // One-time costs
      totalFixedCosts += cost.amount;
    }
  }

  console.log(`Fixed costs: ${costs.length} entries, total: $${totalFixedCosts} (prorated over ${days} days)`);
  return totalFixedCosts;
}

export async function getManualCosts(
  shop: string,
  startDate: Date,
  endDate: Date
): Promise<{ shipping: number; cogs: number; other: number }> {
  const costs = await prisma.manualCost.findMany({
    where: {
      shop,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  const shipping = costs
    .filter((c) => c.category === "shipping")
    .reduce((sum, cost) => sum + cost.amount, 0);

  const cogs = costs
    .filter((c) => c.category === "cogs")
    .reduce((sum, cost) => sum + cost.amount, 0);

  const other = costs
    .filter((c) => c.category === "other")
    .reduce((sum, cost) => sum + cost.amount, 0);

  console.log(`Manual costs: ${costs.length} entries - Shipping: $${shipping}, COGS: $${cogs}, Other: $${other}`);
  return { shipping, cogs, other };
}

export async function getSettings(shop: string) {
  let settings = await prisma.settings.findUnique({
    where: { shop },
  });

  // Create default settings if they don't exist
  if (!settings) {
    settings = await prisma.settings.create({
      data: {
        shop,
        transactionFeePercent: 3.0,
        currency: "USD",
      },
    });
  }

  return settings;
}

export { prisma };

