/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, Component } from 'react';
import { 
  Plus, 
  Trash2, 
  Save, 
  Printer, 
  Search, 
  User, 
  Phone, 
  MapPin, 
  CreditCard, 
  FileText, 
  ChevronRight,
  History,
  LogOut,
  Calculator,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { 
  collection,
  addDoc,
  updateDoc,
  doc,
  query,
  getDocs,
  orderBy,
  serverTimestamp,
  onSnapshot,
  getDocFromServer,
  deleteDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { db, auth } from './firebase';
import { 
  Estimate, 
  EstimateProduct, 
  EstimateStatus, 
  DeliveryStatus, 
  PaymentStatus,
  ASSIGNEES, 
  PAYMENT_MODES, 
  ESTIMATE_STATUS_CONFIG,
  DELIVERY_STATUS_OPTIONS,
  PAYMENT_STATUS_OPTIONS
} from './types';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    const state = (this as any).state;
    if (state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(state.error?.message || "{}");
        if (parsed.error) errorMessage = parsed.error;
      } catch (e) {
        errorMessage = state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="text-red-500" size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Application Error</h2>
            <p className="text-slate-500 mb-6">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-black text-white py-3 rounded-xl font-bold hover:bg-black/90 transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

// --- Components ---

const Input = ({ label, icon: Icon, ...props }: any) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold text-black uppercase tracking-wider flex items-center gap-1.5">
      {Icon && <Icon size={14} />}
      {label}
    </label>
    <input
      {...props}
      className="w-full px-4 py-2.5 bg-white border border-black rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-black placeholder:text-black/40"
    />
  </div>
);

const Select = ({ label, icon: Icon, options, ...props }: any) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold text-black uppercase tracking-wider flex items-center gap-1.5">
      {Icon && <Icon size={14} />}
      {label}
    </label>
    <select
      {...props}
      className="w-full px-4 py-2.5 bg-white border border-black rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-black appearance-none"
    >
      <option value="">Select {label}</option>
      {options.map((opt: any) => (
        <option key={opt.value || opt} value={opt.value || opt}>
          {opt.label || opt}
        </option>
      ))}
    </select>
  </div>
);

const TILE_SIZES = ['4 x 2', '2 x 2', '2 x 1', '1 x 1']; // Deprecated

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'dashboard' | 'estimate_detail' | 'estimate_form'>('dashboard');
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Estimate Form State (Includes Client Info)
  const [currentEstimateId, setCurrentEstimateId] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [architectName, setArchitectName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [estimateStatus, setEstimateStatus] = useState<EstimateStatus>('Draft');
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('Not Paid');
  const [amountPaid, setAmountPaid] = useState(0);
  const [estimateRemarks, setEstimateRemarks] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>('Preparing Order');
  const [isFinalOrder, setIsFinalOrder] = useState(false);
  const [cartageAmount, setCartageAmount] = useState(0);
  const [products, setProducts] = useState<EstimateProduct[]>([
    {
      id: Math.random().toString(36).substr(2, 9),
      type: 'tile',
      name: '',
      length: 2,
      width: 2,
      unit: 'Feet',
      tileAreaSqFt: 4,
      pricePerSqFt: 0,
      sqFtRequired: 0,
      sqFtPerBox: 0,
      totalBoxes: 0,
      totalPrice: 0,
    }
  ]);

  // --- Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const deleteEstimate = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this lead?')) return;
    try {
      await deleteDoc(doc(db, 'estimates', id));
      if (selectedEstimateId === id) {
        setView('dashboard');
        setSelectedEstimateId(null);
      }
    } catch (error) {
      console.error('Delete failed', error);
      handleFirestoreError(error, OperationType.DELETE, `estimates/${id}`);
    }
  };

  // --- Firestore Connection Test ---
  useEffect(() => {
    if (user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }
      };
      testConnection();
    }
  }, [user]);

  // --- Calculations ---
  const totals = useMemo(() => {
    const tileTotal = products
      .filter(p => p.type === 'tile')
      .reduce((acc, p) => acc + p.totalPrice, 0);
    
    const graniteTotal = products
      .filter(p => p.type === 'granite')
      .reduce((acc, p) => acc + p.totalPrice, 0);

    const spectaTotal = products
      .filter(p => p.type === 'specta')
      .reduce((acc, p) => acc + p.totalPrice, 0);
    
    const productTotal = products
      .filter(p => p.type === 'product')
      .reduce((acc, p) => acc + p.totalPrice, 0);

    const subtotal = tileTotal + graniteTotal + spectaTotal + productTotal;
    const totalBoxes = products.reduce((acc, p) => acc + (p.totalBoxes || 0), 0);
    
    const grandTotal = Math.round(subtotal + cartageAmount);

    return {
      tileTotal,
      graniteTotal,
      spectaTotal,
      productTotal,
      subtotal,
      cartageAmount,
      grandTotal,
      totalBoxes
    };
  }, [products, cartageAmount]);

  const updateProduct = (id: string, updates: Partial<EstimateProduct>) => {
    setProducts(prev => prev.map(p => {
      if (p.id === id) {
        const updated = { ...p, ...updates };
        
        if (updated.type === 'tile') {
          // Calculate Tile Area
          const length = updated.length || 0;
          const width = updated.width || 0;
          const unit = updated.unit || 'Feet';
          
          if (unit === 'Feet') {
            updated.tileAreaSqFt = length * width;
          } else {
            updated.tileAreaSqFt = (length / 12) * (width / 12);
          }

          const perBox = updated.sqFtPerBox || 1;
          const price = updated.pricePerSqFt || 0;
          const discount = updated.discountPerSqFt || 0;

          if ('sqFtRequired' in updates || 'sqFtPerBox' in updates) {
            updated.totalBoxes = Math.ceil((updated.sqFtRequired || 0) / perBox);
          }
          
          updated.totalPrice = (updated.sqFtRequired || 0) * (price - discount);
        } 
        else if (updated.type === 'specta') {
          // Slab size: 129" x 64"
          const slabAreaSqFt = 57.3; // (129/12) * (64/12) rounded as per user example
          updated.slabAreaSqFt = slabAreaSqFt;
          
          const numSlabs = updated.numberOfSlabs || 0;
          const price = updated.pricePerSqFt || 0;
          const discount = Math.max(0, updated.discountPerSqFt || 0); // Prevent negative discount
          
          updated.discountPerSqFt = discount;
          updated.effectivePrice = price - discount;
          updated.totalSqFt = numSlabs * slabAreaSqFt;
          updated.totalPrice = updated.totalSqFt * updated.effectivePrice;
          updated.finalPrice = updated.totalPrice;
        }
        else if (updated.type === 'granite') {
          const totalSqFt = updated.totalSqFt || 0;
          const price = updated.pricePerSqFt || 0;
          const discount = updated.discountPerSqFt || 0;
          const effectivePrice = price - discount;
          const subtotal = totalSqFt * effectivePrice;
          
          if (updated.gstApplied) {
            updated.gstAmount = subtotal * 0.18;
            updated.totalPrice = subtotal + updated.gstAmount;
          } else {
            updated.gstAmount = 0;
            updated.totalPrice = subtotal;
          }
        }
        else if (updated.type === 'product') {
          const pieces = updated.pieces || 0;
          const price = updated.pricePerPiece || 0;
          updated.totalPrice = pieces * price;
        }

        updated.totalPrice = Math.round(updated.totalPrice);
        return updated;
      }
      return p;
    }));
  };

  const addTile = () => {
    setProducts([...products, {
      id: Math.random().toString(36).substr(2, 9),
      type: 'tile',
      name: '',
      length: 2,
      width: 2,
      unit: 'Feet',
      tileAreaSqFt: 4,
      pricePerSqFt: 0,
      discountPerSqFt: 0,
      sqFtRequired: 0,
      sqFtPerBox: 0,
      totalBoxes: 0,
      totalPrice: 0,
    }]);
  };

  const addSpecta = () => {
    const slabAreaSqFt = 57.3; // (129/12) * (64/12) rounded as per user example
    setProducts([...products, {
      id: Math.random().toString(36).substr(2, 9),
      type: 'specta',
      name: '',
      spectaName: '',
      numberOfSlabs: 0,
      slabAreaSqFt: slabAreaSqFt,
      totalSqFt: 0,
      pricePerSqFt: 0,
      discountPerSqFt: 0,
      effectivePrice: 0,
      finalPrice: 0,
      totalPrice: 0,
    }]);
  };

  const addGranite = () => {
    setProducts([...products, {
      id: Math.random().toString(36).substr(2, 9),
      type: 'granite',
      name: '',
      totalSqFt: 0,
      pricePerSqFt: 0,
      discountPerSqFt: 0,
      gstApplied: false,
      gstAmount: 0,
      totalPrice: 0,
    }]);
  };

  const addOtherProduct = () => {
    setProducts([...products, {
      id: Math.random().toString(36).substr(2, 9),
      type: 'product',
      name: '',
      pieces: 0,
      pricePerPiece: 0,
      totalPrice: 0,
    }]);
  };

  const removeProduct = (id: string) => {
    if (products.length > 1) {
      setProducts(products.filter(p => p.id !== id));
    }
  };

  // --- Actions ---
  const saveEstimate = async () => {
    if (!user) return;

    setIsSaving(true);
    const estimateData: any = {
      clientName: clientName || '',
      phoneNumber: phoneNumber || '',
      siteAddress: siteAddress || '',
      architectName: architectName || '',
      assignee: assignee || '',
      estimateStatus,
      paymentMode,
      paymentStatus,
      amountPaid,
      balanceAmount: totals.grandTotal - amountPaid,
      grandTotal: totals.grandTotal,
      subtotal: totals.subtotal,
      totalBoxes: totals.totalBoxes,
      tileTotal: totals.tileTotal,
      graniteTotal: totals.graniteTotal,
      spectaTotal: totals.spectaTotal,
      productTotal: totals.productTotal,
      cartageAmount: totals.cartageAmount,
      products,
      remarks: estimateRemarks,
      updatedAt: serverTimestamp(),
      orderDate: estimateStatus === 'Order Confirmed' ? (orderDate || new Date().toISOString()) : null,
      expectedDeliveryDate: expectedDeliveryDate || null,
      deliveryStatus: deliveryStatus || 'Preparing Order',
      isFinalOrder: isFinalOrder || false,
    };

    if (!currentEstimateId) {
      estimateData.createdAt = serverTimestamp();
      estimateData.createdBy = user.uid;
      estimateData.version = 1;
    }

    try {
      let estimateId = currentEstimateId;
      if (currentEstimateId) {
        await updateDoc(doc(db, 'estimates', currentEstimateId), estimateData);
      } else {
        const docRef = await addDoc(collection(db, 'estimates'), estimateData);
        estimateId = docRef.id;
      }
      
      alert('Estimate saved successfully!');
      resetForm();
      setSelectedEstimateId(estimateId!);
      setView('estimate_detail');
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save estimate. Please check your connection and try again.');
      handleFirestoreError(error, OperationType.WRITE, 'estimates');
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setCurrentEstimateId(null);
    setAssignee('');
    setClientName('');
    setPhoneNumber('');
    setSiteAddress('');
    setArchitectName('');
    
    setEstimateStatus('Draft');
    setPaymentMode('');
    setPaymentStatus('Not Paid');
    setAmountPaid(0);
    setEstimateRemarks('');
    setOrderDate('');
    setExpectedDeliveryDate('');
    setDeliveryStatus('Preparing Order');
    setIsFinalOrder(false);
    setCartageAmount(0);
    
    setProducts([{
      id: Math.random().toString(36).substr(2, 9),
      type: 'tile',
      name: '',
      length: 2,
      width: 2,
      unit: 'Feet',
      tileAreaSqFt: 4,
      pricePerSqFt: 0,
      discountPerSqFt: 0,
      sqFtRequired: 0,
      sqFtPerBox: 0,
      totalBoxes: 0,
      totalPrice: 0,
    }]);
  };

  const duplicateEstimate = async (estimate: Estimate) => {
    if (!user) return;
    
    setIsSaving(true);
    
    const newEstimate: Partial<Estimate> = {
      ...estimate,
      id: undefined,
      version: (estimate.version || 1) + 1,
      estimateStatus: 'Draft',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isFinalOrder: false,
      paymentStatus: 'Not Paid',
      amountPaid: 0,
      balanceAmount: estimate.grandTotal
    };

    try {
      await addDoc(collection(db, 'estimates'), newEstimate);
      alert('Estimate duplicated as Draft!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'estimates');
    } finally {
      setIsSaving(false);
    }
  };

  const updateEstimateStatus = async (estimateId: string, newStatus: EstimateStatus) => {
    const estimate = estimates.find(e => e.id === estimateId);
    if (!estimate || !user) return;

    try {
      await updateDoc(doc(db, 'estimates', estimateId), {
        estimateStatus: newStatus,
        updatedAt: serverTimestamp(),
        orderDate: newStatus === 'Order Confirmed' ? new Date().toISOString() : estimate.orderDate
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'estimates');
    }
  };

  const viewEstimateDetail = (estimate: Estimate) => {
    setSelectedEstimateId(estimate.id!);
    setView('estimate_detail');
  };

  const editEstimate = (estimate: Estimate) => {
    setCurrentEstimateId(estimate.id!);
    setClientName(estimate.clientName);
    setPhoneNumber(estimate.phoneNumber);
    setAssignee(estimate.assignee);
    setSiteAddress(estimate.siteAddress);
    setArchitectName(estimate.architectName);

    setEstimateStatus(estimate.estimateStatus);
    setPaymentMode(estimate.paymentMode);
    setPaymentStatus(estimate.paymentStatus);
    setAmountPaid(estimate.amountPaid);
    setEstimateRemarks(estimate.remarks);
    setOrderDate(estimate.orderDate || '');
    setExpectedDeliveryDate(estimate.expectedDeliveryDate || '');
    setDeliveryStatus(estimate.deliveryStatus || 'Preparing Order');
    setIsFinalOrder(estimate.isFinalOrder || false);
    setCartageAmount(estimate.cartageAmount || 0);
    setProducts(estimate.products);
    setView('estimate_form');
  };

  // --- Data Fetching ---
  useEffect(() => {
    if (!user) return;
    
    // Fetch Estimates
    const baseQuery = collection(db, 'estimates');
    const estimatesQuery = query(baseQuery, orderBy('updatedAt', 'desc'));

    const unsubscribeEstimates = onSnapshot(estimatesQuery, (snapshot) => {
      setEstimates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Estimate)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'estimates'));

    return () => {
      unsubscribeEstimates();
    };
  }, [user]);

  const filteredEstimates = useMemo(() => {
    return estimates.filter(e => {
      const matchesSearch = 
        e.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.phoneNumber.includes(searchQuery) ||
        (e.architectName?.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesAssignee = !assigneeFilter || e.assignee === assigneeFilter;

      return matchesSearch && matchesAssignee;
    });
  }, [estimates, searchQuery, assigneeFilter]);

  const selectedEstimate = useMemo(() => 
    estimates.find(e => e.id === selectedEstimateId) || null
  , [estimates, selectedEstimateId]);

  const dashboardStats = useMemo(() => {
    const totalEstimates = estimates.length;
    const confirmedOrders = estimates.filter(e => e.estimateStatus === 'Order Confirmed').length;
    const pendingPayments = estimates.filter(e => e.paymentStatus === 'Not Paid' || e.paymentStatus === 'Partially Paid').length;
    
    return { totalEstimates, confirmedOrders, pendingPayments };
  }, [estimates]);

  // --- PDF Export ---
  const generatePDF = (estimate: Estimate) => {
    try {
      const doc = new jsPDF();
      
      // Header
      doc.setFontSize(22);
      doc.setTextColor(30, 41, 59);
      doc.text('AASHIYANA DECOR', 105, 20, { align: 'center' });
      doc.setFontSize(10);
      doc.text('Tile Showroom & Decor Solutions', 105, 26, { align: 'center' });
      
      doc.setDrawColor(226, 232, 240);
      doc.line(20, 32, 190, 32);

      // Client Info
      doc.setFontSize(12);
      doc.text(`ESTIMATE v${estimate.version || 1}`, 20, 42);
      doc.setFontSize(10);
      
      const date = estimate.updatedAt && typeof estimate.updatedAt.toDate === 'function' 
        ? estimate.updatedAt.toDate() 
        : new Date();
      doc.text(`Date: ${format(date, 'dd MMM yyyy')}`, 190, 42, { align: 'right' });

      doc.setFont('helvetica', 'bold');
      doc.text('Client Details:', 20, 52);
      doc.setFont('helvetica', 'normal');
      doc.text(`Name: ${estimate.clientName || 'N/A'}`, 20, 58);
      doc.text(`Phone: ${estimate.phoneNumber || 'N/A'}`, 20, 64);
      doc.text(`Address: ${estimate.siteAddress || 'N/A'}`, 20, 70);

      doc.setFont('helvetica', 'bold');
      doc.text('Sales Info:', 120, 52);
      doc.setFont('helvetica', 'normal');
      doc.text(`Assignee: ${estimate.assignee || 'N/A'}`, 120, 58);
      doc.text(`Architect: ${estimate.architectName || 'N/A'}`, 120, 64);
      doc.text(`Payment: ${estimate.paymentMode || 'N/A'}`, 120, 70);

      // Table
      autoTable(doc, {
        startY: 80,
        head: [['Type', 'Product', 'Qty/Info', 'Rate', 'Total']],
        body: estimate.products.map(p => {
          let qtyInfo = '';
          let rate = '';
          let productName = p.name || 'N/A';
          
          if (p.type === 'tile') {
            if (p.length && p.width) {
              productName += ` (${p.length}x${p.width} ${p.unit === 'Inches' ? 'in' : 'ft'})`;
            }
            qtyInfo = `${p.sqFtRequired} sqft (${p.totalBoxes} boxes)`;
            rate = `₹${p.pricePerSqFt}/sqft`;
            if (p.discountPerSqFt) rate += ` (-₹${p.discountPerSqFt})`;
          } else if (p.type === 'specta') {
            productName = p.spectaName || 'Specta Slab';
            qtyInfo = `${p.numberOfSlabs} slabs (${p.totalSqFt?.toFixed(2)} sqft)`;
            rate = `₹${p.pricePerSqFt}/sqft`;
            if (p.discountPerSqFt) rate += ` (-₹${p.discountPerSqFt})`;
            if (p.effectivePrice) rate += ` (Eff: ₹${p.effectivePrice.toFixed(2)})`;
          } else if (p.type === 'granite') {
            qtyInfo = `${p.totalSqFt} sqft`;
            rate = `₹${p.pricePerSqFt}/sqft`;
            if (p.discountPerSqFt) rate += ` (-₹${p.discountPerSqFt})`;
            if (p.gstApplied) qtyInfo += ' + GST';
          } else {
            qtyInfo = `${p.pieces} pcs`;
            rate = `₹${p.pricePerPiece}/pc`;
          }

          return [
            p.type.toUpperCase(),
            productName,
            qtyInfo,
            rate,
            `₹${(p.totalPrice || 0).toLocaleString()}`
          ];
        }),
        theme: 'striped',
        headStyles: { fillColor: [30, 41, 59] },
        margin: { top: 80 }
      });

      const finalY = (doc as any).lastAutoTable.finalY + 10;

      // Summary
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`Tile Total: Rs. ${(estimate.tileTotal || 0).toLocaleString()}`, 190, finalY, { align: 'right' });
      doc.text(`Granite Total: Rs. ${(estimate.graniteTotal || 0).toLocaleString()}`, 190, finalY + 6, { align: 'right' });
      doc.text(`Specta Total: Rs. ${(estimate.spectaTotal || 0).toLocaleString()}`, 190, finalY + 12, { align: 'right' });
      doc.text(`Product Total: Rs. ${(estimate.productTotal || 0).toLocaleString()}`, 190, finalY + 18, { align: 'right' });
      doc.text(`Cartage: Rs. ${(estimate.cartageAmount || 0).toLocaleString()}`, 190, finalY + 24, { align: 'right' });
      doc.setFontSize(14);
      doc.setTextColor(37, 99, 235);
      doc.text(`Grand Total: Rs. ${(estimate.grandTotal || 0).toLocaleString()}`, 190, finalY + 34, { align: 'right' });

      if (estimate.remarks) {
        doc.setTextColor(30, 41, 59);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text('Remarks:', 20, finalY + 40);
        doc.setFontSize(9);
        doc.text(estimate.remarks, 20, finalY + 45, { maxWidth: 170 });
      }

      doc.save(`Estimate_${estimate.clientName || 'Unnamed'}_v${estimate.version || 1}.pdf`);
    } catch (error) {
      console.error('PDF Generation Error:', error);
      alert('Failed to generate PDF. Please check the console for details.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mb-8 shadow-xl shadow-blue-500/20">
          <Calculator className="text-white" size={40} />
        </div>
        <h1 className="text-3xl font-bold text-black mb-2">Aashiyana Decor</h1>
        <p className="text-black/40 mb-8 max-w-xs">Digital Estimate & Billing System for Tile Showrooms</p>
        <button
          onClick={handleLogin}
          className="flex items-center gap-3 bg-white border border-black/10 px-8 py-3.5 rounded-2xl font-semibold text-black hover:bg-neutral-50 transition-all shadow-sm active:scale-95"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-black/10 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/10">
              <Calculator className="text-white" size={20} />
            </div>
            <div>
              <h1 className="font-bold text-black leading-tight">Aashiyana Decor</h1>
              <p className="text-[10px] text-black/40 uppercase tracking-widest font-bold">Estimates</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('dashboard')}
              className={cn(
                "p-2.5 rounded-xl transition-all flex items-center gap-2",
                view === 'dashboard' ? "bg-blue-50 text-blue-600 font-bold" : "text-black hover:bg-black/5"
              )}
            >
              <History size={20} />
              <span className="text-sm hidden md:block">Dashboard</span>
            </button>
            <button
              onClick={() => { resetForm(); setView('estimate_form'); }}
              className={cn(
                "p-2.5 rounded-xl transition-all flex items-center gap-2",
                view === 'estimate_form' ? "bg-blue-50 text-blue-600 font-bold" : "text-black hover:bg-black/5"
              )}
            >
              <Plus size={20} />
              <span className="text-sm hidden md:block">New Estimate</span>
            </button>
            <button
              onClick={handleLogout}
              className="p-2.5 text-black/40 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all ml-2"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6">
        {view === 'dashboard' && (
          <div className="space-y-8">
            {/* Stats Overview */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total', value: dashboardStats.totalEstimates, color: 'blue' },
                { label: 'Confirmed', value: dashboardStats.confirmedOrders, color: 'emerald' },
                { label: 'Pending', value: dashboardStats.pendingPayments, color: 'amber' },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-4 rounded-2xl border border-black shadow-sm">
                  <p className="text-[9px] font-bold text-black/50 uppercase tracking-widest mb-1 truncate">{stat.label}</p>
                  <p className={cn("text-2xl font-bold", `text-${stat.color}-600`)}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Filters Row */}
            <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl border border-black shadow-sm space-y-3 md:space-y-0 md:flex md:flex-row md:gap-4 md:items-end">
              <div className="flex-1 w-full">
                <Input
                  label="Search"
                  icon={Search}
                  placeholder="Name, Phone or Architect..."
                  value={searchQuery}
                  onChange={(e: any) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1 md:w-48">
                  <Select
                    label="Assignee"
                    options={ASSIGNEES}
                    value={assigneeFilter}
                    onChange={(e: any) => setAssigneeFilter(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => { setSearchQuery(''); setAssigneeFilter(''); }}
                  className="px-4 py-2.5 text-sm font-bold text-black hover:bg-black/5 rounded-xl transition-colors whitespace-nowrap"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Estimates — Mobile Cards */}
            <div className="md:hidden space-y-3">
              {filteredEstimates.map((estimate) => (
                <div key={estimate.id} className="bg-white rounded-2xl border border-black shadow-sm p-4" onClick={() => viewEstimateDetail(estimate)}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="font-bold text-black text-base leading-tight">{estimate.clientName || 'Unnamed'}</div>
                      <div className="text-xs text-black/50 flex items-center gap-1 mt-0.5">
                        <Phone size={10} /> {estimate.phoneNumber || '—'}
                      </div>
                    </div>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap",
                      ESTIMATE_STATUS_CONFIG[estimate.estimateStatus as keyof typeof ESTIMATE_STATUS_CONFIG]?.color || "bg-black/5 text-black"
                    )}>
                      {estimate.estimateStatus}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <div>
                      <div className="text-[10px] text-black/40 uppercase tracking-widest">Assignee</div>
                      <div className="text-sm font-bold text-black">{estimate.assignee || '—'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-black/40 uppercase tracking-widest">Total</div>
                      <div className="text-base font-bold text-blue-600">₹{(estimate.grandTotal || 0).toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-black/5">
                    <span className="text-[10px] text-black/30">
                      {estimate.updatedAt ? format((estimate.updatedAt as any).toDate(), 'dd MMM yyyy') : 'Just now'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); editEstimate(estimate); }}
                        className="p-2 text-black/40 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all">
                        <Plus size={16} className="rotate-45" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteEstimate(estimate.id!); }}
                        className="p-2 text-black/40 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredEstimates.length === 0 && (
                <div className="p-12 text-center bg-white rounded-2xl border border-black">
                  <p className="text-black/40">No estimates found.</p>
                </div>
              )}
            </div>

            {/* Estimates Table — Desktop */}
            <div className="hidden md:block bg-white rounded-3xl border border-black shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-black">
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-black uppercase tracking-widest">Client / Date</th>
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-black uppercase tracking-widest">Site Address</th>
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-black uppercase tracking-widest">Assignee</th>
                      <th className="px-6 py-4 text-center text-[10px] font-bold text-black uppercase tracking-widest">Status</th>
                      <th className="px-6 py-4 text-center text-[10px] font-bold text-black uppercase tracking-widest">Total</th>
                      <th className="px-6 py-4 text-center text-[10px] font-bold text-black uppercase tracking-widest">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {filteredEstimates.map((estimate) => (
                      <tr key={estimate.id} className="hover:bg-black/5 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="font-bold text-black">{estimate.clientName}</div>
                          <div className="text-xs text-black flex items-center gap-1 mt-0.5">
                            <Phone size={10} /> {estimate.phoneNumber}
                          </div>
                          <div className="text-[10px] text-black mt-1">
                            {estimate.updatedAt ? format((estimate.updatedAt as any).toDate(), 'dd MMM yyyy') : 'Just now'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm text-black truncate max-w-[200px]">{estimate.siteAddress || 'N/A'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-black/5 rounded-full flex items-center justify-center text-[10px] font-bold text-black">
                              {estimate.assignee?.charAt(0) || '?'}
                            </div>
                            <span className="text-sm text-black">{estimate.assignee}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                            ESTIMATE_STATUS_CONFIG[estimate.estimateStatus as keyof typeof ESTIMATE_STATUS_CONFIG]?.color || "bg-black/5 text-black"
                          )}>
                            {estimate.estimateStatus}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <p className="text-sm font-bold text-black">₹{(estimate.grandTotal || 0).toLocaleString()}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => viewEstimateDetail(estimate)}
                              className="p-2 text-black/40 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                              title="View Details"
                            >
                              <FileText size={18} />
                            </button>
                            <button
                              onClick={() => editEstimate(estimate)}
                              className="p-2 text-black/40 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                              title="Edit Estimate"
                            >
                              <Plus size={18} className="rotate-45" />
                            </button>
                            <button
                              onClick={() => deleteEstimate(estimate.id!)}
                              className="p-2 text-black/40 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                              title="Delete Lead"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredEstimates.length === 0 && (
                <div className="p-12 text-center">
                  <p className="text-black/40">No estimates found matching your criteria.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'estimate_detail' && selectedEstimate && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={() => setView('dashboard')}
                className="flex items-center gap-2 text-sm font-bold text-black hover:text-black transition-colors"
              >
                <ChevronRight size={18} className="rotate-180" />
                Back to Dashboard
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => deleteEstimate(selectedEstimate.id!)}
                  className="flex-1 sm:flex-none px-3 py-2 bg-white border border-red-200 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 flex items-center justify-center gap-1.5"
                >
                  <Trash2 size={15} />
                  <span className="hidden sm:inline">Delete</span>
                </button>
                <button
                  onClick={() => editEstimate(selectedEstimate)}
                  className="flex-1 sm:flex-none px-3 py-2 bg-white border border-black rounded-xl text-sm font-bold text-black hover:bg-black/5 flex items-center justify-center gap-1.5"
                >
                  <Plus size={15} className="rotate-45" />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => generatePDF(selectedEstimate)}
                  className="flex-1 sm:flex-none px-3 py-2 bg-black rounded-xl text-sm font-bold text-white hover:bg-black/80 flex items-center justify-center gap-1.5"
                >
                  <Printer size={15} />
                  <span>PDF</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Estimate Info */}
                <div className="bg-white rounded-3xl p-8 border border-black shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h2 className="text-2xl font-bold text-black">Estimate v{selectedEstimate.version || 1}</h2>
                        <span className={cn(
                          "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                          ESTIMATE_STATUS_CONFIG[selectedEstimate.estimateStatus as keyof typeof ESTIMATE_STATUS_CONFIG]?.color || "bg-black/5 text-black"
                        )}>
                          {selectedEstimate.estimateStatus}
                        </span>
                      </div>
                      <p className="text-black/60 text-sm">
                        Created on {selectedEstimate.createdAt ? format((selectedEstimate.createdAt as any).toDate(), 'dd MMM yyyy, HH:mm') : 'Just now'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-black uppercase tracking-widest mb-1">Grand Total</p>
                      <p className="text-3xl font-bold text-blue-600 font-mono">₹{(selectedEstimate.grandTotal || 0).toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-8 border-y border-black/10">
                    <div>
                      <h4 className="text-[10px] font-bold text-black uppercase tracking-widest mb-4">Client Details</h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                            <User size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-black/40">Name</p>
                            <p className="text-sm font-bold text-black">{selectedEstimate.clientName}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                            <Phone size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-black/40">Phone</p>
                            <p className="text-sm font-bold text-black">{selectedEstimate.phoneNumber}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                            <MapPin size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-black/40">Site Address</p>
                            <p className="text-sm font-bold text-black">{selectedEstimate.siteAddress || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-black uppercase tracking-widest mb-4">Project Info</h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                            <User size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-black/40">Assignee</p>
                            <p className="text-sm font-bold text-black">{selectedEstimate.assignee}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                            <User size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-black/40">Architect</p>
                            <p className="text-sm font-bold text-black">{selectedEstimate.architectName || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                            <CreditCard size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-black/40">Payment Mode</p>
                            <p className="text-sm font-bold text-black">{selectedEstimate.paymentMode || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8">
                    <h4 className="text-[10px] font-bold text-black uppercase tracking-widest mb-4">Product Details</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-black/10">
                            <th className="py-3 text-left text-[10px] font-bold text-black uppercase tracking-widest">Type</th>
                            <th className="py-3 text-left text-[10px] font-bold text-black uppercase tracking-widest">Product</th>
                            <th className="py-3 text-left text-[10px] font-bold text-black uppercase tracking-widest">Qty / Info</th>
                            <th className="py-3 text-right text-[10px] font-bold text-black uppercase tracking-widest">Rate</th>
                            <th className="py-3 text-right text-[10px] font-bold text-black uppercase tracking-widest">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          {selectedEstimate.products.map((p) => (
                            <tr key={p.id}>
                              <td className="py-4">
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                                  p.type === 'tile' ? "bg-blue-100 text-blue-600" :
                                  p.type === 'granite' ? "bg-purple-100 text-purple-600" :
                                  p.type === 'specta' ? "bg-emerald-100 text-emerald-600" :
                                  "bg-black/5 text-black"
                                )}>
                                  {p.type}
                                </span>
                              </td>
                              <td className="py-4 text-sm font-bold text-black">
                                {p.type === 'specta' ? p.spectaName : p.name}
                                {p.type === 'tile' && p.length && p.width && (
                                  <span className="ml-2 text-[10px] text-black/40 font-normal">
                                    ({p.length} x {p.width} {p.unit === 'Feet' ? 'ft' : 'in'})
                                  </span>
                                )}
                              </td>
                              <td className="py-4 text-sm text-black/60">
                                {p.type === 'tile' ? (
                                  <span>{p.sqFtRequired} sqft ({p.totalBoxes} boxes)</span>
                                ) : p.type === 'specta' ? (
                                  <span>{p.numberOfSlabs} slabs ({p.totalSqFt?.toFixed(2)} sqft)</span>
                                ) : p.type === 'granite' ? (
                                  <span>{p.totalSqFt} sqft {p.gstApplied && <span className="text-purple-600 font-bold ml-1">+ GST</span>}</span>
                                ) : (
                                  <span>{p.pieces} pcs</span>
                                )}
                              </td>
                              <td className="py-4 text-sm text-right text-black/60 font-mono">
                                {p.type === 'product' ? (
                                  `₹${p.pricePerPiece}/pc`
                                ) : (
                                  <div className="flex flex-col items-end">
                                    <span>₹{p.pricePerSqFt}/sqft</span>
                                    {p.discountPerSqFt ? <span className="text-[10px] text-red-500">-₹{p.discountPerSqFt} disc</span> : null}
                                    {p.type === 'specta' && p.effectivePrice && (
                                      <span className="text-[10px] text-emerald-600 font-bold">Eff: ₹{p.effectivePrice.toFixed(2)}</span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-4 text-sm text-right font-bold text-black font-mono">₹{(p.totalPrice || 0).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-black/10">
                            <td colSpan={4} className="py-4 text-right text-sm font-bold text-black/40">Tile Total</td>
                            <td className="py-4 text-right text-sm font-bold text-black font-mono">₹{(selectedEstimate.tileTotal || 0).toLocaleString()}</td>
                          </tr>
                          <tr className="border-t border-black/10">
                            <td colSpan={4} className="py-4 text-right text-sm font-bold text-black/40">Granite Total</td>
                            <td className="py-4 text-right text-sm font-bold text-black font-mono">₹{(selectedEstimate.graniteTotal || 0).toLocaleString()}</td>
                          </tr>
                          <tr className="border-t border-black/10">
                            <td colSpan={4} className="py-4 text-right text-sm font-bold text-black/40">Specta Total</td>
                            <td className="py-4 text-right text-sm font-bold text-black font-mono">₹{(selectedEstimate.spectaTotal || 0).toLocaleString()}</td>
                          </tr>
                          <tr className="border-t border-black/10">
                            <td colSpan={4} className="py-4 text-right text-sm font-bold text-black/40">Product Total</td>
                            <td className="py-4 text-right text-sm font-bold text-black font-mono">₹{(selectedEstimate.productTotal || 0).toLocaleString()}</td>
                          </tr>
                          {selectedEstimate.cartageAmount > 0 && (
                            <tr className="border-t border-black/10">
                              <td colSpan={4} className="py-2 text-right text-sm font-bold text-black/40">Cartage</td>
                              <td className="py-2 text-right text-sm font-bold text-black font-mono">₹{(selectedEstimate.cartageAmount || 0).toLocaleString()}</td>
                            </tr>
                          )}
                          <tr className="border-t-2 border-black/10">
                            <td colSpan={4} className="py-4 text-right text-lg font-bold text-blue-600">Grand Total</td>
                            <td className="py-4 text-right text-xl font-bold text-blue-600 font-mono">₹{(selectedEstimate.grandTotal || 0).toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>

                {selectedEstimate.remarks && (
                  <div className="bg-white rounded-3xl p-8 border border-black shadow-sm">
                    <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-4">Remarks</h4>
                    <p className="text-sm text-black/60 leading-relaxed">{selectedEstimate.remarks}</p>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                {/* Status & Payment Card */}
                <div className="bg-white rounded-3xl p-6 border border-black shadow-sm">
                  <h3 className="font-bold text-black mb-6 flex items-center gap-2">
                    <CreditCard size={18} className="text-black/40" />
                    Status & Payment
                  </h3>
                  
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Estimate Status</label>
                      <select 
                        className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-2.5 text-sm font-bold text-black outline-none focus:ring-2 focus:ring-blue-500/20"
                        value={selectedEstimate.estimateStatus}
                        onChange={(e) => updateEstimateStatus(selectedEstimate.id!, e.target.value as EstimateStatus)}
                      >
                        {Object.keys(ESTIMATE_STATUS_CONFIG).map(status => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </div>

                    <div className="p-4 bg-black/5 rounded-2xl space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-black/60">Payment Status</span>
                        <span className={cn(
                          "text-xs font-bold px-2 py-0.5 rounded-full",
                          selectedEstimate.paymentStatus === 'Paid' ? "bg-emerald-100 text-emerald-700" :
                          selectedEstimate.paymentStatus === 'Partially Paid' ? "bg-amber-100 text-amber-700" :
                          "bg-black/10 text-black/60"
                        )}>
                          {selectedEstimate.paymentStatus}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-black/60">Amount Paid</span>
                        <span className="text-sm font-bold text-black font-mono">₹{(selectedEstimate.amountPaid || 0).toLocaleString()}</span>
                      </div>
                      <div className="h-px bg-black/10"></div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-black/60">Balance</span>
                        <span className="text-sm font-bold text-red-600 font-mono">₹{(selectedEstimate.balanceAmount || 0).toLocaleString()}</span>
                      </div>
                    </div>

                    {selectedEstimate.estimateStatus === 'Order Confirmed' && (
                      <div className="p-4 bg-blue-50 rounded-2xl space-y-3">
                        <h4 className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Order Tracking</h4>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-blue-600/70">Delivery Status</span>
                          <span className="text-xs font-bold text-blue-700">{selectedEstimate.deliveryStatus}</span>
                        </div>
                        {selectedEstimate.expectedDeliveryDate && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-blue-600/70">Expected Delivery</span>
                            <span className="text-xs font-bold text-blue-700">{format(new Date(selectedEstimate.expectedDeliveryDate), 'dd MMM yyyy')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions Card */}
                <div className="bg-black rounded-3xl p-6 text-white shadow-xl">
                  <h3 className="font-bold mb-4">Actions</h3>
                  <div className="space-y-3">
                    <button 
                      onClick={() => duplicateEstimate(selectedEstimate)}
                      className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus size={16} />
                      Duplicate Estimate
                    </button>
                    <button 
                      onClick={() => generatePDF(selectedEstimate)}
                      className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                    >
                      <Printer size={16} />
                      Download PDF
                    </button>
                    {!selectedEstimate.isFinalOrder && (
                      <button 
                        onClick={async () => {
                          await updateDoc(doc(db, 'estimates', selectedEstimate.id!), { isFinalOrder: true });
                          alert('Marked as Final Order!');
                        }}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                      >
                        <CheckCircle size={16} />
                        Mark as Final Order
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'estimate_form' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setView('dashboard')}
                className="flex items-center gap-2 text-sm font-bold text-black/40 hover:text-black transition-colors"
              >
                <ChevronRight size={18} className="rotate-180" />
                Cancel
              </button>
              <h2 className="text-xl font-bold text-black">{currentEstimateId ? 'Edit Estimate' : 'New Estimate'}</h2>
              <div className="w-20"></div>
            </div>

            {/* Client Info Card */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-black">
              <div className="flex items-center gap-2 mb-8">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <User className="text-blue-600" size={20} />
                </div>
                <div>
                  <h2 className="font-bold text-black">Client Information</h2>
                  <p className="text-xs text-black/40">Basic client and project details</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <Select
                  label="Assignee"
                  icon={User}
                  options={ASSIGNEES}
                  value={assignee}
                  onChange={(e: any) => setAssignee(e.target.value)}
                />
                <Input
                  label="Client Name"
                  icon={User}
                  placeholder="Enter client name"
                  value={clientName}
                  onChange={(e: any) => setClientName(e.target.value)}
                />
                <Input
                  label="Phone Number"
                  icon={Phone}
                  type="tel"
                  placeholder="10-digit mobile"
                  value={phoneNumber}
                  onChange={(e: any) => setPhoneNumber(e.target.value)}
                />
                <Input
                  label="Architect Name"
                  icon={User}
                  placeholder="Optional"
                  value={architectName}
                  onChange={(e: any) => setArchitectName(e.target.value)}
                />
                <div className="md:col-span-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-black/40 uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin size={14} />
                      Site Address
                    </label>
                    <textarea
                      placeholder="Enter full site address"
                      rows={2}
                      value={siteAddress}
                      onChange={(e) => setSiteAddress(e.target.value)}
                      className="w-full px-4 py-2.5 bg-black/5 border border-black/10 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-black placeholder:text-black/40"
                    />
                  </div>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Products Section */}
                <section className="bg-white rounded-3xl p-6 shadow-sm border border-black overflow-hidden">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                        <Calculator className="text-blue-600" size={18} />
                      </div>
                      <h2 className="font-bold text-black">Estimate Items</h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={addTile}
                        className="flex items-center gap-2 text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-xl transition-colors border border-blue-100"
                      >
                        <Plus size={14} />
                        Add Tile
                      </button>
                      <button
                        onClick={addGranite}
                        className="flex items-center gap-2 text-xs font-bold text-purple-600 hover:bg-purple-50 px-3 py-2 rounded-xl transition-colors border border-purple-100"
                      >
                        <Plus size={14} />
                        Add Granite
                      </button>
                      <button
                        onClick={addSpecta}
                        className="flex items-center gap-2 text-xs font-bold text-emerald-600 hover:bg-emerald-50 px-3 py-2 rounded-xl transition-colors border border-emerald-100"
                      >
                        <Plus size={14} />
                        Add Specta
                      </button>
                      <button
                        onClick={addOtherProduct}
                        className="flex items-center gap-2 text-xs font-bold text-black/60 hover:bg-black/5 px-3 py-2 rounded-xl transition-colors border border-black/10"
                      >
                        <Plus size={14} />
                        Add Product
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto -mx-6">
                    <table className="w-full min-w-[1000px] border-collapse">
                      <thead>
                        <tr className="bg-black/5 border-y border-black/10">
                          <th className="px-6 py-3 text-left text-[10px] font-bold text-black/40 uppercase tracking-widest w-16">Type</th>
                          <th className="px-4 py-3 text-left text-[10px] font-bold text-black/40 uppercase tracking-widest">Product Details</th>
                          <th className="px-4 py-3 text-left text-[10px] font-bold text-black/40 uppercase tracking-widest">Qty / Info</th>
                          <th className="px-4 py-3 text-right text-[10px] font-bold text-black/40 uppercase tracking-widest">Rate</th>
                          <th className="px-4 py-3 text-right text-[10px] font-bold text-black/40 uppercase tracking-widest">Total</th>
                          <th className="px-6 py-3 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/10">
                        {products.map((p) => (
                          <tr key={p.id} className="group hover:bg-black/5 transition-colors">
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                                p.type === 'tile' ? "bg-blue-100 text-blue-600" :
                                p.type === 'granite' ? "bg-purple-100 text-purple-600" :
                                p.type === 'specta' ? "bg-emerald-100 text-emerald-600" :
                                "bg-black/5 text-black"
                              )}>
                                {p.type}
                              </span>
                            </td>
                            <td className="px-4 py-4">
                              <div className="space-y-2">
                                {p.type === 'tile' && (
                                  <div className="flex flex-wrap gap-2 items-end">
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">Length</label>
                                      <input
                                        type="number"
                                        value={p.length || ''}
                                        onChange={(e) => updateProduct(p.id, { length: parseFloat(e.target.value) || 0 })}
                                        className="w-16 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-black"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">Width</label>
                                      <input
                                        type="number"
                                        value={p.width || ''}
                                        onChange={(e) => updateProduct(p.id, { width: parseFloat(e.target.value) || 0 })}
                                        className="w-16 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-black"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">Unit</label>
                                      <select
                                        value={p.unit || 'Feet'}
                                        onChange={(e) => updateProduct(p.id, { unit: e.target.value as any })}
                                        className="text-xs font-bold bg-black/5 border-none rounded-lg px-2 py-1"
                                      >
                                        <option value="Feet">Feet</option>
                                        <option value="Inches">Inches</option>
                                      </select>
                                    </div>
                                  </div>
                                )}
                                {p.type === 'specta' && (
                                  <div className="text-[10px] font-bold text-emerald-600 uppercase">
                                    Premium Slab (129" x 64")
                                  </div>
                                )}
                                <input
                                  placeholder={p.type === 'granite' ? "Granite Name" : p.type === 'specta' ? "Specta Name" : p.type === 'product' ? "Product Name" : "Tile Name"}
                                  value={p.type === 'specta' ? p.spectaName : p.name}
                                  onChange={(e) => updateProduct(p.id, p.type === 'specta' ? { spectaName: e.target.value, name: e.target.value } : { name: e.target.value })}
                                  className="w-full bg-transparent border-none focus:ring-0 text-sm font-bold text-black placeholder:text-black/20"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-wrap items-center gap-4">
                                {p.type === 'tile' && (
                                  <>
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">SqFt Req.</label>
                                      <input
                                        type="number"
                                        value={p.sqFtRequired || ''}
                                        onChange={(e) => updateProduct(p.id, { sqFtRequired: parseFloat(e.target.value) || 0 })}
                                        className="w-16 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-black"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">SqFt/Box</label>
                                      <input
                                        type="number"
                                        value={p.sqFtPerBox || ''}
                                        onChange={(e) => updateProduct(p.id, { sqFtPerBox: parseFloat(e.target.value) || 0 })}
                                        className="w-16 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-black"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">Boxes</label>
                                      <div className="text-xs font-bold text-black px-2 py-1">{p.totalBoxes}</div>
                                    </div>
                                  </>
                                )}
                                {p.type === 'specta' && (
                                  <>
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">No. of Slabs</label>
                                      <input
                                        type="number"
                                        value={p.numberOfSlabs || ''}
                                        onChange={(e) => updateProduct(p.id, { numberOfSlabs: parseFloat(e.target.value) || 0 })}
                                        className="w-16 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-black"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">Total SqFt</label>
                                      <div className="text-xs font-bold text-black px-2 py-1">
                                        {p.totalSqFt?.toFixed(2)}
                                      </div>
                                    </div>
                                  </>
                                )}
                                {p.type === 'granite' && (
                                  <>
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">Total SqFt</label>
                                      <input
                                        type="number"
                                        value={p.totalSqFt || ''}
                                        onChange={(e) => updateProduct(p.id, { totalSqFt: parseFloat(e.target.value) || 0 })}
                                        className="w-20 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-black"
                                      />
                                    </div>
                                    <div className="flex items-center gap-2 pt-4">
                                      <input
                                        type="checkbox"
                                        checked={p.gstApplied}
                                        onChange={(e) => updateProduct(p.id, { gstApplied: e.target.checked })}
                                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                      />
                                      <label className="text-[10px] font-bold text-purple-600 uppercase">Add GST (18%)</label>
                                    </div>
                                  </>
                                )}
                                {p.type === 'product' && (
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold text-black/40 uppercase">Pieces</label>
                                    <input
                                      type="number"
                                      value={p.pieces || ''}
                                      onChange={(e) => updateProduct(p.id, { pieces: parseFloat(e.target.value) || 0 })}
                                      className="w-16 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-black"
                                    />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <div className="flex flex-col items-end gap-2">
                                {p.type === 'product' ? (
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold text-black/40 uppercase">Price/Pc</label>
                                    <input
                                      type="number"
                                      value={p.pricePerPiece || ''}
                                      onChange={(e) => updateProduct(p.id, { pricePerPiece: parseFloat(e.target.value) || 0 })}
                                      className="w-20 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-right text-black"
                                    />
                                  </div>
                                ) : (
                                  <div className="flex gap-4">
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">Price/SqFt</label>
                                      <input
                                        type="number"
                                        value={p.pricePerSqFt || ''}
                                        onChange={(e) => updateProduct(p.id, { pricePerSqFt: parseFloat(e.target.value) || 0 })}
                                        className="w-20 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-right text-black"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-black/40 uppercase">Disc/SqFt</label>
                                      <input
                                        type="number"
                                        value={p.discountPerSqFt || ''}
                                        onChange={(e) => updateProduct(p.id, { discountPerSqFt: parseFloat(e.target.value) || 0 })}
                                        className="w-16 bg-black/5 rounded-lg px-2 py-1 text-xs font-bold text-right text-red-500"
                                      />
                                    </div>
                                  </div>
                                )}
                                {p.type === 'specta' && p.effectivePrice && (
                                  <span className="text-[9px] font-bold text-emerald-600">Eff. Rate: ₹{p.effectivePrice.toFixed(2)}</span>
                                )}
                                {p.gstApplied && (
                                  <span className="text-[9px] font-bold text-purple-600">GST: ₹{Math.round(p.gstAmount || 0)}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <span className="text-sm font-bold text-black font-mono">₹{(p.totalPrice || 0).toLocaleString()}</span>
                            </td>
                            <td className="px-6 py-4">
                              <button
                                onClick={() => removeProduct(p.id)}
                                className="p-1.5 text-black/20 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <section className="bg-white rounded-3xl p-6 shadow-sm border border-black">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                        <FileText className="text-blue-600" size={18} />
                      </div>
                      <h2 className="font-bold text-black">Estimate Remarks</h2>
                    </div>
                    <textarea
                      placeholder="Enter special instructions or notes for this estimate..."
                      rows={3}
                      value={estimateRemarks}
                      onChange={(e) => setEstimateRemarks(e.target.value)}
                      className="w-full px-4 py-3 bg-black/5 border border-black/10 rounded-2xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-black placeholder:text-black/40 resize-none"
                    />
                  </section>

                  <section className="bg-white rounded-3xl p-6 shadow-sm border border-black">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
                        <MapPin className="text-amber-600" size={18} />
                      </div>
                      <h2 className="font-bold text-black">Additional Charges</h2>
                    </div>
                    <Input
                      label="Cartage Amount (₹)"
                      type="number"
                      value={cartageAmount}
                      onChange={(e: any) => setCartageAmount(parseFloat(e.target.value) || 0)}
                    />
                  </section>
                </div>
              </div>

              <div className="space-y-6">
                <section className="bg-white rounded-3xl p-6 shadow-sm border border-black">
                  <h3 className="font-bold text-black mb-6 flex items-center gap-2">
                    <CreditCard size={18} className="text-black/40" />
                    Estimate Settings
                  </h3>
                  <div className="space-y-6">
                    <Select
                      label="Status"
                      icon={ChevronRight}
                      options={Object.keys(ESTIMATE_STATUS_CONFIG)}
                      value={estimateStatus}
                      onChange={(e: any) => setEstimateStatus(e.target.value as EstimateStatus)}
                    />
                    <Select
                      label="Payment Mode"
                      icon={CreditCard}
                      options={PAYMENT_MODES}
                      value={paymentMode}
                      onChange={(e: any) => setPaymentMode(e.target.value)}
                    />
                    <Input
                      label="Amount Paid"
                      icon={CreditCard}
                      type="number"
                      value={amountPaid}
                      onChange={(e: any) => setAmountPaid(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </section>

                <section className="bg-black rounded-3xl p-8 text-white shadow-xl">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-6">Summary</h2>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-white/60">
                      <span className="text-sm">Tile Total</span>
                      <span className="font-mono">₹{totals.tileTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-white/60">
                      <span className="text-sm">Granite Total</span>
                      <span className="font-mono">₹{totals.graniteTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-white/60">
                      <span className="text-sm">Specta Total</span>
                      <span className="font-mono">₹{totals.spectaTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-white/60">
                      <span className="text-sm">Products Total</span>
                      <span className="font-mono">₹{totals.productTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-white/60">
                      <span className="text-sm">Cartage</span>
                      <span className="font-mono">₹{totals.cartageAmount.toLocaleString()}</span>
                    </div>
                    <div className="h-px bg-white/10 my-4"></div>
                    <div className="flex justify-between items-end">
                      <span className="text-sm font-bold text-blue-400">Grand Total</span>
                      <span className="text-3xl font-bold font-mono">₹{totals.grandTotal.toLocaleString()}</span>
                    </div>
                  </div>
                  
                  <div className="mt-8 space-y-3">
                    <button
                      onClick={() => saveEstimate()}
                      disabled={isSaving}
                      className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-white/10 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                      {isSaving ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      ) : (
                        <>
                          <Save size={20} />
                          {currentEstimateId ? 'Update Estimate' : 'Save Estimate'}
                        </>
                      )}
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-black/10 px-6 py-3 flex items-center justify-around md:hidden z-40">
        <button 
          onClick={() => { resetForm(); setView('estimate_form'); }}
          className={cn(
            "flex flex-col items-center gap-1 p-2 transition-all",
            view === 'estimate_form' ? "text-blue-600" : "text-black/40"
          )}
        >
          <Plus size={24} />
          <span className="text-[10px] font-bold uppercase tracking-widest">New</span>
        </button>
        <button 
          onClick={() => setView('dashboard')}
          className={cn(
            "flex flex-col items-center gap-1 p-2 transition-all",
            view === 'dashboard' ? "text-blue-600" : "text-black/40"
          )}
        >
          <History size={24} />
          <span className="text-[10px] font-bold uppercase tracking-widest">Estimates</span>
        </button>
      </nav>
    </div>
  );
}
