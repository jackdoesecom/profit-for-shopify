import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  FormLayout,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getSettings, prisma } from "../utils/database";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  // Get or create metric targets
  let targets = await prisma.metricTargets.findUnique({
    where: { shop: session.shop },
  });

  if (!targets) {
    targets = await prisma.metricTargets.create({
      data: {
        shop: session.shop,
        grossProfit: null,
        contributionProfit: null,
        netProfit: null,
        totalSales: null,
        newCustomerRevenue: null,
        returnCustomerRevenue: null,
        variableCosts: null,
        marketingCosts: null,
        fixedCosts: null,
      },
    });
  }

  // Get Facebook integration status
  const facebookIntegration = await prisma.integration.findFirst({
    where: {
      shop: session.shop,
      platform: "facebook_ads",
    },
  });

  return json({ settings, targets, facebookIntegration });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "updateSettings") {
    const transactionFeePercent = parseFloat(formData.get("transactionFeePercent") as string);

    await prisma.settings.upsert({
      where: { shop: session.shop },
      update: {
        transactionFeePercent,
      },
      create: {
        shop: session.shop,
        transactionFeePercent,
        currency: "USD",
      },
    });
  } else if (action === "updateTargets") {
    // Helper to parse float safely
    const safeParseFloat = (value: string | null): number | null => {
      if (!value || value === "") return null;
      const parsed = parseFloat(value);
      return isNaN(parsed) ? null : parsed;
    };
    
    const targetData = {
      grossProfit: safeParseFloat(formData.get("grossProfit") as string),
      contributionProfit: safeParseFloat(formData.get("contributionProfit") as string),
      netProfit: safeParseFloat(formData.get("netProfit") as string),
      totalSales: safeParseFloat(formData.get("totalSales") as string),
      newCustomerRevenue: safeParseFloat(formData.get("newCustomerRevenue") as string),
      returnCustomerRevenue: safeParseFloat(formData.get("returnCustomerRevenue") as string),
      variableCosts: safeParseFloat(formData.get("variableCosts") as string),
      marketingCosts: safeParseFloat(formData.get("marketingCosts") as string),
      fixedCosts: safeParseFloat(formData.get("fixedCosts") as string),
    };
    
    console.log("Saving targets to database:", targetData);
    
    await prisma.metricTargets.upsert({
      where: { shop: session.shop },
      update: targetData,
      create: {
        shop: session.shop,
        ...targetData,
      },
    });
  }

  return json({ success: true });
};

