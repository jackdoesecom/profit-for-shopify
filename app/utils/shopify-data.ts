import type { SalesData } from "./profit-calculator";

export async function getShopTimezone(admin: any): Promise<string> {
  try {
    const response = await admin.graphql(
      `#graphql
        query {
          shop {
            ianaTimezone
          }
        }
      `
    );
    
    const data = await response.json();
    return data.data?.shop?.ianaTimezone || "UTC";
  } catch (error) {
    console.error("Error fetching shop timezone:", error);
    return "UTC"; // Fallback to UTC
  }
}

export async function fetchOrdersData(
  admin: any,
  startDate: Date,
  endDate: Date
): Promise<SalesData> {
  try {
    console.log(`Fetching orders from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    const response = await admin.graphql(
      `#graphql
        query getOrders($query: String!) {
          orders(first: 250, query: $query) {
            edges {
              node {
                id
                createdAt
                totalPriceSet {
                  shopMoney {
                    amount
                  }
                }
                customerJourneySummary {
                  firstVisit {
                    occurredAt
                  }
                }
                customer {
                  id
                  createdAt
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      {
        variables: {
          query: `created_at:>='${startDate.toISOString()}' AND created_at:<='${endDate.toISOString()}'`,
        },
      }
    );

    const data = await response.json();
    
    if ('errors' in data && data.errors) {
      console.error("GraphQL errors fetching orders:", data.errors);
      throw new Error("Failed to fetch orders");
    }
    
    const orders = data.data?.orders?.edges || [];
    console.log(`Found ${orders.length} orders`);

    let totalSales = 0;
    let newCustomerRevenue = 0;
    let returnCustomerRevenue = 0;
    let newCustomerCount = 0;
    let returnCustomerCount = 0;
    const processedCustomers = new Set<string>();

    for (const { node: order } of orders) {
      const orderAmount = parseFloat(order.totalPriceSet?.shopMoney?.amount || "0");
      totalSales += orderAmount;

      // Check if this is a new customer based on customer journey
      // If the first visit date is close to order date, it's a new customer
      const customerId = order.customer?.id;
      const isFirstOrder = order.customerJourneySummary?.firstVisit?.occurredAt;
      const orderDate = new Date(order.createdAt);
      
      // Consider it a new customer if the order was placed within 24 hours of first visit
      // or if we haven't seen this customer before in this dataset
      let isNewCustomer = false;
      
      if (customerId && !processedCustomers.has(customerId)) {
        processedCustomers.add(customerId);
        if (isFirstOrder) {
          const firstVisitDate = new Date(isFirstOrder);
          const hoursDiff = (orderDate.getTime() - firstVisitDate.getTime()) / (1000 * 60 * 60);
          isNewCustomer = hoursDiff <= 24; // Within 24 hours = new customer
        } else {
          // If no customer journey data, assume new customer for first occurrence
          isNewCustomer = true;
        }
      }
      
      if (isNewCustomer) {
        newCustomerRevenue += orderAmount;
        newCustomerCount += 1;
      } else {
        returnCustomerRevenue += orderAmount;
        returnCustomerCount += 1;
      }
    }

    console.log(`Total Sales: $${totalSales}, New Customer: $${newCustomerRevenue}, Returning: $${returnCustomerRevenue}`);

    return {
      totalSales,
      newCustomerRevenue,
      returnCustomerRevenue,
      orderCount: orders.length,
      newCustomerCount,
      returnCustomerCount,
    };
  } catch (error) {
    console.error("Error fetching orders data:", error);
    throw error;
  }
}

export async function fetchProductCosts(
  admin: any,
  startDate: Date,
  endDate: Date
): Promise<{ totalCogs: number; totalShipping: number }> {
  try {
    // Fetch orders with line items to calculate COGS
    const response = await admin.graphql(
      `#graphql
        query getOrdersWithLineItems($query: String!) {
          orders(first: 250, query: $query) {
            edges {
              node {
                id
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      quantity
                      variant {
                        inventoryItem {
                          unitCost {
                            amount
                          }
                        }
                      }
                    }
                  }
                }
                totalShippingPriceSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          query: `created_at:>='${startDate.toISOString()}' AND created_at:<='${endDate.toISOString()}'`,
        },
      }
    );

    const data = await response.json();
    
    // Check for GraphQL errors
    if ('errors' in data && data.errors) {
      console.error("GraphQL errors fetching product costs:", data.errors);
      // Return zeros if there are API errors
      return { totalCogs: 0, totalShipping: 0 };
    }
    
    const orders = data.data?.orders?.edges || [];
    console.log(`Found ${orders.length} orders for COGS calculation`);

    let totalCogs = 0;
    let totalShipping = 0;

    for (const { node: order } of orders) {
      // Sum up COGS for all line items
      for (const { node: lineItem } of order.lineItems?.edges || []) {
        const unitCost = parseFloat(
          lineItem.variant?.inventoryItem?.unitCost?.amount || "0"
        );
        const quantity = lineItem.quantity || 0;
        totalCogs += unitCost * quantity;
      }

      // Add shipping costs
      const shippingCost = parseFloat(
        order.totalShippingPriceSet?.shopMoney?.amount || "0"
      );
      totalShipping += shippingCost;
    }

    console.log(`Total COGS: $${totalCogs}, Total Shipping: $${totalShipping}`);
    return { totalCogs, totalShipping };
  } catch (error) {
    console.error("Error fetching product costs:", error);
    // Return zeros if there's an error
    return { totalCogs: 0, totalShipping: 0 };
  }
}

export function getDateRangeForPeriod(period: string, timezone: string = "UTC"): {
  startDate: Date;
  endDate: Date;
} {
  // Get current date/time in the shop's timezone
  const now = new Date();
  
  // Get date parts in the shop's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const dateParts = {
    year: parseInt(parts.find(p => p.type === 'year')?.value || '0'),
    month: parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1, // JS months are 0-indexed
    day: parseInt(parts.find(p => p.type === 'day')?.value || '0'),
  };
  
  // Create dates in UTC but representing the shop's local date
  const endDate = new Date(Date.UTC(dateParts.year, dateParts.month, dateParts.day, 23, 59, 59, 999));
  const startDate = new Date(Date.UTC(dateParts.year, dateParts.month, dateParts.day, 0, 0, 0, 0));

  switch (period) {
    case "today":
      // Already set to today's start and end
      break;
    case "yesterday":
      startDate.setUTCDate(startDate.getUTCDate() - 1);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      endDate.setUTCHours(23, 59, 59, 999);
      break;
    case "last7days":
      startDate.setUTCDate(startDate.getUTCDate() - 7);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate.setUTCHours(23, 59, 59, 999);
      break;
    case "last30days":
      startDate.setUTCDate(startDate.getUTCDate() - 30);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate.setUTCHours(23, 59, 59, 999);
      break;
    case "last60days":
      startDate.setUTCDate(startDate.getUTCDate() - 60);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate.setUTCHours(23, 59, 59, 999);
      break;
    case "last90days":
      startDate.setUTCDate(startDate.getUTCDate() - 90);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate.setUTCHours(23, 59, 59, 999);
      break;
    case "thisMonth":
      startDate.setUTCDate(1);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate.setUTCHours(23, 59, 59, 999);
      break;
    case "lastMonth":
      // Start date: First day of last month
      startDate.setUTCMonth(startDate.getUTCMonth() - 1);
      startDate.setUTCDate(1);
      startDate.setUTCHours(0, 0, 0, 0);
      
      // End date: Last day of last month
      // Set to first day of current month, then subtract 1 day
      endDate.setUTCDate(1); // First of current month
      endDate.setUTCDate(0); // Go back one day = last day of previous month
      endDate.setUTCHours(23, 59, 59, 999);
      break;
    default:
      // Default to last 30 days
      startDate.setUTCDate(startDate.getUTCDate() - 30);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate.setUTCHours(23, 59, 59, 999);
  }

  return { startDate, endDate };
}

