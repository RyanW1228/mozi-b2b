export type InventoryRow = {
  sku: string;
  onHandUnits: number;
};

export type SkuMeta = {
  priceUsd: number;
  avgDailyConsumption: number;
  useByDays: number;
  supplier: string;
};
