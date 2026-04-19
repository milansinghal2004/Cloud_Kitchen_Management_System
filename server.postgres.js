const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { Pool } = require("pg");
const { loadEnv } = require("./config/load-env");

loadEnv();

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required to run server.postgres.js");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const PUBLIC_DIR = path.join(__dirname, "public");
const sseClients = new Map();
const idempotencyMemory = new Map();
const PAYMENT_PROVIDER = String(process.env.PAYMENT_PROVIDER || "mock").trim().toLowerCase();
const PAYMENT_CURRENCY = String(process.env.PAYMENT_CURRENCY || "INR").trim().toUpperCase();
const UPI_RECEIVER_VPA = String(process.env.UPI_RECEIVER_VPA || "").trim();
const UPI_RECEIVER_NAME = String(process.env.UPI_RECEIVER_NAME || "Cloud Kitchen").trim();
const RAZORPAY_KEY_ID = String(process.env.RAZORPAY_KEY_ID || "").trim();
const RAZORPAY_KEY_SECRET = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
const RAZORPAY_WEBHOOK_SECRET = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { ok: false, message });
}

function isAdminAuthorized(req) {
  const adminKey = String(req.headers["x-admin-key"] || "");
  return adminKey === (process.env.ADMIN_KEY || "dev-admin-key-change-me");
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
      if (data.length > 1_000_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(plain), salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plain, stored) {
  const value = String(stored || "");
  if (!value) return false;
  if (value.startsWith("scrypt$")) {
    const [, salt, expected] = value.split("$");
    if (!salt || !expected) return false;
    const derived = crypto.scryptSync(String(plain), salt, 64).toString("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return derived === expected;
    }
  }
  return value === crypto.createHash("sha256").update(String(plain)).digest("hex");
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function slugifyUsername(value) {
  return normalizeUsername(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.\.+/g, ".") || "user";
}

function validatePasswordStrength(password, username = "") {
  const value = String(password || "");
  const lower = value.toLowerCase();
  const usernameLower = String(username || "").toLowerCase();
  if (value.length < 8) return "Password must be at least 8 characters long.";
  if (!/[a-z]/.test(value)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(value)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(value)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must include a symbol.";
  if (usernameLower && lower.includes(usernameLower.replace(/\s+/g, ""))) return "Password should not contain your username.";
  return "";
}

async function generateUniqueEmail(baseUsername) {
  const slug = slugifyUsername(baseUsername);
  let attempt = 0;
  while (attempt < 10) {
    const email = attempt === 0 ? `${slug}@cloudkitchen.local` : `${slug}-${attempt}@cloudkitchen.local`;
    const existing = await queryOne("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [email]);
    if (!existing) return email;
    attempt += 1;
  }
  return `${slug}-${Date.now()}@cloudkitchen.local`;
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

function isOnlinePaymentMode(mode) {
  const normalized = String(mode || "").trim().toUpperCase();
  return normalized === "UPI" || normalized === "CARD" || normalized === "NETBANKING" || normalized === "WALLET";
}

function getEffectivePaymentProvider() {
  if (PAYMENT_PROVIDER === "razorpay" && RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) return "razorpay";
  return "mock";
}

function makeUpiUri({ orderId, amount }) {
  if (!UPI_RECEIVER_VPA) return "";
  const params = new URLSearchParams({
    pa: UPI_RECEIVER_VPA,
    pn: UPI_RECEIVER_NAME,
    am: Number(amount || 0).toFixed(2),
    cu: PAYMENT_CURRENCY,
    tn: `Cloud Kitchen Order ${orderId}`,
    tr: orderId
  });
  return `upi://pay?${params.toString()}`;
}

function verifyRazorpayPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
  const digest = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(payload).digest("hex");
  return digest === razorpaySignature;
}

function verifyRazorpayWebhookSignature(rawBody, signature) {
  const digest = crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return digest === signature;
}

async function createRazorpayOrder({ amountPaise, receipt, notes }) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: PAYMENT_CURRENCY,
      receipt,
      notes: notes || {}
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.description || "Unable to create Razorpay order.");
  }
  return data;
}

async function buildPaymentSessionForOrder(order, existingTxn = null, queryRunner = pool) {
  const paymentMode = String(order.payment_mode || "").trim().toUpperCase();
  const provider = paymentMode === "UPI" ? "upi_qr" : getEffectivePaymentProvider();
  const amountPaise = Number(order.total || 0) * 100;
  if (amountPaise <= 0) throw new Error("Invalid payable amount.");
  if (provider === "upi_qr") {
    if (!UPI_RECEIVER_VPA) throw new Error("UPI_RECEIVER_VPA is not configured.");
    const upiUri = makeUpiUri({ orderId: order.id, amount: Number(order.total || 0) });
    const qrImageUrl = `https://quickchart.io/qr?size=320&text=${encodeURIComponent(upiUri)}`;
    if (existingTxn) {
      await queryRunner.query(
        "UPDATE payment_transactions SET provider = $2, amount = $3, currency = $4, status = 'pending', gateway_order_id = $5, metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb WHERE id = $1",
        [existingTxn.id, provider, Number(order.total || 0), PAYMENT_CURRENCY, `upi_${order.id}`, JSON.stringify({ upiUri, qrImageUrl, vpa: UPI_RECEIVER_VPA })]
      );
    }
    return {
      provider: "upi_qr",
      amountPaise,
      currency: PAYMENT_CURRENCY,
      upiUri,
      vpa: UPI_RECEIVER_VPA,
      payee: UPI_RECEIVER_NAME,
      qrImageUrl,
      orderId: order.id
    };
  }
  if (provider === "razorpay") {
    const razorpayOrder = await createRazorpayOrder({
      amountPaise,
      receipt: order.id,
      notes: { orderId: order.id, sessionId: order.session_id || "", customer: order.customer_name || "" }
    });
    if (existingTxn) {
      await queryRunner.query(
        "UPDATE payment_transactions SET provider = $2, amount = $3, currency = $4, status = 'pending', gateway_order_id = $5, metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb WHERE id = $1",
        [existingTxn.id, provider, Number(order.total || 0), PAYMENT_CURRENCY, razorpayOrder.id, JSON.stringify({ razorpayOrder })]
      );
    }
    return {
      provider: "razorpay",
      keyId: RAZORPAY_KEY_ID,
      gatewayOrderId: razorpayOrder.id,
      amountPaise,
      currency: PAYMENT_CURRENCY,
      name: "Cloud Kitchen",
      description: `Order ${order.id}`
    };
  }
  const gatewayOrderId = `mock_${order.id}_${Date.now()}`;
  if (existingTxn) {
    await queryRunner.query(
      "UPDATE payment_transactions SET provider = $2, amount = $3, currency = $4, status = 'pending', gateway_order_id = $5 WHERE id = $1",
      [existingTxn.id, provider, Number(order.total || 0), PAYMENT_CURRENCY, gatewayOrderId]
    );
  }
  return {
    provider: "mock",
    gatewayOrderId,
    amountPaise,
    currency: PAYMENT_CURRENCY,
    message: "Mock gateway enabled. Confirm payment in-app."
  };
}

function getOrderStatus(order) {
  if (order.status === "Cancelled") return "Cancelled";
  if (order.status === "Delivered") return "Delivered";
  if (order.status === "Out for Delivery") return "Out for Delivery";
  if (order.status === "Preparing") return "Preparing";

  const createdAtMs = new Date(order.created_at || order.createdAt).getTime();
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - createdAtMs) / 60000));
  const eta = Number(order.eta_minutes || order.etaMinutes || 32);
  if (elapsedMinutes < 5) return "Confirmed";
  if (elapsedMinutes < 15) return "Preparing";
  if (elapsedMinutes < eta) return "Out for Delivery";
  return "Delivered";
}

function canCancelOrder(order) {
  const status = getOrderStatus(order);
  return !(status === "Cancelled" || status === "Delivered");
}

function getAdminUsername() {
  return process.env.ADMIN_USERNAME || "manager";
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || "manager123";
}

function sendSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addSseClient(sessionId, res) {
  if (!sseClients.has(sessionId)) sseClients.set(sessionId, new Set());
  sseClients.get(sessionId).add(res);
}

function removeSseClient(sessionId, res) {
  if (!sseClients.has(sessionId)) return;
  sseClients.get(sessionId).delete(res);
  if (sseClients.get(sessionId).size === 0) sseClients.delete(sessionId);
}

function emitRealtimeUpdate(sessionId, event, payload) {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  for (const res of clients) sendSseEvent(res, event, payload);
}

function toOrderDto(row, items = [], history = [], supportTickets = [], paymentTransactions = []) {
  const status = getOrderStatus(row);
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    createdAt: row.created_at,
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      address: row.customer_address
    },
    paymentMode: row.payment_mode,
    paymentStatus: row.payment_status || "Pending",
    paymentRef: row.payment_ref || null,
    paymentTransactions,
    etaMinutes: row.eta_minutes,
    status,
    canCancel: canCancelOrder(row),
    pricing: {
      subtotal: row.subtotal,
      discount: row.discount,
      deliveryFee: row.delivery_fee,
      tax: row.tax,
      total: row.total,
      appliedOffer: row.applied_offer || null
    },
    items,
    statusHistory: history,
    supportTickets
  };
}