export default function SettingsPage() {
  const { settings, targets, facebookIntegration } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";
  
  // Get shop from URL (Shopify passes it in embedded apps)
  const shopDomain = typeof window !== 'undefined' 
    ? new URLSearchParams(window.location.search).get('shop') || 'adspendcalculator.myshopify.com'
    : 'adspendcalculator.myshopify.com';

  const [transactionFeePercent, setTransactionFeePercent] = useState(
    settings.transactionFeePercent.toString()
  );

  // Target states
  const [grossProfit, setGrossProfit] = useState(targets.grossProfit?.toString() || "");
  const [contributionProfit, setContributionProfit] = useState(targets.contributionProfit?.toString() || "");
  const [netProfit, setNetProfit] = useState(targets.netProfit?.toString() || "");
  const [totalSales, setTotalSales] = useState(targets.totalSales?.toString() || "");
  const [newCustomerRevenue, setNewCustomerRevenue] = useState(targets.newCustomerRevenue?.toString() || "");
  const [returnCustomerRevenue, setReturnCustomerRevenue] = useState(targets.returnCustomerRevenue?.toString() || "");
  const [variableCosts, setVariableCosts] = useState(targets.variableCosts?.toString() || "");
  const [marketingCosts, setMarketingCosts] = useState(targets.marketingCosts?.toString() || "");
  const [fixedCosts, setFixedCosts] = useState(targets.fixedCosts?.toString() || "");

  const handleSubmitSettings = () => {
    const formData = new FormData();
    formData.append("action", "updateSettings");
    formData.append("transactionFeePercent", transactionFeePercent);
    submit(formData, { method: "post" });
  };

  const handleSubmitTargets = () => {
    console.log("Submitting targets:", {
      grossProfit,
      contributionProfit,
      netProfit,
      totalSales,
      newCustomerRevenue,
      returnCustomerRevenue,
      variableCosts,
      marketingCosts,
      fixedCosts
    });
    
    const formData = new FormData();
    formData.append("action", "updateTargets");
    formData.append("grossProfit", grossProfit);
    formData.append("contributionProfit", contributionProfit);
    formData.append("netProfit", netProfit);
    formData.append("totalSales", totalSales);
    formData.append("newCustomerRevenue", newCustomerRevenue);
    formData.append("returnCustomerRevenue", returnCustomerRevenue);
    formData.append("variableCosts", variableCosts);
    formData.append("marketingCosts", marketingCosts);
    formData.append("fixedCosts", fixedCosts);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Settings"
      subtitle="Configure your profit tracking settings"
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Integrations
              </Text>
              
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">
                      Facebook Ads
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Automatically sync your Facebook ad spend
                    </Text>
                  </BlockStack>
                  
                  {facebookIntegration?.isActive ? (
                    <InlineStack gap="200">
                      <Badge tone="success">Connected</Badge>
                      <Button 
                        size="slim"
                        onClick={() => {
                          const formData = new FormData();
                          formData.append("period", "last30days");
                          submit(formData, { 
                            method: "post",
                            action: "/app/sync-facebook"
                          });
                        }}
                      >
                        Sync Now
                      </Button>
                      <Button 
                        size="slim" 
                        tone="critical"
                        onClick={() => {
                          if (confirm("Disconnect Facebook Ads?")) {
                            // TODO: Add disconnect action
                          }
                        }}
                      >
                        Disconnect
                      </Button>
                    </InlineStack>
                  ) : (
                    <a 
                      href={`/facebook-oauth?shop=${shopDomain}`}
                      target="_top"
                      style={{ textDecoration: 'none' }}
                    >
                      <Button>
                        Connect Facebook Ads
                      </Button>
                    </a>
                  )}
                </InlineStack>
                
                {facebookIntegration?.lastSync && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Last synced: {new Date(facebookIntegration.lastSync).toLocaleString()}
                  </Text>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Calculation Settings
              </Text>
              <FormLayout>
                <TextField
                  label="Transaction Fee Percentage"
                  type="number"
                  value={transactionFeePercent}
                  onChange={setTransactionFeePercent}
                  autoComplete="off"
                  suffix="%"
                  helpText="Default is 3% for Shopify Payments. Adjust based on your payment processor."
                />
              </FormLayout>
              <Button onClick={handleSubmitSettings} loading={isLoading}>
                Save Settings
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Monthly Targets
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Set your monthly targets for each metric. Leave blank to disable target tracking for that metric.
              </Text>
              <FormLayout>
                <FormLayout.Group>
                  <TextField
                    label="Gross Profit Target"
                    type="number"
                    value={grossProfit}
                    onChange={setGrossProfit}
                    autoComplete="off"
                    prefix="$"
                  />
                  <TextField
                    label="Contribution Profit Target"
                    type="number"
                    value={contributionProfit}
                    onChange={setContributionProfit}
                    autoComplete="off"
                    prefix="$"
                  />
                  <TextField
                    label="Net Profit Target"
                    type="number"
                    value={netProfit}
                    onChange={setNetProfit}
                    autoComplete="off"
                    prefix="$"
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Total Sales Target"
                    type="number"
                    value={totalSales}
                    onChange={setTotalSales}
                    autoComplete="off"
                    prefix="$"
                  />
                  <TextField
                    label="New Customer Revenue Target"
                    type="number"
                    value={newCustomerRevenue}
                    onChange={setNewCustomerRevenue}
                    autoComplete="off"
                    prefix="$"
                  />
                  <TextField
                    label="Return Customer Revenue Target"
                    type="number"
                    value={returnCustomerRevenue}
                    onChange={setReturnCustomerRevenue}
                    autoComplete="off"
                    prefix="$"
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Variable Costs Target (Max)"
                    type="number"
                    value={variableCosts}
                    onChange={setVariableCosts}
                    autoComplete="off"
                    prefix="$"
                    helpText="Maximum you want to spend"
                  />
                  <TextField
                    label="Marketing Costs Target (Max)"
                    type="number"
                    value={marketingCosts}
                    onChange={setMarketingCosts}
                    autoComplete="off"
                    prefix="$"
                    helpText="Maximum you want to spend"
                  />
                  <TextField
                    label="Fixed Costs Target (Max)"
                    type="number"
                    value={fixedCosts}
                    onChange={setFixedCosts}
                    autoComplete="off"
                    prefix="$"
                    helpText="Maximum you want to spend"
                  />
                </FormLayout.Group>
              </FormLayout>
              <Button onClick={handleSubmitTargets} loading={isLoading} variant="primary">
                Save Targets
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                About Calculations
              </Text>
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    Gross Profit
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Total Sales - Variable Costs (COGS + Shipping + Transaction Fees)
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    Contribution Profit
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Total Sales - (Variable Costs + Marketing Costs)
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    Net Profit
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Total Sales - (Variable Costs + Marketing Costs + Fixed Costs)
                  </Text>
                </BlockStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

