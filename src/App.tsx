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
  where, 
  getDocs, 
  orderBy, 
  serverTimestamp,
  onSnapshot,
  getDocFromServer
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
  Lead, 
  Estimate, 
  TileProduct, 
  EstimateStatus, 
  DeliveryStatus, 
  PaymentStatus,
  ASSIGNEES, 
  PAYMENT_MODES, 
  TILE_SIZES, 
  ESTIMATE_STATUS_CONFIG,
  DELIVERY_STATUS_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  LeadActivity
} from './types';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
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
              className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-all"
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
    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
      {Icon && <Icon size={14} />}
      {label}
    </label>
    <input
      {...props}
      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800 placeholder:text-slate-400"
    />
  </div>
);

const Select = ({ label, icon: Icon, options, ...props }: any) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
      {Icon && <Icon size={14} />}
      {label}
    </label>
    <select
      {...props}
      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800 appearance-none"
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
  const [view, setView] = useState<'dashboard' | 'lead_detail' | 'estimate_detail' | 'lead_form' | 'estimate_form'>('dashboard');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Lead Form State
  const [currentLeadId, setCurrentLeadId] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [clientName, setClientName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [architectName, setArchitectName] = useState('');
  const [leadRemarks, setLeadRemarks] = useState('');

  // Estimate Form State
  const [currentEstimateId, setCurrentEstimateId] = useState<string | null>(null);
  const [estimateStatus, setEstimateStatus] = useState<EstimateStatus>('Draft');
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('Not Paid');
  const [amountPaid, setAmountPaid] = useState(0);
  const [estimateRemarks, setEstimateRemarks] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>('Preparing Order');
  const [isFinalOrder, setIsFinalOrder] = useState(false);
  const [products, setProducts] = useState<TileProduct[]>([
    {
      id: Math.random().toString(36).substr(2, 9),
      tileName: '',
      tileSize: '',
      pricePerSqFt: 0,
      sqFtRequired: 0,
      sqFtPerBox: 0,
      totalBoxes: 0,
      totalPrice: 0,
      costPricePerSqFt: 0
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
    const subtotal = products.reduce((acc, p) => acc + p.totalPrice, 0);
    const totalBoxes = products.reduce((acc, p) => acc + p.totalBoxes, 0);
    return {
      subtotal,
      grandTotal: subtotal, // Add tax logic here if needed
      totalBoxes
    };
  }, [products]);

  const updateProduct = (id: string, updates: Partial<TileProduct>) => {
    setProducts(prev => prev.map(p => {
      if (p.id === id) {
        const updated = { ...p, ...updates };
        
        // Auto-calculate logic
        if ('sqFtRequired' in updates || 'sqFtPerBox' in updates || 'pricePerSqFt' in updates) {
          const sqFt = updated.sqFtRequired || 0;
          const perBox = updated.sqFtPerBox || 1;
          const price = updated.pricePerSqFt || 0;
          
          updated.totalBoxes = Math.ceil(sqFt / perBox);
          updated.totalPrice = sqFt * price;
        }
        
        return updated;
      }
      return p;
    }));
  };

  const addProduct = () => {
    setProducts([...products, {
      id: Math.random().toString(36).substr(2, 9),
      tileName: '',
      tileSize: '',
      pricePerSqFt: 0,
      sqFtRequired: 0,
      sqFtPerBox: 0,
      totalBoxes: 0,
      totalPrice: 0,
      costPricePerSqFt: 0
    }]);
  };

  const removeProduct = (id: string) => {
    if (products.length > 1) {
      setProducts(products.filter(p => p.id !== id));
    }
  };

  // --- Actions ---
  const saveLead = async () => {
    if (!user) return;
    if (!clientName || !phoneNumber || !assignee) {
      alert('Please fill in Client Name, Phone, and Assignee');
      return;
    }

    setIsSaving(true);
    const leadData: Partial<Lead> = {
      clientName,
      phoneNumber,
      assignee,
      siteAddress,
      architectName,
      remarks: leadRemarks,
      updatedAt: serverTimestamp(),
    };

    if (!currentLeadId) {
      leadData.createdAt = serverTimestamp();
      leadData.createdBy = user.uid;
      leadData.activities = [{
        id: Math.random().toString(36).substr(2, 9),
        type: 'system',
        message: 'Lead created',
        timestamp: new Date().toISOString(),
        userName: user.displayName || user.email || 'Unknown',
        userId: user.uid
      }];
    }

    try {
      let leadId = currentLeadId;
      if (currentLeadId) {
        await updateDoc(doc(db, 'leads', currentLeadId), leadData);
      } else {
        const docRef = await addDoc(collection(db, 'leads'), leadData);
        leadId = docRef.id;
      }
      return leadId;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'leads');
    } finally {
      setIsSaving(false);
    }
  };

  const saveEstimate = async (leadId: string) => {
    if (!user || !leadId) return;

    setIsSaving(true);
    const estimateData: Partial<Estimate> = {
      leadId,
      estimateStatus,
      paymentMode,
      paymentStatus,
      amountPaid,
      balanceAmount: totals.grandTotal - amountPaid,
      grandTotal: totals.grandTotal,
      subtotal: totals.subtotal,
      totalBoxes: totals.totalBoxes,
      products,
      remarks: estimateRemarks,
      updatedAt: serverTimestamp(),
      orderDate: estimateStatus === 'Order Confirmed' ? (orderDate || new Date().toISOString()) : undefined,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      deliveryStatus: deliveryStatus || undefined,
      isFinalOrder: isFinalOrder || false,
    };

    if (!currentEstimateId) {
      estimateData.createdAt = serverTimestamp();
      estimateData.version = (estimates.filter(e => e.leadId === leadId).length || 0) + 1;
    }

    try {
      if (currentEstimateId) {
        await updateDoc(doc(db, 'estimates', currentEstimateId), estimateData);
      } else {
        await addDoc(collection(db, 'estimates'), estimateData);
      }
      
      // Add activity to lead
      const lead = leads.find(l => l.id === leadId);
      if (lead) {
        const newActivity: LeadActivity = {
          id: Math.random().toString(36).substr(2, 9),
          type: 'system',
          message: currentEstimateId ? `Estimate updated (v${estimateData.version})` : `New estimate created (v${estimateData.version})`,
          timestamp: new Date().toISOString(),
          userName: user.displayName || user.email || 'Unknown',
          userId: user.uid
        };
        await updateDoc(doc(db, 'leads', leadId), {
          activities: [...(lead.activities || []), newActivity],
          updatedAt: serverTimestamp()
        });
      }

      alert('Estimate saved successfully!');
      resetForm();
      setSelectedLeadId(leadId);
      setView('lead_detail');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'estimates');
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setCurrentLeadId(null);
    setCurrentEstimateId(null);
    setAssignee('');
    setClientName('');
    setPhoneNumber('');
    setSiteAddress('');
    setArchitectName('');
    setLeadRemarks('');
    
    setEstimateStatus('Draft');
    setPaymentMode('');
    setPaymentStatus('Not Paid');
    setAmountPaid(0);
    setEstimateRemarks('');
    setOrderDate('');
    setExpectedDeliveryDate('');
    setDeliveryStatus('Preparing Order');
    setIsFinalOrder(false);
    
    setProducts([{
      id: Math.random().toString(36).substr(2, 9),
      tileName: '',
      tileSize: '',
      pricePerSqFt: 0,
      sqFtRequired: 0,
      sqFtPerBox: 0,
      totalBoxes: 0,
      totalPrice: 0,
      costPricePerSqFt: 0
    }]);
  };

  const duplicateEstimate = async (estimate: Estimate) => {
    if (!user) return;
    
    setIsSaving(true);
    const newVersion = (estimates.filter(e => e.leadId === estimate.leadId).length || 0) + 1;
    
    const newEstimate: Partial<Estimate> = {
      ...estimate,
      id: undefined,
      version: newVersion,
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
      
      // Add activity to lead
      const lead = leads.find(l => l.id === estimate.leadId);
      if (lead) {
        const newActivity: LeadActivity = {
          id: Math.random().toString(36).substr(2, 9),
          type: 'system',
          message: `Estimate duplicated (v${estimate.version} -> v${newVersion})`,
          timestamp: new Date().toISOString(),
          userName: user.displayName || user.email || 'Unknown',
          userId: user.uid
        };
        await updateDoc(doc(db, 'leads', estimate.leadId), {
          activities: [...(lead.activities || []), newActivity],
          updatedAt: serverTimestamp()
        });
      }
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

      // Add activity to lead
      const lead = leads.find(l => l.id === estimate.leadId);
      if (lead) {
        const newActivity: LeadActivity = {
          id: Math.random().toString(36).substr(2, 9),
          type: 'status_change',
          message: `Estimate v${estimate.version} status updated to ${newStatus}`,
          timestamp: new Date().toISOString(),
          userName: user.displayName || user.email || 'Unknown',
          userId: user.uid
        };
        await updateDoc(doc(db, 'leads', estimate.leadId), {
          activities: [...(lead.activities || []), newActivity],
          updatedAt: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'estimates');
    }
  };

  const addFollowUpNote = async (leadId: string, note: string, nextDate?: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || !user || !note) return;

    const newActivity: LeadActivity = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'note',
      message: note,
      timestamp: new Date().toISOString(),
      userName: user.displayName || user.email || 'Unknown',
      userId: user.uid
    };

    try {
      await updateDoc(doc(db, 'leads', leadId), {
        updatedAt: serverTimestamp(),
        nextFollowUpDate: nextDate || lead.nextFollowUpDate,
        activities: [...(lead.activities || []), newActivity]
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'leads');
    }
  };

  const editLead = (lead: Lead) => {
    setCurrentLeadId(lead.id!);
    setAssignee(lead.assignee);
    setClientName(lead.clientName);
    setPhoneNumber(lead.phoneNumber);
    setSiteAddress(lead.siteAddress);
    setArchitectName(lead.architectName);
    setLeadRemarks(lead.remarks);
    setView('lead_form');
  };

  const viewLeadDetail = (lead: Lead) => {
    setSelectedLeadId(lead.id!);
    setView('lead_detail');
  };

  const viewEstimateDetail = (estimate: Estimate) => {
    setSelectedEstimateId(estimate.id!);
    setView('estimate_detail');
  };

  const editEstimate = (estimate: Estimate) => {
    const lead = leads.find(l => l.id === estimate.leadId);
    if (!lead) return;

    setCurrentLeadId(lead.id!);
    setClientName(lead.clientName);
    setPhoneNumber(lead.phoneNumber);
    setAssignee(lead.assignee);
    setSiteAddress(lead.siteAddress);
    setArchitectName(lead.architectName);

    setCurrentEstimateId(estimate.id!);
    setEstimateStatus(estimate.estimateStatus);
    setPaymentMode(estimate.paymentMode);
    setPaymentStatus(estimate.paymentStatus);
    setAmountPaid(estimate.amountPaid);
    setEstimateRemarks(estimate.remarks);
    setOrderDate(estimate.orderDate || '');
    setExpectedDeliveryDate(estimate.expectedDeliveryDate || '');
    setDeliveryStatus(estimate.deliveryStatus || 'Preparing Order');
    setIsFinalOrder(estimate.isFinalOrder || false);
    setProducts(estimate.products);
    setView('estimate_form');
  };

  const createNewEstimate = (lead: Lead) => {
    resetForm();
    setCurrentLeadId(lead.id!);
    setClientName(lead.clientName);
    setPhoneNumber(lead.phoneNumber);
    setAssignee(lead.assignee);
    setSiteAddress(lead.siteAddress);
    setArchitectName(lead.architectName);
    setView('estimate_form');
  };

  // --- Data Fetching ---
  useEffect(() => {
    if (!user) return;
    
    // Fetch Leads
    const leadsQuery = query(collection(db, 'leads'), orderBy('updatedAt', 'desc'));
    const unsubscribeLeads = onSnapshot(leadsQuery, (snapshot) => {
      setLeads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lead)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'leads'));

    // Fetch Estimates
    const estimatesQuery = query(collection(db, 'estimates'), orderBy('updatedAt', 'desc'));
    const unsubscribeEstimates = onSnapshot(estimatesQuery, (snapshot) => {
      setEstimates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Estimate)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'estimates'));

    return () => {
      unsubscribeLeads();
      unsubscribeEstimates();
    };
  }, [user]);

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      const matchesSearch = 
        l.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.phoneNumber.includes(searchQuery) ||
        (l.architectName?.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesAssignee = !assigneeFilter || l.assignee === assigneeFilter;

      return matchesSearch && matchesAssignee;
    });
  }, [leads, searchQuery, assigneeFilter]);

  const selectedLead = useMemo(() => 
    leads.find(l => l.id === selectedLeadId) || null
  , [leads, selectedLeadId]);

  const selectedLeadEstimates = useMemo(() => 
    estimates.filter(e => e.leadId === selectedLeadId)
  , [estimates, selectedLeadId]);

  const selectedEstimate = useMemo(() => 
    estimates.find(e => e.id === selectedEstimateId) || null
  , [estimates, selectedEstimateId]);

  const dashboardStats = useMemo(() => {
    const totalLeads = leads.length;
    const confirmedOrders = estimates.filter(e => e.estimateStatus === 'Order Confirmed').length;
    const pendingPayments = estimates.filter(e => e.paymentStatus === 'Not Paid' || e.paymentStatus === 'Partially Paid').length;
    
    return { totalLeads, confirmedOrders, pendingPayments };
  }, [leads, estimates]);

  const followUpsToday = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return leads.filter(l => l.nextFollowUpDate === today);
  }, [leads]);

  // --- PDF Export ---
  const generatePDF = (lead: Lead, estimate: Estimate) => {
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
    doc.text(`ESTIMATE v${estimate.version}`, 20, 42);
    doc.setFontSize(10);
    doc.text(`Date: ${format(new Date(estimate.updatedAt?.toDate() || new Date()), 'dd MMM yyyy')}`, 190, 42, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.text('Client Details:', 20, 52);
    doc.setFont('helvetica', 'normal');
    doc.text(`Name: ${lead.clientName}`, 20, 58);
    doc.text(`Phone: ${lead.phoneNumber}`, 20, 64);
    doc.text(`Address: ${lead.siteAddress || 'N/A'}`, 20, 70);

    doc.setFont('helvetica', 'bold');
    doc.text('Sales Info:', 120, 52);
    doc.setFont('helvetica', 'normal');
    doc.text(`Assignee: ${lead.assignee}`, 120, 58);
    doc.text(`Architect: ${lead.architectName || 'N/A'}`, 120, 64);
    doc.text(`Payment: ${estimate.paymentMode}`, 120, 70);

    // Table
    (doc as any).autoTable({
      startY: 80,
      head: [['Product', 'Size', 'Price/SqFt', 'SqFt', 'Boxes', 'Total']],
      body: estimate.products.map(p => [
        p.tileName,
        p.tileSize,
        `₹${p.pricePerSqFt}`,
        p.sqFtRequired,
        p.totalBoxes,
        `₹${p.totalPrice.toLocaleString()}`
      ]),
      theme: 'striped',
      headStyles: { fillColor: [30, 41, 59] },
      margin: { top: 80 }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;

    // Summary
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Boxes: ${estimate.totalBoxes}`, 20, finalY);
    doc.text(`Grand Total: Rs. ${estimate.grandTotal.toLocaleString()}`, 190, finalY, { align: 'right' });

    if (estimate.remarks) {
      doc.setFont('helvetica', 'normal');
      doc.text('Remarks:', 20, finalY + 15);
      doc.setFontSize(9);
      doc.text(estimate.remarks, 20, finalY + 20, { maxWidth: 170 });
    }

    doc.save(`Estimate_${lead.clientName}_v${estimate.version}.pdf`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mb-8 shadow-xl shadow-blue-200">
          <Calculator className="text-white" size={40} />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Aashiyana Decor</h1>
        <p className="text-slate-500 mb-8 max-w-xs">Digital Estimate & Billing System for Tile Showrooms</p>
        <button
          onClick={handleLogin}
          className="flex items-center gap-3 bg-white border border-slate-200 px-8 py-3.5 rounded-2xl font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
              <Calculator className="text-white" size={20} />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 leading-tight">Aashiyana Decor</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Estimates</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('dashboard')}
              className={cn(
                "p-2.5 rounded-xl transition-all flex items-center gap-2",
                view === 'dashboard' ? "bg-blue-50 text-blue-600 font-bold" : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <History size={20} />
              <span className="text-sm hidden md:block">Dashboard</span>
            </button>
            <button
              onClick={() => { resetForm(); setView('lead_form'); }}
              className={cn(
                "p-2.5 rounded-xl transition-all flex items-center gap-2",
                view === 'lead_form' ? "bg-blue-50 text-blue-600 font-bold" : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <Plus size={20} />
              <span className="text-sm hidden md:block">New Lead</span>
            </button>
            <button
              onClick={handleLogout}
              className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all ml-2"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6">
        {view === 'dashboard' && (
          <div className="space-y-8">
            {/* Follow-ups Today Banner */}
            {followUpsToday.length > 0 && (
              <div className="bg-blue-600 rounded-3xl p-6 text-white flex flex-col md:flex-row items-center justify-between gap-4 shadow-lg shadow-blue-200">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                    <Phone size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">You have {followUpsToday.length} follow-ups today</h3>
                    <p className="text-blue-100 text-sm">Don't forget to call your clients and update their status.</p>
                  </div>
                </div>
                <div className="flex -space-x-3">
                  {followUpsToday.slice(0, 5).map((l, i) => (
                    <div key={i} className="w-10 h-10 rounded-full border-2 border-blue-600 bg-white flex items-center justify-center text-blue-600 font-bold text-xs shadow-sm">
                      {l.clientName.charAt(0)}
                    </div>
                  ))}
                  {followUpsToday.length > 5 && (
                    <div className="w-10 h-10 rounded-full border-2 border-blue-600 bg-blue-800 flex items-center justify-center text-white font-bold text-xs">
                      +{followUpsToday.length - 5}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Total Leads', value: dashboardStats.totalLeads, color: 'blue' },
                { label: 'Confirmed Orders', value: dashboardStats.confirmedOrders, color: 'emerald' },
                { label: 'Pending Payments', value: dashboardStats.pendingPayments, color: 'amber' },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{stat.label}</p>
                  <p className={cn("text-2xl font-bold", `text-${stat.color}-600`)}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Filters Row */}
            <div className="flex flex-col md:flex-row gap-4 items-end bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex-1 w-full">
                <Input
                  label="Search Leads"
                  icon={Search}
                  placeholder="Name, Phone or Architect..."
                  value={searchQuery}
                  onChange={(e: any) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="w-full md:w-48">
                <Select
                  label="Assignee"
                  options={ASSIGNEES}
                  value={assigneeFilter}
                  onChange={(e: any) => setAssigneeFilter(e.target.value)}
                />
              </div>
              <button 
                onClick={() => { setSearchQuery(''); setAssigneeFilter(''); }}
                className="px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                Reset
              </button>
            </div>

            {/* Leads Table */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Client / Date</th>
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Site Address</th>
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Assignee</th>
                      <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">Estimates</th>
                      <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLeads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-900">{lead.clientName}</div>
                          <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                            <Phone size={10} /> {lead.phoneNumber}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            {lead.createdAt ? format((lead.createdAt as any).toDate(), 'dd MMM yyyy') : 'Just now'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm text-slate-600 truncate max-w-[200px]">{lead.siteAddress || 'N/A'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-600">
                              {lead.assignee.charAt(0)}
                            </div>
                            <span className="text-sm text-slate-700">{lead.assignee}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="px-2 py-1 bg-slate-100 rounded-lg text-xs font-bold text-slate-600">
                            {estimates.filter(e => e.leadId === lead.id).length}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2">
                            <button 
                              onClick={() => viewLeadDetail(lead)}
                              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                              title="View Details"
                            >
                              <FileText size={18} />
                            </button>
                            <button 
                              onClick={() => editLead(lead)}
                              className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                              title="Edit Lead"
                            >
                              <Plus size={18} className="rotate-45" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredLeads.length === 0 && (
                <div className="p-12 text-center">
                  <p className="text-slate-400">No leads found matching your criteria.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'lead_detail' && selectedLead && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setView('dashboard')}
                className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ChevronRight size={18} className="rotate-180" />
                Back to Dashboard
              </button>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => editLead(selectedLead)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Edit Lead
                </button>
                <button 
                  onClick={() => {
                    resetForm();
                    setClientName(selectedLead.clientName);
                    setPhoneNumber(selectedLead.phoneNumber);
                    setSiteAddress(selectedLead.siteAddress);
                    setArchitectName(selectedLead.architectName);
                    setAssignee(selectedLead.assignee);
                    setView('estimate_form');
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 flex items-center gap-2"
                >
                  <Plus size={16} />
                  New Estimate
                </button>
              </div>
            </div>

            {/* Lead Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Estimates</p>
                <p className="text-xl font-bold text-slate-900">{estimates.filter(e => e.leadId === selectedLead.id).length}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Confirmed Orders</p>
                <p className="text-xl font-bold text-blue-600">{estimates.filter(e => e.leadId === selectedLead.id && e.estimateStatus === 'Order Confirmed').length}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Revenue</p>
                <p className="text-xl font-bold text-emerald-600">₹{estimates.filter(e => e.leadId === selectedLead.id && e.estimateStatus === 'Order Confirmed').reduce((acc, curr) => acc + curr.grandTotal, 0).toLocaleString()}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Outstanding</p>
                <p className="text-xl font-bold text-amber-600">₹{estimates.filter(e => e.leadId === selectedLead.id && e.estimateStatus === 'Order Confirmed').reduce((acc, curr) => acc + curr.balanceAmount, 0).toLocaleString()}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Lead Info & Estimates */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                  <div className="flex justify-between items-start mb-8">
                    <div>
                      <h2 className="text-3xl font-bold text-slate-900 mb-1">{selectedLead.clientName}</h2>
                      <div className="flex items-center gap-4 text-slate-500">
                        <span className="flex items-center gap-1.5"><Phone size={14} /> {selectedLead.phoneNumber}</span>
                        <span className="flex items-center gap-1.5"><MapPin size={14} /> {selectedLead.siteAddress || 'No address'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6 py-6 border-t border-slate-100">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Assignee</p>
                      <p className="font-bold text-slate-700">{selectedLead.assignee}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Architect</p>
                      <p className="font-bold text-slate-700">{selectedLead.architectName || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Lead Created</p>
                      <p className="font-bold text-slate-700">{selectedLead.createdAt ? format((selectedLead.createdAt as any).toDate(), 'dd MMM yyyy') : 'N/A'}</p>
                    </div>
                  </div>
                </div>

                {/* Estimates Table */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <FileText size={18} className="text-slate-400" />
                      Estimates & Orders
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50/50">
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">ID / Date</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Items</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {estimates.filter(e => e.leadId === selectedLead.id).sort((a, b) => (b.createdAt as any)?.toDate() - (a.createdAt as any)?.toDate()).map((estimate) => (
                          <tr key={estimate.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4">
                              <p className="font-bold text-slate-900">EST-{estimate.id?.slice(0, 4)} v{estimate.version}</p>
                              <p className="text-[10px] text-slate-400">{estimate.createdAt ? format((estimate.createdAt as any).toDate(), 'dd MMM yyyy') : 'N/A'}</p>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm text-slate-600">{estimate.products.length} Products</p>
                              <p className="text-[10px] text-slate-400">{estimate.totalBoxes} Boxes</p>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm font-bold text-slate-900">₹{estimate.grandTotal.toLocaleString()}</p>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                ESTIMATE_STATUS_CONFIG[estimate.estimateStatus as keyof typeof ESTIMATE_STATUS_CONFIG]?.color || "bg-slate-100 text-slate-600"
                              )}>
                                {estimate.estimateStatus}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-center gap-2">
                                <button 
                                  onClick={() => viewEstimateDetail(estimate)}
                                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                  title="View Details"
                                >
                                  <FileText size={18} />
                                </button>
                                <button 
                                  onClick={() => duplicateEstimate(estimate)}
                                  className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                  title="Duplicate"
                                >
                                  <Plus size={18} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {estimates.filter(e => e.leadId === selectedLead.id).length === 0 && (
                    <div className="p-12 text-center">
                      <p className="text-slate-400">No estimates created yet.</p>
                    </div>
                  )}
                </div>

                {/* Activity Timeline */}
                <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                  <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                    <History size={18} className="text-slate-400" />
                    Activity Timeline
                  </h3>
                  <div className="space-y-6">
                    {selectedLead.activities?.slice().reverse().map((activity, i) => (
                      <div key={activity.id} className="relative pl-6 pb-6 last:pb-0">
                        {i !== (selectedLead.activities?.length || 0) - 1 && (
                          <div className="absolute left-[7px] top-2 bottom-0 w-px bg-slate-100"></div>
                        )}
                        <div className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-blue-500"></div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-bold text-slate-800">{activity.message}</p>
                            <span className="text-[10px] text-slate-400">{format(new Date(activity.timestamp), 'dd MMM, HH:mm')}</span>
                          </div>
                          <p className="text-xs text-slate-500">by {activity.userName}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Actions & CRM */}
              <div className="space-y-6">
                <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <Phone size={18} className="text-blue-400" />
                    Quick Follow-up
                  </h3>
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <a 
                      href={`tel:${selectedLead.phoneNumber}`}
                      className="flex flex-col items-center justify-center p-4 bg-white/10 rounded-2xl hover:bg-white/20 transition-colors"
                    >
                      <Phone size={20} className="mb-2" />
                      <span className="text-xs font-bold">Call</span>
                    </a>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(selectedLead.phoneNumber);
                        alert('Phone number copied!');
                      }}
                      className="flex flex-col items-center justify-center p-4 bg-white/10 rounded-2xl hover:bg-white/20 transition-colors"
                    >
                      <FileText size={20} className="mb-2" />
                      <span className="text-xs font-bold">Copy</span>
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Next Follow-up</label>
                      <input 
                        type="date"
                        className="w-full bg-white/10 border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        value={selectedLead.nextFollowUpDate?.split('T')[0] || ''}
                        onChange={(e) => addFollowUpNote(selectedLead.id!, 'Updated follow-up date', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quick Note</label>
                      <textarea 
                        placeholder="Add a note..."
                        className="w-full bg-white/10 border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 resize-none"
                        rows={3}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            addFollowUpNote(selectedLead.id!, (e.target as HTMLTextAreaElement).value);
                            (e.target as HTMLTextAreaElement).value = '';
                          }
                        }}
                      />
                      <p className="text-[10px] text-slate-500 italic">Press Enter to save note</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'estimate_detail' && selectedEstimate && selectedLead && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setView('lead_detail')}
                className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ChevronRight size={18} className="rotate-180" />
                Back to Lead
              </button>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => editEstimate(selectedEstimate)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Edit Estimate
                </button>
                <button 
                  onClick={() => generatePDF(selectedLead, selectedEstimate)}
                  className="px-4 py-2 bg-slate-900 rounded-xl text-sm font-bold text-white hover:bg-slate-800 flex items-center gap-2"
                >
                  <Printer size={16} />
                  Print PDF
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Estimate Info */}
                <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h2 className="text-2xl font-bold text-slate-900">Estimate v{selectedEstimate.version}</h2>
                        <span className={cn(
                          "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                          ESTIMATE_STATUS_CONFIG[selectedEstimate.estimateStatus as keyof typeof ESTIMATE_STATUS_CONFIG]?.color || "bg-slate-100 text-slate-600"
                        )}>
                          {selectedEstimate.estimateStatus}
                        </span>
                      </div>
                      <p className="text-slate-500 text-sm">
                        Created on {selectedEstimate.createdAt ? format((selectedEstimate.createdAt as any).toDate(), 'dd MMM yyyy, HH:mm') : 'Just now'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Grand Total</p>
                      <p className="text-3xl font-bold text-blue-600 font-mono">₹{selectedEstimate.grandTotal.toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-8 border-y border-slate-100">
                    <div>
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Client Details</h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
                            <User size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Name</p>
                            <p className="text-sm font-bold text-slate-800">{selectedLead.clientName}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
                            <Phone size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Phone</p>
                            <p className="text-sm font-bold text-slate-800">{selectedLead.phoneNumber}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
                            <MapPin size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Site Address</p>
                            <p className="text-sm font-bold text-slate-800">{selectedLead.siteAddress || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Project Info</h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
                            <User size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Assignee</p>
                            <p className="text-sm font-bold text-slate-800">{selectedLead.assignee}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
                            <User size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Architect</p>
                            <p className="text-sm font-bold text-slate-800">{selectedLead.architectName || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
                            <CreditCard size={16} />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Payment Mode</p>
                            <p className="text-sm font-bold text-slate-800">{selectedEstimate.paymentMode || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Product Details</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-slate-100">
                            <th className="py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Product</th>
                            <th className="py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Size</th>
                            <th className="py-3 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Price/SqFt</th>
                            <th className="py-3 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">SqFt</th>
                            <th className="py-3 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Boxes</th>
                            <th className="py-3 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {selectedEstimate.products.map((p) => (
                            <tr key={p.id}>
                              <td className="py-4 text-sm font-bold text-slate-800">{p.tileName}</td>
                              <td className="py-4 text-sm text-slate-600">{p.tileSize}</td>
                              <td className="py-4 text-sm text-right text-slate-600 font-mono">₹{p.pricePerSqFt}</td>
                              <td className="py-4 text-sm text-right text-slate-600 font-mono">{p.sqFtRequired}</td>
                              <td className="py-4 text-sm text-right text-slate-600 font-mono">{p.totalBoxes}</td>
                              <td className="py-4 text-sm text-right font-bold text-slate-900 font-mono">₹{p.totalPrice.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-100">
                            <td colSpan={4} className="py-4 text-right text-sm font-bold text-slate-500">Summary</td>
                            <td className="py-4 text-right text-sm font-bold text-slate-900 font-mono">{selectedEstimate.totalBoxes}</td>
                            <td className="py-4 text-right text-lg font-bold text-blue-600 font-mono">₹{selectedEstimate.grandTotal.toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>

                {selectedEstimate.remarks && (
                  <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Remarks</h4>
                    <p className="text-sm text-slate-600 leading-relaxed">{selectedEstimate.remarks}</p>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                {/* Status & Payment Card */}
                <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
                  <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                    <CreditCard size={18} className="text-slate-400" />
                    Status & Payment
                  </h3>
                  
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estimate Status</label>
                      <select 
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                        value={selectedEstimate.estimateStatus}
                        onChange={(e) => updateEstimateStatus(selectedEstimate.id!, e.target.value as EstimateStatus)}
                      >
                        {Object.keys(ESTIMATE_STATUS_CONFIG).map(status => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Payment Status</span>
                        <span className={cn(
                          "text-xs font-bold px-2 py-0.5 rounded-full",
                          selectedEstimate.paymentStatus === 'Paid' ? "bg-emerald-100 text-emerald-700" :
                          selectedEstimate.paymentStatus === 'Partially Paid' ? "bg-amber-100 text-amber-700" :
                          "bg-slate-200 text-slate-600"
                        )}>
                          {selectedEstimate.paymentStatus}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Amount Paid</span>
                        <span className="text-sm font-bold text-slate-900 font-mono">₹{selectedEstimate.amountPaid.toLocaleString()}</span>
                      </div>
                      <div className="h-px bg-slate-200"></div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Balance</span>
                        <span className="text-sm font-bold text-red-600 font-mono">₹{selectedEstimate.balanceAmount.toLocaleString()}</span>
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
                <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl">
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
                      onClick={() => generatePDF(selectedLead, selectedEstimate)}
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

        {view === 'lead_form' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setView(currentLeadId ? 'lead_detail' : 'dashboard')}
                className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ChevronRight size={18} className="rotate-180" />
                Cancel
              </button>
              <h2 className="text-xl font-bold text-slate-900">{currentLeadId ? 'Edit Lead' : 'New Lead'}</h2>
              <div className="w-20"></div> {/* Spacer */}
            </div>

            {/* Lead Info Card */}
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
              <div className="flex items-center gap-2 mb-8">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <User className="text-blue-600" size={20} />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900">Lead Information</h2>
                  <p className="text-xs text-slate-500">Basic client and project details</p>
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
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin size={14} />
                      Site Address
                    </label>
                    <textarea
                      placeholder="Enter full site address"
                      rows={2}
                      value={siteAddress}
                      onChange={(e) => setSiteAddress(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800 placeholder:text-slate-400"
                    />
                  </div>
                </div>
                <div className="md:col-span-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <FileText size={14} />
                      Lead Remarks
                    </label>
                    <textarea
                      placeholder="General notes about this lead..."
                      rows={2}
                      value={leadRemarks}
                      onChange={(e) => setLeadRemarks(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800 placeholder:text-slate-400"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-10 flex justify-end">
                <button
                  onClick={async () => {
                    const id = await saveLead();
                    if (id) {
                      setSelectedLeadId(id);
                      setView('lead_detail');
                    }
                  }}
                  disabled={isSaving}
                  className="px-8 py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-2xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-200"
                >
                  {isSaving ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <Save size={20} />
                      {currentLeadId ? 'Update Lead' : 'Create Lead'}
                    </>
                  )}
                </button>
              </div>
            </section>
          </div>
        )}

        {view === 'estimate_form' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setView('lead_detail')}
                className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ChevronRight size={18} className="rotate-180" />
                Cancel
              </button>
              <h2 className="text-xl font-bold text-slate-900">{currentEstimateId ? 'Edit Estimate' : 'New Estimate'}</h2>
              <div className="w-20"></div>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400">
                  <User size={24} />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Client</p>
                  <p className="text-lg font-bold text-slate-900">{clientName}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Site Address</p>
                <p className="text-sm text-slate-600">{siteAddress || 'N/A'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Products Section */}
                <section className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                        <Calculator className="text-blue-600" size={18} />
                      </div>
                      <h2 className="font-bold text-slate-900">Tile Products</h2>
                    </div>
                    <button
                      onClick={addProduct}
                      className="flex items-center gap-2 text-sm font-bold text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-xl transition-colors"
                    >
                      <Plus size={18} />
                      Add Product
                    </button>
                  </div>

                  <div className="overflow-x-auto -mx-6">
                    <table className="w-full min-w-[800px] border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-y border-slate-100">
                          <th className="px-6 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Tile Details</th>
                          <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Size</th>
                          <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Price/SqFt</th>
                          <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">SqFt Req.</th>
                          <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">SqFt/Box</th>
                          <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Boxes</th>
                          <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total</th>
                          <th className="px-6 py-3 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {products.map((p) => (
                          <tr key={p.id} className="group hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4">
                              <input
                                placeholder="Tile Name"
                                value={p.tileName}
                                onChange={(e) => updateProduct(p.id, { tileName: e.target.value })}
                                className="w-full bg-transparent border-none focus:ring-0 text-sm font-medium text-slate-800 placeholder:text-slate-300"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <select
                                value={p.tileSize}
                                onChange={(e) => updateProduct(p.id, { tileSize: e.target.value })}
                                className="bg-transparent border-none focus:ring-0 text-sm text-slate-600 appearance-none cursor-pointer"
                              >
                                <option value="">Size</option>
                                {TILE_SIZES.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
                              </select>
                            </td>
                            <td className="px-4 py-4">
                              <input
                                type="number"
                                placeholder="0"
                                value={p.pricePerSqFt || ''}
                                onChange={(e) => updateProduct(p.id, { pricePerSqFt: parseFloat(e.target.value) })}
                                className="w-20 bg-transparent border-none focus:ring-0 text-sm text-slate-600"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <input
                                type="number"
                                placeholder="0"
                                value={p.sqFtRequired || ''}
                                onChange={(e) => updateProduct(p.id, { sqFtRequired: parseFloat(e.target.value) })}
                                className="w-20 bg-transparent border-none focus:ring-0 text-sm text-slate-600"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <input
                                type="number"
                                placeholder="0"
                                value={p.sqFtPerBox || ''}
                                onChange={(e) => updateProduct(p.id, { sqFtPerBox: parseFloat(e.target.value) })}
                                className="w-20 bg-transparent border-none focus:ring-0 text-sm text-slate-600"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <span className="text-sm font-bold text-slate-900">{p.totalBoxes}</span>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <span className="text-sm font-bold text-slate-900">₹{p.totalPrice.toLocaleString()}</span>
                            </td>
                            <td className="px-6 py-4">
                              <button
                                onClick={() => removeProduct(p.id)}
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
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

                <section className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                      <FileText className="text-blue-600" size={18} />
                    </div>
                    <h2 className="font-bold text-slate-900">Estimate Remarks</h2>
                  </div>
                  <textarea
                    placeholder="Enter special instructions or notes for this estimate..."
                    rows={3}
                    value={estimateRemarks}
                    onChange={(e) => setEstimateRemarks(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800 placeholder:text-slate-400 resize-none"
                  />
                </section>
              </div>

              <div className="space-y-6">
                <section className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
                  <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                    <CreditCard size={18} className="text-slate-400" />
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

                <section className="bg-slate-900 rounded-3xl p-8 text-white shadow-xl">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">Summary</h2>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-slate-400">
                      <span className="text-sm">Total Boxes</span>
                      <span className="font-mono">{totals.totalBoxes}</span>
                    </div>
                    <div className="h-px bg-slate-800 my-4"></div>
                    <div className="flex justify-between items-end">
                      <span className="text-sm font-bold text-blue-400">Grand Total</span>
                      <span className="text-3xl font-bold font-mono">₹{totals.grandTotal.toLocaleString()}</span>
                    </div>
                  </div>
                  
                  <div className="mt-8 space-y-3">
                    <button
                      onClick={() => saveEstimate(currentLeadId!)}
                      disabled={isSaving}
                      className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
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
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-around md:hidden z-40">
        <button 
          onClick={() => { resetForm(); setView('lead_form'); }}
          className={cn(
            "flex flex-col items-center gap-1 p-2 transition-all",
            view === 'lead_form' ? "text-blue-600" : "text-slate-400"
          )}
        >
          <Plus size={24} />
          <span className="text-[10px] font-bold uppercase tracking-widest">New</span>
        </button>
        <button 
          onClick={() => setView('dashboard')}
          className={cn(
            "flex flex-col items-center gap-1 p-2 transition-all",
            view === 'dashboard' ? "text-blue-600" : "text-slate-400"
          )}
        >
          <History size={24} />
          <span className="text-[10px] font-bold uppercase tracking-widest">Leads</span>
        </button>
      </nav>
    </div>
  );
}
