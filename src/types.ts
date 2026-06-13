export type ProductType = 'tile' | 'granite' | 'specta' | 'product';

export interface EstimateProduct {
  id: string;
  type: ProductType;
  name: string;
  
  // Tile specific
  length?: number;
  width?: number;
  unit?: 'Feet' | 'Inches';
  tileAreaSqFt?: number;
  pricePerSqFt?: number;
  sqFtRequired?: number;
  sqFtPerBox?: number;
  totalBoxes?: number;
  discountPerSqFt?: number;
  
  // Granite specific
  totalSqFt?: number;
  // pricePerSqFt (shared)
  // discountPerSqFt (shared)
  gstApplied?: boolean;
  gstAmount?: number;
  
  // Specta specific
  spectaName?: string;
  numberOfSlabs?: number;
  slabAreaSqFt?: number;
  // totalSqFt (shared)
  // pricePerSqFt (shared)
  // discountPerSqFt (shared)
  effectivePrice?: number;
  finalPrice?: number;
  
  // Other Product specific
  pieces?: number;
  pricePerPiece?: number;
  
  totalPrice: number;
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

export interface Estimate {
  id?: string;
  clientName: string;
  phoneNumber: string;
  siteAddress: string;
  architectName: string;
  assignee: string;
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
  tileTotal: number;
  graniteTotal: number;
  spectaTotal: number;
  productTotal: number;
  cartageAmount: number;
  products: EstimateProduct[];
  remarks: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  deliveryStatus?: DeliveryStatus;
  isFinalOrder?: boolean;
  createdBy: string;
}

export interface Reminder {
  id?: string;
  message: string;
  dueDate: string; // ISO date string YYYY-MM-DD
  clientName?: string;
  estimateId?: string;
  isDone: boolean;
  createdBy: string;
  createdAt: any;
}

export const ASSIGNEES = [
  'Raj', 'Anil', 'Pinkey', 'Hema', 'Ranjendra', 'Bharat', 'Indresh'
];

export const PAYMENT_MODES = [
  'Advance', 'Cash', 'Bank Transfer', 'COD', 'Credit'
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
