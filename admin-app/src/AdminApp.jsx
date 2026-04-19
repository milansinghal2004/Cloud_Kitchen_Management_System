import { useEffect, useMemo, useState } from "react";

const STATUS_OPTIONS = ["Confirmed", "Preparing", "Out for Delivery", "Delivered", "Cancelled"];
const VIEWS = {
  TODAY: "today",
  PAST_ORDERS: "past-orders",
  PAST_TICKETS: "past-tickets",
  ANALYTICS: "analytics"
};

export function AdminApp() {
  const [adminKey, setAdminKey] = useState(localStorage.getItem("ck_admin_key") || "");
  const [adminUser] = useState(localStorage.getItem("ck_admin_user") || "");
  const [notice, setNotice] = useState("");
  const [metrics, setMetrics] = useState({});
  const [orders, setOrders] = useState([]);
  const [chefs, setChefs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [ticketStatus, setTicketStatus] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [activeOrder, setActiveOrder] = useState(null);
  const [itemChefMap, setItemChefMap] = useState({});
  const [itemAssignGlow, setItemAssignGlow] = useState({});
  const [authRequired, setAuthRequired] = useState(!localStorage.getItem("ck_admin_key"));
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [apiBase, setApiBase] = useState(window.location.origin);
  const [view, setView] = useState(() => {
    try {
      const url = new URL(window.location.href);
      const v = String(url.searchParams.get("view") || "").trim().toLowerCase();
      if (v === VIEWS.PAST_ORDERS) return VIEWS.PAST_ORDERS;
      if (v === VIEWS.PAST_TICKETS) return VIEWS.PAST_TICKETS;
      if (v === VIEWS.ANALYTICS) return VIEWS.ANALYTICS;
      return VIEWS.TODAY;
    } catch {
      return VIEWS.TODAY;
    }
  });
  const [pastPreset, setPastPreset] = useState("last7");
  const [pastFrom, setPastFrom] = useState("");
  const [pastTo, setPastTo] = useState("");
  const [analyticsPreset, setAnalyticsPreset] = useState("last7");
  const [analyticsFrom, setAnalyticsFrom] = useState("");
  const [analyticsTo, setAnalyticsTo] = useState("");
  const [analytics, setAnalytics] = useState(null);

  const onDutyChefs = useMemo(() => chefs.filter((c) => c.isOnDuty), [chefs]);
  const activeChefs = useMemo(() => chefs.filter((c) => c.isActive !== false), [chefs]);

  const todaysOrders = useMemo(() => orders.filter((o) => isToday(o.createdAt)), [orders]);
  const pastOrders = useMemo(() => orders.filter((o) => !isToday(o.createdAt)), [orders]);
  const todaysTickets = useMemo(() => tickets.filter((t) => isToday(t.createdAt)), [tickets]);
  const pastTickets = useMemo(() => tickets.filter((t) => !isToday(t.createdAt)), [tickets]);

  const pastRange = useMemo(() => computePastRange(pastPreset, pastFrom, pastTo), [pastPreset, pastFrom, pastTo]);
  const filteredPastOrders = useMemo(
    () =>
      pastOrders
        .filter((o) => isWithinRange(o.createdAt, pastRange))
        .filter((o) => {
          const q = String(orderSearch || "").trim().toLowerCase();
          if (!q) return true;
          const hay = `${o.id} ${o.customerName || ""} ${o.customerPhone || ""}`.toLowerCase();
          return hay.includes(q);
        }),
    [pastOrders, pastRange, orderSearch]
  );
  const filteredPastTickets = useMemo(
    () =>
      pastTickets
        .filter((t) => isWithinRange(t.createdAt, pastRange))
        .filter((t) => {
          const q = String(ticketSearch || "").trim().toLowerCase();
          if (!q) return true;
          const hay = `${t.id} ${t.orderId || ""} ${t.customerName || ""} ${t.customerPhone || ""} ${t.message || ""}`.toLowerCase();
          return hay.includes(q);
        }),
    [pastTickets, pastRange, ticketSearch]
  );

  useEffect(() => {
    resolveApiBase();
  }, []);

  useEffect(() => {
    if (!adminKey) {
      setAuthRequired(true);
      return;
    }
    if (!apiBase) return;
    setAuthRequired(false);
    refreshAll();
    const timer = setInterval(refreshAll, 15000);
    return () => clearInterval(timer);
  }, [adminKey, apiBase, statusFilter, orderSearch, ticketStatus, ticketSearch]);

  useEffect(() => {
    // keep URL shareable without adding a full router
    try {
      const url = new URL(window.location.href);
      if (view === VIEWS.TODAY) url.searchParams.delete("view");
      else url.searchParams.set("view", view);
      window.history.replaceState({}, "", url.toString());
    } catch {
      // no-op
    }
  }, [view]);

  useEffect(() => {
    if (!adminKey || !apiBase) return;
    if (view !== VIEWS.ANALYTICS) return;
    loadAnalytics();
  }, [view, adminKey, apiBase, analyticsPreset, analyticsFrom, analyticsTo]);

  useEffect(() => {
    if (!activeOrder) return;
    const nextMap = {};
    for (const item of activeOrder.items || []) {
      nextMap[item.id] = item.assignedChef?.chefId || "";
    }
    setItemChefMap(nextMap);
  }, [activeOrder, activeChefs]);

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target;
      const tag = String(target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || tag === "select" || Boolean(target?.isContentEditable);

      if (event.key === "Escape" && activeOrder) {
        event.preventDefault();
        setActiveOrder(null);
        return;
      }

      if (event.altKey && event.key === "1") {
        event.preventDefault();
        document.getElementById("overview")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (event.altKey && event.key === "2") {
        event.preventDefault();
        document.getElementById("orders")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (event.altKey && event.key === "3") {
        event.preventDefault();
        document.getElementById("chefs")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (event.altKey && event.key === "4") {
        event.preventDefault();
        document.getElementById("tickets")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (event.altKey && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        refreshAll();
        return;
      }

      if (activeOrder && event.key === "Enter" && tag === "select" && target?.dataset?.itemId) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        assignChefToItem(activeOrder.id, itemId);
        return;
      }

      if (isTyping) return;
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeOrder, itemChefMap, adminKey, apiBase, statusFilter, orderSearch, ticketStatus, ticketSearch]);

  async function resolveApiBase() {
    const envBase = import.meta.env.VITE_API_BASE;
    const uniqueCandidates = [...new Set([envBase, window.location.origin, "http://localhost:3001", "http://localhost:3000"].filter(Boolean))];
    for (const base of uniqueCandidates) {
      try {
        const res = await fetch(`${base}/api/admin/tickets`, {
          method: "GET",
          headers: { "x-admin-key": localStorage.getItem("ck_admin_key") || "probe-key" }
        });
        if (res.status === 200 || res.status === 401) {
          setApiBase(base);
          return base;
        }
      } catch {
        // Try next candidate
      }
    }
    setApiBase(window.location.origin);
    return window.location.origin;
  }

  async function api(path, options = {}) {
    const url = path.startsWith("http") ? path : `${apiBase}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
        ...(options.headers || {})
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Request failed");
    return data;
  }

  async function loadAnalytics() {
    try {
      const range = computePastRange(analyticsPreset, analyticsFrom, analyticsTo);
      const q = new URLSearchParams();
      if (range?.from) q.set("from", range.from.toISOString());
      if (range?.to) q.set("to", range.to.toISOString());
      const data = await api(`/api/admin/analytics?${q.toString()}`);
      setAnalytics(data);
      setNotice("Analytics updated.");
    } catch (error) {
      setAnalytics(null);
      setNotice(`Unable to load analytics: ${error.message}`);
    }
  }

  async function refreshAll() {
    try {
      const orderParams = new URLSearchParams();
      if (statusFilter) orderParams.set("status", statusFilter);
      if (orderSearch) orderParams.set("search", orderSearch);

      const ticketParams = new URLSearchParams();
      if (ticketStatus) ticketParams.set("status", ticketStatus);
      if (ticketSearch) ticketParams.set("search", ticketSearch);

      const [overview, ordersData, chefsData, ticketsData] = await Promise.all([
        api("/api/admin/overview"),
        api(`/api/admin/orders?${orderParams.toString()}`),
        api("/api/admin/chefs"),
        api(`/api/admin/tickets?${ticketParams.toString()}`)
      ]);

      setMetrics(overview.metrics || {});
      setOrders(ordersData.orders || []);
      setChefs(chefsData.chefs || []);
      setTickets(ticketsData.tickets || []);
      setNotice("Dashboard synced.");
    } catch (error) {
      if (String(error.message || "").toLowerCase().includes("invalid admin key")) {
        localStorage.removeItem("ck_admin_key");
        localStorage.removeItem("ck_admin_user");
        setAdminKey("");
        setAuthRequired(true);
        return;
      }
      setNotice(`Unable to sync dashboard: ${error.message}`);
    }
  }

  async function openOrder(orderId) {
    try {
      const data = await api(`/api/orders/${orderId}`);
      setActiveOrder(data.order || null);
    } catch (error) {
      setNotice(error.message || "Unable to load order.");
    }
  }

  async function updateOrderStatus(orderId, status, note = "Updated by manager dashboard") {
    try {
      await api(`/api/admin/orders/${orderId}/status`, {
        method: "POST",
        body: JSON.stringify({ status, note })
      });
      setNotice(`Order ${orderId} -> ${status}`);
      await refreshAll();
      if (activeOrder?.id === orderId) await openOrder(orderId);
    } catch (error) {
      setNotice(error.message || "Status update failed.");
    }
  }

  async function verifyOrderPayment(orderId, approve = true) {
    try {
      await api(`/api/admin/orders/${orderId}/payment-verify`, {
        method: "POST",
        body: JSON.stringify({
          approve,
          note: approve ? "Verified by manager from dashboard." : "Rejected by manager from dashboard."
        })
      });
      setNotice(approve ? `Payment verified for ${orderId}.` : `Payment rejected for ${orderId}.`);
      await refreshAll();
      if (activeOrder?.id === orderId) await openOrder(orderId);
    } catch (error) {
      setNotice(error.message || "Payment verification failed.");
    }
  }

  async function updateCodPaymentStatus(orderId, paymentStatus) {
    try {
      const paymentRef = paymentStatus === "Paid" ? `COD-${Date.now()}` : "";
      await api(`/api/admin/orders/${orderId}/payment-status`, {
        method: "POST",
        body: JSON.stringify({ paymentStatus, paymentRef })
      });
      setNotice(`Payment status updated: ${paymentStatus}`);
      await refreshAll();
      if (activeOrder?.id === orderId) await openOrder(orderId);
    } catch (error) {
      setNotice(error.message || "Payment status update failed.");
    }
  }

  async function assignChefToItem(orderId, itemId) {
    const chefId = itemChefMap[itemId];
    if (!chefId) return setNotice("Select a chef first.");
    try {
      await api(`/api/admin/orders/${orderId}/items/${itemId}/assign-chef`, {
        method: "POST",
        body: JSON.stringify({ chefId })
      });
      setNotice("Item chef assigned.");
      setItemAssignGlow((prev) => ({ ...prev, [itemId]: true }));
      setTimeout(() => {
        setItemAssignGlow((prev) => ({ ...prev, [itemId]: false }));
      }, 1600);
      await refreshAll();
      await openOrder(orderId);
    } catch (error) {
      setNotice(error.message || "Item assignment failed.");
    }
  }

  async function toggleDuty(chefId) {
    try {
      const data = await api(`/api/admin/chefs/${chefId}/toggle-duty`, { method: "POST" });
      setNotice(`Chef ${data.chef.name} duty updated.`);
      await refreshAll();
    } catch (error) {
      setNotice(error.message || "Chef update failed.");
    }
  }

  async function replyTicket(ticketId, closeTicket) {
    const message = prompt(
      closeTicket ? "Closing reply:" : "Reply to customer:",
      closeTicket ? "Issue resolved. Thank you." : "We are checking this right away."
    );
    if (!message) return;
    try {
      await api(`/api/admin/tickets/${ticketId}/reply`, {
        method: "POST",
        body: JSON.stringify({ message, closeTicket, adminName: adminUser || "manager" })
      });
      setNotice(`Ticket ${ticketId} updated.`);
      await refreshAll();
    } catch (error) {
      setNotice(error.message || "Ticket reply failed.");
    }
  }

  function logout() {
    localStorage.removeItem("ck_admin_key");
    localStorage.removeItem("ck_admin_user");
    setAdminKey("");
    setAuthRequired(true);
  }

  async function loginFromReact(event) {
    event.preventDefault();
    const username = loginUsername.trim();
    const password = loginPassword;
    if (!username || !password) {
      setLoginNotice("Enter username and password.");
      return;
    }
    setIsLoggingIn(true);
    setLoginNotice("");
    try {
      const detectedBase = await resolveApiBase();
      const res = await fetch(`${detectedBase}/api/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginNotice(data.message || "Admin login failed.");
        return;
      }
      localStorage.setItem("ck_admin_key", data.adminKey);
      localStorage.setItem("ck_admin_user", data.admin?.username || username);
      setAdminKey(data.adminKey);
      setAuthRequired(false);
      setLoginPassword("");
      setLoginNotice("Login successful.");
    } catch {
      setLoginNotice("Unable to reach backend. Ensure Postgres server is running.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  if (authRequired) {
    return (
      <div className="admin-root">
        <div className="container" style={{ paddingTop: "3rem" }}>
          <article className="kpi-card" style={{ maxWidth: "560px" }}>
            <h2 style={{ marginTop: 0 }}>Admin Session Required</h2>
            <p style={{ marginBottom: "1rem" }}>Login here to continue on React admin dashboard.</p>
            <form onSubmit={loginFromReact} className="order-filters" style={{ marginBottom: "0.7rem" }}>
              <input
                type="text"
                placeholder="Manager username"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
              />
              <input
                type="password"
                placeholder="Manager password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
              <button className="btn accent" type="submit" disabled={isLoggingIn}>
                {isLoggingIn ? "Logging in..." : "Admin Login"}
              </button>
            </form>
            <p style={{ margin: 0, color: loginNotice.toLowerCase().includes("successful") ? "#2a6a2a" : "#7a3b1c" }}>{loginNotice}</p>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-root">
      <header className="topbar">
        <div className="topbar-inner container">
          <a className="brand" href="#">
            <img src="/assets/logo-ck.png" alt="CK logo" />
            <div>
              <strong>Cloud Kitchen Admin</strong>
              <span>Kitchen Manager Panel</span>
            </div>
          </a>
          <nav className="navlinks">
            <button
              type="button"
              className="btn subtle"
              onClick={() => {
                setView(VIEWS.TODAY);
                document.getElementById("overview")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Today
            </button>
            <button
              type="button"
              className="btn subtle"
              onClick={() => {
                setView(VIEWS.PAST_ORDERS);
                document.getElementById("past-orders")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Past Orders
            </button>
            <button
              type="button"
              className="btn subtle"
              onClick={() => {
                setView(VIEWS.PAST_TICKETS);
                document.getElementById("past-tickets")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Past Tickets
            </button>
            <button
              type="button"
              className="btn subtle"
              onClick={() => {
                setView(VIEWS.ANALYTICS);
                document.getElementById("analytics")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Analytics
            </button>
          </nav>
          <div className="topbar-actions">
            <span className="chip">Manager: {adminUser || "manager"}</span>
            <a className="btn subtle" href="/customer-react/">Customer Site</a>
            <button className="btn subtle" onClick={logout}>Logout</button>
          </div>
        </div>
      </header>

      <main className="container admin-main">
        <section className="section" id="overview">
          <div className="section-head">
            <div>
              <p className="kicker">Operations</p>
              <h2>{view === VIEWS.TODAY ? "Kitchen Dashboard (Today)" : "Kitchen Dashboard"}</h2>
            </div>
            <button className="btn accent" onClick={refreshAll}>Refresh</button>
          </div>
          <div className="admin-notice">{notice}</div>
          <div className="kpi-grid">
            <Kpi title="Today's Orders" value={metrics.total_orders || 0} />
            <Kpi title="Active Orders" value={metrics.active_orders || 0} />
            <Kpi title="Delivered Today" value={metrics.delivered_orders || 0} />
            <Kpi title="Cancelled Today" value={metrics.cancelled_orders || 0} />
            <Kpi title="Pending Payments" value={metrics.pending_payments || 0} />
            <Kpi title="Pending Verification" value={metrics.pending_verifications || 0} />
            <Kpi title="Revenue Today" value={`Rs ${metrics.gross_revenue || 0}`} />
            <Kpi title="Chefs On Duty" value={`${metrics.on_duty_chefs || 0}/${metrics.total_chefs || 0}`} />
            <Kpi title="Open Tickets" value={metrics.open_tickets || 0} />
          </div>
        </section>

        {view === VIEWS.TODAY ? (
          <section className="section" id="orders">
            <div className="section-head">
              <div>
                <p className="kicker">Live queue</p>
                <h2>Today’s Orders</h2>
              </div>
              <div className="order-filters">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <input
                  type="search"
                  placeholder="Search by order/customer/phone"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                />
                <button className="btn subtle" type="button" onClick={() => setView(VIEWS.PAST_ORDERS)}>
                  View past orders
                </button>
              </div>
            </div>
            <div className="admin-orders-grid">
              {!todaysOrders.length ? <p>No orders found for today.</p> : todaysOrders.map((order) => (
                <article className="admin-order-card" key={order.id}>
                  <h4>{order.id}</h4>
                  <p><span className="chip">{order.status}</span> <span className="chip">{order.paymentStatus || "Pending"}</span></p>
                  <p>{order.customerName} ({order.customerPhone})</p>
                  <p>Total: Rs {order.total} | {fmt(order.createdAt)}</p>
                  <p>Chef: {order.assignedChef?.name || "Not assigned"}</p>
                  <p>Item assignments: {order.assignedItems || 0}/{order.totalItems || 0}</p>
                  <div className="admin-order-actions">
                    <button className="btn subtle" onClick={() => openOrder(order.id)}>Details</button>
                    {order.paymentStatus === "Verification Pending" ? (
                      <>
                        <button className="btn subtle" onClick={() => verifyOrderPayment(order.id, true)}>Verify Payment</button>
                        <button className="btn subtle" onClick={() => verifyOrderPayment(order.id, false)}>Reject Proof</button>
                      </>
                    ) : null}
                    <button className="btn subtle" onClick={() => updateOrderStatus(order.id, "Preparing")}>Preparing</button>
                    <button className="btn subtle" onClick={() => updateOrderStatus(order.id, "Out for Delivery")}>Out for Delivery</button>
                    <button className="btn subtle" onClick={() => updateOrderStatus(order.id, "Delivered")}>Delivered</button>
                  </div>
                  {order.status === "Cancelled" && order.paymentStatus === "Paid" && String(order.paymentMode || "").toUpperCase() !== "COD" && (
                    <div className="refund-alert">⚠️ REFUND/REVOKE ACTION REQUIRED</div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {view === VIEWS.PAST_ORDERS ? (
          <section className="section" id="past-orders">
            <div className="section-head">
              <div>
                <p className="kicker">History</p>
                <h2>Past Orders</h2>
              </div>
              <div className="order-filters">
                <select value={pastPreset} onChange={(e) => setPastPreset(e.target.value)}>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 days</option>
                  <option value="last30">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
                <input
                  type="date"
                  value={pastFrom}
                  onChange={(e) => setPastFrom(e.target.value)}
                  disabled={pastPreset !== "custom"}
                  title="From date"
                />
                <input
                  type="date"
                  value={pastTo}
                  onChange={(e) => setPastTo(e.target.value)}
                  disabled={pastPreset !== "custom"}
                  title="To date"
                />
                <input
                  type="search"
                  placeholder="Search by order/customer/phone"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                />
                <button className="btn subtle" type="button" onClick={() => setView(VIEWS.TODAY)}>
                  Back to today
                </button>
              </div>
            </div>
            <div className="admin-orders-grid">
              {!filteredPastOrders.length ? <p>No past orders found for the selected range.</p> : filteredPastOrders.map((order) => (
              <article className="admin-order-card" key={order.id}>
                <h4>{order.id}</h4>
                <p><span className="chip">{order.status}</span> <span className="chip">{order.paymentStatus || "Pending"}</span></p>
                <p>{order.customerName} ({order.customerPhone})</p>
                <p>Total: Rs {order.total} | {fmt(order.createdAt)}</p>
                <p>Chef: {order.assignedChef?.name || "Not assigned"}</p>
                <p>Item assignments: {order.assignedItems || 0}/{order.totalItems || 0}</p>
                <div className="admin-order-actions">
                  <button className="btn subtle" onClick={() => openOrder(order.id)}>Details</button>
                </div>
                {order.status === "Cancelled" && order.paymentStatus === "Paid" && String(order.paymentMode || "").toUpperCase() !== "COD" && (
                  <div className="refund-alert">⚠️ REFUND/REVOKE ACTION REQUIRED</div>
                )}
              </article>
              ))}
            </div>
          </section>
        ) : null}

        {view === VIEWS.TODAY ? (
          <section className="section" id="chefs">
          <div className="section-head"><div><p className="kicker">Kitchen floor</p><h2>Chef Management</h2></div></div>
          <div className="chef-grid">
            {!chefs.length ? <p>No chef records found.</p> : chefs.map((chef) => (
              <article className={`chef-card ${chef.isOnDuty ? "" : "off-duty"}`} key={chef.id}>
                <h4>{chef.name}</h4>
                <p>{chef.station}</p>
                <div className="chef-row">
                  <span className="chip">{chef.isOnDuty ? "On Duty" : "Off Duty"}</span>
                  <span className="chip">Assigned: {chef.assignedOrders}</span>
                </div>
                <button className="btn subtle" onClick={() => toggleDuty(chef.id)}>{chef.isOnDuty ? "Set Off Duty" : "Set On Duty"}</button>
              </article>
            ))}
          </div>
          </section>
        ) : null}

        {view === VIEWS.TODAY ? (
          <section className="section" id="tickets">
            <div className="section-head">
              <div><p className="kicker">Customer Support</p><h2>Today’s Tickets</h2></div>
              <div className="order-filters">
                <select value={ticketStatus} onChange={(e) => setTicketStatus(e.target.value)}>
                  <option value="">All tickets</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
                <input type="search" placeholder="Search ticket/order/customer" value={ticketSearch} onChange={(e) => setTicketSearch(e.target.value)} />
                <button className="btn subtle" type="button" onClick={() => setView(VIEWS.PAST_TICKETS)}>
                  View past tickets
                </button>
              </div>
            </div>
            <div className="admin-orders-grid">
              {!todaysTickets.length ? <p>No tickets found for today.</p> : todaysTickets.map((ticket) => (
                <article className="admin-order-card" key={ticket.id}>
                  <h4>{ticket.id}</h4>
                  <p><span className="chip">{ticket.status}</span></p>
                  <p><strong>Order:</strong> {ticket.orderId}</p>
                  <p><strong>Customer:</strong> {ticket.customerName} ({ticket.customerPhone})</p>
                  <p><strong>Query:</strong> {ticket.message}</p>
                  <div className="ticket-thread">
                    {(ticket.replies || []).length ? (
                      ticket.replies.map((reply, idx) => (
                        <div className="ticket-reply" key={`${ticket.id}-${idx}`}>
                          <strong>{reply.authorType === "admin" ? (reply.authorName || "Manager") : (reply.authorName || "Customer")}:</strong>
                          <span>{reply.message}</span>
                          <em>{fmt(reply.at)}</em>
                        </div>
                      ))
                    ) : (
                      <p className="ticket-empty">No thread yet.</p>
                    )}
                  </div>
                  <div className="admin-order-actions">
                    <button className="btn subtle" onClick={() => replyTicket(ticket.id, false)}>Reply</button>
                    <button className="btn subtle" disabled={ticket.status === "closed"} onClick={() => replyTicket(ticket.id, true)}>Mark Closed</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {view === VIEWS.PAST_TICKETS ? (
          <section className="section" id="past-tickets">
            <div className="section-head">
              <div><p className="kicker">History</p><h2>Past Tickets</h2></div>
              <div className="order-filters">
                <select value={pastPreset} onChange={(e) => setPastPreset(e.target.value)}>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 days</option>
                  <option value="last30">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
                <input
                  type="date"
                  value={pastFrom}
                  onChange={(e) => setPastFrom(e.target.value)}
                  disabled={pastPreset !== "custom"}
                  title="From date"
                />
                <input
                  type="date"
                  value={pastTo}
                  onChange={(e) => setPastTo(e.target.value)}
                  disabled={pastPreset !== "custom"}
                  title="To date"
                />
                <input type="search" placeholder="Search ticket/order/customer" value={ticketSearch} onChange={(e) => setTicketSearch(e.target.value)} />
                <button className="btn subtle" type="button" onClick={() => setView(VIEWS.TODAY)}>
                  Back to today
                </button>
              </div>
            </div>
            <div className="admin-orders-grid">
              {!filteredPastTickets.length ? <p>No past tickets found for the selected range.</p> : filteredPastTickets.map((ticket) => (
              <article className="admin-order-card" key={ticket.id}>
                <h4>{ticket.id}</h4>
                <p><span className="chip">{ticket.status}</span></p>
                <p><strong>Order:</strong> {ticket.orderId}</p>
                <p><strong>Customer:</strong> {ticket.customerName} ({ticket.customerPhone})</p>
                <p><strong>Query:</strong> {ticket.message}</p>
                <div className="ticket-thread">
                  {(ticket.replies || []).length ? (
                    ticket.replies.map((reply, idx) => (
                      <div className="ticket-reply" key={`${ticket.id}-${idx}`}>
                        <strong>{reply.authorType === "admin" ? (reply.authorName || "Manager") : (reply.authorName || "Customer")}:</strong>
                        <span>{reply.message}</span>
                        <em>{fmt(reply.at)}</em>
                      </div>
                    ))
                  ) : (
                    <p className="ticket-empty">No thread yet.</p>
                  )}
                </div>
                <div className="admin-order-actions">
                  <button className="btn subtle" onClick={() => replyTicket(ticket.id, false)}>Reply</button>
                  <button className="btn subtle" disabled={ticket.status === "closed"} onClick={() => replyTicket(ticket.id, true)}>Mark Closed</button>
                </div>
              </article>
              ))}
            </div>
          </section>
        ) : null}

        {view === VIEWS.ANALYTICS ? (
          <section className="section" id="analytics">
            <div className="section-head">
              <div>
                <p className="kicker">Insights</p>
                <h2>Analytics</h2>
              </div>
              <div className="order-filters">
                <select value={analyticsPreset} onChange={(e) => setAnalyticsPreset(e.target.value)}>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 days</option>
                  <option value="last30">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
                <input
                  type="date"
                  value={analyticsFrom}
                  onChange={(e) => setAnalyticsFrom(e.target.value)}
                  disabled={analyticsPreset !== "custom"}
                  title="From date"
                />
                <input
                  type="date"
                  value={analyticsTo}
                  onChange={(e) => setAnalyticsTo(e.target.value)}
                  disabled={analyticsPreset !== "custom"}
                  title="To date"
                />
                <button className="btn subtle" type="button" onClick={loadAnalytics}>
                  Refresh
                </button>
                <button className="btn subtle" type="button" onClick={() => setView(VIEWS.TODAY)}>
                  Back to today
                </button>
              </div>
            </div>

            {!analytics?.ok ? (
              <p>No analytics data loaded yet.</p>
            ) : (
              <>
                <div className="kpi-grid" style={{ marginTop: "0.7rem" }}>
                  <Kpi title="Orders" value={analytics.summary?.orders || 0} />
                  <Kpi title="Revenue" value={`Rs ${analytics.summary?.revenue || 0}`} />
                  <Kpi title="Avg order value" value={`Rs ${analytics.summary?.aov || 0}`} />
                  <Kpi title="Delivered" value={analytics.summary?.delivered || 0} />
                  <Kpi title="Cancelled" value={analytics.summary?.cancelled || 0} />
                  <Kpi title="Pending payments" value={analytics.summary?.pendingPayments || 0} />
                </div>

                <div className="analytics-grid" style={{ marginTop: "1rem" }}>
                  <ChartCard title="Peak hours (orders)" subtitle="Hover bars to inspect">
                    <BarChart
                      data={(analytics.hourly || []).map((h) => ({
                        key: String(h.hour).padStart(2, "0"),
                        label: `${String(h.hour).padStart(2, "0")}:00`,
                        value: Number(h.count || 0)
                      }))}
                      valueSuffix=" orders"
                    />
                  </ChartCard>
                  <ChartCard title="Payment modes" subtitle="Hover bars to inspect">
                    <BarChart
                      data={(analytics.paymentModes || []).map((p) => ({
                        key: String(p.mode || ""),
                        label: String(p.mode || ""),
                        value: Number(p.count || 0)
                      }))}
                      valueSuffix=""
                    />
                  </ChartCard>
                </div>

                <div className="analytics-grid" style={{ marginTop: "1rem" }}>
                  <ChartCard title="Top items (by quantity)" subtitle="Top 10">
                    <BarChart
                      data={(analytics.topItems || []).slice(0, 10).map((it) => ({
                        key: String(it.name || ""),
                        label: String(it.name || ""),
                        value: Number(it.qty || 0),
                        metaRight: `Rs ${Number(it.revenue || 0)}`
                      }))}
                      maxLabelChars={18}
                      valueSuffix=""
                    />
                  </ChartCard>
                  <ChartCard title="Top customers (by orders)" subtitle="Top 10">
                    <BarChart
                      data={(analytics.topCustomers || []).slice(0, 10).map((c) => ({
                        key: `${c.phone || ""}-${c.name || ""}`,
                        label: `${String(c.name || "Customer")} (${String(c.phone || "").slice(-4)})`,
                        value: Number(c.orders || 0),
                        metaRight: `Rs ${Number(c.spend || 0)}`
                      }))}
                      maxLabelChars={18}
                      valueSuffix=""
                    />
                  </ChartCard>
                </div>

                <div className="orders-layout" style={{ marginTop: "1rem" }}>
                  <div>
                    <h3>Top items</h3>
                    {!analytics.topItems?.length ? (
                      <p>No data.</p>
                    ) : (
                      <div className="admin-orders-grid">
                        {analytics.topItems.slice(0, 10).map((it) => (
                          <article className="admin-order-card" key={it.name}>
                            <h4>{it.name}</h4>
                            <p><span className="chip">Qty {it.qty}</span> <span className="chip">Rs {it.revenue}</span></p>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3>Top customers</h3>
                    {!analytics.topCustomers?.length ? (
                      <p>No data.</p>
                    ) : (
                      <div className="admin-orders-grid">
                        {analytics.topCustomers.slice(0, 10).map((c) => (
                          <article className="admin-order-card" key={`${c.phone}-${c.name}`}>
                            <h4>{c.name || "Customer"}</h4>
                            <p>{c.phone}</p>
                            <p><span className="chip">Orders {c.orders}</span> <span className="chip">Rs {c.spend}</span></p>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="orders-layout" style={{ marginTop: "1rem" }}>
                  <div>
                    <h3>Payment modes</h3>
                    {!analytics.paymentModes?.length ? (
                      <p>No data.</p>
                    ) : (
                      <div className="admin-orders-grid">
                        {analytics.paymentModes.map((p) => (
                          <article className="admin-order-card" key={p.mode}>
                            <h4>{p.mode}</h4>
                            <p><span className="chip">{p.count}</span></p>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3>Peak hours</h3>
                    {!analytics.hourly?.length ? (
                      <p>No data.</p>
                    ) : (
                      <div className="admin-orders-grid">
                        {analytics.hourly.map((h) => (
                          <article className="admin-order-card" key={h.hour}>
                            <h4>{String(h.hour).padStart(2, "0")}:00</h4>
                            <p><span className="chip">{h.count} orders</span></p>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        ) : null}
      </main>

      {activeOrder ? (
        <div className="modal-backdrop" onClick={() => setActiveOrder(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="order-detail-head">
              <h3>Order {activeOrder.id}</h3>
              <button className="icon-btn" onClick={() => setActiveOrder(null)}>X</button>
            </div>
            <div className="detail-block">
              <p><strong>Status:</strong> {activeOrder.status}</p>
              <p><strong>Payment:</strong> {activeOrder.paymentMode} ({activeOrder.paymentStatus || "Pending"})</p>
              <p><strong>Customer:</strong> {activeOrder.customer?.name} | {activeOrder.customer?.phone}</p>
              <p><strong>Address:</strong> {activeOrder.customer?.address}</p>
              <p><strong>Total:</strong> Rs {activeOrder.pricing?.total}</p>
            </div>
            {String(activeOrder.paymentMode || "").trim().toUpperCase() === "COD" ? (
              <div className="detail-block">
                <strong>COD Payment</strong>
                <div className="admin-order-actions" style={{ marginTop: "0.6rem" }}>
                  {String(activeOrder.paymentStatus || "").toLowerCase() !== "paid" ? (
                    <button className="btn subtle" onClick={() => updateCodPaymentStatus(activeOrder.id, "Paid")}>
                      Mark COD Paid
                    </button>
                  ) : (
                    <button className="btn subtle" onClick={() => updateCodPaymentStatus(activeOrder.id, "Pending")}>
                      Mark Unpaid
                    </button>
                  )}
                </div>
              </div>
            ) : null}
            <div className="detail-block">
              <strong>Status Actions</strong>
              <div className="admin-order-actions" style={{ marginTop: "0.6rem" }}>
                <button className="btn subtle" onClick={() => updateOrderStatus(activeOrder.id, "Preparing", "Updated from order details modal")}>Preparing</button>
                <button className="btn subtle" onClick={() => updateOrderStatus(activeOrder.id, "Out for Delivery", "Updated from order details modal")}>Out for Delivery</button>
                <button className="btn subtle" onClick={() => updateOrderStatus(activeOrder.id, "Delivered", "Updated from order details modal")}>Delivered</button>
                <button className="btn subtle" disabled={activeOrder.status === "Delivered" || activeOrder.status === "Cancelled"} onClick={() => updateOrderStatus(activeOrder.id, "Cancelled", "Cancelled by manager from order details")}>Manual Cancel</button>
                {activeOrder.paymentStatus === "Verification Pending" ? (
                  <>
                    <button className="btn subtle" onClick={() => verifyOrderPayment(activeOrder.id, true)}>Verify Payment</button>
                    <button className="btn subtle" onClick={() => verifyOrderPayment(activeOrder.id, false)}>Reject Proof</button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="detail-block">
              <strong>Items (Assign Chef per Item)</strong>
              <ul className="timeline">
                {(activeOrder.items || []).map((item) => (
                  <li key={item.id} className={itemAssignGlow[item.id] ? "item-assign-success" : ""}>
                    <div><strong>{item.name}</strong> x {item.quantity}</div>
                    <div className="admin-order-actions" style={{ marginTop: "0.5rem" }}>
                      <select data-item-id={item.id} value={itemChefMap[item.id] || ""} onChange={(e) => setItemChefMap((prev) => ({ ...prev, [item.id]: e.target.value }))}>
                        <option value="" disabled={activeChefs.length === 0}>Assign chef</option>
                        {!activeChefs.length ? <option value="" disabled>No active chef</option> : null}
                        {activeChefs.map((chef) => (
                          <option key={chef.id} value={chef.id}>
                            {chef.name} ({chef.station}){chef.isOnDuty ? "" : " - Off Duty"}
                          </option>
                        ))}
                      </select>
                      <button className="btn subtle" disabled={!itemChefMap[item.id]} onClick={() => assignChefToItem(activeOrder.id, item.id)}>Assign Chef</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="detail-block">
              <strong>Payment Attempts</strong>
              <ul className="timeline">
                {(activeOrder.paymentTransactions || []).length ? (
                  activeOrder.paymentTransactions.map((txn) => (
                    <li key={txn.id}>
                      <div><strong>{txn.provider?.toUpperCase() || "N/A"}</strong> - {txn.status}</div>
                      <div>Amount: Rs {txn.amount} {txn.currency}</div>
                      <div>Order Ref: {txn.gatewayOrderId || "-"}</div>
                      <div>Payment Ref: {txn.gatewayPaymentId || "-"}</div>
                      <div>{fmt(txn.createdAt)}{txn.capturedAt ? ` | Captured: ${fmt(txn.capturedAt)}` : ""}</div>
                    </li>
                  ))
                ) : (
                  <li>No payment attempts found.</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({ title, value }) {
  return (
    <article className="kpi-card">
      <p>{title}</p>
      <strong>{value}</strong>
    </article>
  );
}

function fmt(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function isToday(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    return d.toDateString() === now.toDateString();
  } catch {
    return false;
  }
}

function startOfDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d) {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function parseDateInput(value) {
  // value is YYYY-MM-DD from <input type="date">
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function computePastRange(preset, fromInput, toInput) {
  const now = new Date();
  if (preset === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: startOfDay(y), to: endOfDay(y) };
  }
  if (preset === "last30") {
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    return { from: startOfDay(from), to: endOfDay(now) };
  }
  if (preset === "custom") {
    const fromParsed = parseDateInput(fromInput);
    const toParsed = parseDateInput(toInput);
    if (!fromParsed && !toParsed) return { from: null, to: null };
    let from = fromParsed ? startOfDay(fromParsed) : null;
    let to = toParsed ? endOfDay(toParsed) : null;
    if (from && to && from > to) {
      // User selected dates in reverse order; normalize.
      const tmp = from;
      from = startOfDay(toParsed);
      to = endOfDay(fromParsed);
      // tmp is intentionally unused after swap; kept for clarity.
      void tmp;
    }
    return { from, to };
  }
  // default last7
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  return { from: startOfDay(from), to: endOfDay(now) };
}

function isWithinRange(value, range) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    const fromOk = range?.from ? d >= range.from : true;
    const toOk = range?.to ? d <= range.to : true;
    return fromOk && toOk;
  } catch {
    return false;
  }
}

function ChartCard({ title, subtitle, children }) {
  return (
    <article className="chart-card">
      <div className="chart-head">
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          {subtitle ? <p className="chart-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      <div className="chart-body">{children}</div>
    </article>
  );
}

function BarChart({ data, valueSuffix = "", maxLabelChars = 24 }) {
  const [tip, setTip] = useState(null);
  const max = Math.max(1, ...(data || []).map((d) => Number(d.value || 0)));

  function onLeave() {
    setTip(null);
  }

  return (
    <div className="chart-wrap" onMouseLeave={onLeave}>
      {tip ? (
        <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }}>
          <strong>{tip.title}</strong>
          <div>{tip.value}</div>
          {tip.metaRight ? <div className="chart-tip-meta">{tip.metaRight}</div> : null}
        </div>
      ) : null}
      <svg viewBox="0 0 1000 320" preserveAspectRatio="none" className="chart-svg">
        {/* Bars area */}
        {(data || []).map((d, idx) => {
          const v = Math.max(0, Number(d.value || 0));
          const barW = 1000 / Math.max(1, data.length);
          const x = idx * barW;
          const h = (v / max) * 240;
          const y = 40 + (240 - h);
          const label = String(d.label || d.key || "");
          const showLabel = label.length > maxLabelChars ? `${label.slice(0, maxLabelChars - 1)}…` : label;
          return (
            <g key={d.key || `${idx}`}>
              <rect
                x={x + 8}
                y={y}
                width={Math.max(6, barW - 16)}
                height={h}
                rx="10"
                className="chart-bar"
                onMouseMove={(e) => {
                  const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                  const px = rect ? e.clientX - rect.left : 0;
                  const py = rect ? e.clientY - rect.top : 0;
                  setTip({
                    x: Math.min(820, Math.max(8, px + 12)),
                    y: Math.min(240, Math.max(8, py - 18)),
                    title: label,
                    value: `${v}${valueSuffix}`,
                    metaRight: d.metaRight || ""
                  });
                }}
              />
              <text x={x + barW / 2} y={306} textAnchor="middle" className="chart-label">
                {showLabel}
              </text>
            </g>
          );
        })}
        {/* Baseline */}
        <line x1="0" y1="280" x2="1000" y2="280" className="chart-axis" />
      </svg>
    </div>
  );
}
