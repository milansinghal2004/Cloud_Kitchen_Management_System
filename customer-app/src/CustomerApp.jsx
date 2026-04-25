import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";

function CustomSelect({ value, onChange, options, className }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel = options.find(o => String(o.value) === String(value))?.label || value;

  return (
    <div className={`custom-select-wrap ${className || ""}`} ref={containerRef}>
      <div className={`select-trigger ${isOpen ? "active" : ""}`} onClick={() => setIsOpen(!isOpen)}>
        <span>{selectedLabel}</span>
        <span className="select-chevron">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </span>
      </div>
      {isOpen && (
        <div className="select-options-card">
          {options.map((opt) => (
            <div 
              key={opt.value} 
              className={`select-option ${String(opt.value) === String(value) ? "selected" : ""}`}
              onClick={() => { onChange({ target: { value: opt.value } }); setIsOpen(false); }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CustomerApp() {
  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const [upiDrafts, setUpiDrafts] = useState({});
  const [apiBase, setApiBase] = useState(window.location.origin);
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState([]);
  const [categories, setCategories] = useState(["All"]);
  const [offers, setOffers] = useState([]);
  const [todaysSpecial, setTodaysSpecial] = useState(null);
  const [cart, setCart] = useState({ items: [], pricing: {} });
  const [orders, setOrders] = useState({ currentOrders: [], pastOrders: [] });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [showCart, setShowCart] = useState(false);
  const [showOffers, setShowOffers] = useState(false);
  const [offerCode, setOfferCode] = useState("");
  const [checkout, setCheckout] = useState({ name: "", phone: "", address: "", paymentMode: "COD" });
  const [isPaying, setIsPaying] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState({ provider: "mock", currency: "INR", upiEnabled: false, upiReceiverVpa: "", upiReceiverName: "Cloud Kitchen" });
  const [paymentPortal, setPaymentPortal] = useState({ open: false, orderId: "", session: null, processing: false, error: "" });
  const [upiReference, setUpiReference] = useState("");
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("pending"); // 'all', 'pending', 'completed'
  const [paymentPriceRange, setPaymentPriceRange] = useState("all"); // 'all', 'under500', '500-1000', '1000-2500', 'above2500'
  const [paymentSort, setPaymentSort] = useState("newest"); // 'newest', 'oldest', 'priceHigh', 'priceLow'
  const [paymentDateSearch, setPaymentDateSearch] = useState(""); // Calendar search
  const [paymentTimer, setPaymentTimer] = useState(0); // seconds remaining

  function getInitials(name) {
    if (!name) return "?";
    const parts = name.split(" ");
    return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
  }
  const [user, setUser] = useState(loadStoredUser());
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderSupport, setOrderSupport] = useState([]);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "", email: "", name: "" });
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [cancelDraft, setCancelDraft] = useState({ open: false, orderId: "", reason: "Changed my mind", fee: 0, step: "REASON", txnId: "" });
  const [supportDraft, setSupportDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [updatedOrders, setUpdatedOrders] = useState({});
  const [dialog, setDialog] = useState({ open: false, title: "", message: "", resolve: null, type: "confirm" });

  const sessionId = useMemo(loadOrCreateSessionId, []);
  const cartCount = useMemo(() => (cart.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0), [cart]);
  const navigate = useNavigate();
  const paymentResolveRef = useRef(null);
  const isClearingRef = useRef(false);

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!apiBase) return;
    loadMenu();
  }, [category, search, apiBase]);

  useEffect(() => {
    if (!apiBase) return;
    loadOrders();
  }, [apiBase, user?.id]);

  useEffect(() => {
    if (user) {
      setCheckout(p => ({
        ...p,
        name: user.name || p.name,
        phone: user.phone || p.phone,
        address: user.address || p.address,
        paymentMode: user.defaultPaymentMode || p.paymentMode
      }));
    }
  }, [user]);

  useEffect(() => {
    if (!apiBase || !window.EventSource) return;
    const stream = new EventSource(`${apiBase}/api/events?sessionId=${encodeURIComponent(sessionId)}`);

    stream.addEventListener("order_updated", async (evt) => {
      await loadOrders();
      const payload = safeJson(evt.data);
      const orderId = payload?.orderId || selectedOrder?.id;
      if (orderId) markOrderUpdated(orderId, "order");
      if (selectedOrder?.id) await openOrderDetails(selectedOrder.id);
      flash("Order status updated");
    });

    stream.addEventListener("support_updated", async (evt) => {
      await loadOrders();
      const payload = safeJson(evt.data);
      const orderId = payload?.orderId || selectedOrder?.id;
      if (orderId) markOrderUpdated(orderId, "support");
      if (selectedOrder?.id) await loadSupport(orderId);
      flash("Support ticket updated");
    });

    stream.addEventListener("cart_updated", async () => {
      // If we are currently clearing the cart, ignore the updated event 
      // as we are already handling the state transition locally.
      if (isClearingRef.current) return;
      await loadCart();
    });

    return () => stream.close();
  }, [apiBase, sessionId, selectedOrder?.id]);

  const [couponBlink, setCouponBlink] = useState(null); // 'green', 'red', 'yellow'

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target;
      const tag = String(target?.tagName || "").toLowerCase();
      const isTextArea = tag === "textarea";
      if (event.key === "Escape") {
        if (dialog.open) {
          event.preventDefault();
          setDialog(p => ({ ...p, open: false }));
          dialog.resolve(false);
          return;
        }
        if (paymentPortal.open) {
          event.preventDefault();
          cancelMockPayment();
          return;
        }
        if (cancelDraft.open) {
          event.preventDefault();
          setCancelDraft({ open: false, orderId: "", reason: "Changed my mind" });
          return;
        }
        if (selectedOrder) {
          event.preventDefault();
          setSelectedOrder(null);
          return;
        }
        if (showAuth) {
          event.preventDefault();
          setShowAuth(false);
          return;
        }
        if (showCart) {
          event.preventDefault();
          setShowCart(false);
          return;
        }
      }
      if (event.key === "Enter" && showCart && tag === "input" && target?.placeholder === "Apply offer code") {
        event.preventDefault();
        applyOffer();
      }
      if (event.key === "Enter" && cancelDraft.open && !isTextArea) {
        event.preventDefault();
        confirmCancel();
      }
      if (event.key === "Enter" && paymentPortal.open && !isTextArea) {
        event.preventDefault();
        confirmMockPayment();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showCart, showAuth, selectedOrder, cancelDraft.open, cancelDraft.reason, paymentPortal.open, applyOffer]);

  useEffect(() => {
    let interval;
    if (paymentPortal.open && paymentTimer > 0) {
      interval = setInterval(() => {
        setPaymentTimer(prev => prev - 1);
      }, 1000);
    } else if (paymentTimer === 0 && paymentPortal.open) {
      // Timer expired logic could go here if needed, 
      // but we handle it in the UI by checking paymentTimer === 0
    }
    return () => clearInterval(interval);
  }, [paymentPortal.open, paymentTimer]);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  useEffect(() => {
    const savedPhone = localStorage.getItem("ck_last_phone") || "";
    setCheckout((prev) => ({
      ...prev,
      name: prev.name || user?.name || "",
      phone: prev.phone || user?.phone || savedPhone,
      address: prev.address || user?.address || "",
      paymentMode: prev.paymentMode || user?.defaultPaymentMode || "COD"
    }));
  }, [user]);

  function markOrderUpdated(orderId, type) {
    setUpdatedOrders((prev) => ({ ...prev, [orderId]: type }));
    setTimeout(() => {
      setUpdatedOrders((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }, 2500);
  }

  async function bootstrap() {
    const base = await resolveApiBase();
    setApiBase(base);
    const results = await Promise.allSettled([
      loadPaymentConfig(base),
      loadCategories(base),
      loadOffers(base),
      loadToday(base),
      loadCart(base)
    ]);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) {
      flash(`Loaded with partial data (${failed} section${failed > 1 ? "s" : ""} unavailable).`);
    }
  }

  async function resolveApiBase() {
    const env = import.meta.env.VITE_API_BASE;
    const candidates = [...new Set([env, "http://localhost:3001", "http://localhost:3000", window.location.origin].filter(Boolean))];
    for (const base of candidates) {
      try {
        const res = await fetch(`${base}/api/menu`);
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data?.items)) return base;
      } catch {
        // try next
      }
    }
    return window.location.origin;
  }

  async function api(path, options = {}, forcedBase = null) {
    const base = forcedBase || apiBase;
    const res = await fetch(`${base}${path}`, options);
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) throw new Error(data.message || "Request failed.");
    return data;
  }

  async function loadCategories(base = null) {
    try {
      const data = await api("/api/categories", {}, base);
      setCategories(data.categories || ["All"]);
    } catch {
      setCategories(["All"]);
    }
  }

  async function loadPaymentConfig(base = null) {
    try {
      const data = await api("/api/payments/config", {}, base);
      setPaymentConfig({
        provider: data.provider || "mock",
        currency: data.currency || "INR",
        upiEnabled: Boolean(data.upiEnabled),
        upiReceiverVpa: data.upiReceiverVpa || "",
        upiReceiverName: data.upiReceiverName || "Cloud Kitchen"
      });
    } catch {
      setPaymentConfig({ provider: "mock", currency: "INR", upiEnabled: false, upiReceiverVpa: "", upiReceiverName: "Cloud Kitchen" });
    }
  }

  async function loadMenu(base = null) {
    const q = new URLSearchParams();
    if (category) q.set("category", category);
    if (search) q.set("search", search);
    try {
      const data = await api(`/api/menu?${q.toString()}`, {}, base);
      setMenu(data.items || []);
    } catch {
      setMenu([]);
    }
  }

  async function loadOffers(base = null) {
    try {
      const data = await api("/api/offers", {}, base);
      setOffers(data.offers || []);
    } catch {
      setOffers([]);
    }
  }

  async function loadToday(base = null) {
    try {
      const data = await api("/api/special/today", {}, base);
      setTodaysSpecial(data.special || null);
    } catch {
      setTodaysSpecial(null);
    }
  }

  async function loadCart(base = null) {
    try {
      // Add cache-busting timestamp to ensure we don't get stale data
      const data = await api(`/api/cart?sessionId=${encodeURIComponent(sessionId)}&_t=${Date.now()}`, {}, base);
      setCart(data.cart || { items: [], pricing: {} });
      setOfferCode(data.cart?.offerCode || "");
    } catch {
      setCart({ items: [], pricing: {} });
      setOfferCode("");
    }
  }

  async function loadOrders(base = null, userOverride = undefined) {
    const q = new URLSearchParams();
    q.set("sessionId", sessionId);
    const activeUser = userOverride !== undefined ? userOverride : user;
    if (activeUser?.id) q.set("userId", activeUser.id);
    const phone = localStorage.getItem("ck_last_phone") || "";
    if (phone) q.set("phone", phone);
    try {
      const data = await api(`/api/orders?${q.toString()}`, {}, base);
      setOrders({ currentOrders: data.currentOrders || [], pastOrders: data.pastOrders || [] });
    } catch {
      setOrders({ currentOrders: [], pastOrders: [] });
    }
  }

  async function addToCart(itemId) {
    await api("/api/cart/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, itemId, quantity: 1 })
    });
    await loadCart();
    flash("Item added to cart");
  }

  async function updateQty(itemId, quantity) {
    await api("/api/cart/item", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, itemId, quantity })
    });
    await loadCart();
  }

  async function confirmAction(title, message, type = "confirm") {
    return new Promise((resolve) => {
      setDialog({ open: true, title, message, resolve, type });
    });
  }

  async function clearCart() {
    if (!cart.items?.length) return;
    const confirmed = await confirmAction("Empty Cart?", "Are you sure you want to remove all items from your cart?");
    if (!confirmed) return;
    
    // Optimistic update
    setCart({ items: [], pricing: { subtotal: 0, total: 0, discount: 0 } });
    isClearingRef.current = true;
    
    try {
      await api(`/api/cart/clear`, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      flash("Cart cleared");
    } catch (e) {
      // Re-load if failed
      await loadCart();
      flash("Failed to clear cart", "error");
    } finally {
      // Small delay to ensure any pending SSE events from the DELETE are ignored
      setTimeout(() => {
        isClearingRef.current = false;
      }, 1000);
    }
  }

  async function applyOffer() {
    if (!offerCode.trim()) return;
    try {
      const data = await api("/api/cart/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, offerCode: offerCode.trim() })
      });
      
      if (data.status === "valid") {
        setCouponBlink("success"); // Triggers apply-success-glow
        flash(data.message || "Offer applied");
      } else if (data.status === "not_met") {
        setCouponBlink("warning");
        flash(data.message, "warning");
      } else {
        setCouponBlink("error");
        flash(data.message || "Invalid coupon", "error");
      }
      
      setTimeout(() => setCouponBlink(null), 1800);
      await loadCart();
    } catch (e) {
      setCouponBlink("error");
      setTimeout(() => setCouponBlink(null), 1800);
      flash("Failed to apply offer", "error");
    }
  }

  async function checkoutOrder() {
    if (isPaying) return;
    if (!checkout.name || !checkout.phone || !checkout.address) {
      flash("Enter checkout details");
      return;
    }
    setIsPaying(true);
    const idempotencyKey = `idem_${sessionId}_${Date.now()}`;
    try {
      const data = await api("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          userId: user?.id || "",
          name: checkout.name,
          phone: checkout.phone,
          address: checkout.address,
          paymentMode: checkout.paymentMode,
          idempotencyKey
        })
      });
      localStorage.setItem("ck_last_phone", checkout.phone);

      if (data.paymentRequired && data.paymentSession) {
        const paymentResult = await completePaymentFlow(data.orderId, data.paymentSession);
        if (paymentResult === "paid") {
          flash(`Payment successful for ${data.orderId}`);
        } else if (paymentResult === "submitted") {
          flash(`Payment submitted for verification for ${data.orderId}.`);
        } else {
          flash("Payment not completed. Order is pending payment.");
        }
      } else {
        flash(`Order placed: ${data.orderId}`);
      }

      setShowCart(false);
      await Promise.all([loadCart(), loadOrders()]);
      navigate("/orders");
    } catch (error) {
      flash(error?.message || "Checkout failed. Please try again.");
    } finally {
      setIsPaying(false);
    }
  }

  async function completePaymentFlow(orderId, session) {
    if (session.provider === "mock" || session.provider === "upi_qr") {
      setUpiReference("");
      setPaymentTimer(300); // 5 minutes
      setPaymentPortal({ open: true, orderId, session, processing: false, error: "" });
      const result = await new Promise((resolve) => {
        paymentResolveRef.current = resolve;
      });
      paymentResolveRef.current = null;
      return result || "failed";
    }
    if (session.provider === "razorpay") {
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        flash("Razorpay checkout failed to load.");
        return false;
      }
      return await new Promise((resolve) => {
        const options = {
          key: session.keyId,
          amount: session.amountPaise,
          currency: session.currency,
          name: session.name || "Cloud Kitchen",
          description: session.description || `Order ${orderId}`,
          order_id: session.gatewayOrderId,
          prefill: {
            name: checkout.name,
            email: user?.email || "",
            contact: checkout.phone
          },
          theme: { color: "#ef4444" },
          handler: async (response) => {
            try {
              await api("/api/payments/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  provider: "razorpay",
                  orderId,
                  gatewayOrderId: response.razorpay_order_id,
                  gatewayPaymentId: response.razorpay_payment_id,
                  signature: response.razorpay_signature
                })
              });
              resolve("paid");
            } catch {
              resolve("failed");
            }
          },
          modal: {
            ondismiss: async () => {
              try {
                await api("/api/payments/attempt", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orderId, status: "cancelled", reason: "User closed Razorpay checkout." })
                });
              } catch {
                // no-op
              }
              resolve("failed");
            }
          }
        };
        const instance = new window.Razorpay(options);
        instance.open();
      });
    }
    return "failed";
  }

  async function beginPaymentForOrder(orderId) {
    if (isPaying) return;
    setIsPaying(true);
    try {
      const data = await api("/api/payments/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          sessionId,
          userId: user?.id || "",
          phone: localStorage.getItem("ck_last_phone") || ""
        })
      });
      if (data.alreadyPaid) {
        flash("Order already marked paid.");
        await loadOrders();
        if (selectedOrder?.id === orderId) await openOrderDetails(orderId);
        return;
      }
      const paymentResult = await completePaymentFlow(orderId, data.paymentSession);
      if (paymentResult === "paid") {
        flash(`Payment successful for ${orderId}`);
        await loadOrders();
        if (selectedOrder?.id === orderId) await openOrderDetails(orderId);
      } else if (paymentResult === "submitted") {
        flash(`Payment proof submitted for ${orderId}. Awaiting manager verification.`);
        await loadOrders();
        if (selectedOrder?.id === orderId) await openOrderDetails(orderId);
      } else {
        flash("Payment not completed.");
      }
    } finally {
      setIsPaying(false);
    }
  }

  async function confirmMockPayment() {
    const orderId = paymentPortal.orderId;
    const session = paymentPortal.session;
    if (!orderId || !session) return;
    setPaymentPortal((prev) => ({ ...prev, processing: true, error: "" }));
    try {
      if (session.provider === "upi_qr") {
        if (!upiReference.trim()) {
          setPaymentPortal((prev) => ({ ...prev, processing: false, error: "Enter UTR/reference after payment." }));
          return;
        }
        await api("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "upi_qr",
            orderId,
            gatewayOrderId: session.gatewayOrderId || `upi_${orderId}`,
            utr: upiReference.trim(),
            paymentRef: upiReference.trim()
          })
        });
      } else {
        await api("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "mock",
            orderId,
            gatewayOrderId: session.gatewayOrderId,
            mockSuccess: true,
            paymentRef: `MOCK-${Date.now()}`
          })
        });
      }
      setPaymentPortal({ open: false, orderId: "", session: null, processing: false, error: "" });
      if (paymentResolveRef.current) paymentResolveRef.current(session.provider === "upi_qr" ? "submitted" : "paid");
    } catch (error) {
      setPaymentPortal((prev) => ({ ...prev, processing: false, error: error.message || "Payment failed." }));
    }
  }

  async function failMockPayment() {
    if (paymentPortal.orderId) {
      try {
        await api("/api/payments/attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: paymentPortal.orderId, status: "failed", reason: "Mock failure selected by user." })
        });
      } catch {
        // no-op
      }
    }
    setPaymentPortal({ open: false, orderId: "", session: null, processing: false, error: "" });
    setUpiReference("");
    if (paymentResolveRef.current) paymentResolveRef.current("failed");
  }

  async function cancelMockPayment() {
    if (paymentPortal.orderId) {
      try {
        await api("/api/payments/attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: paymentPortal.orderId, status: "cancelled", reason: "User cancelled in mock portal." })
        });
      } catch {
        // no-op
      }
    }
    setPaymentPortal({ open: false, orderId: "", session: null, processing: false, error: "" });
    setUpiReference("");
    if (paymentResolveRef.current) paymentResolveRef.current("failed");
  }

  async function loadRazorpayScript() {
    if (window.Razorpay) return true;
    return await new Promise((resolve) => {
      const existing = document.querySelector("script[data-razorpay='true']");
      if (existing) {
        existing.addEventListener("load", () => resolve(true), { once: true });
        existing.addEventListener("error", () => resolve(false), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.dataset.razorpay = "true";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  async function submitAuth() {
    if (isAuthLoading) return;
    setIsAuthLoading(true);
    try {
      const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload = {
        username: authForm.username.trim(),
        password: authForm.password,
        ...(authMode === "register" ? { email: authForm.email.trim(), name: authForm.name.trim() } : {})
      };
      
      const data = await api(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      setUser(data.user);
      localStorage.setItem("ck_user", JSON.stringify(data.user));
      setShowAuth(false);
      setAuthForm({ username: "", password: "", email: "", name: "" });
      setShowPassword(false);
      
      await loadOrders(null, data.user);
      flash(`${authMode === "register" ? "Account created" : "Login successful"}`);
    } catch (error) {
      flash(error.message || "Authentication failed. Please try again.");
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function logout() {
    const confirmed = await confirmAction("Sign Out?", "Are you sure you want to log out of your account?");
    if (!confirmed) return;
    setUser(null);
    localStorage.removeItem("ck_user");
    setShowProfileDropdown(false);
    loadOrders();
    flash("Logged out");
  }

  function requestCancel(orderId) {
    const all = [...(orders.currentOrders || []), ...(orders.pastOrders || [])];
    const order = all.find(o => o.id === orderId);
    let fee = 0;
    if (order) {
      const total = order.pricing?.total || 0;
      if (order.status === "Preparing") fee = Math.max(20, Math.round(total * 0.05));
      if (order.status === "Out for Delivery") fee = Math.max(50, Math.round(total * 0.15));
    }
    setCancelDraft({ open: true, orderId, reason: "Changed my mind", fee, step: "REASON" });
  }

  async function confirmCancel() {
    if (cancelDraft.fee > 0 && !cancelDraft.txnId) {
      flash("Please enter Transaction ID", "error");
      return;
    }
    await api(`/api/orders/${cancelDraft.orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        userId: user?.id || "",
        phone: localStorage.getItem("ck_last_phone") || "",
        reason: cancelDraft.reason || "Cancelled by user",
        txnId: cancelDraft.txnId
      })
    });
    setCancelDraft({ open: false, orderId: "", reason: "Changed my mind", txnId: "" });
    await loadOrders();
    if (selectedOrder?.id) await openOrderDetails(selectedOrder.id);
    flash(cancelDraft.fee > 0 ? "Cancellation request sent for approval" : "Order cancelled");
  }

  async function reorderOrder(orderId) {
    const data = await api(`/api/orders/${orderId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        userId: user?.id || "",
        phone: localStorage.getItem("ck_last_phone") || ""
      })
    });
    await loadCart();
    flash(`Added ${data.addedItems} item(s) to cart`);
  }

  async function payOrder(orderId) {
    const data = await api(`/api/orders/${orderId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        userId: user?.id || "",
        phone: localStorage.getItem("ck_last_phone") || "",
        paymentRef: `TXN-${Date.now()}`
      })
    });
    await loadOrders();
    if (selectedOrder?.id === orderId) await openOrderDetails(orderId);
    flash(`Payment updated: ${data.paymentStatus}`);
  }

  async function openOrderDetails(orderId) {
    const q = new URLSearchParams();
    q.set("sessionId", sessionId);
    if (user?.id) q.set("userId", user.id);
    const phone = localStorage.getItem("ck_last_phone") || "";
    if (phone) q.set("phone", phone);
    const data = await api(`/api/orders/${orderId}?${q.toString()}`);
    setSelectedOrder(data.order || null);
    setSupportDraft("");
    await loadSupport(orderId);
  }

  async function loadSupport(orderId) {
    const data = await api(`/api/orders/${orderId}/support`);
    setOrderSupport(data.tickets || []);
  }

  async function raiseSupport(orderId) {
    if (!supportDraft.trim()) {
      flash("Write your issue first");
      return;
    }
    const data = await api(`/api/orders/${orderId}/support`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: supportDraft.trim() })
    });
    setSupportDraft("");
    await loadSupport(orderId);
    markOrderUpdated(orderId, "support");
    flash(`Support ticket created: ${data.ticketId}`);
  }

  async function submitSupportReply(ticketId, orderId, overrideMsg = null) {
    const message = (overrideMsg || replyDrafts[ticketId] || "").trim();
    if (!message) return;
    await api(`/api/support/tickets/${ticketId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, authorName: user?.name || "Customer" })
    });
    if (!overrideMsg) setReplyDrafts(p => ({ ...p, [ticketId]: "" }));
    await loadSupport(orderId);
    flash("Reply sent");
  }

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(""), 2200);
  }

  return (
    <div>
      <div className="site-bg"></div>
      <div className={`live-notice ${notice ? "show" : ""}`}>{notice}</div>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link className="brand-group" to="/">
            <img src={`${apiBase}/assets/logo-ck.png`} alt="Cloud Kitchen" className="site-logo" />
            <div className="brand-text">
              <strong>Cloud Kitchen</strong>
              <span>Startup Mode</span>
            </div>
          </Link>
          <nav className="navlinks">
            <Link to="/menu">Menu</Link>
            <Link to="/specials">Specials</Link>
            <Link to="/orders">Orders</Link>
            <Link to="/payments">Payments</Link>
          </nav>
          <div className="topbar-actions">
            <button className="btn subtle" onClick={() => navigate("/orders")}>My Orders</button>
            <button className="btn accent" onClick={() => setShowCart(true)}>Cart {cartCount}</button>
            {user ? (
              <div className="header-profile-container">
                <div 
                  className="profile-avatar-circle" 
                  onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                  title={user.name}
                >
                  {getInitials(user.name)}
                  <div className="profile-hover-name">{user.name}</div>
                </div>
                {showProfileDropdown && (
                  <div className="profile-dropdown-menu">
                    <div className="dropdown-user-info">
                      <strong>{user.name}</strong>
                      <span>{user.email || user.username}</span>
                    </div>
                    <div className="dropdown-divider"></div>
                    <Link to="/profile" className="dropdown-item" onClick={() => setShowProfileDropdown(false)}>Edit Profile</Link>
                    <Link to="/orders" className="dropdown-item" onClick={() => setShowProfileDropdown(false)}>My Orders</Link>
                    <div className="dropdown-divider"></div>
                    <button className="dropdown-item signout" onClick={logout}>Sign Out</button>
                  </div>
                )}
              </div>
            ) : (
              <button className="btn subtle" onClick={() => setShowAuth(true)}>Sign in</button>
            )}
          </div>
        </div>
      </header>

      <main>
        <Routes>
          <Route
            path="/"
            element={
              <UnifiedHomePage
                apiBase={apiBase}
                todaysSpecial={todaysSpecial}
                addToCart={addToCart}
                updateQty={updateQty}
                cart={cart}
                menu={menu}
                categories={categories}
                search={search}
                setSearch={setSearch}
                category={category}
                setCategory={setCategory}
                orders={orders}
                openDetails={openOrderDetails}
                requestCancel={requestCancel}
                reorderOrder={reorderOrder}
                updatedOrders={updatedOrders}
                refreshOrders={loadOrders}
                offerCode={offerCode}
                setOfferCode={setOfferCode}
                applyOffer={applyOffer}
                showOffers={showOffers}
                setShowOffers={setShowOffers}
                offers={offers}
                checkout={checkout}
                setCheckout={setCheckout}
                checkoutOrder={checkoutOrder}
              />
            }
          />
          <Route
            path="/menu"
            element={
              <MenuPage
                menu={menu}
                categories={categories}
                search={search}
                setSearch={setSearch}
                category={category}
                setCategory={setCategory}
                addToCart={addToCart}
                updateQty={updateQty}
                cart={cart}
                apiBase={apiBase}
              />
            }
          />
          <Route
            path="/specials"
            element={<SpecialsPage apiBase={apiBase} todaysSpecial={todaysSpecial} addToCart={addToCart} />}
          />
          <Route
            path="/orders"
            element={
              <OrdersPage
                orders={orders}
                apiBase={apiBase}
                openDetails={openOrderDetails}
                requestCancel={requestCancel}
                reorderOrder={reorderOrder}
                updatedOrders={updatedOrders}
                refreshOrders={loadOrders}
                beginPaymentForOrder={beginPaymentForOrder}
              />
            }
          />
          <Route
            path="/payments"
            element={
              <PaymentsPage
                orders={orders}
                beginPaymentForOrder={beginPaymentForOrder}
                openDetails={openOrderDetails}
                isPaying={isPaying}
                refreshOrders={loadOrders}
                paymentSearch={paymentSearch}
                setPaymentSearch={setPaymentSearch}
                paymentFilter={paymentFilter}
                setPaymentFilter={setPaymentFilter}
                paymentPriceRange={paymentPriceRange}
                setPaymentPriceRange={setPaymentPriceRange}
                paymentSort={paymentSort}
                setPaymentSort={setPaymentSort}
                paymentDateSearch={paymentDateSearch}
                setPaymentDateSearch={setPaymentDateSearch}
              />
            }
          />
          <Route
            path="/checkout"
            element={
              <CheckoutPage
                cart={cart}
                apiBase={apiBase}
                updateQty={updateQty}
                offerCode={offerCode}
                setOfferCode={setOfferCode}
                applyOffer={applyOffer}
                showOffers={showOffers}
                setShowOffers={setShowOffers}
                offers={offers}
                checkout={checkout}
                setCheckout={setCheckout}
                checkoutOrder={checkoutOrder}
                isPaying={isPaying}
              />
            }
          />
          <Route
            path="/profile"
            element={
              <ProfilePage
                user={user}
                setUser={setUser}
                api={api}
                flash={flash}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer id="contact" className="site-footer">
        <div className="container footer-grid">
          <div className="footer-col brand-col">
            <div className="footer-brand">
              <img src="/assets/logo-ck.png" alt="Cloud Kitchen" />
              <div className="brand-text">
                <strong>Cloud Kitchen</strong>
                <span>Startup Mode</span>
              </div>
            </div>
            <p className="footer-bio">
              Premium cloud kitchen delivering gourmet experiences to your doorstep. Crafted with love, served with care.
            </p>
            <div className="social-links">
              <span className="social-icon">Instagram</span>
              <span className="social-icon">FaceBook</span>
              <span className="social-icon">Twitter</span>
            </div>
          </div>
          
          <div className="footer-col">
            <h4>Cuisines</h4>
            <ul className="footer-links">
              <li>North Indian</li>
              <li>Chinese Fusion</li>
              <li>Continental</li>
              <li>Desserts & Shakes</li>
              <li>Healthy Bowls</li>
            </ul>
          </div>
          
          <div className="footer-col">
            <h4>Quick Links</h4>
            <ul className="footer-links">
              <li><Link to="/">Menu</Link></li>
              <li><Link to="/specials">Today's Specials</Link></li>
              <li><Link to="/orders">My Orders</Link></li>
              <li><Link to="/checkout">Checkout</Link></li>
              <li><button className="text-btn" onClick={() => setShowAuth(true)}>Login / Signup</button></li>
              <li className="admin-link-sep"></li>
              <li><a href="/admin-react/" className="text-btn admin-btn" target="_blank" rel="noreferrer">Admin Portal</a></li>
            </ul>
          </div>
          
          <div className="footer-col contact-col">
            <h4>Contact Details</h4>
            <ul className="contact-list">
              <li>
                <strong>Location:</strong>
                <span>Sector 17, Main Market, Chandigarh, 160017</span>
              </li>
              <li>
                <strong>Phone:</strong>
                <span>+91 98765 00000</span>
              </li>
              <li>
                <strong>Email:</strong>
                <span>hello@cloudkitchen.local</span>
              </li>
              <li>
                <strong>Hours:</strong>
                <span>Mon - Sun: 10:00 AM - 11:30 PM</span>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="container">
            <p>&copy; {new Date().getFullYear()} Cloud Kitchen Startup Mode. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {showCart ? (
        <>
          <aside className="cart-panel open">
            <CartBody
              cart={cart}
              apiBase={apiBase}
              updateQty={updateQty}
              clearCart={clearCart}
              offerCode={offerCode}
              setOfferCode={setOfferCode}
              applyOffer={applyOffer}
              couponBlink={couponBlink}
              showOffers={showOffers}
              setShowOffers={setShowOffers}
              offers={offers}
              checkout={checkout}
              setCheckout={setCheckout}
              checkoutOrder={checkoutOrder}
              paymentConfig={paymentConfig}
              isPaying={isPaying}
              closeCart={() => setShowCart(false)}
            />
          </aside>
        <div className="backdrop show cart-panel-backdrop" onClick={() => setShowCart(false)} />
        </>
      ) : null}

      {showAuth ? (
        <div className="backdrop show" onClick={() => (isAuthLoading ? null : setShowAuth(false))}>
          <div className="modal auth-modal theme-modal" onClick={(e) => e.stopPropagation()}>
            <div className="auth-tabs">
              <button 
                className={`auth-tab ${authMode === "login" ? "active" : ""}`} 
                onClick={() => setAuthMode("login")}
              >
                Sign In
              </button>
              <button 
                className={`auth-tab ${authMode === "register" ? "active" : ""}`} 
                onClick={() => setAuthMode("register")}
              >
                New Account
              </button>
            </div>
            
            <div className="auth-content">
              <h3>{authMode === "login" ? "Welcome Back" : "Create Account"}</h3>
              <p className="auth-subtitle">
                {authMode === "login" ? "Enter your credentials to access your account." : "Join us for a premium kitchen experience."}
              </p>

              <form
                className="checkout auth-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (authMode === "reset") {
                    setIsAuthLoading(true);
                    try {
                      await api("/api/auth/reset-password", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ identifier: authForm.username, newPassword: authForm.password })
                      });
                      flash("Password reset successful. Please login.");
                      setAuthMode("login");
                    } catch (err) {
                      flash(err.message, "error");
                    } finally {
                      setIsAuthLoading(false);
                    }
                    return;
                  }
                  submitAuth();
                }}
              >
                {authMode === "reset" && (
                   <p style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#6c655f" }}>
                     Enter your username/email and the new password you'd like to set.
                   </p>
                )}
                {authMode === "register" && (
                  <>
                    <input
                      placeholder="Full Name"
                      value={authForm.name}
                      autoFocus
                      required
                      onChange={(e) => setAuthForm((p) => ({ ...p, name: e.target.value }))}
                    />
                    <input
                      type="email"
                      placeholder="Email Address"
                      value={authForm.email}
                      required
                      onChange={(e) => setAuthForm((p) => ({ ...p, email: e.target.value }))}
                    />
                  </>
                )}
                
                <input
                  placeholder="Username"
                  value={authForm.username}
                  autoFocus={authMode === "login"}
                  required
                  onChange={(e) => setAuthForm((p) => ({ ...p, username: e.target.value }))}
                />
                
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={authForm.password}
                    required
                    onChange={(e) => setAuthForm((p) => ({ ...p, password: e.target.value }))}
                  />
                  <button 
                    type="button" 
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>

                <button className="btn accent full" type="submit" disabled={isAuthLoading}>
                  {isAuthLoading ? "Verifying..." : authMode === "login" ? "Sign In" : "Register Now"}
                </button>
                
                <p className="auth-footer">
                  {authMode === "login" ? "Don't have an account?" : authMode === "register" ? "Already have an account?" : ""}
                  <button 
                    type="button" 
                    className="text-btn" 
                    onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
                  >
                    {authMode === "login" ? "Register here" : "Sign in here"}
                  </button>
                  {authMode === "login" && (
                    <button 
                      type="button" 
                      className="text-btn forgot-pw" 
                      onClick={() => setAuthMode("reset")}
                      style={{ display: "block", marginTop: "0.5rem" }}
                    >
                      Forgot Password?
                    </button>
                  )}
                </p>

                <div className="admin-access-row">
                  <a href="/admin-react/" className="admin-access-btn" target="_blank" rel="noreferrer">
                    <span className="icon">🛡️</span> Manager / Admin Access
                  </a>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {selectedOrder ? (
        <div className="backdrop show" onClick={() => setSelectedOrder(null)}>
          <div className="modal order-modal theme-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Order Details</h3>
              <button className="close-btn" onClick={() => setSelectedOrder(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="order-id-tag">ID: {selectedOrder.id}</div>
            <div className={`detail ${updatedOrders[selectedOrder.id] ? "updated" : ""}`}>
              <p><strong>Status:</strong> {selectedOrder.status}</p>
              <p><strong>Payment:</strong> {selectedOrder.paymentMode} ({selectedOrder.paymentStatus || "Pending"})</p>
              <p><strong>Total:</strong> Rs {selectedOrder.pricing?.total}</p>
              {selectedOrder.pricing?.cancellationFee > 0 && (
                <p style={{ color: "#ef4444" }}><strong>Cancellation Fee:</strong> Rs {selectedOrder.pricing.cancellationFee}</p>
              )}
              <p><strong>Address:</strong> {selectedOrder.customer?.address}</p>
            </div>
            <div className="detail">
              <strong>Items</strong>
              <ul>
                {(selectedOrder.items || []).map((item) => (
                  <li key={item.id}>{item.name} x {item.quantity} - Rs {item.price * item.quantity}</li>
                ))}
              </ul>
            </div>
            <div className="detail">
              <strong>Status Timeline</strong>
              <ul>
                {(selectedOrder.statusHistory || []).slice(0, showFullTimeline ? undefined : 3).map((entry, idx) => (
                  <li key={`${entry.status}-${idx}`}>
                    <strong>{entry.status}</strong> - {new Date(entry.at).toLocaleString()}{entry.note ? ` (${entry.note})` : ""}
                  </li>
                ))}
              </ul>
              {(selectedOrder.statusHistory || []).length > 3 && (
                <button className="btn subtle small" onClick={() => setShowFullTimeline(!showFullTimeline)}>
                  {showFullTimeline ? "Show less" : `+ ${(selectedOrder.statusHistory.length - 3)} more updates`}
                </button>
              )}
            </div>

            {selectedOrder.paymentStatus === "Refunded" && selectedOrder.paymentRef && (
              <div className="detail refund-id-box" style={{ background: "rgba(59, 130, 246, 0.1)", padding: "1rem", borderRadius: "1rem", border: "1px solid #3b82f6", marginBottom: "1rem" }}>
                <strong style={{ color: "#1d4ed8" }}>Refund Transaction ID</strong>
                <p style={{ margin: "0.25rem 0 0", fontFamily: "monospace", fontSize: "1.1rem" }}>{selectedOrder.paymentRef}</p>
              </div>
            )}

            <div className="detail">
              <strong>Payment Attempts</strong>
              <span className={`chip ${selectedOrder.paymentStatus === "Paid" ? "success" : selectedOrder.paymentStatus === "Refunded" ? "refunded" : "pending"}`} style={{ marginLeft: "0.5rem" }}>
                {selectedOrder.paymentStatus || "Verification Pending"}
              </span>
              <ul>
                {(selectedOrder.paymentTransactions || []).length ? (
                  (selectedOrder.paymentTransactions || []).map((txn) => (
                    <li key={txn.id}>
                      <strong>{txn.provider?.toUpperCase() || "N/A"}</strong> - {txn.status} | Rs {txn.amount} {txn.currency} | {new Date(txn.createdAt).toLocaleString()}
                      {txn.refundId && <div className="refund-id">Refund ID: {txn.refundId}</div>}
                    </li>
                  ))
                ) : (
                  <li>No payment attempts yet.</li>
                )}
              </ul>
            </div>
            <div className={`detail ${updatedOrders[selectedOrder.id] === "support" ? "updated-support" : ""}`}>
              <strong>Support Queries</strong>
              {!orderSupport.length ? <p>No support query raised yet.</p> : (
                <div className="support-thread">
                  {orderSupport.map((ticket) => (
                    <article className="support-ticket" key={ticket.id}>
                      <div className="ticket-header">
                        <strong>{ticket.id}</strong>
                        <span className={`status-tag ${ticket.status}`}>{ticket.status}</span>
                        <span className="time">{new Date(ticket.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="ticket-message source">
                        <p>{ticket.message}</p>
                      </div>
                      <div className="ticket-replies">
                        {(ticket.replies || []).map((reply, idx) => (
                          <div key={`${ticket.id}-${idx}`} className={`reply-bubble ${reply.authorType}`}>
                            <p><strong>{reply.authorType === "admin" ? "Manager" : "You"}:</strong> {reply.message}</p>
                            <span className="reply-time">{new Date(reply.at).toLocaleTimeString()}</span>
                          </div>
                        ))}
                      </div>
                      {/* UPI Refund Form Injection */}
                      {[ticket.message, ...(ticket.replies || []).map(r => r.message)].some(m => String(m).includes("[ACTION:PROVIDE_UPI_FOR_REFUND]")) && (
                        <div className="upi-refund-form" style={{ background: "rgba(245, 158, 11, 0.1)", padding: "1rem", borderRadius: "1rem", margin: "0.5rem 0", border: "1px dashed #f59e0b" }}>
                          <p style={{ margin: 0, fontWeight: 600, color: "#92400e", fontSize: "0.9rem" }}>🏦 Refund Registration Required</p>
                          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                            <input 
                              placeholder="Enter UPI ID (e.g. name@upi)" 
                              style={{ flex: 1, padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid #d1d5db" }}
                              value={upiDrafts[ticket.id] || ""}
                              onChange={(e) => setUpiDrafts(p => ({ ...p, [ticket.id]: e.target.value }))}
                            />
                            <button className="btn accent small" onClick={() => {
                              const upi = upiDrafts[ticket.id];
                              if (!upi) return;
                              setReplyDrafts(p => ({ ...p, [ticket.id]: `[UPI_REFUND_SUBMISSION]: ${upi}` }));
                              submitSupportReply(ticket.id, selectedOrder.id, `[UPI_REFUND_SUBMISSION]: ${upi}`);
                              setUpiDrafts(p => ({ ...p, [ticket.id]: "" }));
                            }}>Submit</button>
                          </div>
                        </div>
                      )}
                      {ticket.status === "open" && (
                        <div className="ticket-reply-box">
                          <textarea 
                            rows={1} 
                            placeholder="Type a reply..." 
                            value={replyDrafts[ticket.id] || ""} 
                            onChange={(e) => setReplyDrafts(p => ({ ...p, [ticket.id]: e.target.value }))}
                          />
                          <button className="btn subtle small" onClick={() => submitSupportReply(ticket.id, selectedOrder.id)}>Reply</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <div className="checkout" style={{ marginTop: "0.5rem" }}>
                <textarea rows={2} placeholder="Write your issue" value={supportDraft} onChange={(e) => setSupportDraft(e.target.value)} />
                <button className="btn subtle" onClick={() => raiseSupport(selectedOrder.id)}>Send Query</button>
              </div>
            </div>
            </div>
            <div className="modal-footer">
              <button className="btn subtle" disabled={!selectedOrder.canCancel} onClick={() => requestCancel(selectedOrder.id)}>
                {selectedOrder.canCancel ? "Cancel Order" : "Cancellation Closed"}
              </button>
              {selectedOrder.paymentStatus === "Pending" && needsOnlinePayment(selectedOrder.paymentMode) ? (
                <button className="btn accent" disabled={isPaying} onClick={() => beginPaymentForOrder(selectedOrder.id)}>{isPaying ? "Processing..." : "Pay Now"}</button>
              ) : null}
              {selectedOrder.paymentStatus === "Pending" && String(selectedOrder.paymentMode || "").toUpperCase() === "COD" ? (
                <button className="btn subtle" onClick={() => payOrder(selectedOrder.id)}>Mark Paid</button>
              ) : null}
              <button className="btn subtle" onClick={() => reorderOrder(selectedOrder.id)}>Reorder</button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelDraft.open ? (
        <div className="backdrop show" onClick={() => setCancelDraft({ open: false, orderId: "", reason: "Changed my mind", step: "REASON" })}>
          <div className="modal theme-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{cancelDraft.step === "PAYMENT" ? "Pay Cancellation Fee" : "Cancel order?"}</h3>
            </div>
            <div className="modal-body">
              {cancelDraft.step === "REASON" && (
                <>
                  <p>This action updates customer timeline immediately. Please provide a reason.</p>
                  {cancelDraft.fee > 0 && (
                    <div className="fee-notice-box">
                      <strong className="danger-text">Cancellation Fee: Rs {cancelDraft.fee}</strong>
                      <p className="fee-subtext">
                        Since your order is already in the <strong>{
                          [...(orders.currentOrders || []), ...(orders.pastOrders || [])].find(o => o.id === cancelDraft.orderId)?.status
                        }</strong> stage, a fee will be deducted.
                      </p>
                    </div>
                  )}
                  <form id="cancel-order-form" onSubmit={(e) => {
                    e.preventDefault();
                    if (cancelDraft.fee > 0) {
                      setCancelDraft(p => ({ ...p, step: "PAYMENT" }));
                    } else {
                      confirmCancel();
                    }
                  }}>
                    <textarea 
                      className="cancel-modal-textarea themed-input"
                      rows={3} 
                      placeholder="Reason for cancellation..."
                      value={cancelDraft.reason} 
                      onChange={(e) => setCancelDraft((p) => ({ ...p, reason: e.target.value }))} 
                    />
                  </form>
                </>
              )}

              {cancelDraft.step === "PAYMENT" && (
                  <div className="qr-step-wrap">
                    <div className="fee-summary">
                      <p style={{ margin: "0 0 0.5rem" }}>Amount to pay: <strong>Rs {cancelDraft.fee}</strong></p>
                      <span style={{ fontSize: "0.85rem", opacity: 0.8 }}>Reason: {cancelDraft.reason}</span>
                    </div>
                    <div className="qr-container-themed">
                      <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=upi://pay?pa=kitchen@bank%26pn=CloudKitchen%26am=${cancelDraft.fee}%26tn=Fee-Order-${cancelDraft.orderId}`} alt="Payment QR" />
                      <p className="qr-instruction">Scan to pay cancellation fee</p>
                    </div>
                    <div className="txn-id-input-wrap" style={{ marginTop: "1rem" }}>
                      <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", fontWeight: 600 }}>Transaction ID / Ref Number</label>
                      <input 
                        className="themed-input"
                        placeholder="Enter 12-digit Txn ID"
                        value={cancelDraft.txnId}
                        onChange={(e) => setCancelDraft(p => ({ ...p, txnId: e.target.value }))}
                      />
                      <p style={{ fontSize: "0.75rem", color: "#6c655f", marginTop: "0.4rem" }}>Please enter the transaction ID from your payment app to proceed.</p>
                    </div>
                  </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn subtle" onClick={() => {
                if (cancelDraft.step === "PAYMENT") {
                  setCancelDraft(p => ({ ...p, step: "REASON" }));
                } else {
                  setCancelDraft({ open: false, orderId: "", reason: "Changed my mind", step: "REASON" });
                }
              }}>
                {cancelDraft.step === "PAYMENT" ? "Go Back" : "Keep Order"}
              </button>
              {cancelDraft.step === "REASON" ? (
                <button type="submit" form="cancel-order-form" className="btn accent">
                  {cancelDraft.fee > 0 ? "Next: Pay Fee" : "Confirm Cancellation"}
                </button>
              ) : (
                <button type="button" className="btn accent" onClick={confirmCancel}>
                  Fee Paid - Cancel Order
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {paymentPortal.open ? (
        <div className="backdrop show" onClick={cancelMockPayment}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Payment Portal</h3>
              <button className="close-btn" onClick={cancelMockPayment}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="order-id-tag">Order: {paymentPortal.orderId}</div>
              <p><strong>Provider:</strong> {paymentPortal.session?.provider === "upi_qr" ? "UPI QR" : "Mock Gateway"}</p>
              <p><strong>Amount:</strong> <span className="price">Rs {Number(paymentPortal.session?.amountPaise || 0) / 100}</span></p>
              
              {paymentTimer > 0 ? (
                <div className="payment-timer-wrap">
                  <span className="timer-label">Session expires in:</span>
                  <span className={`timer-value ${paymentTimer < 60 ? 'urgent' : ''}`}>{formatTimer(paymentTimer)}</span>
                </div>
              ) : (
                <div className="payment-timer-expired">
                  <p>⚠️ Payment session expired. Please regenerate the QR code to continue.</p>
                  <button className="btn accent small" onClick={() => beginPaymentForOrder(paymentPortal.orderId)}>Regenerate QR</button>
                </div>
              )}

              {paymentPortal.session?.provider === "upi_qr" && paymentTimer > 0 ? (
                <>
                  <p>Scan this QR in any UPI app and complete the payment, then enter UTR/reference below.</p>
                  {paymentPortal.session?.qrImageUrl ? (
                    <div style={{ display: "flex", justifyContent: "center", margin: "1.5rem 0" }}>
                      <img src={paymentPortal.session.qrImageUrl} alt="UPI QR" style={{ width: "220px", height: "220px", borderRadius: "16px", border: "1.5px solid rgba(0,0,0,0.05)", boxShadow: "0 10px 30px rgba(0,0,0,0.08)" }} />
                    </div>
                  ) : null}
                  <div className="detail">
                    <p><strong>Payee:</strong> {paymentPortal.session?.payee || paymentConfig.upiReceiverName}</p>
                    <p><strong>VPA:</strong> {paymentPortal.session?.vpa || paymentConfig.upiReceiverVpa || "Not configured"}</p>
                    {paymentPortal.session?.upiUri ? (
                      <p style={{ marginTop: "1rem" }}>
                        <a className="btn subtle" href={paymentPortal.session.upiUri}>Open UPI App</a>
                      </p>
                    ) : null}
                  </div>
                  <div className="checkout-field" style={{ marginTop: "1rem" }}>
                    <label>Transaction Reference</label>
                    <input
                      placeholder="Enter UTR / Transaction Reference"
                      value={upiReference}
                      onChange={(e) => setUpiReference(e.target.value)}
                    />
                  </div>
                </>
              ) : paymentPortal.session?.provider !== "upi_qr" && paymentTimer > 0 ? (
                <p>This simulates a real payment gateway. Confirm to mark payment successful.</p>
              ) : null}
            </div>
            {paymentPortal.error ? <p style={{ color: "#b3261e", padding: "0 2.5rem" }}>{paymentPortal.error}</p> : null}
            <div className="modal-footer">
              <button className="btn subtle" disabled={paymentPortal.processing} onClick={cancelMockPayment}>Cancel Payment</button>
              {paymentTimer > 0 && (
                <button className="btn accent" disabled={paymentPortal.processing} onClick={confirmMockPayment}>{paymentPortal.processing ? "Processing..." : paymentPortal.session?.provider === "upi_qr" ? "I Have Paid" : "Pay Securely"}</button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {dialog.open && (
        <div className="backdrop show" style={{ zIndex: 3000 }} onClick={() => (setDialog(p => ({ ...p, open: false })), dialog.resolve(false))}>
          <div className="modal themed-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{dialog.title}</h3>
            </div>
            <div className="modal-body">
              <p>{dialog.message}</p>
            </div>
            <div className="modal-footer">
              {dialog.type === "confirm" && (
                <button className="btn subtle" onClick={() => (setDialog(p => ({ ...p, open: false })), dialog.resolve(false))}>Cancel</button>
              )}
              <button className="btn accent" onClick={() => (setDialog(p => ({ ...p, open: false })), dialog.resolve(true))}>
                {dialog.type === "confirm" ? "Confirm" : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfilePage({ user, setUser, api, flash }) {
  const [form, setForm] = useState({
    name: user?.name || "",
    phone: user?.phone || "",
    address: user?.address || "",
    defaultPaymentMode: user?.defaultPaymentMode || "COD"
  });
  const [isSaving, setIsSaving] = useState(false);
  const [pwForm, setPwForm] = useState({ oldPassword: "", newPassword: "" });
  const [isSavingPw, setIsSavingPw] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const data = await api("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, ...form })
      });
      setUser(data.user);
      localStorage.setItem("ck_user", JSON.stringify(data.user));
      flash("Profile updated successfully");
    } catch (err) {
      flash(err.message, "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    setIsSavingPw(true);
    try {
      await api("/api/auth/change-password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, ...pwForm })
      });
      setPwForm({ oldPassword: "", newPassword: "" });
      flash("Password updated successfully");
    } catch (err) {
      flash(err.message, "error");
    } finally {
      setIsSavingPw(false);
    }
  }

  if (!user) return <Navigate to="/" />;

  return (
    <section className="section container profile-page">
      <div className="section-head">
        <div>
          <p className="kicker">Personal Settings</p>
          <h2>My Profile</h2>
        </div>
      </div>

      <div className="profile-grid">
        <form className="profile-card" onSubmit={handleSave}>
          <h3>Basic Information</h3>
          <div className="checkout-field">
            <label>Full Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="checkout-field">
            <label>Phone Number</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="checkout-field">
            <label>Delivery Address</label>
            <textarea rows={3} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="checkout-field">
            <label>Default Payment</label>
            <CustomSelect 
              value={form.defaultPaymentMode} 
              onChange={(e) => setForm({ ...form, defaultPaymentMode: e.target.value })}
              options={[
                { value: "COD", label: "Cash on Delivery" },
                { value: "UPI", label: "UPI (Online)" }
              ]}
            />
          </div>
          <button className="btn accent full" type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Update Profile"}</button>
        </form>

        <form className="profile-card" onSubmit={handlePasswordChange}>
          <h3>Security</h3>
          <div className="checkout-field">
            <label>Current Password</label>
            <input type="password" value={pwForm.oldPassword} onChange={(e) => setPwForm({ ...pwForm, oldPassword: e.target.value })} />
          </div>
          <div className="checkout-field">
            <label>New Password</label>
            <input type="password" value={pwForm.newPassword} onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} />
          </div>
          <button className="btn subtle full" type="submit" disabled={isSavingPw}>{isSavingPw ? "Updating..." : "Change Password"}</button>
        </form>
      </div>
    </section>
  );
}

function HomePage({ apiBase, addToCart }) {
  return (
    <section id="home" className="hero-landing">
      <div className="container hero-inner hero-blur-box">
        <div className="hero-copy">
          <p className="kicker">Fast delivery. Premium flavor.</p>
          <h1>Freshly cooked food for every craving.</h1>
          <p className="hero-text">
            Built from your Figma references and fully connected end-to-end.
            Browse, add to cart, apply offers, and place orders in one flow.
          </p>
          <div className="hero-actions">
            <Link className="btn accent" to="/menu">Order now</Link>
            <Link className="btn subtle" to="/checkout">See deals</Link>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-blob"></div>
          <img className="hero-main" src={`${apiBase}/assets/hero-bowl.png`} alt="Main dish" />
        </div>
      </div>
    </section>
  );
}

function SpecialsPage({ apiBase, todaysSpecial, addToCart }) {
  return (
    <section id="specials" className="section container">
      <div className="section-head">
        <div>
          <p className="kicker">Kitchen spotlight</p>
          <h2>Chef's Studio</h2>
        </div>
      </div>
      <div className="specials-grid">
        <article className="special-card feature-card">
          <div className="special-img-wrap">
            <img src={`${apiBase}/assets/feature-biryani.jpg`} alt="Chef special dish" />
          </div>
          <div className="special-info">
            <p className="kicker">Chef's curated plate</p>
            <h3>Royal Pot Biryani</h3>
            <p>Layered saffron rice, roasted vegetables, and aromatic spices in our signature dum finish. Balanced heat, rich aroma, and quick delivery.</p>
            <div className="special-meta">
              <span className="badge">Prep: 26 mins</span>
              <span className="badge green">Pure Veg</span>
            </div>
            <button className="btn accent" onClick={() => addToCart("dish-001")}>Add to cart</button>
          </div>
        </article>
        
        <article className="special-card daily-card">
          <div className="daily-head">
            <p className="kicker">Auto updates daily</p>
            <h3>{todaysSpecial?.name || "Today's Special"}</h3>
          </div>
          <div className="daily-body">
            <p>{todaysSpecial?.description || "No special available right now."}</p>
            <div className="daily-stats">
              <span className="price">Rs {todaysSpecial?.price ?? "--"}</span>
              <span className="cat">{todaysSpecial?.category || "Category --"}</span>
            </div>
            <div className="daily-visual">
              <img src={todaysSpecial ? `${apiBase}${todaysSpecial.image}` : `${apiBase}/assets/feature-biryani.jpg`} alt={todaysSpecial?.name || "Today's special item"} />
            </div>
          </div>
          <button className="btn accent full" onClick={() => addToCart(todaysSpecial?.id)} disabled={!todaysSpecial}>Add today's special</button>
        </article>
      </div>
    </section>
  );
}

function UnifiedHomePage(props) {
  return (
    <>
      <HomePage apiBase={props.apiBase} todaysSpecial={props.todaysSpecial} addToCart={props.addToCart} />
      <LandingMenu
        menu={props.menu}
        categories={props.categories}
        search={props.search}
        setSearch={props.setSearch}
        category={props.category}
        setCategory={props.setCategory}
        addToCart={props.addToCart}
        updateQty={props.updateQty}
        cart={props.cart}
        apiBase={props.apiBase}
      />
      <SpecialsPage apiBase={props.apiBase} todaysSpecial={props.todaysSpecial} addToCart={props.addToCart} />
    </>
  );
}

function CartQtyControl({ id, quantity, updateQty, addToCart }) {
  if (quantity <= 0) {
    return (
      <button className="btn accent full add-cart-btn" onClick={(e) => { e.stopPropagation(); addToCart(id); }}>
        ADD
      </button>
    );
  }

  return (
    <div className="modern-qty-ctrl">
      <button className="qty-btn minus" onClick={(e) => { e.stopPropagation(); updateQty(id, quantity - 1); }}>-</button>
      <span className="qty-count">{quantity}</span>
      <button className="qty-btn plus" onClick={(e) => { e.stopPropagation(); updateQty(id, quantity + 1); }}>+</button>
    </div>
  );
}

function LandingMenu({ menu, categories, search, setSearch, category, setCategory, addToCart, updateQty, cart, apiBase }) {
  return (
    <section id="menu" className="section container">
      <div className="section-head">
        <div>
          <p className="kicker">Popular this week</p>
          <h2>Explore our Menu</h2>
        </div>
        <div className="landing-actions">
          <input 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            placeholder="Search favorites..." 
            className="landing-search"
          />
        </div>
      </div>
      <div className="menu-grid">
        {menu.map((item) => (
          <article className="dish-card" key={item.id}>
            <img className="dish-image" src={`${apiBase}${item.image}`} alt={item.name} />
            <div className="dish-body">
              <div className="dish-head">
                <h4>{item.name}</h4>
                <span className="rating">★ {item.rating}</span>
              </div>
              <p className="dish-desc">{item.description}</p>
              <div className="dish-meta">
                <strong className="price">Rs {item.price}</strong>
                <span className="prep">{item.prepMinutes} mins</span>
              </div>
              {(() => {
                const inCart = cart.items?.find(i => i.id === item.id);
                return inCart ? (
                  <CartQtyControl id={item.id} quantity={inCart.quantity} updateQty={updateQty} />
                ) : (
                  <button className="btn accent full" onClick={() => addToCart(item.id)}>Add to cart</button>
                );
              })()}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MenuPage({ menu, categories, search, setSearch, category, setCategory, addToCart, updateQty, cart, apiBase }) {
  const categoryIcons = {
    "Main Course": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h18M3 12c0-4.4 3.6-8 8-8s8 3.6 8 8M3 12c0 4.4 3.6 8 8 8s8-3.6 8-8" />
        <path d="M12 4v4m0 8v4M4 12h4m8 0h4" />
      </svg>
    ),
    "Snacks": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    "Beverages": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="2" x2="6" y2="4" />
        <line x1="10" y1="2" x2="10" y2="4" />
        <line x1="14" y1="2" x2="14" y2="4" />
      </svg>
    ),
    "Desserts": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 2 4 10-4 10-4-10z" />
      </svg>
    ),
    "All": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    )
  };

  // Improved icon lookup (case-insensitive and trimmed)
  const getIcon = (cat) => {
    const normalized = String(cat || "").trim();
    return categoryIcons[normalized] || categoryIcons["All"];
  };

  // Filter out invalid/stray categories e.g. stray commas from data
  const validCategories = categories.filter(c => c && String(c).trim() && String(c).trim() !== ",");

  return (
    <section id="menu" className="menu-container-new">
      <aside className="menu-sidebar-sticky">
        <nav className="sidebar-nav">
          {validCategories.map((c) => (
            <button
              key={c}
              className={`sidebar-item ${category === c ? "active" : ""}`}
              onClick={() => setCategory(c)}
            >
              <div className="sidebar-icon-wrap">
                <span className="sidebar-icon">{getIcon(c)}</span>
                <span className="sidebar-label">{c}</span>
              </div>
            </button>
          ))}
        </nav>
      </aside>

      <main className="menu-content-new">
        <div className="menu-header-new">
          <div>
            <p className="kicker">{category === "All" ? "Kitchen spotlight" : category}</p>
            <h2>{category === "All" ? "Our Signature Menu" : `Best of ${category}`}</h2>
          </div>
          <div className="menu-search-new">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for dishes..."
            />
          </div>
        </div>

        <div className="menu-grid">
          {menu.map((item) => (
            <article className="dish-card" key={item.id}>
              <img className="dish-image" src={`${apiBase}${item.image}`} alt={item.name} />
              <div className="dish-body">
                <div className="dish-head">
                  <h4>{item.name}</h4>
                  <span className="rating">★ {item.rating}</span>
                </div>
                <p className="dish-desc">{item.description}</p>
                <div className="dish-meta">
                  <strong className="price">Rs {item.price}</strong>
                  <span className="prep">{item.prepMinutes} mins</span>
                </div>
                <CartQtyControl 
                  id={item.id} 
                  quantity={cart.items?.find(i => i.id === item.id)?.quantity || 0} 
                  updateQty={updateQty} 
                  addToCart={addToCart} 
                />
              </div>
            </article>
          ))}
        </div>
      </main>
    </section>
  );
}

function OrdersPage({ orders, openDetails, requestCancel, reorderOrder, updatedOrders, refreshOrders, beginPaymentForOrder, apiBase }) {
  return (
    <section id="orders" className="section container" style={{ paddingTop: "2rem" }}>
      <div className="section-head">
        <div>
          <p className="kicker">Track your food</p>
          <h2>Current & past orders</h2>
        </div>
        <button className="btn subtle" onClick={refreshOrders}>Refresh</button>
      </div>

      <div className="orders-shelf-container">
        <h3 className="shelf-title">Current Orders</h3>
        <OrderShelf 
          orders={orders.currentOrders || []} 
          apiBase={apiBase}
          openDetails={openDetails} 
          requestCancel={requestCancel} 
          reorderOrder={reorderOrder} 
          updatedOrders={updatedOrders}
          beginPaymentForOrder={beginPaymentForOrder}
          emptyMsg="No active orders at the moment."
        />
      </div>

      <div className="orders-shelf-container" style={{ marginTop: "2.5rem" }}>
        <h3 className="shelf-title">Past Orders</h3>
        <OrderShelf 
          orders={orders.pastOrders || []} 
          apiBase={apiBase}
          openDetails={openDetails} 
          requestCancel={null} 
          reorderOrder={reorderOrder} 
          updatedOrders={updatedOrders}
          emptyMsg="No past orders found."
        />
      </div>
    </section>
  );
}

function OrderShelf({ orders, openDetails, requestCancel, reorderOrder, updatedOrders, beginPaymentForOrder, emptyMsg, apiBase }) {
  const shelfRef = useRef(null);

  const scroll = (dir) => {
    if (!shelfRef.current) return;
    const amount = dir === "left" ? -320 : 320;
    shelfRef.current.scrollBy({ left: amount, behavior: "smooth" });
  };

  if (!orders.length) {
    return <p className="empty-orders">{emptyMsg}</p>;
  }

  return (
    <div className="shelf-wrapper">
      <button className="shelf-nav left" onClick={() => scroll("left")} aria-label="Scroll left">‹</button>
      <div className="order-shelf" ref={shelfRef}>
        {orders.map((o, idx) => (
          <div className="shelf-item" key={o.id} style={{ "--idx": idx }}>
            <OrderCard
              order={o}
              apiBase={apiBase}
              highlightType={updatedOrders[o.id] || ""}
              onDetails={() => openDetails(o.id)}
              onCancel={o.canCancel && requestCancel ? () => requestCancel(o.id) : null}
              onReorder={() => reorderOrder(o.id)}
              onPay={beginPaymentForOrder ? () => beginPaymentForOrder(o.id) : null}
            />
          </div>
        ))}
      </div>
      <button className="shelf-nav right" onClick={() => scroll("right")} aria-label="Scroll right">›</button>
    </div>
  );
}

function PaymentsPage({ orders, beginPaymentForOrder, openDetails, isPaying, refreshOrders, paymentSearch, setPaymentSearch, paymentFilter, setPaymentFilter, paymentPriceRange, setPaymentPriceRange, paymentSort, setPaymentSort, paymentDateSearch, setPaymentDateSearch }) {
  const allOrders = [...(orders.currentOrders || []), ...(orders.pastOrders || [])];
  
  const filteredPayments = allOrders
    .filter((order) => {
      // Only online payments
      if (!needsOnlinePayment(order.paymentMode)) return false;
      
      const status = String(order.paymentStatus || "").toLowerCase();
      const orderStatus = String(order.status || "").toLowerCase();
      const total = order.pricing?.total || 0;
      const createdAt = new Date(order.createdAt);
      
      // Filter by section
      if (paymentFilter === "pending") {
        if (status === "paid" || orderStatus === "cancelled") return false;
      } else if (paymentFilter === "completed") {
        if (status !== "paid") return false;
      }

      // Filter by Price Range
      if (paymentPriceRange !== "all") {
        if (paymentPriceRange === "under500" && total >= 500) return false;
        if (paymentPriceRange === "500-1000" && (total < 500 || total > 1000)) return false;
        if (paymentPriceRange === "1000-2500" && (total < 1000 || total > 2500)) return false;
        if (paymentPriceRange === "above2500" && total <= 2500) return false;
      }

      // Filter by Date Search (Calendar)
      if (paymentDateSearch) {
        const searchDate = new Date(paymentDateSearch).toLocaleDateString();
        const orderDate = createdAt.toLocaleDateString();
        if (searchDate !== orderDate) return false;
      }
      
      // Filter by search (Date string, ID or Amount)
      if (paymentSearch) {
        const s = paymentSearch.toLowerCase();
        const orderDateStr = createdAt.toLocaleDateString().toLowerCase();
        return (
          order.id.toLowerCase().includes(s) || 
          String(total).includes(s) ||
          orderDateStr.includes(s)
        );
      }
      
      return true;
    })
    .sort((a, b) => {
      if (paymentSort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (paymentSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (paymentSort === "priceHigh") return (b.pricing?.total || 0) - (a.pricing?.total || 0);
      if (paymentSort === "priceLow") return (a.pricing?.total || 0) - (b.pricing?.total || 0);
      return 0;
    });

  return (
    <section className="section container payments-center-new">
      <div className="section-head payments-header-new">
        <div>
          <p className="kicker">Secure payments</p>
          <h2>Payment Center</h2>
        </div>
      </div>

      <div className="payments-unified-bar">
        <div className="search-wrap-new">
          <input 
            value={paymentSearch} 
            onChange={(e) => setPaymentSearch(e.target.value)} 
            placeholder="Search ID, Date or Amount..." 
            className="payment-search-input"
          />
        </div>

        <div className="calendar-search-wrap">
          <input 
            type="date" 
            value={paymentDateSearch} 
            onChange={(e) => setPaymentDateSearch(e.target.value)}
            className="payment-date-input"
            title="Filter by specific date"
          />
          {paymentDateSearch && (
            <button className="clear-date-btn" onClick={() => setPaymentDateSearch("")}>×</button>
          )}
        </div>

        <CustomSelect 
          className="payment-price-filter"
          value={paymentPriceRange}
          onChange={(e) => setPaymentPriceRange(e.target.value)}
          options={[
            { value: "all", label: "All Prices" },
            { value: "under500", label: "Under Rs 500" },
            { value: "500-1000", label: "Rs 500 - 1000" },
            { value: "1000-2500", label: "Rs 1000 - 2500" },
            { value: "above2500", label: "Above Rs 2500" }
          ]}
        />

        <CustomSelect 
          className="payment-sort-filter"
          value={paymentSort}
          onChange={(e) => setPaymentSort(e.target.value)}
          options={[
            { value: "newest", label: "Newest First" },
            { value: "oldest", label: "Oldest First" },
            { value: "priceHigh", label: "Price: High to Low" },
            { value: "priceLow", label: "Price: Low to High" }
          ]}
        />

        <div className="status-toggle-wrap-new">
          <button className={`status-pill ${paymentFilter === 'pending' ? 'active' : ''}`} onClick={() => setPaymentFilter('pending')}>Pending</button>
          <button className={`status-pill ${paymentFilter === 'completed' ? 'active' : ''}`} onClick={() => setPaymentFilter('completed')}>Completed</button>
          <button className={`status-pill ${paymentFilter === 'all' ? 'active' : ''}`} onClick={() => setPaymentFilter('all')}>All</button>
        </div>
        
        <button className="btn subtle refresh-btn" onClick={refreshOrders} title="Refresh Payments">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        </button>
      </div>



      {!filteredPayments.length ? (
        <div className="empty-state-new">
          <p>No payments found matching your criteria.</p>
        </div>
      ) : (
        <div className="payments-grid-new">
          {filteredPayments.map((order) => (
            <article className={`payment-card-new ${String(order.paymentStatus || "").toLowerCase() === 'paid' ? 'paid' : ''}`} key={order.id} onClick={() => openDetails(order.id)}>
              <div className="payment-card-inner">
                <div className="order-tag">#{order.id}</div>
                <div className="payment-main">
                  <div className="payment-amount">
                    <span className="currency">Rs</span>
                    <span className="value">{order.pricing?.total || 0}</span>
                  </div>
                  <div className={`payment-status-tag ${String(order.paymentStatus || "").toLowerCase()}`}>
                    {order.paymentStatus || "Pending"}
                  </div>
                </div>
                <div className="payment-meta">
                  <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="payment-footer">
                  <button className="btn subtle small" onClick={() => openDetails(order.id)}>View Details</button>
                  {String(order.paymentStatus || "").toLowerCase() !== "paid" && String(order.status || "").toLowerCase() !== "cancelled" && (
                    <button className="btn accent small" disabled={isPaying} onClick={() => beginPaymentForOrder(order.id)}>
                      {isPaying ? "Wait..." : "Pay Now"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CheckoutPage(props) {
  return (
    <section className="section container">
      <div className="section-head"><h2>Checkout</h2></div>
      <div className="checkout-page-card">
        <CartBody {...props} />
      </div>
    </section>
  );
}

function CartBody({ cart, apiBase, updateQty, clearCart, offerCode, setOfferCode, applyOffer, couponBlink, showOffers, setShowOffers, offers, checkout, setCheckout, checkoutOrder, paymentConfig, isPaying, closeCart }) {
  return (
    <>
      <div className="cart-drawer-header">
        <div className="cart-header-title">
          <h3>Your Cart</h3>
          {cart.items?.length > 0 && (
            <button className="empty-cart-btn" onClick={clearCart}>
              Empty Cart
            </button>
          )}
        </div>
        <button className="close-btn" onClick={closeCart}>&times;</button>
      </div>

      <section className="cart-block">
        <p className="kicker">Items in cart</p>
        <div className="cart-items" style={{ maxHeight: "32vh" }}>
        {(cart.items || []).map((item) => (
          <div className="cart-item" key={item.id}>
            <img src={`${apiBase}${item.image}`} alt={item.name} />
            <div>
              <strong>{item.name}</strong>
              <p>Rs {item.price}</p>
              <div style={{ marginTop: '0.4rem', width: '100px' }}>
                <CartQtyControl 
                  id={item.id} 
                  quantity={item.quantity} 
                  updateQty={updateQty} 
                  addToCart={() => {}} 
                />
              </div>
            </div>
          </div>
        ))}
        {!cart.items?.length ? <p className="empty-orders">Your cart is empty. Add dishes from menu.</p> : null}
        </div>
      </section>
      <section className="cart-block">
      <h4>Coupons & offers</h4>
      <form
        className="offer-row"
        onSubmit={(e) => {
          e.preventDefault();
          applyOffer();
        }}
      >
        <input value={offerCode} onChange={(e) => setOfferCode(e.target.value)} placeholder="Apply offer code" />
        <button className={`btn accent ${couponBlink === "success" ? "apply-success-glow" : ""}`} type="submit">
          Apply
        </button>
      </form>
      <button className="btn subtle full" onClick={() => setShowOffers((s) => !s)}>{showOffers ? "Hide Offers" : "Avail Offers"}</button>
      {showOffers ? (
        <div className="checkout-offers-wrap">
          <p className="checkout-offers-title">Available offers at checkout</p>
          <div className="checkout-offer-grid">
          {offers.map((o) => (
            <article key={o.id} className="offer-card">
              <h4>{o.title}</h4>
              <p>{o.description}</p>
              <button className="offer-code" onClick={() => setOfferCode(o.code)}>{o.code}</button>
            </article>
          ))}
          </div>
        </div>
      ) : null}
      </section>
      <section className="cart-block">
      <h4>Price summary</h4>
      <div className="cart-pricing">
        <div className="price-row"><span>Subtotal</span><span>Rs {cart.pricing?.subtotal || 0}</span></div>
        <div className="price-row"><span>Discount</span><span>- Rs {cart.pricing?.discount || 0}</span></div>
        <div className="price-row"><span>Delivery Fee</span><span>Rs {cart.pricing?.deliveryFee || 0}</span></div>
        <div className="price-row"><span>Tax</span><span>Rs {cart.pricing?.tax || 0}</span></div>
        <div className="price-row total"><span>Total</span><span>Rs {cart.pricing?.total || 0}</span></div>
      </div>
      </section>
      <section className="cart-block">
      <h4>Delivery details</h4>
      <form
        className="checkout"
        onSubmit={(e) => {
          e.preventDefault();
          checkoutOrder();
        }}
      >
        <div className="checkout-field">
          <label>Full Name</label>
          <input placeholder="Enter your full name" value={checkout.name} onChange={(e) => setCheckout((c) => ({ ...c, name: e.target.value }))} />
        </div>
        <div className="checkout-field">
          <label>Phone Number</label>
          <input placeholder="e.g. +91 98765 00000" value={checkout.phone} onChange={(e) => setCheckout((c) => ({ ...c, phone: e.target.value }))} />
        </div>
        <div className="checkout-field">
          <label>Delivery Address</label>
          <textarea rows={3} placeholder="Flat/House No, Colony, City" value={checkout.address} onChange={(e) => setCheckout((c) => ({ ...c, address: e.target.value }))} />
        </div>
        <div className="checkout-field">
          <label>Payment Method</label>
          <CustomSelect 
            value={checkout.paymentMode} 
            onChange={(e) => setCheckout((c) => ({ ...c, paymentMode: e.target.value }))}
            options={[
              { value: "COD", label: "Cash on Delivery" },
              { value: "UPI", label: "UPI (Online)" }
            ]}
          />
        </div>
        {String(checkout.paymentMode).toUpperCase() !== "COD" ? (
          <small style={{ color: "#6c655f" }}>
            {String(checkout.paymentMode).toUpperCase() === "UPI"
              ? `Pay via UPI QR (${paymentConfig.currency})${paymentConfig.upiReceiverVpa ? ` to ${paymentConfig.upiReceiverVpa}` : ""}.`
              : `Secure checkout via ${paymentConfig.provider === "razorpay" ? "Razorpay" : "mock gateway"} (${paymentConfig.currency}).`}
          </small>
        ) : null}
        <button className="btn accent full" type="submit" disabled={isPaying}>{isPaying ? "Processing..." : "Checkout"}</button>
      </form>
      </section>
    </>
  );
}

function OrderCard({ order, onDetails, onCancel, onReorder, onPay, highlightType, apiBase }) {
  const itemCount = (order.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
  const cls = `order-card-sq ${highlightType ? `updated-${highlightType}` : ""}`;
  const statusClass = order.status === "Delivered" ? "done" : order.status === "Cancelled" ? "cancel" : "live";
  const canPay = order.paymentStatus === "Pending" && needsOnlinePayment(order.paymentMode);
  
  const dateStr = new Date(order.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const timeStr = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const displayItems = (order.items || []).slice(0, 4);
  const extraCount = Math.max(0, (order.items || []).length - 4);

  return (
    <article className={cls} onClick={onDetails} style={{ cursor: "pointer" }}>
      <div className="sq-card-inner">
        <div className="sq-status-bar">
          <span className={`sq-status-dot ${statusClass}`}></span>
          <span className="sq-status-text">{order.status}</span>
          <span className="sq-date">{dateStr}</span>
        </div>

        {/* Progress Bar */}
        <div className="sq-progress-container">
           <div className={`sq-progress-line ${statusClass}`}></div>
           <div className="sq-progress-steps">
              <div className={`sq-step ${['Confirmed', 'Preparing', 'Out for Delivery', 'Delivered'].indexOf(order.status) >= 0 ? 'active' : ''}`}></div>
              <div className={`sq-step ${['Preparing', 'Out for Delivery', 'Delivered'].indexOf(order.status) >= 0 ? 'active' : ''}`}></div>
              <div className={`sq-step ${['Out for Delivery', 'Delivered'].indexOf(order.status) >= 0 ? 'active' : ''}`}></div>
              <div className={`sq-step ${['Delivered'].indexOf(order.status) >= 0 ? 'active' : ''}`}></div>
           </div>
        </div>

        <div className="sq-item-avatars">

          {displayItems.map((item, i) => (
            <div 
              key={`${order.id}-item-${i}`} 
              className="sq-avatar-wrap"
              style={{ zIndex: 10 - i }}
              title={item.name}
            >
              <img src={`${apiBase}${item.image}`} alt={item.name} className="sq-avatar-img" />
              <span className="sq-tooltip">{item.name}</span>
            </div>
          ))}
          {extraCount > 0 && (
            <div className="sq-avatar-extra" style={{ zIndex: 5 }}>
              +{extraCount}
            </div>
          )}
        </div>

        
        <div className="sq-main">
          <div className="sq-order-id">#{order.id.slice(-6)}</div>
          <div className="sq-price">Rs {order.pricing?.total}</div>
          <div className="sq-items">{itemCount} items • {order.paymentMode}</div>
        </div>

        <div className="sq-footer">
           <div className="sq-actions">
              <button className="sq-btn primary" onClick={onDetails} title="View Details">Details</button>
              {canPay && <button className="sq-btn accent" onClick={onPay}>Pay</button>}
              <button className="sq-btn secondary" onClick={onReorder} title="Reorder Items">Reorder</button>
              {onCancel && <button className="sq-btn danger" onClick={onCancel}>Cancel Order</button>}
           </div>
        </div>
      </div>
    </article>
  );
}

function safeJson(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function needsOnlinePayment(mode) {
  const normalized = String(mode || "").trim().toUpperCase();
  return normalized === "UPI" || normalized === "CARD" || normalized === "NETBANKING" || normalized === "WALLET";
}

function loadStoredUser() {
  try {
    const raw = localStorage.getItem("ck_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadOrCreateSessionId() {
  const key = "ck_session_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `sess_${Math.random().toString(36).slice(2, 11)}`;
  localStorage.setItem(key, id);
  return id;
}
