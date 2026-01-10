// src/lib/types/intentRow.ts
export type OrderLine = {
  sku: string;
  name?: string;
  qty: number;
  uom?: string;
};

export type IntentItem = {
  orderId: string;
  supplier: string;
  amount: string;
  executeAfter?: number;
  lines: OrderLine[];
  txHash?: string;
  to?: string;
  createdAtUnix?: number;
};

export type IntentRow = {
  ref: string;
  owner: string;
  restaurantId: string;
  locationId: string;
  executeAfter?: number;
  approved?: boolean;
  executed?: boolean;
  canceled?: boolean;
  items: IntentItem[];
  createdAtUnix?: number;
  env: "testing" | "production";
};
