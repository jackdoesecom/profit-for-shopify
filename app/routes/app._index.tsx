import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Select,
  Popover,
  ActionList,
  Icon,
  Modal,
  ProgressBar,
} from "@shopify/polaris";
import { CalendarIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { fetchOrdersData, fetchProductCosts, getDateRangeForPeriod, getShopTimezone } from "../utils/shopify-data";
import { getMarketingCosts, getFixedCosts, getManualCosts, getSettings, prisma } from "../utils/database";
import { calculateProfits, calculateTrend } from "../utils/profit-calculator";
import { syncFacebookHistoricalData } from "../utils/facebook-ads";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "last30days";

  // Get shop's timezone for accurate date calculations
  const shopTimezone = await getShopTimezone(admin);
  console.log(`[Timezone] Shop timezone: ${shopTimezone}`);

  // Get date ranges for current and previous periods using shop's timezone
  const { startDate, endDate } = getDateRangeForPeriod(period, shopTimezone);
  const periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const previousStartDate = new Date(startDate);
  previousStartDate.setDate(previousStartDate.getDate() - periodDays);
  const previousEndDate = new Date(startDate);

  try {
    // Check if Facebook is connected and sync if needed
    const facebookIntegration = await prisma.integration.findFirst({
      where: {
        shop: session.shop,
        platform: "facebook_ads",
        isActive: true,
      },
    });

    if (facebookIntegration) {
      // Sync recent data (last 3 days) if last sync was more than 1 hour ago
      const lastSync = facebookIntegration.lastSync;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      if (!lastSync || lastSync < oneHourAgo) {
        console.log("Auto-syncing recent Facebook ad spend (last 3 days)...");
        // Sync just the last 3 days to keep data fresh without heavy API calls
        syncFacebookHistoricalData(session.shop, 3).catch(error => {
          console.error("Background sync failed:", error);
        });
      }
    }

    // Fetch current period data
    const salesData = await fetchOrdersData(admin, startDate, endDate);
    const { totalCogs, totalShipping } = await fetchProductCosts(admin, startDate, endDate);
    const marketingCosts = await getMarketingCosts(session.shop, startDate, endDate);
    const fixedCosts = await getFixedCosts(session.shop, startDate, endDate);
    const manualCosts = await getManualCosts(session.shop, startDate, endDate);
    const settings = await getSettings(session.shop);

    // Combine costs
    const costsData = {
      shippingCosts: totalShipping + manualCosts.shipping,
      cogs: totalCogs + manualCosts.cogs,
      transactionFees: 0, // Will be calculated in calculateProfits
      marketingCosts: marketingCosts,
      fixedCosts: fixedCosts,
    };

    // Calculate current period profits
    const currentMetrics = calculateProfits(
      salesData,
      costsData,
      settings.transactionFeePercent
    );

    // Fetch previous period data for trends
    const previousSalesData = await fetchOrdersData(admin, previousStartDate, previousEndDate);
    const previousProductCosts = await fetchProductCosts(admin, previousStartDate, previousEndDate);
    const previousMarketingCosts = await getMarketingCosts(session.shop, previousStartDate, previousEndDate);
    const previousFixedCosts = await getFixedCosts(session.shop, previousStartDate, previousEndDate);
    const previousManualCosts = await getManualCosts(session.shop, previousStartDate, previousEndDate);

    const previousCostsData = {
      shippingCosts: previousProductCosts.totalShipping + previousManualCosts.shipping,
      cogs: previousProductCosts.totalCogs + previousManualCosts.cogs,
      transactionFees: 0,
      marketingCosts: previousMarketingCosts,
      fixedCosts: previousFixedCosts,
    };

    const previousMetrics = calculateProfits(
      previousSalesData,
      previousCostsData,
      settings.transactionFeePercent
    );

    // Calculate trends
    const trends = {
      grossProfit: calculateTrend(currentMetrics.grossProfit, previousMetrics.grossProfit),
      contributionProfit: calculateTrend(currentMetrics.contributionProfit, previousMetrics.contributionProfit),
      netProfit: calculateTrend(currentMetrics.netProfit, previousMetrics.netProfit),
      totalSales: calculateTrend(currentMetrics.totalSales, previousMetrics.totalSales),
      newCustomerRevenue: calculateTrend(currentMetrics.newCustomerRevenue, previousMetrics.newCustomerRevenue),
      returnCustomerRevenue: calculateTrend(currentMetrics.returnCustomerRevenue, previousMetrics.returnCustomerRevenue),
      variableCosts: calculateTrend(currentMetrics.variableCosts, previousMetrics.variableCosts),
      marketingCosts: calculateTrend(currentMetrics.marketingCosts, previousMetrics.marketingCosts),
      fixedCosts: calculateTrend(currentMetrics.fixedCosts, previousMetrics.fixedCosts),
    };

    // Get targets from database
    let metricTargets = null;
    try {
      metricTargets = await prisma.metricTargets.findUnique({
        where: { shop: session.shop },
      });
      console.log("Shop:", session.shop);
      console.log("Loaded targets from database:", metricTargets);
    } catch (error) {
      console.error("Error loading targets:", error);
    }
    
    const targets = {
      grossProfit: metricTargets?.grossProfit || 0,
      contributionProfit: metricTargets?.contributionProfit || 0,
      netProfit: metricTargets?.netProfit || 0,
      totalSales: metricTargets?.totalSales || 0,
      newCustomerRevenue: metricTargets?.newCustomerRevenue || 0,
      returnCustomerRevenue: metricTargets?.returnCustomerRevenue || 0,
      variableCosts: metricTargets?.variableCosts || 0,
      marketingCosts: metricTargets?.marketingCosts || 0,
      fixedCosts: metricTargets?.fixedCosts || 0,
    };
    
    console.log("Final targets object:", targets);

    // Calculate margins according to formulas (only if we have sales)
    const totalSales = currentMetrics.totalSales;
    const hasSales = totalSales > 0;
    
    const margins = {
      grossProfitMargin: hasSales ? (currentMetrics.grossProfit / totalSales) * 100 : 0,
      contributionProfitMargin: hasSales ? (currentMetrics.contributionProfit / totalSales) * 100 : 0,
      netProfitMargin: hasSales ? (currentMetrics.netProfit / totalSales) * 100 : 0,
      variableCostsMargin: hasSales ? (currentMetrics.variableCosts / totalSales) * 100 : 0,
      marketingCostMargin: hasSales ? (currentMetrics.marketingCosts / totalSales) * 100 : 0,
      fixedCostMargin: hasSales ? (currentMetrics.fixedCosts / totalSales) * 100 : 0,
      totalSalesMargin: hasSales ? 100 : 0, // Total sales is 100% of itself
      newCustomerRevenueMargin: currentMetrics.newCustomerRevenue > 0 
        ? (currentMetrics.variableCosts / currentMetrics.newCustomerRevenue) * 100 
        : 0,
      returnCustomerRevenueMargin: currentMetrics.returnCustomerRevenue > 0
        ? (currentMetrics.variableCosts / currentMetrics.returnCustomerRevenue) * 100
        : 0,
    };

    // Calculate distributions (percentage of total sales)
    const distributions = {
      grossProfitDist: hasSales ? (currentMetrics.grossProfit / totalSales) * 100 : 0,
      contributionProfitDist: hasSales ? (currentMetrics.contributionProfit / totalSales) * 100 : 0,
      netProfitDist: hasSales ? (currentMetrics.netProfit / totalSales) * 100 : 0,
      variableCostsDist: hasSales ? (currentMetrics.variableCosts / totalSales) * 100 : 0,
      marketingCostDist: hasSales ? (currentMetrics.marketingCosts / totalSales) * 100 : 0,
      fixedCostsDist: hasSales ? (currentMetrics.fixedCosts / totalSales) * 100 : 0,
      totalSalesDist: hasSales ? 100 : 0,
      newCustomerRevenueDist: hasSales ? (currentMetrics.newCustomerRevenue / totalSales) * 100 : 0,
      returnCustomerRevenueDist: hasSales ? (currentMetrics.returnCustomerRevenue / totalSales) * 100 : 0,
    };

    return json({
      metrics: {
        grossProfit: currentMetrics.grossProfit,
        contributionProfit: currentMetrics.contributionProfit,
        netProfit: currentMetrics.netProfit,
        totalSales: currentMetrics.totalSales,
        newCustomerRevenue: currentMetrics.newCustomerRevenue,
        returnCustomerRevenue: currentMetrics.returnCustomerRevenue,
        variableCosts: currentMetrics.variableCosts,
        marketingCosts: currentMetrics.marketingCosts,
        fixedCosts: currentMetrics.fixedCosts,
      },
      margins,
      distributions,
      targets,
      trends,
      period,
      facebookLastSync: facebookIntegration?.lastSync,
      facebookConnected: !!facebookIntegration,
    });
  } catch (error) {
    console.error("Error fetching data:", error);
    console.error("Error details:", error instanceof Error ? error.message : String(error));
    
    // Still try to get costs from database even if Shopify API fails
    try {
      const marketingCosts = await getMarketingCosts(session.shop, startDate, endDate);
      const fixedCosts = await getFixedCosts(session.shop, startDate, endDate);
      const manualCosts = await getManualCosts(session.shop, startDate, endDate);
      const settings = await getSettings(session.shop);
      
      // ALSO LOAD TARGETS IN ERROR FALLBACK!
      let metricTargets = await prisma.metricTargets.findUnique({
        where: { shop: session.shop },
      });
      
      const targets = {
        grossProfit: metricTargets?.grossProfit || 0,
        contributionProfit: metricTargets?.contributionProfit || 0,
        netProfit: metricTargets?.netProfit || 0,
        totalSales: metricTargets?.totalSales || 0,
        newCustomerRevenue: metricTargets?.newCustomerRevenue || 0,
        returnCustomerRevenue: metricTargets?.returnCustomerRevenue || 0,
        variableCosts: metricTargets?.variableCosts || 0,
        marketingCosts: metricTargets?.marketingCosts || 0,
        fixedCosts: metricTargets?.fixedCosts || 0,
      };
      
      // Calculate with no sales but with costs
      const salesData = {
        totalSales: 0,
        newCustomerRevenue: 0,
        returnCustomerRevenue: 0,
        orderCount: 0,
        newCustomerCount: 0,
        returnCustomerCount: 0,
      };
      
      const costsData = {
        shippingCosts: manualCosts.shipping,
        cogs: manualCosts.cogs,
        transactionFees: 0,
        marketingCosts: marketingCosts,
        fixedCosts: fixedCosts,
      };
      
      const metrics = calculateProfits(salesData, costsData, settings.transactionFeePercent);
      
      const totalSales = metrics.totalSales || 0.001;
      
      return json({
        metrics: {
          grossProfit: metrics.grossProfit,
          contributionProfit: metrics.contributionProfit,
          netProfit: metrics.netProfit,
          totalSales: metrics.totalSales,
          newCustomerRevenue: metrics.newCustomerRevenue,
          returnCustomerRevenue: metrics.returnCustomerRevenue,
          variableCosts: metrics.variableCosts,
          marketingCosts: metrics.marketingCosts,
          fixedCosts: metrics.fixedCosts,
        },
        margins: {
          grossProfitMargin: (metrics.grossProfit / totalSales) * 100,
          contributionProfitMargin: (metrics.contributionProfit / totalSales) * 100,
          netProfitMargin: (metrics.netProfit / totalSales) * 100,
          variableCostsMargin: (metrics.variableCosts / totalSales) * 100,
          marketingCostMargin: (metrics.marketingCosts / totalSales) * 100,
          fixedCostMargin: (metrics.fixedCosts / totalSales) * 100,
          totalSalesMargin: 100,
          newCustomerRevenueMargin: 0,
          returnCustomerRevenueMargin: 0,
        },
        distributions: {
          grossProfitDist: (metrics.grossProfit / totalSales) * 100,
          contributionProfitDist: (metrics.contributionProfit / totalSales) * 100,
          netProfitDist: (metrics.netProfit / totalSales) * 100,
          variableCostsDist: (metrics.variableCosts / totalSales) * 100,
          marketingCostDist: (metrics.marketingCosts / totalSales) * 100,
          fixedCostsDist: (metrics.fixedCosts / totalSales) * 100,
          totalSalesDist: 100,
          newCustomerRevenueDist: 0,
          returnCustomerRevenueDist: 0,
        },
        targets,
        trends: {
          grossProfit: 0,
          contributionProfit: 0,
          netProfit: 0,
          totalSales: 0,
          newCustomerRevenue: 0,
          returnCustomerRevenue: 0,
          variableCosts: 0,
          marketingCosts: 0,
          fixedCosts: 0,
        },
        period,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (dbError) {
      console.error("Database error:", dbError);
      return json({
        metrics: {
          grossProfit: 0,
          contributionProfit: 0,
          netProfit: 0,
          totalSales: 0,
          newCustomerRevenue: 0,
          returnCustomerRevenue: 0,
          variableCosts: 0,
          marketingCosts: 0,
          fixedCosts: 0,
        },
        margins: {
          grossProfitMargin: 0,
          contributionProfitMargin: 0,
          netProfitMargin: 0,
          variableCostsMargin: 0,
          marketingCostMargin: 0,
          fixedCostMargin: 0,
          totalSalesMargin: 0,
          newCustomerRevenueMargin: 0,
          returnCustomerRevenueMargin: 0,
        },
        distributions: {
          grossProfitDist: 0,
          contributionProfitDist: 0,
          netProfitDist: 0,
          variableCostsDist: 0,
          marketingCostDist: 0,
          fixedCostsDist: 0,
          totalSalesDist: 0,
          newCustomerRevenueDist: 0,
          returnCustomerRevenueDist: 0,
        },
        targets: {
          grossProfit: 0,
          contributionProfit: 0,
          netProfit: 0,
          totalSales: 0,
          newCustomerRevenue: 0,
          returnCustomerRevenue: 0,
          variableCosts: 0,
          marketingCosts: 0,
          fixedCosts: 0,
        },
        trends: {
          grossProfit: 0,
          contributionProfit: 0,
          netProfit: 0,
          totalSales: 0,
          newCustomerRevenue: 0,
          returnCustomerRevenue: 0,
          variableCosts: 0,
          marketingCosts: 0,
          fixedCosts: 0,
        },
        period,
        error: "Failed to load data",
      });
    }
  }
};

interface MetricCardProps {
  title: string;
  value: number;
  target?: number;
  trend?: number;
  margin?: number;
  distribution?: number;
  currentPeriodDays?: number;
  onOptimize?: () => void;
}

function MetricCard({
  title,
  value,
  target,
  trend,
  margin,
  distribution,
  currentPeriodDays = 30,
  onOptimize,
}: MetricCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatPercent = (percent: number | undefined) => {
    if (percent === undefined || percent === null || isNaN(percent)) return "0%";
    return `${Math.abs(percent).toFixed(1)}%`;
  };

  // Calculate target status
  const getTargetStatus = () => {
    if (!target || target === 0) return null;
    
    // Calculate daily average
    const dailyAverage = value / currentPeriodDays;
    // Extrapolate to monthly (30 days)
    const projectedMonthly = dailyAverage * 30;
    
    // Calculate percentage of target
    const percentOfTarget = (projectedMonthly / target) * 100;
    
    if (percentOfTarget >= 100) {
      return { tone: "success" as const, icon: "✓", label: "On Target", percent: percentOfTarget };
    } else if (percentOfTarget >= 80) {
      return { tone: "attention" as const, icon: "!", label: "Near Target", percent: percentOfTarget };
    } else {
      return { tone: "critical" as const, icon: "✗", label: "Off Target", percent: percentOfTarget };
    }
  };

  const targetStatus = getTargetStatus();
  
  // Debug logging for ALL cards
  console.log(`${title} - Target: ${target}, Value: ${value}, Days: ${currentPeriodDays}, Status:`, targetStatus);

  return (
    <div style={{ 
      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      cursor: 'pointer',
      borderRadius: '12px',
      overflow: 'hidden'
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.1)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
    }}>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm" tone="subdued">
              {title}
            </Text>
          </InlineStack>
          
          <InlineStack align="space-between" blockAlign="end">
            <Text as="h2" variant="heading2xl">
              {formatCurrency(value)}
            </Text>
            {trend !== 0 && trend !== undefined && (
              <Badge tone={trend > 0 ? "success" : "critical"}>
                {`${trend > 0 ? "↑" : "↓"} ${Math.abs(trend).toFixed(1)}%`}
              </Badge>
            )}
          </InlineStack>

          <BlockStack gap="100">
            {/* Target */}
            {target && target > 0 ? (
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <div style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  backgroundColor: targetStatus?.tone === 'success' ? '#AEE9D1' : targetStatus?.tone === 'critical' ? '#FED3D1' : '#FFEA8A',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  position: 'relative'
                }}>
                  <div style={{ 
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: targetStatus?.tone === 'success' ? '#008060' : targetStatus?.tone === 'critical' ? '#D72C0D' : '#B98900',
                    fontSize: '10px',
                    lineHeight: '10px',
                    fontWeight: 'bold'
                  }}>
                    {targetStatus?.icon || ''}
                  </div>
                </div>
                <Text as="span" variant="bodyMd">
                  Target: {formatCurrency(target)}
                </Text>
                {targetStatus && (
                  <Badge tone={targetStatus.tone}>
                    {targetStatus.label}
                  </Badge>
                )}
              </InlineStack>
            ) : (
              <Text as="span" variant="bodyMd" tone="subdued">
                No target set
              </Text>
            )}
            
            {/* Distribution */}
            {distribution !== undefined && distribution !== 0 && Math.abs(distribution) <= 1000 && (
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <div style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  backgroundColor: distribution > 0 ? '#AEE9D1' : '#FED3D1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  position: 'relative'
                }}>
                  <div style={{ 
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: distribution > 0 ? '#008060' : '#D72C0D',
                    fontSize: '10px',
                    lineHeight: '10px',
                    fontWeight: 'bold'
                  }}>
                    {distribution > 0 ? '✓' : '✗'}
                  </div>
                </div>
                <Text as="span" variant="bodyMd">
                  Distribution: {formatPercent(distribution)}
                </Text>
                <Badge tone={distribution > 0 ? "success" : "critical"}>
                  {distribution > 0 ? "On Target" : "Off Target"}
                </Badge>
              </InlineStack>
            )}
            
            {/* Margin */}
            {margin !== undefined && margin !== 0 && Math.abs(margin) <= 1000 && (
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <div style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  backgroundColor: margin > 0 ? '#AEE9D1' : '#FED3D1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  position: 'relative'
                }}>
                  <div style={{ 
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: margin > 0 ? '#008060' : '#D72C0D',
                    fontSize: '10px',
                    lineHeight: '10px',
                    fontWeight: 'bold'
                  }}>
                    {margin > 0 ? '✓' : '✗'}
                  </div>
                </div>
                <Text as="span" variant="bodyMd">
                  Margin: {formatPercent(margin)}
                </Text>
                <Badge tone={margin > 0 ? "success" : "critical"}>
                  {margin > 0 ? "On Target" : "Off Target"}
                </Badge>
              </InlineStack>
            )}
          </BlockStack>

          <InlineStack align="end" gap="200">
            <Button 
              size="slim" 
              onClick={() => {
                const subject = encodeURIComponent(`Help Needed: ${title}`);
                const body = encodeURIComponent(`We need to improve my ${title}`);
                const mailtoUrl = `mailto:jack@zeroexperts.co?subject=${subject}&body=${body}`;
                window.open(mailtoUrl, '_blank');
              }}
            >
              Assign team
            </Button>
            {onOptimize && (
              <Button size="slim" variant="primary" onClick={onOptimize}>
                Optimize
              </Button>
            )}
          </InlineStack>
        </BlockStack>
      </div>
    </Card>
    </div>
  );
}