async function queryOne(sql, params = []) {
  const out = await pool.query(sql, params);
  return out.rows[0] || null;
}

async function fetchOrderWithDetails(orderId) {
  const order = await queryOne("SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!order) return null;
  const [itemsRes, historyRes, itemAssignmentRes, ticketRes, ticketReplyRes, paymentTxnRes] = await Promise.all([
    pool.query("SELECT item_id AS id, item_name AS name, item_price AS price, quantity, item_image AS image FROM order_items WHERE order_id = $1 ORDER BY item_name", [orderId]),
    pool.query("SELECT status, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC", [orderId]),
    pool.query(
      `SELECT oia.item_id, oia.chef_id, c.name AS chef_name, c.station AS chef_station, oia.assigned_at
       FROM order_item_assignments oia
       JOIN chefs c ON c.id = oia.chef_id
       WHERE oia.order_id = $1`,
      [orderId]
    ),
    pool.query(
      "SELECT id, status, message, manager_reply, manager_reply_at, manager_reply_by, created_at FROM support_tickets WHERE order_id = $1 ORDER BY created_at DESC",
      [orderId]
    ),
    pool.query(
      `SELECT r.ticket_id, r.author_type, r.author_name, r.message, r.created_at
       FROM support_ticket_replies r
       JOIN support_tickets t ON t.id = r.ticket_id
       WHERE t.order_id = $1
       ORDER BY r.created_at ASC`,
      [orderId]
    ),
    pool.query(
      `SELECT id, provider, amount, currency, status, gateway_order_id, gateway_payment_id, created_at, captured_at, metadata
       FROM payment_transactions
       WHERE order_id = $1
       ORDER BY created_at DESC`,
      [orderId]
    )
  ]);

  const assignmentMap = new Map(
    itemAssignmentRes.rows.map((a) => [
      a.item_id,
      {
        chefId: a.chef_id,
        chefName: a.chef_name,
        chefStation: a.chef_station,
        assignedAt: a.assigned_at
      }
    ])
  );

  const items = itemsRes.rows.map((item) => ({
    ...item,
    assignedChef: assignmentMap.get(item.id) || null
  }));

  const history = historyRes.rows.map((h) => ({ status: h.status, at: h.created_at, note: h.note || "" }));

  const repliesByTicket = new Map();
  for (const reply of ticketReplyRes.rows) {
    if (!repliesByTicket.has(reply.ticket_id)) repliesByTicket.set(reply.ticket_id, []);
    repliesByTicket.get(reply.ticket_id).push({
      authorType: reply.author_type,
      authorName: reply.author_name || "",
      message: reply.message,
      at: reply.created_at
    });
  }
  const supportTickets = ticketRes.rows.map((ticket) => ({
    id: ticket.id,
    status: ticket.status,
    message: ticket.message,
    createdAt: ticket.created_at,
    managerReply: ticket.manager_reply || "",
    managerReplyAt: ticket.manager_reply_at || null,
    managerReplyBy: ticket.manager_reply_by || "",
    replies: repliesByTicket.get(ticket.id) || []
  }));

  const paymentTransactions = paymentTxnRes.rows.map((txn) => ({
    id: txn.id,
    provider: txn.provider,
    amount: txn.amount,
    currency: txn.currency,
    status: txn.status,
    gatewayOrderId: txn.gateway_order_id || "",
    gatewayPaymentId: txn.gateway_payment_id || "",
    createdAt: txn.created_at,
    capturedAt: txn.captured_at,
    metadata: txn.metadata || {}
  }));

  return toOrderDto(order, items, history, supportTickets, paymentTransactions);
}

async function handleApi(req, res, urlObj) {
  const pathname = urlObj.pathname;
  const method = req.method;

  if (method === "GET" && pathname === "/api/events") {
    const sessionId = String(urlObj.searchParams.get("sessionId") || "").trim();
    if (!sessionId) return sendError(res, 400, "sessionId is required.");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    addSseClient(sessionId, res);
    sendSseEvent(res, "connected", { ok: true, sessionId, time: new Date().toISOString() });
    const heartbeat = setInterval(() => sendSseEvent(res, "heartbeat", { ts: Date.now() }), 20000);
    req.on("close", () => {
      clearInterval(heartbeat);
      removeSseClient(sessionId, res);
    });
    return;
  }

  if (method === "GET" && pathname === "/api/health") {
    const dbCheck = await queryOne("SELECT NOW() AS now");
    return sendJson(res, 200, { ok: true, service: "cloud-kitchen-postgres-api", dbTime: dbCheck.now });
  }

  if (method === "GET" && pathname === "/api/admin/overview") {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const [summaryRes, pendingVerificationRes, chefsRes, pendingSupportRes] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*)::int AS total_orders,
          COUNT(*) FILTER (WHERE status IN ('Confirmed','Preparing','Out for Delivery'))::int AS active_orders,
          COUNT(*) FILTER (WHERE status = 'Delivered')::int AS delivered_orders,
          COUNT(*) FILTER (WHERE status = 'Cancelled')::int AS cancelled_orders,
          COUNT(*) FILTER (WHERE payment_status = 'Pending')::int AS pending_payments,
          COALESCE(SUM(total),0)::int AS gross_revenue
         FROM orders
         WHERE created_at::date = NOW()::date`
      ),
      pool.query("SELECT COUNT(*)::int AS pending_verifications FROM payment_transactions WHERE status = 'submitted'"),
      pool.query(
        `SELECT
          COUNT(*)::int AS total_chefs,
          COUNT(*) FILTER (WHERE is_on_duty = TRUE AND is_active = TRUE)::int AS on_duty_chefs
         FROM chefs`
      ),
      pool.query("SELECT COUNT(*)::int AS open_tickets FROM support_tickets WHERE status = 'open'")
    ]);
    return sendJson(res, 200, {
      ok: true,
      metrics: {
        ...summaryRes.rows[0],
        ...pendingVerificationRes.rows[0],
        ...chefsRes.rows[0],
        ...pendingSupportRes.rows[0]
      }
    });
  }

  if (method === "GET" && pathname === "/api/admin/chefs") {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const rows = await pool.query(
      `SELECT
        c.id, c.name, c.station, c.is_on_duty AS "isOnDuty", c.is_active AS "isActive", c.last_seen AS "lastSeen",
        COUNT(oa.order_id)::int AS "assignedOrders"
       FROM chefs c
       LEFT JOIN order_assignments oa ON oa.chef_id = c.id
       WHERE c.is_active = TRUE
       GROUP BY c.id
       ORDER BY c.is_on_duty DESC, c.name ASC`
    );
    return sendJson(res, 200, { ok: true, chefs: rows.rows });
  }

  if (method === "POST" && pathname.startsWith("/api/admin/chefs/") && pathname.endsWith("/toggle-duty")) {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const parts = pathname.split("/").filter(Boolean);
    const chefId = parts[3] || "";
    const chef = await queryOne("UPDATE chefs SET is_on_duty = NOT is_on_duty, last_seen = NOW() WHERE id = $1 RETURNING id, name, station, is_on_duty AS \"isOnDuty\", is_active AS \"isActive\", last_seen AS \"lastSeen\"", [chefId]);
    if (!chef) return sendError(res, 404, "Chef not found.");
    return sendJson(res, 200, { ok: true, chef });
  }

  if (method === "GET" && pathname === "/api/admin/orders") {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const status = String(urlObj.searchParams.get("status") || "").trim();
    const search = String(urlObj.searchParams.get("search") || "").trim().toLowerCase();
    const limit = Math.min(100, Math.max(10, Number(urlObj.searchParams.get("limit") || 40)));
    const params = [];
    const where = [];
    if (status) {
      params.push(status);
      where.push(`o.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(LOWER(o.id) LIKE $${params.length} OR LOWER(o.customer_name) LIKE $${params.length} OR LOWER(o.customer_phone) LIKE $${params.length})`);
    }
    params.push(limit);
    const sql = `
      SELECT
        o.*,
        a.chef_id AS assigned_chef_id,
        c.name AS assigned_chef_name,
        c.station AS assigned_chef_station,
        COALESCE(oi.total_items, 0)::int AS total_items,
        COALESCE(oia.assigned_items, 0)::int AS assigned_items,
        COALESCE(item_chefs.chef_count, 0)::int AS item_chef_count,
        item_chefs.only_chef_id AS item_only_chef_id,
        item_chefs.only_chef_name AS item_only_chef_name,
        item_chefs.only_chef_station AS item_only_chef_station
      FROM orders o
      LEFT JOIN order_assignments a ON a.order_id = o.id
      LEFT JOIN chefs c ON c.id = a.chef_id
      LEFT JOIN (
        SELECT order_id, COUNT(*)::int AS total_items
        FROM order_items
        GROUP BY order_id
      ) oi ON oi.order_id = o.id
      LEFT JOIN (
        SELECT order_id, COUNT(*)::int AS assigned_items
        FROM order_item_assignments
        GROUP BY order_id
      ) oia ON oia.order_id = o.id
      LEFT JOIN (
        SELECT
          oia.order_id,
          COUNT(DISTINCT oia.chef_id)::int AS chef_count,
          CASE WHEN COUNT(DISTINCT oia.chef_id) = 1 THEN MIN(oia.chef_id) END AS only_chef_id,
          CASE WHEN COUNT(DISTINCT oia.chef_id) = 1 THEN MIN(c.name) END AS only_chef_name,
          CASE WHEN COUNT(DISTINCT oia.chef_id) = 1 THEN MIN(c.station) END AS only_chef_station
        FROM order_item_assignments oia
        JOIN chefs c ON c.id = oia.chef_id
        GROUP BY oia.order_id
      ) item_chefs ON item_chefs.order_id = o.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY o.created_at DESC
      LIMIT $${params.length}
    `;
    const rows = await pool.query(sql, params);
    const orders = rows.rows.map((r) => ({
      id: r.id,
      status: getOrderStatus(r),
      paymentStatus: r.payment_status || "Pending",
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      total: r.total,
      createdAt: r.created_at,
      assignedChef: r.assigned_chef_id
        ? { id: r.assigned_chef_id, name: r.assigned_chef_name, station: r.assigned_chef_station }
        : r.item_only_chef_id
          ? { id: r.item_only_chef_id, name: r.item_only_chef_name, station: r.item_only_chef_station }
          : r.item_chef_count > 1
            ? { id: "multiple", name: `Multiple (${r.item_chef_count})`, station: "" }
            : null,
      totalItems: r.total_items,
      assignedItems: r.assigned_items
    }));
    return sendJson(res, 200, { ok: true, orders });
  }

  if (method === "POST" && pathname.startsWith("/api/admin/orders/") && pathname.endsWith("/assign-chef") && !pathname.includes("/items/")) {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[3] || "";
    const body = await parseBody(req);
    const chefId = String(body.chefId || "").trim();
    if (!chefId) return sendError(res, 400, "chefId is required.");

    const chef = await queryOne("SELECT id, is_on_duty, is_active FROM chefs WHERE id = $1", [chefId]);
    if (!chef || !chef.is_active) return sendError(res, 404, "Chef not found.");
    const order = await queryOne("SELECT id, session_id FROM orders WHERE id = $1", [orderId]);
    if (!order) return sendError(res, 404, "Order not found.");

    await pool.query(
      "INSERT INTO order_assignments (order_id, chef_id, assigned_at) VALUES ($1,$2,NOW()) ON CONFLICT (order_id) DO UPDATE SET chef_id = EXCLUDED.chef_id, assigned_at = NOW()",
      [orderId, chefId]
    );
    await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Assigned', $2)", [orderId, `Assigned to ${chefId}`]);
    if (order.session_id) emitRealtimeUpdate(order.session_id, "order_updated", { orderId, assignedChefId: chefId });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname.startsWith("/api/admin/orders/") && pathname.includes("/items/") && pathname.endsWith("/assign-chef")) {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[3] || "";
    const itemId = parts[5] || "";
    const body = await parseBody(req);
    const chefId = String(body.chefId || "").trim();
    if (!orderId || !itemId || !chefId) return sendError(res, 400, "orderId, itemId and chefId are required.");

    const [chef, order, orderItem] = await Promise.all([
      queryOne("SELECT id, name, is_on_duty, is_active FROM chefs WHERE id = $1", [chefId]),
      queryOne("SELECT id, session_id FROM orders WHERE id = $1", [orderId]),
      queryOne("SELECT order_id, item_id, item_name FROM order_items WHERE order_id = $1 AND item_id = $2", [orderId, itemId])
    ]);

    if (!chef || !chef.is_active) return sendError(res, 404, "Chef not found.");
    if (!order) return sendError(res, 404, "Order not found.");
    if (!orderItem) return sendError(res, 404, "Order item not found.");

    await pool.query(
      `INSERT INTO order_item_assignments (order_id, item_id, chef_id, assigned_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (order_id, item_id)
       DO UPDATE SET chef_id = EXCLUDED.chef_id, assigned_at = NOW()`,
      [orderId, itemId, chefId]
    );

    await pool.query(
      "INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Assigned', $2)",
      [orderId, `${orderItem.item_name} assigned to ${chef.name}`]
    );

    if (order.session_id) {
      emitRealtimeUpdate(order.session_id, "order_updated", {
        orderId,
        itemId,
        assignedChefId: chefId,
        assignedChefName: chef.name
      });
    }

    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/admin/tickets") {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const status = String(urlObj.searchParams.get("status") || "").trim().toLowerCase();
    const search = String(urlObj.searchParams.get("search") || "").trim().toLowerCase();

    const params = [];
    const where = [];
    if (status && (status === "open" || status === "closed")) {
      params.push(status);
      where.push(`LOWER(t.status) = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(LOWER(t.id) LIKE $${params.length} OR LOWER(t.order_id) LIKE $${params.length} OR LOWER(t.message) LIKE $${params.length} OR LOWER(o.customer_name) LIKE $${params.length} OR LOWER(o.customer_phone) LIKE $${params.length})`);
    }

    const rows = await pool.query(
      `SELECT
        t.id,
        t.order_id AS "orderId",
        t.message,
        t.status,
        t.created_at AS "createdAt",
        t.manager_reply AS "managerReply",
        t.manager_reply_at AS "managerReplyAt",
        t.manager_reply_by AS "managerReplyBy",
        o.customer_name AS "customerName",
        o.customer_phone AS "customerPhone"
      FROM support_tickets t
      JOIN orders o ON o.id = t.order_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY t.created_at DESC`,
      params
    );

    if (!rows.rows.length) return sendJson(res, 200, { ok: true, tickets: [] });

    const ticketIds = rows.rows.map((t) => t.id);
    const replyRows = await pool.query(
      `SELECT ticket_id, author_type, author_name, message, created_at
       FROM support_ticket_replies
       WHERE ticket_id = ANY($1::text[])
       ORDER BY created_at ASC`,
      [ticketIds]
    );

    const repliesByTicket = new Map();
    for (const reply of replyRows.rows) {
      if (!repliesByTicket.has(reply.ticket_id)) repliesByTicket.set(reply.ticket_id, []);
      repliesByTicket.get(reply.ticket_id).push({
        authorType: reply.author_type,
        authorName: reply.author_name || "",
        message: reply.message,
        at: reply.created_at
      });
    }

    const tickets = rows.rows.map((ticket) => ({
      ...ticket,
      replies: repliesByTicket.get(ticket.id) || []
    }));

    return sendJson(res, 200, { ok: true, tickets });
  }

  if (method === "POST" && pathname.startsWith("/api/admin/tickets/") && pathname.endsWith("/reply")) {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const parts = pathname.split("/").filter(Boolean);
    const ticketId = parts[3] || "";
    const body = await parseBody(req);
    const message = String(body.message || "").trim();
    const closeTicket = Boolean(body.closeTicket);
    const adminName = String(body.adminName || getAdminUsername()).trim() || getAdminUsername();
    if (!ticketId || !message) return sendError(res, 400, "ticketId and message are required.");

    const ticket = await queryOne("SELECT id, order_id FROM support_tickets WHERE id = $1", [ticketId]);
    if (!ticket) return sendError(res, 404, "Ticket not found.");

    await pool.query(
      `UPDATE support_tickets
       SET manager_reply = $2,
           manager_reply_at = NOW(),
           manager_reply_by = $3,
           status = $4
       WHERE id = $1`,
      [ticketId, message, adminName, closeTicket ? "closed" : "open"]
    );

    await pool.query(
      "INSERT INTO support_ticket_replies (ticket_id, author_type, author_name, message) VALUES ($1, 'admin', $2, $3)",
      [ticketId, adminName, message]
    );

    const order = await queryOne("SELECT session_id FROM orders WHERE id = $1", [ticket.order_id]);
    if (order?.session_id) {
      emitRealtimeUpdate(order.session_id, "support_updated", {
        ticketId,
        orderId: ticket.order_id,
        status: closeTicket ? "closed" : "open"
      });
    }

    return sendJson(res, 200, { ok: true, ticketId, status: closeTicket ? "closed" : "open" });
  }

  if (method === "GET" && pathname === "/api/categories") {
    const rows = await pool.query("SELECT DISTINCT category FROM menu_items WHERE is_active = TRUE ORDER BY category ASC");
    return sendJson(res, 200, { ok: true, categories: ["All", ...rows.rows.map((r) => r.category)] });
  }

  if (method === "GET" && pathname === "/api/menu") {
    const category = String(urlObj.searchParams.get("category") || "All");
    const search = String(urlObj.searchParams.get("search") || "").trim().toLowerCase();
    const params = [];
    let where = "WHERE is_active = TRUE";
    if (category && category !== "All") {
      params.push(category);
      where += ` AND category = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND LOWER(name) LIKE $${params.length}`;
    }
    const sql = `SELECT id, name, description, price, rating, prep_minutes AS "prepMinutes", category, image, is_veg AS "isVeg" FROM menu_items ${where} ORDER BY name`;
    const rows = await pool.query(sql, params);
    return sendJson(res, 200, { ok: true, items: rows.rows });
  }

  if (method === "GET" && pathname === "/api/offers") {
    const rows = await pool.query(
      "SELECT id, title, description, code, discount_percent AS \"discountPercent\", discount_flat AS \"discountFlat\", min_order_value AS \"minOrderValue\" FROM offers WHERE is_active = TRUE ORDER BY created_at DESC"
    );
    return sendJson(res, 200, { ok: true, offers: rows.rows });
  }

  if (method === "GET" && pathname === "/api/special/today") {
    const rows = await pool.query("SELECT id, name, description, price, rating, prep_minutes AS \"prepMinutes\", category, image FROM menu_items WHERE is_active = TRUE AND category <> 'Beverages' ORDER BY id");
    if (rows.rows.length === 0) return sendJson(res, 200, { ok: true, special: null });
    const day = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
    const special = rows.rows[day % rows.rows.length];
    special.label = "Today's Special";
    special.validDate = new Date().toISOString().slice(0, 10);
    return sendJson(res, 200, { ok: true, special });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await parseBody(req);
    const displayName = String(body.name || body.username || "").trim();
    const username = normalizeUsername(body.username || body.name || "");
    const emailInput = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!username || !password) return sendError(res, 400, "Username and password are required.");
    const passwordError = validatePasswordStrength(password, username);
    if (passwordError) return sendError(res, 400, passwordError);

    const email = emailInput || await generateUniqueEmail(username);
    const existing = await queryOne(
      `SELECT id FROM users
       WHERE LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($2)`,
       [username, email]
    );
    if (existing) return sendError(res, 409, "Username or email already exists.");

    const id = makeId("user");
    await pool.query(
      "INSERT INTO users (id, name, username, email, password_hash) VALUES ($1,$2,$3,$4,$5)",
      [id, displayName || username, username, email, hashPassword(password)]
    );
    return sendJson(res, 201, { ok: true, user: { id, name: displayName || username, username, email } });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const identifier = String(body.username || body.email || body.identifier || "").trim();
    const password = String(body.password || "");

    if (!identifier || !password) return sendError(res, 400, "Username/email and password are required.");

    // If identifier looks like an email, we don't normalize it like a username
    const isEmail = identifier.includes("@");
    const normalizedIdentifier = isEmail ? identifier.toLowerCase() : normalizeUsername(identifier);

    const user = await queryOne(
      `SELECT id, name, username, email, password_hash
       FROM users
       WHERE LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($1)`,
      [normalizedIdentifier]
    );

    if (!user || !verifyPassword(password, user.password_hash)) {
      return sendError(res, 401, "Invalid username or password.");
    }

    return sendJson(res, 200, {
      ok: true,
      user: {
        id: user.id,
        name: user.name || user.username || normalizedIdentifier,
        username: user.username,
        email: user.email
      }
    });
  }

  if (method === "POST" && pathname === "/api/admin/auth/login") {
    const body = await parseBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) return sendError(res, 400, "Username and password are required.");
    if (username !== getAdminUsername() || password !== getAdminPassword()) {
      return sendError(res, 401, "Invalid admin credentials.");
    }
    return sendJson(res, 200, {
      ok: true,
      admin: { username },
      adminKey: process.env.ADMIN_KEY || "dev-admin-key-change-me"
    });
  }

  if (method === "GET" && pathname === "/api/cart") {
    const sessionId = String(urlObj.searchParams.get("sessionId") || "").trim();
    if (!sessionId) return sendError(res, 400, "sessionId is required.");
    await pool.query("INSERT INTO carts (session_id, offer_code, updated_at) VALUES ($1, '', NOW()) ON CONFLICT (session_id) DO NOTHING", [sessionId]);
    const [cartRow, itemsRes] = await Promise.all([
      queryOne("SELECT session_id, offer_code FROM carts WHERE session_id = $1", [sessionId]),
      pool.query(
        "SELECT ci.item_id AS id, m.name, m.price, ci.quantity, m.image FROM cart_items ci JOIN menu_items m ON m.id = ci.item_id WHERE ci.session_id = $1 ORDER BY m.name",
        [sessionId]
      )
    ]);
    const items = itemsRes.rows;
    const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
    const offerCode = cartRow.offer_code || "";
    let discount = 0;
    let appliedOffer = null;
    if (offerCode) {
      const offer = await queryOne("SELECT * FROM offers WHERE code = $1 AND is_active = TRUE", [offerCode]);
      if (offer && subtotal >= offer.min_order_value) {
        let isEligible = true;
        if (offer.is_new_user_only) {
          const prevOrders = await queryOne(
            "SELECT COUNT(*)::int as count FROM orders WHERE (session_id = $1 OR user_id = (SELECT id FROM users WHERE id = (SELECT id FROM carts WHERE session_id = $1 LIMIT 1))) AND status <> 'Cancelled'",
            [sessionId]
          );
          // Better way: Check if user is logged in and has orders, OR if sessionId has orders
          // Actually, let's just check if current sessionId or the user ID associated with this session has any past non-cancelled orders.
          const userCheck = await queryOne("SELECT id FROM users WHERE id IN (SELECT id FROM users WHERE email IN (SELECT email FROM users WHERE id = (SELECT id FROM carts WHERE session_id = $1 LIMIT 1)))", [sessionId]); // This is complex
          
          // Simplified: Just check if this sessionId OR any user associated with this sessionId in the 'orders' table has orders.
          const hasPastOrders = await queryOne(
            `SELECT 1 FROM orders 
             WHERE (session_id = $1 OR (user_id IS NOT NULL AND user_id IN (SELECT user_id FROM orders WHERE session_id = $1)))
             AND status <> 'Cancelled' LIMIT 1`, 
            [sessionId]
          );
          if (hasPastOrders) isEligible = false;
        }

        if (isEligible) {
          if (offer.discount_percent) discount = Math.round((subtotal * Number(offer.discount_percent)) / 100);
          if (offer.discount_flat) discount = Math.min(subtotal, Number(offer.discount_flat));
          appliedOffer = offer.code;
        }
      }
    }
    const deliveryFee = subtotal > 0 ? 39 : 0;
    const tax = Math.round((subtotal - discount) * 0.05);
    const total = subtotal - discount + deliveryFee + tax;
    return sendJson(res, 200, {
      ok: true,
      cart: {
        items,
        offerCode,
        pricing: { subtotal, discount, deliveryFee, tax, total, appliedOffer }
      }
    });
  }

  if (method === "POST" && pathname === "/api/cart/add") {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const itemId = String(body.itemId || "").trim();
    const quantity = Number(body.quantity || 1);
    if (!sessionId || !itemId || quantity < 1) return sendError(res, 400, "Invalid request.");
    const menu = await queryOne("SELECT id FROM menu_items WHERE id = $1 AND is_active = TRUE", [itemId]);
    if (!menu) return sendError(res, 404, "Menu item not found.");
    await pool.query("INSERT INTO carts (session_id, offer_code, updated_at) VALUES ($1, '', NOW()) ON CONFLICT (session_id) DO NOTHING", [sessionId]);
    await pool.query(
      "INSERT INTO cart_items (session_id, item_id, quantity) VALUES ($1,$2,$3) ON CONFLICT (session_id, item_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity",
      [sessionId, itemId, quantity]
    );
    emitRealtimeUpdate(sessionId, "cart_updated", { sessionId });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "PATCH" && pathname === "/api/cart/item") {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const itemId = String(body.itemId || "").trim();
    const quantity = Number(body.quantity || 0);
    if (!sessionId || !itemId) return sendError(res, 400, "Invalid request.");
    if (quantity <= 0) {
      await pool.query("DELETE FROM cart_items WHERE session_id = $1 AND item_id = $2", [sessionId, itemId]);
    } else {
      await pool.query("UPDATE cart_items SET quantity = $3 WHERE session_id = $1 AND item_id = $2", [sessionId, itemId, quantity]);
    }
    emitRealtimeUpdate(sessionId, "cart_updated", { sessionId });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/cart/offer") {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const offerCode = String(body.offerCode || "").trim().toUpperCase();
    if (!sessionId) return sendError(res, 400, "sessionId is required.");
    await pool.query("INSERT INTO carts (session_id, offer_code, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (session_id) DO UPDATE SET offer_code = EXCLUDED.offer_code, updated_at = NOW()", [sessionId, offerCode]);
    emitRealtimeUpdate(sessionId, "cart_updated", { sessionId });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/checkout") {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const userId = String(body.userId || "").trim();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const address = String(body.address || "").trim();
    const paymentMode = String(body.paymentMode || "COD").trim();
    const idem = String(body.idempotencyKey || "").trim();
    if (!sessionId || !name || !phone || !address) return sendError(res, 400, "Missing required checkout details.");

    if (idem) {
      const inMem = idempotencyMemory.get(idem);
      if (inMem) return sendJson(res, 200, { ok: true, ...inMem, idempotentReplay: true });
      const row = await queryOne("SELECT response_json FROM idempotency_keys WHERE key = $1", [idem]);
      if (row) {
        idempotencyMemory.set(idem, row.response_json);
        return sendJson(res, 200, { ok: true, ...row.response_json, idempotentReplay: true });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const [cart, itemsRes] = await Promise.all([
        queryOne("SELECT session_id, offer_code FROM carts WHERE session_id = $1", [sessionId]),
        client.query(
          "SELECT ci.item_id AS id, m.name, m.price, m.image, ci.quantity FROM cart_items ci JOIN menu_items m ON m.id = ci.item_id WHERE ci.session_id = $1",
          [sessionId]
        )
      ]);
      const items = itemsRes.rows;
      if (!cart || items.length === 0) throw new Error("Cart is empty.");
      const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
      let discount = 0;
      let appliedOffer = null;
      if (cart.offer_code) {
        const offer = await queryOne("SELECT * FROM offers WHERE code = $1 AND is_active = TRUE", [cart.offer_code]);
        if (offer && subtotal >= offer.min_order_value) {
          if (offer.discount_percent) discount = Math.round((subtotal * Number(offer.discount_percent)) / 100);
          if (offer.discount_flat) discount = Math.min(subtotal, Number(offer.discount_flat));
          appliedOffer = offer.code;
        }
      }
      const deliveryFee = 39;
      const tax = Math.round((subtotal - discount) * 0.05);
      const total = subtotal - discount + deliveryFee + tax;
      const orderId = makeId("order");
      const onlinePayment = isOnlinePaymentMode(paymentMode);
      const provider = String(paymentMode || "").toUpperCase() === "UPI" ? "upi_qr" : getEffectivePaymentProvider();
      const paymentStatus = onlinePayment ? "Pending" : "Pay on Delivery";
      const paymentIntentId = onlinePayment ? makeId("pay") : null;
      let paymentSession = null;

      await client.query(
        `INSERT INTO orders
        (id, session_id, user_id, customer_name, customer_phone, customer_address, payment_mode, payment_status, status, eta_minutes, subtotal, discount, delivery_fee, tax, total, applied_offer)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Confirmed',32,$9,$10,$11,$12,$13,$14)`,
        [orderId, sessionId, userId || null, name, phone, address, paymentMode, paymentStatus, subtotal, discount, deliveryFee, tax, total, appliedOffer]
      );
      for (const item of items) {
        await client.query(
          "INSERT INTO order_items (order_id, item_id, item_name, item_price, quantity, item_image) VALUES ($1,$2,$3,$4,$5,$6)",
          [orderId, item.id, item.name, item.price, item.quantity, item.image]
        );
      }
      await client.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Confirmed','Order placed')", [orderId]);

      if (onlinePayment) {
        await client.query(
          `INSERT INTO payment_transactions
           (id, order_id, provider, amount, currency, status, gateway_order_id, metadata)
           VALUES ($1,$2,$3,$4,$5,'pending',$6,$7::jsonb)`,
          [paymentIntentId, orderId, provider, total, PAYMENT_CURRENCY, null, JSON.stringify({ mode: paymentMode, customerName: name, customerPhone: phone })]
        );
        paymentSession = await buildPaymentSessionForOrder(
          { id: orderId, session_id: sessionId, customer_name: name, total, payment_mode: paymentMode },
          { id: paymentIntentId },
          client
        );
      }

      await client.query("DELETE FROM cart_items WHERE session_id = $1", [sessionId]);
      await client.query("DELETE FROM carts WHERE session_id = $1", [sessionId]);
      await client.query("COMMIT");

      const responsePayload = { orderId, etaMinutes: 32, paymentRequired: onlinePayment, paymentSession };
      if (idem) {
        idempotencyMemory.set(idem, responsePayload);
        await pool.query("INSERT INTO idempotency_keys (key, response_json) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO NOTHING", [
          idem,
          JSON.stringify(responsePayload)
        ]);
      }
      emitRealtimeUpdate(sessionId, "order_updated", { orderId, status: "Confirmed" });
      return sendJson(res, 201, { ok: true, ...responsePayload });
    } catch (err) {
      await client.query("ROLLBACK");
      return sendError(res, 400, err.message || "Checkout failed");
    } finally {
      client.release();
    }
  }

  if (method === "GET" && pathname === "/api/payments/config") {
    const provider = getEffectivePaymentProvider();
    return sendJson(res, 200, {
      ok: true,
      provider,
      currency: PAYMENT_CURRENCY,
      upiEnabled: Boolean(UPI_RECEIVER_VPA),
      upiReceiverVpa: UPI_RECEIVER_VPA || "",
      upiReceiverName: UPI_RECEIVER_NAME,
      razorpayEnabled: provider === "razorpay",
      razorpayKeyId: provider === "razorpay" ? RAZORPAY_KEY_ID : ""
    });
  }

  if (method === "POST" && pathname === "/api/payments/session") {
    const body = await parseBody(req);
    const orderId = String(body.orderId || "").trim();
    const sessionId = String(body.sessionId || "").trim();
    const userId = String(body.userId || "").trim();
    const phone = String(body.phone || "").trim();
    if (!orderId) return sendError(res, 400, "orderId is required.");

    const order = await queryOne("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (!order) return sendError(res, 404, "Order not found.");
    const authorized =
      (sessionId && sessionId === String(order.session_id || "")) ||
      (userId && userId === String(order.user_id || "")) ||
      (phone && phone === String(order.customer_phone || ""));
    if (sessionId || userId || phone) {
      if (!authorized) return sendError(res, 403, "Payment session access denied.");
    }
    if (!isOnlinePaymentMode(order.payment_mode)) return sendError(res, 400, "This order does not require online payment.");
    if (String(order.payment_status || "").toLowerCase() === "paid") {
      return sendJson(res, 200, { ok: true, alreadyPaid: true, paymentStatus: "Paid", orderId });
    }
    if (String(order.payment_status || "").toLowerCase() === "verification pending") {
      return sendError(res, 409, "Payment proof already submitted and pending manager verification.");
    }

    let txn = await queryOne("SELECT * FROM payment_transactions WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1", [orderId]);
    if (!txn) {
      const txnId = makeId("pay");
      await pool.query(
        `INSERT INTO payment_transactions
         (id, order_id, provider, amount, currency, status, metadata)
         VALUES ($1,$2,$3,$4,$5,'pending',$6::jsonb)`,
        [txnId, orderId, getEffectivePaymentProvider(), Number(order.total || 0), PAYMENT_CURRENCY, JSON.stringify({ mode: order.payment_mode })]
      );
      txn = await queryOne("SELECT * FROM payment_transactions WHERE id = $1", [txnId]);
    }

    const paymentSession = await buildPaymentSessionForOrder(order, { id: txn.id });
    return sendJson(res, 200, { ok: true, orderId, paymentRequired: true, paymentSession });
  }

  if (method === "POST" && pathname === "/api/payments/verify") {
    const body = await parseBody(req);
    const orderId = String(body.orderId || "").trim();
    const provider = String(body.provider || "").trim().toLowerCase();
    const gatewayOrderId = String(body.gatewayOrderId || "").trim();
    const gatewayPaymentId = String(body.gatewayPaymentId || "").trim();
    const signature = String(body.signature || "").trim();
    const paymentRef = String(body.paymentRef || "").trim();
    const mockSuccess = Boolean(body.mockSuccess);
    if (!orderId || !provider) return sendError(res, 400, "orderId and provider are required.");

    const order = await queryOne("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (!order) return sendError(res, 404, "Order not found.");
    if (String(order.status || "").toLowerCase() === "cancelled") {
      return sendError(res, 409, "Cancelled orders cannot accept payment proofs.");
    }
    if (String(order.payment_status || "").toLowerCase() === "paid") {
      return sendJson(res, 200, { ok: true, alreadyPaid: true, paymentStatus: "Paid", orderId });
    }

    let txn = await queryOne(
      "SELECT * FROM payment_transactions WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
      [orderId]
    );
    if (!txn) return sendError(res, 404, "Payment transaction not found.");

    if (provider === "mock") {
      if (!mockSuccess) return sendError(res, 400, "mockSuccess must be true for mock verification.");
      const ref = paymentRef || `MOCK-${Date.now()}`;
      await pool.query("UPDATE orders SET payment_status = 'Paid', payment_ref = $2 WHERE id = $1", [orderId, ref]);
      await pool.query(
        "UPDATE payment_transactions SET status = 'captured', gateway_payment_id = $2, gateway_signature = $3, captured_at = NOW() WHERE id = $1",
        [txn.id, ref, "mock_signature"]
      );
      await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Payment Confirmed',$2)", [orderId, `Ref: ${ref}`]);
      if (order.session_id) emitRealtimeUpdate(order.session_id, "order_updated", { orderId, paymentStatus: "Paid", status: order.status });
      return sendJson(res, 200, { ok: true, paymentStatus: "Paid", paymentRef: ref, orderId });
    }

    if (provider === "upi_qr") {
      const utr = String(body.utr || body.gatewayPaymentId || body.paymentRef || "").trim();
      if (!utr) return sendError(res, 400, "UTR/reference is required.");
      if (String(order.payment_status || "").toLowerCase() === "verification pending" && String(order.payment_ref || "") === utr) {
        return sendJson(res, 200, { ok: true, alreadySubmitted: true, paymentStatus: "Verification Pending", paymentRef: utr, orderId });
      }
      const duplicate = await queryOne(
        "SELECT id, order_id FROM payment_transactions WHERE gateway_payment_id = $1 AND order_id <> $2 LIMIT 1",
        [utr, orderId]
      );
      if (duplicate) return sendError(res, 409, "This UTR/reference is already used for another order.");

      // If the last attempt was rejected/failed, create a fresh transaction so the customer can resubmit proof
      // until it is accepted or the order is cancelled.
      const lastStatus = String(txn.status || "").trim().toLowerCase();
      if (lastStatus && lastStatus !== "pending" && lastStatus !== "submitted") {
        const txnId = makeId("pay");
        await pool.query(
          `INSERT INTO payment_transactions
           (id, order_id, provider, amount, currency, status, metadata)
           VALUES ($1,$2,$3,$4,$5,'pending',$6::jsonb)`,
          [
            txnId,
            orderId,
            "upi_qr",
            Number(order.total || 0),
            PAYMENT_CURRENCY,
            JSON.stringify({ mode: order.payment_mode, resubmission: true, previousTxnId: txn.id, createdAt: new Date().toISOString() })
          ]
        );
        txn = await queryOne("SELECT * FROM payment_transactions WHERE id = $1", [txnId]);
      }

      await pool.query("UPDATE orders SET payment_status = 'Verification Pending', payment_ref = $2 WHERE id = $1", [orderId, utr]);
      await pool.query(
        "UPDATE payment_transactions SET status = 'submitted', gateway_payment_id = $2, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb WHERE id = $1",
        [txn.id, utr, JSON.stringify({ submittedBy: "customer", submittedAt: new Date().toISOString() })]
      );
      await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Payment Submitted',$2)", [orderId, `UPI Ref submitted: ${utr}`]);
      if (order.session_id) emitRealtimeUpdate(order.session_id, "order_updated", { orderId, paymentStatus: "Verification Pending", status: order.status });
      return sendJson(res, 200, { ok: true, paymentStatus: "Verification Pending", paymentRef: utr, orderId, verificationRequired: true });
    }

    if (provider === "razorpay") {
      if (!gatewayOrderId || !gatewayPaymentId || !signature) {
        return sendError(res, 400, "gatewayOrderId, gatewayPaymentId and signature are required.");
      }
      const expectedOrderId = String(txn.gateway_order_id || "");
      if (!expectedOrderId || expectedOrderId !== gatewayOrderId) {
        return sendError(res, 400, "Gateway order mismatch.");
      }
      const valid = verifyRazorpayPaymentSignature({
        razorpayOrderId: gatewayOrderId,
        razorpayPaymentId: gatewayPaymentId,
        razorpaySignature: signature
      });
      if (!valid) return sendError(res, 400, "Invalid payment signature.");

      await pool.query("UPDATE orders SET payment_status = 'Paid', payment_ref = $2 WHERE id = $1", [orderId, gatewayPaymentId]);
      await pool.query(
        "UPDATE payment_transactions SET status = 'captured', gateway_payment_id = $2, gateway_signature = $3, captured_at = NOW() WHERE id = $1",
        [txn.id, gatewayPaymentId, signature]
      );
      await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Payment Confirmed',$2)", [orderId, `Ref: ${gatewayPaymentId}`]);
      if (order.session_id) emitRealtimeUpdate(order.session_id, "order_updated", { orderId, paymentStatus: "Paid", status: order.status });
      return sendJson(res, 200, { ok: true, paymentStatus: "Paid", paymentRef: gatewayPaymentId, orderId });
    }

    return sendError(res, 400, "Unsupported provider.");
  }

  if (method === "POST" && pathname === "/api/payments/attempt") {
    const body = await parseBody(req);
    const orderId = String(body.orderId || "").trim();
    const status = String(body.status || "").trim().toLowerCase();
    const reason = String(body.reason || "").trim();
    const allowed = new Set(["failed", "cancelled", "pending"]);
    if (!orderId || !allowed.has(status)) return sendError(res, 400, "orderId and valid status are required.");

    const order = await queryOne("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (!order) return sendError(res, 404, "Order not found.");

    const txn = await queryOne("SELECT * FROM payment_transactions WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1", [orderId]);
    if (!txn) return sendError(res, 404, "Payment transaction not found.");

    await pool.query(
      "UPDATE payment_transactions SET status = $2, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb WHERE id = $1",
      [txn.id, status, JSON.stringify({ lastAttemptReason: reason || "", updatedAt: new Date().toISOString() })]
    );
    await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Payment Update',$2)", [
      orderId,
      `Payment ${status}${reason ? `: ${reason}` : ""}`
    ]);
    if (order.session_id) emitRealtimeUpdate(order.session_id, "order_updated", { orderId, paymentStatus: order.payment_status, paymentAttempt: status });
    return sendJson(res, 200, { ok: true, orderId, paymentAttempt: status });
  }

  if (method === "POST" && pathname === "/api/webhooks/razorpay") {
    const signature = String(req.headers["x-razorpay-signature"] || "").trim();
    if (!RAZORPAY_WEBHOOK_SECRET) return sendError(res, 503, "Webhook secret not configured.");
    let raw = "";
    await new Promise((resolve, reject) => {
      req.on("data", (chunk) => {
        raw += chunk.toString();
        if (raw.length > 1_000_000) reject(new Error("Payload too large"));
      });
      req.on("end", resolve);
      req.on("error", reject);
    });
    if (!signature || !verifyRazorpayWebhookSignature(raw, signature)) {
      return sendError(res, 401, "Invalid webhook signature.");
    }
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return sendError(res, 400, "Invalid webhook payload.");
    }
    const event = String(payload.event || "").trim();
    const paymentEntity = payload?.payload?.payment?.entity || {};
    if (event === "payment.captured") {
      const gatewayOrderId = String(paymentEntity.order_id || "").trim();
      const gatewayPaymentId = String(paymentEntity.id || "").trim();
      if (gatewayOrderId && gatewayPaymentId) {
        const txn = await queryOne("SELECT * FROM payment_transactions WHERE gateway_order_id = $1 ORDER BY created_at DESC LIMIT 1", [gatewayOrderId]);
        if (txn) {
          const order = await queryOne("SELECT * FROM orders WHERE id = $1", [txn.order_id]);
          if (order && String(order.payment_status || "").toLowerCase() !== "paid") {
            await pool.query("UPDATE orders SET payment_status = 'Paid', payment_ref = $2 WHERE id = $1", [order.id, gatewayPaymentId]);
            await pool.query(
              "UPDATE payment_transactions SET status = 'captured', gateway_payment_id = $2, captured_at = NOW() WHERE id = $1",
              [txn.id, gatewayPaymentId]
            );
            await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Payment Confirmed',$2)", [order.id, `Ref: ${gatewayPaymentId} (webhook)`]);
            if (order.session_id) emitRealtimeUpdate(order.session_id, "order_updated", { orderId: order.id, paymentStatus: "Paid", status: order.status });
          }
        }
      }
    }
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/orders") {
    const sessionId = String(urlObj.searchParams.get("sessionId") || "").trim();
    const userId = String(urlObj.searchParams.get("userId") || "").trim();
    const phone = String(urlObj.searchParams.get("phone") || "").trim();
    if (!sessionId && !userId && !phone) return sendError(res, 400, "sessionId or userId or phone is required.");

    const where = [];
    const params = [];
    if (sessionId) { params.push(sessionId); where.push(`session_id = $${params.length}`); }
    if (userId) { params.push(userId); where.push(`user_id = $${params.length}`); }
    if (phone) { params.push(phone); where.push(`customer_phone = $${params.length}`); }
    const rows = await pool.query(`SELECT * FROM orders WHERE ${where.join(" OR ")} ORDER BY created_at DESC`, params);

    const orders = [];
    for (const row of rows.rows) {
      const [itemsRes, histRes] = await Promise.all([
        pool.query("SELECT item_id AS id, item_name AS name, item_price AS price, quantity, item_image AS image FROM order_items WHERE order_id = $1", [row.id]),
        pool.query("SELECT status, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC", [row.id])
      ]);
      const hist = histRes.rows.map((h) => ({ status: h.status, at: h.created_at, note: h.note || "" }));
      orders.push(toOrderDto(row, itemsRes.rows, hist));
    }
    const currentOrders = orders.filter((o) => o.status !== "Delivered" && o.status !== "Cancelled");
    const pastOrders = orders.filter((o) => o.status === "Delivered" || o.status === "Cancelled");
    return sendJson(res, 200, { ok: true, currentOrders, pastOrders });
  }

  if (method === "GET" && pathname.startsWith("/api/orders/") && pathname.endsWith("/support")) {
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[2] || "";
    const order = await queryOne("SELECT id FROM orders WHERE id = $1", [orderId]);
    if (!order) return sendError(res, 404, "Order not found.");

    const [ticketRows, replyRows] = await Promise.all([
      pool.query(
        "SELECT id, order_id AS \"orderId\", message, status, created_at AS \"createdAt\", manager_reply AS \"managerReply\", manager_reply_at AS \"managerReplyAt\", manager_reply_by AS \"managerReplyBy\" FROM support_tickets WHERE order_id = $1 ORDER BY created_at DESC",
        [orderId]
      ),
      pool.query(
        `SELECT r.ticket_id, r.author_type, r.author_name, r.message, r.created_at
         FROM support_ticket_replies r
         JOIN support_tickets t ON t.id = r.ticket_id
         WHERE t.order_id = $1
         ORDER BY r.created_at ASC`,
        [orderId]
      )
    ]);

    const repliesByTicket = new Map();
    for (const reply of replyRows.rows) {
      if (!repliesByTicket.has(reply.ticket_id)) repliesByTicket.set(reply.ticket_id, []);
      repliesByTicket.get(reply.ticket_id).push({
        authorType: reply.author_type,
        authorName: reply.author_name || "",
        message: reply.message,
        at: reply.created_at
      });
    }

    const tickets = ticketRows.rows.map((ticket) => ({
      ...ticket,
      replies: repliesByTicket.get(ticket.id) || []
    }));

    return sendJson(res, 200, { ok: true, tickets });
  }

  if (method === "POST" && pathname.startsWith("/api/support/tickets/") && pathname.endsWith("/replies")) {
    const parts = pathname.split("/").filter(Boolean);
    const ticketId = parts[3] || "";
    const body = await parseBody(req);
    const message = String(body.message || "").trim();
    const authorName = String(body.authorName || "Customer").trim();

    if (!ticketId || !message) return sendError(res, 400, "ticketId and message are required.");

    const ticket = await queryOne("SELECT id, order_id FROM support_tickets WHERE id = $1", [ticketId]);
    if (!ticket) return sendError(res, 404, "Ticket not found.");

    await pool.query(
      "INSERT INTO support_ticket_replies (ticket_id, author_type, author_name, message) VALUES ($1, 'customer', $2, $3)",
      [ticketId, authorName, message]
    );

    const order = await queryOne("SELECT session_id FROM orders WHERE id = $1", [ticket.order_id]);
    if (order?.session_id) {
      emitRealtimeUpdate(order.session_id, "support_updated", {
        ticketId,
        orderId: ticket.order_id,
        authorType: "customer"
      });
    }

    return sendJson(res, 200, { ok: true, ticketId });
  }

  if (method === "GET" && pathname.startsWith("/api/orders/")) {
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[2] || "";
    const order = await fetchOrderWithDetails(orderId);
    if (!order) return sendError(res, 404, "Order not found.");
    return sendJson(res, 200, { ok: true, order });
  }

  if (method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/cancel")) {
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[2] || "";
    const body = await parseBody(req);
    const reason = String(body.reason || "Cancelled by user").trim();
    const existing = await queryOne("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (!existing) return sendError(res, 404, "Order not found.");
    if (!canCancelOrder(existing)) return sendError(res, 409, "Order cannot be cancelled at this stage.");
    await pool.query("UPDATE orders SET status = 'Cancelled', cancel_reason = $2, cancelled_at = NOW() WHERE id = $1", [orderId, reason]);
    await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Cancelled',$2)", [orderId, reason]);
    const updated = await fetchOrderWithDetails(orderId);
    if (updated?.sessionId) emitRealtimeUpdate(updated.sessionId, "order_updated", { orderId, status: "Cancelled" });
    return sendJson(res, 200, { ok: true, order: updated });
  }

  if (method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/reorder")) {
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[2] || "";
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) return sendError(res, 400, "sessionId is required.");
    const itemsRes = await pool.query("SELECT item_id, quantity FROM order_items WHERE order_id = $1", [orderId]);
    if (itemsRes.rows.length === 0) return sendError(res, 404, "Order not found.");
    await pool.query("INSERT INTO carts (session_id, offer_code, updated_at) VALUES ($1,'',NOW()) ON CONFLICT (session_id) DO NOTHING", [sessionId]);
    for (const item of itemsRes.rows) {
      await pool.query(
        "INSERT INTO cart_items (session_id, item_id, quantity) VALUES ($1,$2,$3) ON CONFLICT (session_id, item_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity",
        [sessionId, item.item_id, item.quantity]
      );
    }
    emitRealtimeUpdate(sessionId, "cart_updated", { sessionId });
    return sendJson(res, 200, { ok: true, addedItems: itemsRes.rows.length });
  }

  if (method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/support")) {
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[2] || "";
    const body = await parseBody(req);
    const message = String(body.message || "").trim();
    if (!message) return sendError(res, 400, "Support message is required.");
    const order = await queryOne("SELECT id, session_id FROM orders WHERE id = $1", [orderId]);
    if (!order) return sendError(res, 404, "Order not found.");
    const ticketId = makeId("ticket");
    await pool.query("INSERT INTO support_tickets (id, order_id, message) VALUES ($1,$2,$3)", [ticketId, orderId, message]);
    await pool.query(
      "INSERT INTO support_ticket_replies (ticket_id, author_type, author_name, message) VALUES ($1, 'customer', $2, $3)",
      [ticketId, "Customer", message]
    );
    if (order.session_id) emitRealtimeUpdate(order.session_id, "support_updated", { orderId, ticketId, status: "open" });
    return sendJson(res, 200, { ok: true, ticketId, status: "open", message: "Support request received." });
  }

  if (method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/pay")) {
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[2] || "";
    const body = await parseBody(req);
    const paymentRef = String(body.paymentRef || makeId("payref")).trim();
    const updated = await queryOne("UPDATE orders SET payment_status = 'Paid', payment_ref = $2 WHERE id = $1 RETURNING *", [orderId, paymentRef]);
    if (!updated) return sendError(res, 404, "Order not found.");
    await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Payment Confirmed',$2)", [orderId, `Ref: ${paymentRef}`]);
    if (updated.session_id) emitRealtimeUpdate(updated.session_id, "order_updated", { orderId, status: updated.status, paymentStatus: "Paid" });
    return sendJson(res, 200, { ok: true, paymentStatus: "Paid", paymentRef });
  }

  if (method === "POST" && pathname.startsWith("/api/admin/orders/") && pathname.endsWith("/status")) {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[3] || "";
    const body = await parseBody(req);
    const status = String(body.status || "").trim();
    const note = String(body.note || "").trim();
    const allowed = new Set(["Preparing", "Out for Delivery", "Delivered", "Cancelled"]);
    if (!allowed.has(status)) return sendError(res, 400, "Invalid status transition.");
    const existing = await queryOne("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (!existing) return sendError(res, 404, "Order not found.");
    if (existing.status === "Cancelled") return sendError(res, 409, "Cancelled order cannot be progressed.");
    const paymentStatus = status === "Delivered" && existing.payment_mode === "COD" ? "Paid" : existing.payment_status;
    const updated = await queryOne(
      "UPDATE orders SET status = $2, payment_status = $3, delivered_at = CASE WHEN $2 = 'Delivered' THEN NOW() ELSE delivered_at END WHERE id = $1 RETURNING *",
      [orderId, status, paymentStatus]
    );
    await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,$2,$3)", [orderId, status, note || "Updated by kitchen"]);
    const dto = await fetchOrderWithDetails(orderId);
    if (updated.session_id) emitRealtimeUpdate(updated.session_id, "order_updated", { orderId, status, paymentStatus });
    return sendJson(res, 200, { ok: true, order: dto });
  }

  if (method === "POST" && pathname.startsWith("/api/admin/orders/") && pathname.endsWith("/payment-verify")) {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[3] || "";
    const body = await parseBody(req);
    const approve = body.approve !== false;
    const note = String(body.note || "").trim();
    const paymentRefInput = String(body.paymentRef || "").trim();
    if (!orderId) return sendError(res, 400, "orderId is required.");

    const order = await queryOne("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (!order) return sendError(res, 404, "Order not found.");
    const txn = await queryOne("SELECT * FROM payment_transactions WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1", [orderId]);
    if (!txn) return sendError(res, 404, "Payment transaction not found.");

    if (approve) {
      const paymentRef = paymentRefInput || txn.gateway_payment_id || order.payment_ref || `MANUAL-${Date.now()}`;
      await pool.query("UPDATE orders SET payment_status = 'Paid', payment_ref = $2 WHERE id = $1", [orderId, paymentRef]);
      await pool.query(
        "UPDATE payment_transactions SET status = 'captured', gateway_payment_id = COALESCE(NULLIF($2, ''), gateway_payment_id), captured_at = NOW(), metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb WHERE id = $1",
        [txn.id, paymentRef, JSON.stringify({ verifiedBy: getAdminUsername(), verifyNote: note || "Verified by manager", verifiedAt: new Date().toISOString() })]
      );
      await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Payment Confirmed',$2)", [
        orderId,
        note || `Verified by manager. Ref: ${paymentRef}`
      ]);
      if (order.session_id) emitRealtimeUpdate(order.session_id, "order_updated", { orderId, paymentStatus: "Paid", status: order.status });
      const dto = await fetchOrderWithDetails(orderId);
      return sendJson(res, 200, { ok: true, order: dto, paymentStatus: "Paid", paymentRef });
    }

    await pool.query("UPDATE orders SET payment_status = 'Pending' WHERE id = $1", [orderId]);
    await pool.query(
      "UPDATE payment_transactions SET status = 'failed', metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1",
      [txn.id, JSON.stringify({ rejectedBy: getAdminUsername(), rejectNote: note || "Rejected by manager", rejectedAt: new Date().toISOString() })]
    );
    // Clear ref so customer can submit a new proof cleanly.
    await pool.query("UPDATE orders SET payment_ref = NULL WHERE id = $1", [orderId]);
    await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,'Payment Rejected',$2)", [
      orderId,
      note || "Payment proof rejected by manager"
    ]);
    if (order.session_id) emitRealtimeUpdate(order.session_id, "order_updated", { orderId, paymentStatus: "Pending", status: order.status });
    const dto = await fetchOrderWithDetails(orderId);
    return sendJson(res, 200, { ok: true, order: dto, paymentStatus: "Pending" });
  }

  if (method === "POST" && pathname.startsWith("/api/admin/orders/") && pathname.endsWith("/payment-status")) {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[3] || "";
    const body = await parseBody(req);
    const paymentStatus = String(body.paymentStatus || "").trim();
    const paymentRefInput = String(body.paymentRef || "").trim();
    if (!orderId) return sendError(res, 400, "orderId is required.");
    if (!paymentStatus) return sendError(res, 400, "paymentStatus is required.");

    const allowed = new Set(["Paid", "Pending", "Pay on Delivery"]);
    if (!allowed.has(paymentStatus)) return sendError(res, 400, "Invalid paymentStatus.");

    const order = await queryOne("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (!order) return sendError(res, 404, "Order not found.");
    if (String(order.status || "").toLowerCase() === "cancelled") {
      return sendError(res, 409, "Cancelled orders cannot change payment status.");
    }
    if (String(order.payment_mode || "").trim().toUpperCase() !== "COD") {
      return sendError(res, 409, "Manual payment status updates are only allowed for COD orders.");
    }

    const paymentRef = paymentStatus === "Paid" ? (paymentRefInput || order.payment_ref || `COD-${Date.now()}`) : null;
    await pool.query("UPDATE orders SET payment_status = $2, payment_ref = $3 WHERE id = $1", [orderId, paymentStatus, paymentRef]);
    await pool.query("INSERT INTO order_status_history (order_id, status, note) VALUES ($1,$2,$3)", [
      orderId,
      paymentStatus === "Paid" ? "Payment Confirmed" : "Payment Update",
      paymentStatus === "Paid" ? `COD marked paid. Ref: ${paymentRef}` : `COD payment status -> ${paymentStatus}`
    ]);
    if (order.session_id) emitRealtimeUpdate(order.session_id, "order_updated", { orderId, paymentStatus });
    const dto = await fetchOrderWithDetails(orderId);
    return sendJson(res, 200, { ok: true, order: dto, paymentStatus, paymentRef: paymentRef || "" });
  }

  if (method === "GET" && pathname === "/api/admin/analytics") {
    if (!isAdminAuthorized(req)) return sendError(res, 401, "Invalid admin key.");
    const fromRaw = String(urlObj.searchParams.get("from") || "").trim();
    const toRaw = String(urlObj.searchParams.get("to") || "").trim();
    const from = fromRaw ? new Date(fromRaw) : null;
    const to = toRaw ? new Date(toRaw) : null;
    if ((fromRaw && Number.isNaN(from?.getTime?.())) || (toRaw && Number.isNaN(to?.getTime?.()))) {
      return sendError(res, 400, "Invalid from/to timestamp.");
    }

    const params = [];
    const where = [];
    if (from) {
      params.push(from.toISOString());
      where.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(to.toISOString());
      where.push(`created_at <= $${params.length}::timestamptz`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [
      summaryRes,
      statusRes,
      paymentModeRes,
      hourlyRes,
      topItemsRes,
      topCustomersRes,
      pendingPaymentsRes
    ] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*)::int AS orders,
          COALESCE(SUM(total),0)::int AS revenue,
          COALESCE(ROUND(AVG(total))::int, 0) AS aov,
          COUNT(*) FILTER (WHERE status = 'Delivered')::int AS delivered,
          COUNT(*) FILTER (WHERE status = 'Cancelled')::int AS cancelled
         FROM orders
         ${whereSql}`,
        params
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM orders
         ${whereSql}
         GROUP BY status
         ORDER BY count DESC`,
        params
      ),
      pool.query(
        `SELECT payment_mode AS mode, COUNT(*)::int AS count
         FROM orders
         ${whereSql}
         GROUP BY payment_mode
         ORDER BY count DESC`,
        params
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS count
         FROM orders
         ${whereSql}
         GROUP BY hour
         ORDER BY hour ASC`,
        params
      ),
      pool.query(
        `SELECT
          oi.item_name AS name,
          SUM(oi.quantity)::int AS qty,
          SUM(oi.quantity * oi.item_price)::int AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         ${where.length ? `WHERE ${where.map((w) => w.replace(/created_at/g, "o.created_at")).join(" AND ")}` : ""}
         GROUP BY oi.item_name
         ORDER BY qty DESC, revenue DESC
         LIMIT 20`,
        params
      ),
      pool.query(
        `SELECT
          o.customer_phone AS phone,
          MIN(o.customer_name) AS name,
          COUNT(*)::int AS orders,
          COALESCE(SUM(o.total),0)::int AS spend
         FROM orders o
         ${where.length ? `WHERE ${where.map((w) => w.replace(/created_at/g, "o.created_at")).join(" AND ")}` : ""}
         GROUP BY o.customer_phone
         ORDER BY orders DESC, spend DESC
         LIMIT 20`,
        params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS pendingPayments
         FROM orders
         ${whereSql}
         AND LOWER(payment_status) IN ('pending','verification pending')`,
        params
      ).catch(async () => {
        // Fallback for when whereSql is empty (can't prepend AND)
        const w = whereSql ? `${whereSql} AND` : "WHERE";
        const sql = `SELECT COUNT(*)::int AS pendingPayments FROM orders ${w} LOWER(payment_status) IN ('pending','verification pending')`;
        return await pool.query(sql, params);
      })
    ]);

    const summary = summaryRes.rows[0] || {};
    const pendingPayments = pendingPaymentsRes.rows[0]?.pendingpayments ?? pendingPaymentsRes.rows[0]?.pendingPayments ?? 0;

    return sendJson(res, 200, {
      ok: true,
      range: { from: from ? from.toISOString() : "", to: to ? to.toISOString() : "" },
      summary: { ...summary, pendingPayments },
      statuses: statusRes.rows || [],
      paymentModes: paymentModeRes.rows || [],
      hourly: hourlyRes.rows || [],
      topItems: topItemsRes.rows || [],
      topCustomers: topCustomersRes.rows || []
    });
  }

  return sendError(res, 404, "Endpoint not found.");
}

async function handleStatic(req, res, urlObj) {
  let pathname = urlObj.pathname;

  // Root path now serves the Customer React app
  if (pathname === "/") {
    pathname = "/customer-react/index.html";
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendError(res, 403, "Forbidden");
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      const content = await fsp.readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(content);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = contentTypes[ext] || "application/octet-stream";
    const stream = fs.createReadStream(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400"
    });
    stream.pipe(res);
  } catch {
    // SPA Fallback logic for React Router
    let fallbackFile = "/customer-react/index.html";
    if (urlObj.pathname === "/admin-react" || urlObj.pathname.startsWith("/admin-react/")) {
      fallbackFile = "/admin-react/index.html";
    }

    try {
      const indexPath = path.join(PUBLIC_DIR, fallbackFile);
      const content = await fsp.readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    } catch {
      // If even the fallback fails, return a 404
      sendError(res, 404, "File not found");
    }
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
    });
    return res.end();
  }
  try {
    if (urlObj.pathname.startsWith("/api/")) return await handleApi(req, res, urlObj);
    return await handleStatic(req, res, urlObj);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error.");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Cloud Kitchen Postgres app running at http://localhost:${PORT}`);
});
