import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  DataTable,
  Badge,
  Modal,
  TextField,
  Select,
  FormLayout,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { prisma } from "../utils/database";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Fetch all costs for the shop
  const marketingCosts = await prisma.marketingCost.findMany({
    where: { shop: session.shop },
    orderBy: { date: "desc" },
    take: 50,
  });

  const fixedCosts = await prisma.fixedCost.findMany({
    where: { shop: session.shop },
    orderBy: { startDate: "desc" },
  });

  const manualCosts = await prisma.manualCost.findMany({
    where: { shop: session.shop },
    orderBy: { date: "desc" },
    take: 50,
  });

  return json({
    marketingCosts,
    fixedCosts,
    manualCosts,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "addMarketingCost") {
    await prisma.marketingCost.create({
      data: {
        shop: session.shop,
        platform: formData.get("platform") as string,
        amount: parseFloat(formData.get("amount") as string),
        date: new Date(formData.get("date") as string),
        description: formData.get("description") as string || null,
      },
    });
  } else if (action === "addFixedCost") {
    await prisma.fixedCost.create({
      data: {
        shop: session.shop,
        category: formData.get("category") as string,
        name: formData.get("name") as string,
        amount: parseFloat(formData.get("amount") as string),
        startDate: new Date(formData.get("startDate") as string),
        recurring: formData.get("recurring") === "true",
      },
    });
  } else if (action === "addManualCost") {
    await prisma.manualCost.create({
      data: {
        shop: session.shop,
        category: formData.get("category") as string,
        description: formData.get("description") as string,
        amount: parseFloat(formData.get("amount") as string),
        date: new Date(formData.get("date") as string),
      },
    });
  } else if (action === "deleteMarketingCost") {
    await prisma.marketingCost.delete({
      where: { id: formData.get("id") as string },
    });
  } else if (action === "deleteFixedCost") {
    await prisma.fixedCost.delete({
      where: { id: formData.get("id") as string },
    });
  } else if (action === "deleteManualCost") {
    await prisma.manualCost.delete({
      where: { id: formData.get("id") as string },
    });
  }

  return json({ success: true });
};

