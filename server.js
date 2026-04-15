const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { loadEnv } = require("./config/load-env");

loadEnv();

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "server", "data");

const DATA_FILES = {
  menu: path.join(DATA_DIR, "menu.json"),
  offers: path.join(DATA_DIR, "offers.json"),
  users: path.join(DATA_DIR, "users.json"),
  carts: path.join(DATA_DIR, "carts.json"),
  orders: path.join(DATA_DIR, "orders.json")
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const sseClients = new Map();
const idempotencyStore = new Map();

function getAdminKey() {
  return process.env.ADMIN_KEY || "dev-admin-key-change-me";
}

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

function sendSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addSseClient(channelKey, res) {
  if (!sseClients.has(channelKey)) {
    sseClients.set(channelKey, new Set());
  }
  sseClients.get(channelKey).add(res);
}

function removeSseClient(channelKey, res) {
  if (!sseClients.has(channelKey)) return;
  sseClients.get(channelKey).delete(res);
  if (sseClients.get(channelKey).size === 0) {
    sseClients.delete(channelKey);
  }
}

function emitRealtimeUpdate(channelKey, event, payload) {
  const clients = sseClients.get(channelKey);
  if (!clients) return;
  for (const res of clients) {
    sendSseEvent(res, event, payload);
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function hashPassword(plain) {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
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

function subtotalFromCart(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function applyOffer(subtotal, offerCode, offers) {
  if (!offerCode) return { discount: 0, appliedOffer: null };
  const offer = offers.find((x) => x.code.toUpperCase() === String(offerCode).toUpperCase());
  if (!offer) return { discount: 0, appliedOffer: null };
  if (subtotal < offer.minOrderValue) return { discount: 0, appliedOffer: null };

  if (offer.discountPercent) {
    return {
      discount: Math.round((subtotal * offer.discountPercent) / 100),
      appliedOffer: offer.code
    };
  }
  if (offer.discountFlat) {
    return {
      discount: Math.min(subtotal, offer.discountFlat),
      appliedOffer: offer.code
    };
  }
  return { discount: 0, appliedOffer: null };
}

function getOrderStatus(order) {
  if (order.status === "Cancelled") return "Cancelled";
  if (order.status === "Delivered") return "Delivered";
  if (order.status === "Out for Delivery") return "Out for Delivery";
  if (order.status === "Preparing") return "Preparing";
  const createdAtMs = new Date(order.createdAt).getTime();
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - createdAtMs) / 60000));
  const totalEtaMinutes = Number(order.etaMinutes || 32);

  if (elapsedMinutes < 5) return "Confirmed";
  if (elapsedMinutes < 15) return "Preparing";
  if (elapsedMinutes < totalEtaMinutes) return "Out for Delivery";
  return "Delivered";
}

function canCancelOrder(order) {
  const status = getOrderStatus(order);
  if (status === "Cancelled" || status === "Delivered") return false;
  return true;
}

function enrichOrder(order) {
  const status = getOrderStatus(order);
  const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [{ status: "Confirmed", at: order.createdAt }];
  const historyWithComputed = [...statusHistory];
  const hasComputed = historyWithComputed.some((entry) => entry.status === status);
  if (!hasComputed) {
    historyWithComputed.push({ status, at: new Date().toISOString(), note: "Auto-updated by system clock" });
  }
  return {
    ...order,
    status,
    paymentStatus: order.paymentStatus || (order.paymentMode === "COD" ? "Pay on Delivery" : "Pending"),
    canCancel: canCancelOrder(order),
    statusHistory: historyWithComputed
  };
}

function getDayOfYear(dateObj) {
  const start = new Date(Date.UTC(dateObj.getUTCFullYear(), 0, 0));
  const diff = dateObj - start;
  return Math.floor(diff / 86400000);
}

function getTodaysSpecial(menu) {
  const candidates = menu.filter((item) => item.category !== "Beverages");
  if (candidates.length === 0) return null;
  const now = new Date();
  const index = getDayOfYear(now) % candidates.length;
  return {
    ...candidates[index],
    label: "Today's Special",
    validDate: now.toISOString().slice(0, 10)
  };
}

function getOrderIdFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length >= 3 ? parts[2] : "";
}

async function handleApi(req, res, urlObj) {
  const pathname = urlObj.pathname;
  const method = req.method;

  const [menu, offers, users, carts, orders] = await Promise.all([
    readJson(DATA_FILES.menu, []),
    readJson(DATA_FILES.offers, []),
    readJson(DATA_FILES.users, []),
    readJson(DATA_FILES.carts, {}),
    readJson(DATA_FILES.orders, [])
  ]);

  const adminKeyHeader = String(req.headers["x-admin-key"] || "");
  const isAdmin = adminKeyHeader === getAdminKey();

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
    return sendJson(res, 200, { ok: true, service: "cloud-kitchen-api", time: new Date().toISOString() });
  }

  if (method === "GET" && pathname === "/api/menu") {
    const category = urlObj.searchParams.get("category");
    const search = (urlObj.searchParams.get("search") || "").trim().toLowerCase();

    let list = menu;
    if (category && category !== "All") {
      list = list.filter((item) => item.category === category);
    }
    if (search) {
      list = list.filter((item) => item.name.toLowerCase().includes(search));
    }
    return sendJson(res, 200, { ok: true, items: list });
  }

  if (method === "GET" && pathname === "/api/categories") {
    const categories = ["All", ...new Set(menu.map((m) => m.category))];
    return sendJson(res, 200, { ok: true, categories });
  }

  if (method === "GET" && pathname === "/api/offers") {
    return sendJson(res, 200, { ok: true, offers });
  }

  if (method === "GET" && pathname === "/api/special/today") {
    return sendJson(res, 200, { ok: true, special: getTodaysSpecial(menu) });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!name || !email || !password) {
      return sendError(res, 400, "Name, email, and password are required.");
    }

    const exists = users.find((u) => u.email === email);
    if (exists) return sendError(res, 409, "User already exists.");

    const newUser = {
      id: makeId("user"),
      name,
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    await writeJson(DATA_FILES.users, users);
    return sendJson(res, 201, {
      ok: true,
      user: { id: newUser.id, name: newUser.name, email: newUser.email }
    });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const passwordHash = hashPassword(password);

    const user = users.find((u) => u.email === email && u.passwordHash === passwordHash);
    if (!user) return sendError(res, 401, "Invalid credentials.");

    return sendJson(res, 200, {
      ok: true,
      user: { id: user.id, name: user.name, email: user.email }
    });
  }

  if (method === "POST" && pathname === "/api/admin/auth/login") {
    const body = await parseBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const adminUsername = process.env.ADMIN_USERNAME || "manager";
    const adminPassword = process.env.ADMIN_PASSWORD || "manager123";
    if (!username || !password) return sendError(res, 400, "Username and password are required.");
    if (username !== adminUsername || password !== adminPassword) {
      return sendError(res, 401, "Invalid admin credentials.");
    }
    return sendJson(res, 200, {
      ok: true,
      admin: { username },
      adminKey: process.env.ADMIN_KEY || "dev-admin-key-change-me"
    });
  }

  // Admin dashboard endpoints (JSON-mode backend)
  if (method === "GET" && pathname === "/api/admin/overview") {
    if (!isAdmin) return sendError(res, 401, "Invalid admin key.");
    const enriched = orders.map(enrichOrder);
    const total_orders = enriched.length;
    const active_orders = enriched.filter((o) => ["Confirmed", "Preparing", "Out for Delivery"].includes(o.status)).length;
    const delivered_orders = enriched.filter((o) => o.status === "Delivered").length;
    const cancelled_orders = enriched.filter((o) => o.status === "Cancelled").length;
    const pending_payments = enriched.filter((o) => String(o.paymentStatus || "").toLowerCase() === "pending").length;
    const gross_revenue = enriched.reduce((sum, o) => sum + Number(o.pricing?.total || 0), 0);
    return sendJson(res, 200, {
      ok: true,
      metrics: {
        total_orders,
        active_orders,
        delivered_orders,
        cancelled_orders,
        pending_payments,
        pending_verifications: 0,
        gross_revenue,
        total_chefs: 0,
        on_duty_chefs: 0,
        open_tickets: 0
      }
    });
  }

  if (method === "GET" && pathname === "/api/admin/orders") {
    if (!isAdmin) return sendError(res, 401, "Invalid admin key.");
    const statusFilter = String(urlObj.searchParams.get("status") || "").trim();
    const search = String(urlObj.searchParams.get("search") || "").trim().toLowerCase();
    const list = orders
      .map(enrichOrder)
      .filter((o) => {
        if (statusFilter && o.status !== statusFilter) return false;
        if (!search) return true;
        const hay = `${o.id} ${o.customer?.name || ""} ${o.customer?.phone || ""}`.toLowerCase();
        return hay.includes(search);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100)
      .map((o) => ({
        id: o.id,
        status: o.status,
        paymentStatus: o.paymentStatus || "Pending",
        customerName: o.customer?.name || "",
        customerPhone: o.customer?.phone || "",
        total: Number(o.pricing?.total || 0),
        createdAt: o.createdAt,
        assignedChef: null,
        totalItems: Array.isArray(o.items) ? o.items.length : 0,
        assignedItems: 0
      }));
    return sendJson(res, 200, { ok: true, orders: list });
  }

  if (method === "GET" && pathname === "/api/admin/chefs") {
    if (!isAdmin) return sendError(res, 401, "Invalid admin key.");
    return sendJson(res, 200, { ok: true, chefs: [] });
  }

  if (method === "GET" && pathname === "/api/admin/tickets") {
    if (!isAdmin) return sendError(res, 401, "Invalid admin key.");
    return sendJson(res, 200, { ok: true, tickets: [] });
  }

  if (method === "GET" && pathname === "/api/cart") {
    const sessionId = String(urlObj.searchParams.get("sessionId") || "").trim();
    if (!sessionId) return sendError(res, 400, "sessionId is required.");
    const cart = carts[sessionId] || { items: [], offerCode: "" };
    const subtotal = subtotalFromCart(cart);
    const { discount, appliedOffer } = applyOffer(subtotal, cart.offerCode, offers);
    const deliveryFee = subtotal > 0 ? 39 : 0;
    const tax = Math.round((subtotal - discount) * 0.05);
    const total = subtotal - discount + deliveryFee + tax;
    return sendJson(res, 200, {
      ok: true,
      cart: {
        ...cart,
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

    const menuItem = menu.find((m) => m.id === itemId);
    if (!menuItem) return sendError(res, 404, "Menu item not found.");

    const cart = carts[sessionId] || { items: [], offerCode: "" };
    const existing = cart.items.find((x) => x.id === itemId);

    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.items.push({
        id: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: quantity,
        image: menuItem.image
      });
    }

    carts[sessionId] = cart;
    await writeJson(DATA_FILES.carts, carts);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "PATCH" && pathname === "/api/cart/item") {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const itemId = String(body.itemId || "").trim();
    const quantity = Number(body.quantity || 0);
    const cart = carts[sessionId];
    if (!cart) return sendError(res, 404, "Cart not found.");
    const item = cart.items.find((x) => x.id === itemId);
    if (!item) return sendError(res, 404, "Cart item not found.");

    if (quantity <= 0) {
      cart.items = cart.items.filter((x) => x.id !== itemId);
    } else {
      item.quantity = quantity;
    }
    carts[sessionId] = cart;
    await writeJson(DATA_FILES.carts, carts);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "DELETE" && pathname.startsWith("/api/cart/item/")) {
    const sessionId = String(urlObj.searchParams.get("sessionId") || "").trim();
    const itemId = pathname.split("/").pop();
    const cart = carts[sessionId];
    if (!cart) return sendError(res, 404, "Cart not found.");
    cart.items = cart.items.filter((x) => x.id !== itemId);
    carts[sessionId] = cart;
    await writeJson(DATA_FILES.carts, carts);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/cart/offer") {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const offerCode = String(body.offerCode || "").trim().toUpperCase();
    if (!sessionId) return sendError(res, 400, "sessionId is required.");

    const cart = carts[sessionId] || { items: [], offerCode: "" };
    cart.offerCode = offerCode;
    carts[sessionId] = cart;
    await writeJson(DATA_FILES.carts, carts);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/checkout") {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const address = String(body.address || "").trim();
    const paymentMode = String(body.paymentMode || "COD").trim();
    const userId = String(body.userId || "").trim();
    if (!sessionId || !name || !phone || !address) {
      return sendError(res, 400, "Missing required checkout details.");
    }

    if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
      return sendJson(res, 200, { ok: true, ...idempotencyStore.get(idempotencyKey), idempotentReplay: true });
    }

    const cart = carts[sessionId];
    if (!cart || cart.items.length === 0) return sendError(res, 400, "Cart is empty.");

    const subtotal = subtotalFromCart(cart);
    const { discount, appliedOffer } = applyOffer(subtotal, cart.offerCode, offers);
    const deliveryFee = 39;
    const tax = Math.round((subtotal - discount) * 0.05);
    const total = subtotal - discount + deliveryFee + tax;

    const order = {
      id: makeId("order"),
      sessionId,
      userId: userId || undefined,
      createdAt: new Date().toISOString(),
      customer: { name, phone, address },
      paymentMode,
      etaMinutes: 32,
      status: "Confirmed",
      statusHistory: [{ status: "Confirmed", at: new Date().toISOString(), note: "Order placed" }],
      paymentStatus: paymentMode === "COD" ? "Pay on Delivery" : "Pending",
      items: cart.items,
      pricing: { subtotal, discount, deliveryFee, tax, total, appliedOffer }
    };

    orders.push(order);
    delete carts[sessionId];
    await Promise.all([writeJson(DATA_FILES.orders, orders), writeJson(DATA_FILES.carts, carts)]);

    const responsePayload = {
      ok: true,
      orderId: order.id,
      etaMinutes: 32
    };

    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, responsePayload);
    }
    emitRealtimeUpdate(sessionId, "order_updated", { orderId: order.id, status: order.status });
    return sendJson(res, 201, responsePayload);
  }

  if (method === "GET" && pathname === "/api/orders") {
    const sessionId = String(urlObj.searchParams.get("sessionId") || "").trim();
    const userId = String(urlObj.searchParams.get("userId") || "").trim();
    const phone = String(urlObj.searchParams.get("phone") || "").trim();
    if (!sessionId && !userId && !phone) return sendError(res, 400, "sessionId or userId or phone is required.");

    let mutatedLegacyOrder = false;
    const scopedOrders = orders
      .filter((order) => {
        const sessionMatch = sessionId && order.sessionId === sessionId;
        const userMatch = userId && order.userId === userId;
        const phoneMatch = phone && order.customer?.phone === phone;
        const legacyMatch = !order.sessionId && !order.userId && phone && order.customer?.phone === phone;
        return sessionMatch || userMatch || phoneMatch || legacyMatch;
      })
      .map((order) => {
        if (!order.sessionId && sessionId) {
          order.sessionId = sessionId;
          mutatedLegacyOrder = true;
        }
        if (!order.userId && userId) {
          order.userId = userId;
          mutatedLegacyOrder = true;
        }
        return enrichOrder(order);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (mutatedLegacyOrder) {
      await writeJson(DATA_FILES.orders, orders);
    }

    const current = scopedOrders.filter((order) => order.status !== "Delivered" && order.status !== "Cancelled");
    const past = scopedOrders.filter((order) => order.status === "Delivered" || order.status === "Cancelled");

    return sendJson(res, 200, {
      ok: true,
      currentOrders: current,
      pastOrders: past
    });
  }

  if (method === "GET" && pathname.startsWith("/api/orders/")) {
    const sessionId = String(urlObj.searchParams.get("sessionId") || "").trim();
    const userId = String(urlObj.searchParams.get("userId") || "").trim();
    const phone = String(urlObj.searchParams.get("phone") || "").trim();
    const orderId = getOrderIdFromPath(pathname);
    const order = orders.find((item) => {
      if (item.id !== orderId) return false;
      if (sessionId && item.sessionId === sessionId) return true;
      if (userId && item.userId === userId) return true;
      if (phone && item.customer?.phone === phone) return true;
      if (!sessionId && !userId && !phone) return true;
      return false;
    });
    if (!order) return sendError(res, 404, "Order not found.");
    return sendJson(res, 200, {
      ok: true,
      order: enrichOrder(order)
    });
  }

  if (method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/cancel")) {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const userId = String(body.userId || "").trim();
    const phone = String(body.phone || "").trim();
    const reason = String(body.reason || "Cancelled by user").trim();
    const orderId = getOrderIdFromPath(pathname);

    const order = orders.find((item) => {
      if (item.id !== orderId) return false;
      if (sessionId && item.sessionId === sessionId) return true;
      if (userId && item.userId === userId) return true;
      if (phone && item.customer?.phone === phone) return true;
      return false;
    });

    if (!order) return sendError(res, 404, "Order not found.");
    if (!canCancelOrder(order)) return sendError(res, 409, "Order cannot be cancelled at this stage.");

    order.status = "Cancelled";
    order.cancelledAt = new Date().toISOString();
    order.cancelReason = reason;
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [{ status: "Confirmed", at: order.createdAt }];
    order.statusHistory.push({ status: "Cancelled", at: order.cancelledAt, note: reason });
    await writeJson(DATA_FILES.orders, orders);
    if (order.sessionId) {
      emitRealtimeUpdate(order.sessionId, "order_updated", { orderId: order.id, status: "Cancelled" });
    }

    return sendJson(res, 200, { ok: true, order: enrichOrder(order) });
  }

  if (method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/reorder")) {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const userId = String(body.userId || "").trim();
    const phone = String(body.phone || "").trim();
    const orderId = getOrderIdFromPath(pathname);
    if (!sessionId) return sendError(res, 400, "sessionId is required.");

    const order = orders.find((item) => {
      if (item.id !== orderId) return false;
      if (userId && item.userId === userId) return true;
      if (phone && item.customer?.phone === phone) return true;
      if (!userId && item.sessionId === sessionId) return true;
      if (item.sessionId === sessionId) return true;
      return false;
    });
    if (!order) return sendError(res, 404, "Order not found.");

    const cart = carts[sessionId] || { items: [], offerCode: "" };
    for (const oldItem of order.items) {
      const existing = cart.items.find((x) => x.id === oldItem.id);
      if (existing) {
        existing.quantity += Number(oldItem.quantity || 1);
      } else {
        cart.items.push({
          id: oldItem.id,
          name: oldItem.name,
          price: oldItem.price,
          quantity: Number(oldItem.quantity || 1),
          image: oldItem.image
        });
      }
    }
    carts[sessionId] = cart;
    await writeJson(DATA_FILES.carts, carts);
    emitRealtimeUpdate(sessionId, "cart_updated", { sessionId });
    return sendJson(res, 200, { ok: true, addedItems: order.items.length });
  }

  if (method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/pay")) {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const userId = String(body.userId || "").trim();
    const phone = String(body.phone || "").trim();
    const paymentRef = String(body.paymentRef || makeId("payref")).trim();
    const orderId = getOrderIdFromPath(pathname);

    const order = orders.find((item) => {
      if (item.id !== orderId) return false;
      if (sessionId && item.sessionId === sessionId) return true;
      if (userId && item.userId === userId) return true;
      if (phone && item.customer?.phone === phone) return true;
      return false;
    });
    if (!order) return sendError(res, 404, "Order not found.");

    order.paymentStatus = "Paid";
    order.paymentRef = paymentRef;
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    order.statusHistory.push({ status: "Payment Confirmed", at: new Date().toISOString(), note: `Ref: ${paymentRef}` });
    await writeJson(DATA_FILES.orders, orders);
    if (order.sessionId) {
      emitRealtimeUpdate(order.sessionId, "order_updated", { orderId: order.id, status: order.status, paymentStatus: order.paymentStatus });
    }
    return sendJson(res, 200, { ok: true, paymentStatus: order.paymentStatus, paymentRef });
  }

  if (method === "POST" && pathname.startsWith("/api/admin/orders/") && pathname.endsWith("/status")) {
    const adminKey = String(req.headers["x-admin-key"] || "");
    if (adminKey !== getAdminKey()) return sendError(res, 401, "Invalid admin key.");
    const body = await parseBody(req);
    const status = String(body.status || "").trim();
    const note = String(body.note || "").trim();
    const allowedStatuses = new Set(["Preparing", "Out for Delivery", "Delivered"]);
    if (!allowedStatuses.has(status)) return sendError(res, 400, "Invalid status transition.");
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[3] || "";
    const order = orders.find((item) => item.id === orderId);
    if (!order) return sendError(res, 404, "Order not found.");
    if (order.status === "Cancelled") return sendError(res, 409, "Cancelled order cannot be progressed.");

    order.status = status;
    if (status === "Delivered") {
      order.deliveredAt = new Date().toISOString();
      if (order.paymentMode === "COD") {
        order.paymentStatus = "Paid";
      }
    }
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    order.statusHistory.push({ status, at: new Date().toISOString(), note: note || "Updated by kitchen" });
    await writeJson(DATA_FILES.orders, orders);
    if (order.sessionId) {
      emitRealtimeUpdate(order.sessionId, "order_updated", { orderId: order.id, status: order.status, paymentStatus: order.paymentStatus });
    }
    return sendJson(res, 200, { ok: true, order: enrichOrder(order) });
  }

  if (method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/support")) {
    const body = await parseBody(req);
    const message = String(body.message || "").trim();
    if (!message) return sendError(res, 400, "Support message is required.");
    return sendJson(res, 200, {
      ok: true,
      ticketId: makeId("ticket"),
      message: "Support request received. We will contact you shortly."
    });
  }

  return sendError(res, 404, "Endpoint not found.");
}

async function handleStatic(req, res, urlObj) {
  let pathname = urlObj.pathname;
  if (pathname === "/") pathname = "/index.html";
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
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
    res.writeHead(200, { "Content-Type": contentType });
    stream.pipe(res);
  } catch {
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    try {
      const content = await fsp.readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    } catch {
      sendError(res, 404, "File not found.");
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
    if (urlObj.pathname.startsWith("/api/")) {
      return await handleApi(req, res, urlObj);
    }
    return await handleStatic(req, res, urlObj);
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error.");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Cloud Kitchen app running at http://localhost:${PORT}`);
});
