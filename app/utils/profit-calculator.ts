export interface SalesData {
  totalSales: number;
  newCustomerRevenue: number;
  returnCustomerRevenue: number;
  orderCount: number;
  newCustomerCount: number;
  returnCustomerCount: number;
}

export interface CostsData {
  shippingCosts: number;
  cogs: number; // Cost of Goods Sold
  transactionFees: number;
  marketingCosts: number;
  fixedCosts: number;
}

export interface ProfitMetrics {
  // Revenue
  totalSales: number;
  newCustomerRevenue: number;
  returnCustomerRevenue: number;
  
  // Costs
  variableCosts: number;
  marketingCosts: number;
  fixedCosts: number;
  
  // Profits
  grossProfit: number;
  contributionProfit: number;
  netProfit: number;
  
  // Margins
  grossMargin: number;
  contributionMargin: number;
  netMargin: number;
}

export function calculateProfits(
  sales: SalesData,
  costs: CostsData,
  transactionFeePercent: number = 3.0
): ProfitMetrics {
  const { totalSales, newCustomerRevenue, returnCustomerRevenue } = sales;
  const { shippingCosts, cogs, marketingCosts, fixedCosts } = costs;
  
  // Calculate transaction fees (default 3% of total sales)
  const transactionFees = (totalSales * transactionFeePercent) / 100;
  
  // Variable Costs = Shipping + COGS + Transaction Fees
  const variableCosts = shippingCosts + cogs + transactionFees;
  
  // Gross Profit = Total Sales - Variable Costs
  const grossProfit = totalSales - variableCosts;
  
  // Contribution Profit = Total Sales - (Variable Costs + Marketing Costs)
  const contributionProfit = totalSales - variableCosts - marketingCosts;
  
  // Net Profit = Total Sales - (Variable Costs + Marketing Costs + Fixed Costs)
  const netProfit = totalSales - variableCosts - marketingCosts - fixedCosts;
  
  // Calculate margins (as percentages)
  const grossMargin = totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
  const contributionMargin = totalSales > 0 ? (contributionProfit / totalSales) * 100 : 0;
  const netMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;
  
  return {
    totalSales,
    newCustomerRevenue,
    returnCustomerRevenue,
    variableCosts,
    marketingCosts,
    fixedCosts,
    grossProfit,
    contributionProfit,
    netProfit,
    grossMargin,
    contributionMargin,
    netMargin,
  };
}

export function calculateTrend(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