export default function CostsPage() {
  const data = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [showMarketingModal, setShowMarketingModal] = useState(false);
  const [showFixedModal, setShowFixedModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);

  // Marketing Cost Form State
  const [marketingPlatform, setMarketingPlatform] = useState("manual");
  const [marketingAmount, setMarketingAmount] = useState("");
  const [marketingDate, setMarketingDate] = useState(new Date().toISOString().split("T")[0]);
  const [marketingDescription, setMarketingDescription] = useState("");

  // Fixed Cost Form State
  const [fixedCategory, setFixedCategory] = useState("software");
  const [fixedName, setFixedName] = useState("");
  const [fixedAmount, setFixedAmount] = useState("");
  const [fixedStartDate, setFixedStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [fixedRecurring, setFixedRecurring] = useState("true");

  // Manual Cost Form State
  const [manualCategory, setManualCategory] = useState("shipping");
  const [manualDescription, setManualDescription] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualDate, setManualDate] = useState(new Date().toISOString().split("T")[0]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US");
  };

  const handleAddMarketingCost = () => {
    const formData = new FormData();
    formData.append("action", "addMarketingCost");
    formData.append("platform", marketingPlatform);
    formData.append("amount", marketingAmount);
    formData.append("date", marketingDate);
    formData.append("description", marketingDescription);
    submit(formData, { method: "post" });
    setShowMarketingModal(false);
    // Reset form
    setMarketingPlatform("manual");
    setMarketingAmount("");
    setMarketingDate(new Date().toISOString().split("T")[0]);
    setMarketingDescription("");
  };

  const handleAddFixedCost = () => {
    const formData = new FormData();
    formData.append("action", "addFixedCost");
    formData.append("category", fixedCategory);
    formData.append("name", fixedName);
    formData.append("amount", fixedAmount);
    formData.append("startDate", fixedStartDate);
    formData.append("recurring", fixedRecurring);
    submit(formData, { method: "post" });
    setShowFixedModal(false);
    // Reset form
    setFixedCategory("software");
    setFixedName("");
    setFixedAmount("");
    setFixedStartDate(new Date().toISOString().split("T")[0]);
    setFixedRecurring("true");
  };

  const handleAddManualCost = () => {
    const formData = new FormData();
    formData.append("action", "addManualCost");
    formData.append("category", manualCategory);
    formData.append("description", manualDescription);
    formData.append("amount", manualAmount);
    formData.append("date", manualDate);
    submit(formData, { method: "post" });
    setShowManualModal(false);
    // Reset form
    setManualCategory("shipping");
    setManualDescription("");
    setManualAmount("");
    setManualDate(new Date().toISOString().split("T")[0]);
  };

  const handleDelete = (type: string, id: string) => {
    if (confirm("Are you sure you want to delete this cost?")) {
      const formData = new FormData();
      formData.append("action", `delete${type}Cost`);
      formData.append("id", id);
      submit(formData, { method: "post" });
    }
  };

  return (
    <Page
      title="Manage Costs"
      subtitle="Add and manage your business costs"
    >
      <BlockStack gap="500">
        {/* Marketing Costs */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Marketing Costs
              </Text>
              <Button onClick={() => setShowMarketingModal(true)}>
                Add Marketing Cost
              </Button>
            </InlineStack>
            
            {data.marketingCosts.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "numeric", "text", "text"]}
                headings={["Date", "Platform", "Amount", "Description", "Actions"]}
                rows={data.marketingCosts.map((cost) => [
                  formatDate(cost.date),
                  <Badge key={cost.id}>{cost.platform}</Badge>,
                  formatCurrency(cost.amount),
                  cost.description || "-",
                  <Button
                    key={cost.id}
                    size="slim"
                    tone="critical"
                    onClick={() => handleDelete("Marketing", cost.id)}
                  >
                    Delete
                  </Button>,
                ])}
              />
            ) : (
              <Text as="p" tone="subdued">
                No marketing costs added yet. Click "Add Marketing Cost" to get started.
              </Text>
            )}
          </BlockStack>
        </Card>

        {/* Fixed Costs */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Fixed Costs
              </Text>
              <Button onClick={() => setShowFixedModal(true)}>
                Add Fixed Cost
              </Button>
            </InlineStack>
            
            {data.fixedCosts.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
                headings={["Category", "Name", "Start Date", "Amount", "Type", "Actions"]}
                rows={data.fixedCosts.map((cost) => [
                  <Badge key={cost.id}>{cost.category}</Badge>,
                  cost.name,
                  formatDate(cost.startDate),
                  formatCurrency(cost.amount),
                  cost.recurring ? "Monthly" : "One-time",
                  <Button
                    key={cost.id}
                    size="slim"
                    tone="critical"
                    onClick={() => handleDelete("Fixed", cost.id)}
                  >
                    Delete
                  </Button>,
                ])}
              />
            ) : (
              <Text as="p" tone="subdued">
                No fixed costs added yet. Click "Add Fixed Cost" to get started.
              </Text>
            )}
          </BlockStack>
        </Card>

        {/* Manual Costs */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Manual Variable Costs
              </Text>
              <Button onClick={() => setShowManualModal(true)}>
                Add Manual Cost
              </Button>
            </InlineStack>
            
            {data.manualCosts.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "text"]}
                headings={["Date", "Category", "Description", "Amount", "Actions"]}
                rows={data.manualCosts.map((cost) => [
                  formatDate(cost.date),
                  <Badge key={cost.id}>{cost.category}</Badge>,
                  cost.description,
                  formatCurrency(cost.amount),
                  <Button
                    key={cost.id}
                    size="slim"
                    tone="critical"
                    onClick={() => handleDelete("Manual", cost.id)}
                  >
                    Delete
                  </Button>,
                ])}
              />
            ) : (
              <Text as="p" tone="subdued">
                No manual costs added yet. Click "Add Manual Cost" to get started.
              </Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Marketing Cost Modal */}
      <Modal
        open={showMarketingModal}
        onClose={() => setShowMarketingModal(false)}
        title="Add Marketing Cost"
        primaryAction={{
          content: "Add Cost",
          onAction: handleAddMarketingCost,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowMarketingModal(false),
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <Select
              label="Platform"
              options={[
                { label: "Manual", value: "manual" },
                { label: "Facebook Ads", value: "facebook" },
                { label: "Google Ads", value: "google" },
                { label: "TikTok Ads", value: "tiktok" },
                { label: "Influencer", value: "influencer" },
              ]}
              value={marketingPlatform}
              onChange={setMarketingPlatform}
            />
            <TextField
              label="Amount"
              type="number"
              value={marketingAmount}
              onChange={setMarketingAmount}
              autoComplete="off"
              prefix="$"
            />
            <TextField
              label="Date"
              type="date"
              value={marketingDate}
              onChange={setMarketingDate}
              autoComplete="off"
            />
            <TextField
              label="Description (optional)"
              value={marketingDescription}
              onChange={setMarketingDescription}
              autoComplete="off"
              multiline={2}
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Fixed Cost Modal */}
      <Modal
        open={showFixedModal}
        onClose={() => setShowFixedModal(false)}
        title="Add Fixed Cost"
        primaryAction={{
          content: "Add Cost",
          onAction: handleAddFixedCost,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowFixedModal(false),
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <Select
              label="Category"
              options={[
                { label: "Software", value: "software" },
                { label: "Rent", value: "rent" },
                { label: "Salary", value: "salary" },
                { label: "Other", value: "other" },
              ]}
              value={fixedCategory}
              onChange={setFixedCategory}
            />
            <TextField
              label="Name"
              value={fixedName}
              onChange={setFixedName}
              autoComplete="off"
              placeholder="e.g., Shopify subscription"
            />
            <TextField
              label="Amount"
              type="number"
              value={fixedAmount}
              onChange={setFixedAmount}
              autoComplete="off"
              prefix="$"
            />
            <TextField
              label="Start Date"
              type="date"
              value={fixedStartDate}
              onChange={setFixedStartDate}
              autoComplete="off"
            />
            <Select
              label="Type"
              options={[
                { label: "Monthly Recurring", value: "true" },
                { label: "One-time", value: "false" },
              ]}
              value={fixedRecurring}
              onChange={setFixedRecurring}
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Manual Cost Modal */}
      <Modal
        open={showManualModal}
        onClose={() => setShowManualModal(false)}
        title="Add Manual Cost"
        primaryAction={{
          content: "Add Cost",
          onAction: handleAddManualCost,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowManualModal(false),
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <Select
              label="Category"
              options={[
                { label: "Shipping", value: "shipping" },
                { label: "Cost of Goods Sold (COGS)", value: "cogs" },
                { label: "Other", value: "other" },
              ]}
              value={manualCategory}
              onChange={setManualCategory}
            />
            <TextField
              label="Description"
              value={manualDescription}
              onChange={setManualDescription}
              autoComplete="off"
              placeholder="e.g., Extra shipping labels"
            />
            <TextField
              label="Amount"
              type="number"
              value={manualAmount}
              onChange={setManualAmount}
              autoComplete="off"
              prefix="$"
            />
            <TextField
              label="Date"
              type="date"
              value={manualDate}
              onChange={setManualDate}
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

