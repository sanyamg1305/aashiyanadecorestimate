export interface TileProduct {
  id: string;
  tileName: string;
  tileSize: string;
  pricePerSqFt: number;
  sqFtRequired: number;
  sqFtPerBox: number;
  totalBoxes: number;
  totalPrice: number;
  costPricePerSqFt?: number;
}

export type EstimateStatus = 
  | 'Draft'
  | 'Quotation Sent'
  | 'Revision Requested'
  | 'Final Quotation'
  | 'Order Confirmed'
  | 'Order Processing'
  | 'Delivered'
  | 'Cancelled';

export type DeliveryStatus = 
  | 'Preparing Order'
  | 'Ready for Dispatch'
  | 'Dispatched'
  | 'Delivered';

export type PaymentStatus = 
  | 'Not Paid'
  | 'Advance Received'
  | 'Partially Paid'
  | 'Fully Paid';

export interface LeadActivity {
  id: string;
  type: 'status_change' | 'note' | 'system';
  message: string;
  timestamp: string;
  userName: string;
  userId: string;
}

export interface Lead {
  id?: string;
  clientName: string;
  phoneNumber: string;
  siteAddress: string;
  architectName: string;
  assignee: string;
  remarks: string;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  activities?: LeadActivity[];
}

export interface Estimate {
  id?: string;
  leadId: string;
  version: number;
  createdAt: any;
  updatedAt: any;
  estimateStatus: EstimateStatus;
  paymentMode: string;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  balanceAmount: number;
  grandTotal: number;
  subtotal: number;
  totalBoxes: number;
  products: TileProduct[];
  remarks: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  deliveryStatus?: DeliveryStatus;
  isFinalOrder?: boolean;
}

export const ASSIGNEES = [
  'Raj', 'Anil', 'Pinkey', 'Hema', 'Ranjendra', 'Bharat', 'Indresh'
];

export const PAYMENT_MODES = [
  'Advance', 'Cash', 'Bank Transfer', 'COD', 'Credit'
];

export const TILE_SIZES = [
  { label: '4 x 2', value: 8 },
  { label: '2 x 2', value: 4 },
  { label: '2 x 1', value: 2 },
  { label: '1 x 1', value: 1 }
];

export const ESTIMATE_STATUS_CONFIG: Record<EstimateStatus, { color: string, bg: string }> = {
  'Draft': { color: 'text-slate-600', bg: 'bg-slate-100' },
  'Quotation Sent': { color: 'text-blue-600', bg: 'bg-blue-100' },
  'Revision Requested': { color: 'text-orange-600', bg: 'bg-orange-100' },
  'Final Quotation': { color: 'text-indigo-600', bg: 'bg-indigo-100' },
  'Order Confirmed': { color: 'text-purple-600', bg: 'bg-purple-100' },
  'Order Processing': { color: 'text-teal-600', bg: 'bg-teal-100' },
  'Delivered': { color: 'text-green-600', bg: 'bg-green-100' },
  'Cancelled': { color: 'text-red-600', bg: 'bg-red-100' }
};

export const DELIVERY_STATUS_OPTIONS: DeliveryStatus[] = [
  'Preparing Order', 'Ready for Dispatch', 'Dispatched', 'Delivered'
];

export const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = [
  'Not Paid', 'Advance Received', 'Partially Paid', 'Fully Paid'
];