interface SetupCardProps {
  title: string;
  description: string;
  buttonText: string;
  onAction: () => void;
}

function SetupCard({ title, description, buttonText, onAction }: SetupCardProps) {
  return (
    <div style={{ 
      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      cursor: 'pointer',
      borderRadius: '12px',
      overflow: 'hidden'
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.1)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
    }}>
      <Card>
        <BlockStack gap="400">
        <InlineStack align="center">
          <div style={{ 
            width: '48px', 
            height: '48px', 
            borderRadius: '50%', 
            backgroundColor: '#000', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: 'white',
            fontSize: '20px'
          }}>
            ↑
          </div>
        </InlineStack>
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd" alignment="center">
            {title}
          </Text>
          <Text as="p" variant="bodySm" alignment="center" tone="subdued">
            {description}
                    </Text>
        </BlockStack>
        <Button fullWidth onClick={onAction}>
          {buttonText}
        </Button>
      </BlockStack>
    </Card>
    </div>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const { metrics, targets, trends, period, margins, distributions, facebookConnected, facebookLastSync } = data as any;
  const navigate = useNavigate();
  const submit = useSubmit();
  const [selectedPeriod, setSelectedPeriod] = useState(period || "last30days");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showOptimizeModal, setShowOptimizeModal] = useState(false);
  const [optimizingMetric, setOptimizingMetric] = useState("");
  const [optimizeProgress, setOptimizeProgress] = useState(0);
  const [optimizeStatus, setOptimizeStatus] = useState("Analyzing your data...");
  const error = (data as any).error;

  // Calculate current period days for target status
  const getCurrentPeriodDays = () => {
    switch (selectedPeriod) {
      case "today": return 1;
      case "yesterday": return 1;
      case "last7days": return 7;
      case "last30days": return 30;
      case "last60days": return 60;
      case "last90days": return 90;
      case "thisMonth": return new Date().getDate();
      case "lastMonth": {
        // Get actual number of days in previous month
        const now = new Date();
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const daysInLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
        return daysInLastMonth;
      }
      default: return 30;
    }
  };
  
  const currentPeriodDays = getCurrentPeriodDays();

  const handlePeriodChange = (newPeriod: string) => {
    setSelectedPeriod(newPeriod);
    navigate(`/app?period=${newPeriod}`);
  };

  const handleOptimize = async (metricName: string, metricData: any) => {
    setOptimizingMetric(metricName);
    setShowOptimizeModal(true);
    setOptimizeProgress(0);
    setOptimizeStatus("Analyzing your data...");

    try {
      // Simulate progress
      setOptimizeProgress(20);
      setOptimizeStatus("Gathering insights from 1,000+ brands...");

      // Call the optimization API
      const response = await fetch('/app/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric: metricName,
          data: metricData,
          allMetrics: metrics,
          targets: targets,
          period: selectedPeriod
        })
      });

      setOptimizeProgress(60);
      setOptimizeStatus("Generating recommendations...");

      const result = await response.json();

      setOptimizeProgress(90);
      setOptimizeStatus("Sending recommendations to your email...");

      await new Promise(resolve => setTimeout(resolve, 1000));

      setOptimizeProgress(100);
      setOptimizeStatus("Done! Check your email for optimization recommendations.");

      // Close after 2 seconds
      setTimeout(() => {
        setShowOptimizeModal(false);
      }, 2000);

    } catch (error) {
      console.error("Optimization error:", error);
      setOptimizeStatus("Error generating recommendations. Please try again.");
      setTimeout(() => {
        setShowOptimizeModal(false);
      }, 3000);
    }
  };

  return (
    <Page
      title="Profit For Shopify"
      subtitle="Let's get started."
    >
      <div style={{ paddingBottom: '80px' }}>
      <BlockStack gap="500">
        {/* Optimization Modal */}
        <Modal
          open={showOptimizeModal}
          onClose={() => setShowOptimizeModal(false)}
          title={`Optimizing ${optimizingMetric}`}
          primaryAction={{
            content: "Close",
            onAction: () => setShowOptimizeModal(false),
            disabled: optimizeProgress < 100
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                padding: '40px 20px',
                textAlign: 'center'
              }}>
                <div style={{ 
                  width: '80px', 
                  height: '80px', 
                  marginBottom: '24px'
                }}>
                  <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
                    <path d="M30 20 L70 20 L85 35 L85 80 L15 80 L15 35 Z" fill="#E3E8EF" />
                    <path d="M45 35 L70 35 L70 60 L45 60 Z" fill="white" />
                  </svg>
                </div>
                
                <Text as="h2" variant="headingLg" alignment="center">
                  {optimizeStatus}
                </Text>
                
                <div style={{ width: '100%', marginTop: '24px' }}>
                  <ProgressBar progress={optimizeProgress} size="small" />
                </div>
                
                {optimizeProgress === 100 && (
                  <div style={{ marginTop: '16px' }}>
                    <Text as="p" variant="bodyMd" tone="success" alignment="center">
                      ✓ Recommendations sent successfully!
                    </Text>
                  </div>
                )}
              </div>
            </BlockStack>
          </Modal.Section>
        </Modal>
        {/* Error Display */}
        {error && (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd" tone="critical">
                ⚠️ Data Loading Issue
              </Text>
              <Text as="p" variant="bodyMd">
                {error}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Check the browser console (Dev Console at the bottom) for detailed logs. 
                This is normal for a development store with no orders - costs will still be tracked.
                    </Text>
              </BlockStack>
            </Card>
        )}
        {/* Date Range Selector */}
        <div style={{ marginBottom: '16px' }}>
          <Popover
            active={showDatePicker}
            activator={
              <Button
                onClick={() => setShowDatePicker(!showDatePicker)}
                disclosure={showDatePicker ? "up" : "down"}
                icon={<Icon source={CalendarIcon} />}
              >
                {selectedPeriod === "today" ? "Today" :
                 selectedPeriod === "yesterday" ? "Yesterday" :
                 selectedPeriod === "last7days" ? "Last 7 days" :
                 selectedPeriod === "last30days" ? "Last 30 days" :
                 selectedPeriod === "last60days" ? "Last 60 days" :
                 selectedPeriod === "last90days" ? "Last 90 days" :
                 selectedPeriod === "thisMonth" ? "This month" :
                 selectedPeriod === "lastMonth" ? "Last month" : "Last 30 days"}
              </Button>
            }
            onClose={() => setShowDatePicker(false)}
          >
            <ActionList
              items={[
                {
                  content: "Today",
                  onAction: () => {
                    handlePeriodChange("today");
                    setShowDatePicker(false);
                  },
                },
                {
                  content: "Yesterday",
                  onAction: () => {
                    handlePeriodChange("yesterday");
                    setShowDatePicker(false);
                  },
                },
                {
                  content: "Last 7 days",
                  onAction: () => {
                    handlePeriodChange("last7days");
                    setShowDatePicker(false);
                  },
                },
                {
                  content: "Last 30 days",
                  onAction: () => {
                    handlePeriodChange("last30days");
                    setShowDatePicker(false);
                  },
                },
                {
                  content: "Last 60 days",
                  onAction: () => {
                    handlePeriodChange("last60days");
                    setShowDatePicker(false);
                  },
                },
                {
                  content: "Last 90 days",
                  onAction: () => {
                    handlePeriodChange("last90days");
                    setShowDatePicker(false);
                  },
                },
                {
                  content: "This month",
                  onAction: () => {
                    handlePeriodChange("thisMonth");
                    setShowDatePicker(false);
                  },
                },
                {
                  content: "Last month",
                  onAction: () => {
                    handlePeriodChange("lastMonth");
                    setShowDatePicker(false);
                  },
                },
              ]}
            />
          </Popover>
        </div>

        {/* Facebook Sync Status */}
        {facebookConnected && (
          <div style={{ marginTop: '16px', marginBottom: '16px' }}>
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="success">Facebook Ads Connected</Badge>
                {facebookLastSync && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Ad spend last synced: {new Date(facebookLastSync).toLocaleString()}
                  </Text>
                )}
              </InlineStack>
            </InlineStack>
          </div>
        )}

        {/* Setup Cards */}
        <Layout>
          <Layout.Section variant="oneThird">
            <SetupCard
              title="Sync from QuickBooks"
              description="Automatically sync your costs from QuickBooks"
              buttonText="Sync QuickBooks"
              onAction={() => alert("QuickBooks integration coming soon!")}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <SetupCard
              title="Sync from ad accounts"
              description="Automatically sync your costs from your vendors"
              buttonText="Sync vendors"
              onAction={() => navigate("/app/settings")}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <SetupCard
              title="Add custom costs"
              description="Manually add custom costs. This should take less than 10 minutes."
              buttonText="Add costs"
              onAction={() => navigate("/app/costs")}
            />
          </Layout.Section>
        </Layout>

        {/* Monthly Target - Small inline */}
        <InlineStack align="start" gap="400" blockAlign="center">
          <Button onClick={() => navigate("/app/settings")}>Configure Targets</Button>
          <Text as="p" variant="bodyMd" tone="subdued">
            Monthly targets can be set in Settings
                      </Text>
                    </InlineStack>

        {/* Profit Metrics */}
        <Layout>
          <Layout.Section variant="oneThird">
            <MetricCard
              title="Gross Profit *"
              value={metrics.grossProfit}
              target={targets.grossProfit}
              trend={trends.grossProfit}
              margin={margins?.grossProfitMargin}
              distribution={distributions?.grossProfitDist}
              currentPeriodDays={currentPeriodDays}
              onOptimize={() => handleOptimize("Metric", {})}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <MetricCard
              title="Contribution Profit *"
              value={metrics.contributionProfit}
              target={targets.contributionProfit}
              trend={trends.contributionProfit}
              margin={margins?.contributionProfitMargin}
              distribution={distributions?.contributionProfitDist}
              currentPeriodDays={currentPeriodDays}
              onOptimize={() => handleOptimize("Metric", {})}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <MetricCard
              title="Net Profit *"
              value={metrics.netProfit}
              target={targets.netProfit}
              trend={trends.netProfit}
              margin={margins?.netProfitMargin}
              distribution={distributions?.netProfitDist}
              currentPeriodDays={currentPeriodDays}
              onOptimize={() => handleOptimize("Net Profit", { value: metrics.netProfit, target: targets.netProfit, margin: margins?.netProfitMargin })}
            />
          </Layout.Section>
        </Layout>

        {/* Sales Metrics */}
        <Layout>
          <Layout.Section variant="oneThird">
            <MetricCard
              title="Total Sales"
              value={metrics.totalSales}
              target={targets.totalSales}
              trend={trends.totalSales}
              margin={margins?.totalSalesMargin}
              distribution={distributions?.totalSalesDist}
              currentPeriodDays={currentPeriodDays}
              onOptimize={() => handleOptimize("Metric", {})}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <MetricCard
              title="New Customer Revenue"
              value={metrics.newCustomerRevenue}
              target={targets.newCustomerRevenue}
              trend={trends.newCustomerRevenue}
              margin={margins?.newCustomerRevenueMargin}
              distribution={distributions?.newCustomerRevenueDist}
              currentPeriodDays={currentPeriodDays}
              onOptimize={() => handleOptimize("Metric", {})}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <MetricCard
              title="Return Customer Revenue"
              value={metrics.returnCustomerRevenue}
              target={targets.returnCustomerRevenue}
              trend={trends.returnCustomerRevenue}
              margin={margins?.returnCustomerRevenueMargin}
              distribution={distributions?.returnCustomerRevenueDist}
              currentPeriodDays={currentPeriodDays}
              onOptimize={() => handleOptimize("Metric", {})}
            />
          </Layout.Section>
        </Layout>

        {/* Cost Metrics */}
        <Layout>
          <Layout.Section variant="oneThird">
            <MetricCard
              title="Variable Costs"
              value={metrics.variableCosts}
              target={targets.variableCosts}
              trend={trends.variableCosts}
              margin={margins?.variableCostsMargin}
              distribution={distributions?.variableCostsDist}
              currentPeriodDays={currentPeriodDays}
              onOptimize={() => handleOptimize("Metric", {})}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <MetricCard
              title="Marketing Cost"
              value={metrics.marketingCosts}
              target={targets.marketingCosts}
              trend={trends.marketingCosts}
              margin={margins?.marketingCostMargin}
              distribution={distributions?.marketingCostDist}
              currentPeriodDays={currentPeriodDays}
              onOptimize={() => handleOptimize("Metric", {})}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <MetricCard
              title="Fixed Costs"
              value={metrics.fixedCosts}
              target={targets.fixedCosts}
              trend={trends.fixedCosts}
              margin={margins?.fixedCostMargin}
              distribution={distributions?.fixedCostsDist}
              currentPeriodDays={currentPeriodDays}
              onOptimize={() => handleOptimize("Metric", {})}
            />
          </Layout.Section>
        </Layout>
      </BlockStack>
      </div>
    </Page>
  );
}
