import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";

export function CustomerApp() {
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
  const [user, setUser] = useState(loadStoredUser());
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderSupport, setOrderSupport] = useState([]);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "", email: "", name: "" });
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [cancelDraft, setCancelDraft] = useState({ open: false, orderId: "", reason: "Changed my mind" });
  const [supportDraft, setSupportDraft] = useState("");
  const [updatedOrders, setUpdatedOrders] = useState({});

  const sessionId = useMemo(loadOrCreateSessionId, []);
  const cartCount = useMemo(() => (cart.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0), [cart]);
  const navigate = useNavigate();
  const paymentResolveRef = useRef(null);

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!apiBase) return;
    loadMenu();
  }, [category, search, apiBase]);

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
      if (selectedOrder?.id) await loadSupport(selectedOrder.id);
      flash("Support ticket updated");
    });

    stream.addEventListener("cart_updated", async () => {
      await loadCart();
    });

    return () => stream.close();
  }, [apiBase, sessionId, selectedOrder?.id]);

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target;
      const tag = String(target?.tagName || "").toLowerCase();
      const isTextArea = tag === "textarea";
      if (event.key === "Escape") {
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
    const savedPhone = localStorage.getItem("ck_last_phone") || "";
    setCheckout((prev) => ({
      ...prev,
      name: prev.name || user?.name || "",
      phone: prev.phone || savedPhone
    }));
  }, [user?.name]);

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
      loadMenu(base),
      loadOffers(base),
      loadToday(base),
      loadCart(base),
      loadOrders(base)
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
      const data = await api(`/api/cart?sessionId=${encodeURIComponent(sessionId)}`, {}, base);
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

  async function applyOffer() {
    if (!offerCode.trim()) return;
    await api("/api/cart/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, offerCode: offerCode.trim() })
    });
    await loadCart();
    flash("Offer applied");
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
      
      // Load orders immediately with the new user data to avoid state lag
      await loadOrders(null, data.user);
      flash(`${authMode === "register" ? "Account created" : "Login successful"}`);
    } catch (error) {
      flash(error.message || "Authentication failed. Please try again.");
    } finally {
      setIsAuthLoading(false);
    }
  }

  function logout() {
    setUser(null);
    localStorage.removeItem("ck_user");
    flash("Logged out");
  }

  function requestCancel(orderId) {
    setCancelDraft({ open: true, orderId, reason: "Changed my mind" });
  }

  async function confirmCancel() {
    await api(`/api/orders/${cancelDraft.orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        userId: user?.id || "",
        phone: localStorage.getItem("ck_last_phone") || "",
        reason: cancelDraft.reason || "Cancelled by user"
      })
    });
    setCancelDraft({ open: false, orderId: "", reason: "Changed my mind" });
    await loadOrders();
    if (selectedOrder?.id) await openOrderDetails(selectedOrder.id);
    flash("Order cancelled");
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
          <Link className="brand" to="/">
            <img src={`${apiBase}/assets/logo-ck.png`} alt="CK logo" />
            <div><strong>Cloud Kitchen</strong><span>Startup Mode</span></div>
          </Link>
          <nav className="navlinks">
            <Link to="/menu">Menu</Link>
            <Link to="/specials">Specials</Link>
            <Link to="/orders">Orders</Link>
            <Link to="/payments">Payments</Link>
            <a href="#contact">Contact</a>
          </nav>
          <div className="topbar-actions">
            <button className="btn subtle" onClick={() => navigate("/orders")}>My Orders</button>
            <button className="btn subtle" onClick={() => (user ? logout() : setShowAuth(true))}>{user ? `Hi, ${user.name?.split(" ")[0]}` : "Sign in"}</button>
            <button className="btn accent" onClick={() => setShowCart(true)}>Cart {cartCount}</button>
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
                cart={cart}
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
                openDetails={openOrderDetails}
                requestCancel={requestCancel}
                reorderOrder={reorderOrder}
                updatedOrders={updatedOrders}
                refreshOrders={loadOrders}
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
                paymentConfig={paymentConfig}
                isPaying={isPaying}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer id="contact" className="footer container">
        <div>
          <strong>Cloud Kitchen</strong>
          <p>Sector 17, Chandigarh</p>
        </div>
        <div>
          <p>Open daily: 10:00 AM - 11:30 PM</p>
          <p>Support: +91 98765 00000</p>
        </div>
      </footer>

      {showCart ? (
        <>
          <aside className="cart-panel open">
            <div className="cart-header">
              <h3>Your Cart</h3>
              <button className="icon-btn" onClick={() => setShowCart(false)}>X</button>
            </div>
            <CartBody
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
              paymentConfig={paymentConfig}
              isPaying={isPaying}
            />
          </aside>
          <div className="backdrop show" onClick={() => setShowCart(false)} />
        </>
      ) : null}

      {showAuth ? (
        <div className="backdrop show" onClick={() => (isAuthLoading ? null : setShowAuth(false))}>
          <div className="modal auth-modal" onClick={(e) => e.stopPropagation()}>
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
                onSubmit={(e) => {
                  e.preventDefault();
                  submitAuth();
                }}
              >
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
                  {authMode === "login" ? "Don't have an account?" : "Already have an account?"}
                  <button type="button" className="text-btn" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
                    {authMode === "login" ? "Register here" : "Sign in here"}
                  </button>
                </p>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {selectedOrder ? (
        <div className="backdrop show" onClick={() => setSelectedOrder(null)}>
          <div className="modal order-modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h3>Order {selectedOrder.id}</h3>
              <button className="btn subtle" onClick={() => setSelectedOrder(null)}>Close</button>
            </div>
            <div className={`detail ${updatedOrders[selectedOrder.id] ? "updated" : ""}`}>
              <p><strong>Status:</strong> {selectedOrder.status}</p>
              <p><strong>Payment:</strong> {selectedOrder.paymentMode} ({selectedOrder.paymentStatus || "Pending"})</p>
              <p><strong>Total:</strong> Rs {selectedOrder.pricing?.total}</p>
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
                {(selectedOrder.statusHistory || []).map((entry, idx) => (
                  <li key={`${entry.status}-${idx}`}>
                    <strong>{entry.status}</strong> - {new Date(entry.at).toLocaleString()}{entry.note ? ` (${entry.note})` : ""}
                  </li>
                ))}
              </ul>
            </div>
            <div className="detail">
              <strong>Payment Attempts</strong>
              <ul>
                {(selectedOrder.paymentTransactions || []).length ? (
                  (selectedOrder.paymentTransactions || []).map((txn) => (
                    <li key={txn.id}>
                      <strong>{txn.provider?.toUpperCase() || "N/A"}</strong> - {txn.status} | Rs {txn.amount} {txn.currency} | {new Date(txn.createdAt).toLocaleString()}
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
                      <p><strong>{ticket.id}</strong> | {ticket.status} | {new Date(ticket.createdAt).toLocaleString()}</p>
                      <p>{ticket.message}</p>
                      <div>
                        {(ticket.replies || []).map((reply, idx) => (
                          <p key={`${ticket.id}-${idx}`}><strong>{reply.authorType === "admin" ? "Manager" : "You"}:</strong> {reply.message} ({new Date(reply.at).toLocaleString()})</p>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <div className="checkout" style={{ marginTop: "0.5rem" }}>
                <textarea rows={2} placeholder="Write your issue" value={supportDraft} onChange={(e) => setSupportDraft(e.target.value)} />
                <button className="btn subtle" onClick={() => raiseSupport(selectedOrder.id)}>Send Query</button>
              </div>
            </div>
            <div className="actions-row">
              <button className="btn subtle" disabled={!selectedOrder.canCancel} onClick={() => requestCancel(selectedOrder.id)}>
                {selectedOrder.canCancel ? "Cancel Order" : "Cancellation Closed"}
              </button>
              {selectedOrder.paymentStatus === "Pending" && needsOnlinePayment(selectedOrder.paymentMode) ? (
                <button className="btn subtle" disabled={isPaying} onClick={() => beginPaymentForOrder(selectedOrder.id)}>{isPaying ? "Processing..." : "Pay Now"}</button>
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
        <div className="backdrop show" onClick={() => setCancelDraft({ open: false, orderId: "", reason: "Changed my mind" })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Cancel order?</h3>
            <p>This action updates customer timeline immediately.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                confirmCancel();
              }}
            >
              <textarea rows={3} value={cancelDraft.reason} onChange={(e) => setCancelDraft((p) => ({ ...p, reason: e.target.value }))} />
              <div className="actions-row">
                <button type="button" className="btn subtle" onClick={() => setCancelDraft({ open: false, orderId: "", reason: "Changed my mind" })}>Keep Order</button>
                <button type="submit" className="btn accent">Confirm Cancel</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {paymentPortal.open ? (
        <div className="backdrop show" onClick={cancelMockPayment}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Payment Portal</h3>
            <p><strong>Order:</strong> {paymentPortal.orderId}</p>
            <p><strong>Provider:</strong> {paymentPortal.session?.provider === "upi_qr" ? "UPI QR" : "Mock Gateway"}</p>
            <p><strong>Amount:</strong> Rs {Number(paymentPortal.session?.amountPaise || 0) / 100}</p>
            {paymentPortal.session?.provider === "upi_qr" ? (
              <>
                <p>Scan this QR in any UPI app and complete the payment, then enter UTR/reference below.</p>
                {paymentPortal.session?.qrImageUrl ? (
                  <div style={{ display: "flex", justifyContent: "center", margin: "0.7rem 0" }}>
                    <img src={paymentPortal.session.qrImageUrl} alt="UPI QR" style={{ width: "220px", height: "220px", borderRadius: "12px", border: "1px solid #efe3d5" }} />
                  </div>
                ) : null}
                <p><strong>Payee:</strong> {paymentPortal.session?.payee || paymentConfig.upiReceiverName}</p>
                <p><strong>VPA:</strong> {paymentPortal.session?.vpa || paymentConfig.upiReceiverVpa || "Not configured"}</p>
                {paymentPortal.session?.upiUri ? (
                  <p>
                    <a className="btn subtle" href={paymentPortal.session.upiUri}>Open UPI App</a>
                  </p>
                ) : null}
                <input
                  placeholder="Enter UTR / Transaction Reference"
                  value={upiReference}
                  onChange={(e) => setUpiReference(e.target.value)}
                />
              </>
            ) : (
              <p>This simulates a real payment gateway. Confirm to mark payment successful.</p>
            )}
            {paymentPortal.error ? <p style={{ color: "#b3261e" }}>{paymentPortal.error}</p> : null}
            <div className="actions-row">
              <button className="btn subtle" disabled={paymentPortal.processing} onClick={cancelMockPayment}>Cancel Payment</button>
              <button className="btn subtle" disabled={paymentPortal.processing} onClick={failMockPayment}>Simulate Failure</button>
              <button className="btn accent" disabled={paymentPortal.processing} onClick={confirmMockPayment}>{paymentPortal.processing ? "Processing..." : paymentPortal.session?.provider === "upi_qr" ? "I Have Paid" : "Pay Securely"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HomePage({ apiBase, todaysSpecial, addToCart }) {
  return (
    <section id="home" className="hero container">
      <div className="hero-copy">
        <p className="kicker">Fast delivery. Premium flavor.</p>
        <h1>Freshly cooked food for every craving.</h1>
        <p>
          Built from your Figma references and fully connected end-to-end.
          Browse, add to cart, apply offers, and place orders in one flow.
        </p>
        <div className="hero-actions">
          <Link className="btn accent" to="/menu">Order now</Link>
          <Link className="btn subtle" to="/checkout">See deals</Link>
        </div>
      </div>
      <div className="hero-visual">
        <img className="hero-bg" src={`${apiBase}/assets/hero-bg.png`} alt="Decorative food background" />
        <img className="hero-main" src={`${apiBase}/assets/hero-bowl.png`} alt="Main dish" />
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
      <div className="specials-layout">
        <article className="chef-special-redesign">
          <img src={`${apiBase}/assets/feature-biryani.jpg`} alt="Chef special dish" />
          <div className="chef-content">
            <p className="kicker">Chef's curated plate</p>
            <h3>Royal Pot Biryani</h3>
            <p>Layered saffron rice, roasted vegetables, and aromatic spices in our signature dum finish. Balanced heat, rich aroma, and quick delivery.</p>
            <div className="special-meta">
              <span>Prep: 26 mins</span>
              <span>Rating: 4.8</span>
              <span>Pure Veg</span>
            </div>
            <button className="btn accent" onClick={() => addToCart("dish-001")}>Add to cart</button>
          </div>
        </article>
        <article className="today-special-card">
          <p className="kicker">Auto updates daily</p>
          <h3>{todaysSpecial?.name || "Today's Special"}</h3>
          <p>{todaysSpecial?.description || "No special available right now."}</p>
          <div className="today-special-details">
            <span>Rs {todaysSpecial?.price ?? "--"}</span>
            <span>{todaysSpecial?.category || "Category --"}</span>
          </div>
          <div className="today-special-image-wrap">
            <img src={todaysSpecial ? `${apiBase}${todaysSpecial.image}` : `${apiBase}/assets/feature-biryani.jpg`} alt={todaysSpecial?.name || "Today's special item"} />
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
      <MenuPage
        menu={props.menu}
        categories={props.categories}
        search={props.search}
        setSearch={props.setSearch}
        category={props.category}
        setCategory={props.setCategory}
        addToCart={props.addToCart}
        apiBase={props.apiBase}
      />
      <SpecialsPage apiBase={props.apiBase} todaysSpecial={props.todaysSpecial} addToCart={props.addToCart} />
    </>
  );
}

function MenuPage({ menu, categories, search, setSearch, category, setCategory, addToCart, apiBase }) {
  return (
    <section id="menu" className="section container">
      <div className="section-head">
        <div>
          <p className="kicker">Popular this week</p>
          <h2>Menu</h2>
        </div>
        <div className="menu-tools">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search dishes..." />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="menu-grid">
        {menu.map((item) => (
          <article className="dish-card" key={item.id}>
            <img className="dish-image" src={`${apiBase}${item.image}`} alt={item.name} />
            <div className="dish-body">
              <div className="dish-head"><h4>{item.name}</h4><span className="rating">* {item.rating}</span></div>
              <p className="dish-desc">{item.description}</p>
              <div className="dish-meta"><strong className="price">Rs {item.price}</strong><span className="prep">{item.prepMinutes} mins</span></div>
              <button className="btn accent" onClick={() => addToCart(item.id)}>Add to cart</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function OrdersPage({ orders, openDetails, requestCancel, reorderOrder, updatedOrders, refreshOrders }) {
  return (
    <section id="orders" className="section container">
      <div className="section-head"><div><p className="kicker">Track your food</p><h2>Current & past orders</h2></div><button className="btn subtle" onClick={refreshOrders}>Refresh</button></div>
      <div className="orders-layout">
        <div>
          <h3>Current Orders</h3>
          {(orders.currentOrders || []).map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              highlightType={updatedOrders[o.id] || ""}
              onDetails={() => openDetails(o.id)}
              onCancel={o.canCancel ? () => requestCancel(o.id) : null}
              onReorder={() => reorderOrder(o.id)}
            />
          ))}
        </div>
        <div>
          <h3>Past Orders</h3>
          {(orders.pastOrders || []).map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              highlightType={updatedOrders[o.id] || ""}
              onDetails={() => openDetails(o.id)}
              onCancel={null}
              onReorder={() => reorderOrder(o.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function PaymentsPage({ orders, beginPaymentForOrder, openDetails, isPaying, refreshOrders }) {
  const allOrders = [...(orders.currentOrders || []), ...(orders.pastOrders || [])];
  const pendingPayments = allOrders
    .filter((order) => needsOnlinePayment(order.paymentMode) && String(order.paymentStatus || "").toLowerCase() !== "paid" && String(order.status || "").toLowerCase() !== "cancelled")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <section className="section container">
      <div className="section-head">
        <div>
          <p className="kicker">Secure payments</p>
          <h2>Payment Center</h2>
        </div>
        <button className="btn subtle" onClick={refreshOrders}>Refresh</button>
      </div>
      {!pendingPayments.length ? (
        <p className="empty-orders">No pending online payments. You are all set.</p>
      ) : (
        <div className="payments-grid">
          {pendingPayments.map((order) => (
            <article className="order-card" key={order.id}>
              <div className="order-top">
                <strong>{order.id}</strong>
                <span className="order-status live">{order.paymentStatus || "Pending"}</span>
              </div>
              <p><strong>Amount due:</strong> Rs {order.pricing?.total || 0}</p>
              <p><strong>Mode:</strong> {order.paymentMode}</p>
              <p><strong>Ordered:</strong> {new Date(order.createdAt).toLocaleString()}</p>
              <div className="order-actions">
                <button className="btn subtle" disabled={isPaying} onClick={() => beginPaymentForOrder(order.id)}>{isPaying ? "Processing..." : "Pay Now"}</button>
                <button className="btn subtle" onClick={() => openDetails(order.id)}>View Details</button>
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

function CartBody({ cart, apiBase, updateQty, offerCode, setOfferCode, applyOffer, showOffers, setShowOffers, offers, checkout, setCheckout, checkoutOrder, paymentConfig, isPaying }) {
  return (
    <>
      <section className="cart-block">
        <h4>Items in cart</h4>
        <div className="cart-items" style={{ maxHeight: "32vh" }}>
        {(cart.items || []).map((item) => (
          <div className="cart-item" key={item.id}>
            <img src={`${apiBase}${item.image}`} alt={item.name} />
            <div>
              <strong>{item.name}</strong>
              <p>Rs {item.price}</p>
              <div className="qty-row">
                <button onClick={() => updateQty(item.id, item.quantity - 1)}>-</button>
                <span>{item.quantity}</span>
                <button onClick={() => updateQty(item.id, item.quantity + 1)}>+</button>
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
        <button className="btn subtle" type="submit">Apply</button>
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
        <input placeholder="Full name" value={checkout.name} onChange={(e) => setCheckout((c) => ({ ...c, name: e.target.value }))} />
        <input placeholder="Phone" value={checkout.phone} onChange={(e) => setCheckout((c) => ({ ...c, phone: e.target.value }))} />
        <textarea rows={2} placeholder="Address" value={checkout.address} onChange={(e) => setCheckout((c) => ({ ...c, address: e.target.value }))} />
        <select value={checkout.paymentMode} onChange={(e) => setCheckout((c) => ({ ...c, paymentMode: e.target.value }))}>
          <option value="COD">Cash on Delivery</option>
          <option value="UPI">UPI (Online)</option>
          <option value="CARD">Card (Online)</option>
        </select>
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

function OrderCard({ order, onDetails, onCancel, onReorder, highlightType }) {
  const itemCount = (order.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
  const cls = `order-card ${highlightType ? `updated-${highlightType}` : ""}`;
  const statusClass = order.status === "Delivered" ? "done" : order.status === "Cancelled" ? "cancel" : "live";
  return (
    <article className={cls}>
      <div className="order-top"><strong>{order.id}</strong><span className={`order-status ${statusClass}`}>{order.status}</span></div>
      <p>{itemCount} item(s) | Rs {order.pricing?.total} | {order.paymentMode}</p>
      <p>Payment: {order.paymentStatus || "Pending"}</p>
      <p>{new Date(order.createdAt).toLocaleString()}</p>
      <div className="order-actions">
        <button className="btn subtle" onClick={onDetails}>Details</button>
        {onCancel ? <button className="btn subtle" onClick={onCancel}>Cancel</button> : null}
        <button className="btn subtle" onClick={onReorder}>Reorder</button>
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
