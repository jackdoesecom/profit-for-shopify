-- CreateTable
CREATE TABLE "MetricTargets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "grossProfit" REAL,
    "contributionProfit" REAL,
    "netProfit" REAL,
    "totalSales" REAL,
    "newCustomerRevenue" REAL,
    "returnCustomerRevenue" REAL,
    "variableCosts" REAL,
    "marketingCosts" REAL,
    "fixedCosts" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricTargets_shop_key" ON "MetricTargets"("shop");
