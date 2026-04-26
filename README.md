# Cloud Kitchen Startup Mode

A modern, full-stack **Direct-to-Consumer (D2C)** food technology platform designed to empower independent **cloud kitchens**. This end-to-end solution replaces third-party dependency with a premium, self-hosted ordering system and a robust **restaurant management dashboard**.

![Branding](https://img.shields.io/badge/UI-Glassmorphism-brightgreen)
![Tech](https://img.shields.io/badge/Stack-React%20%7C%20Node.js%20%7C%20PostgreSQL-blue)
![Realtime](https://img.shields.io/badge/Realtime-SSE-red)

## 🌐 Live Demo
Experience the platform live: [cloudkitchenstartup.netlify.app](https://cloudkitchenstartup.netlify.app/)

## 🚀 The Vision
Most cloud kitchens lose 25-30% revenue to delivery platforms. **Cloud Kitchen Startup Mode** is built to reclaim that margin by providing a high-conversion ordering experience and a professional-grade kitchen management suite. It aims to be the "Shopify for Cloud Kitchens."

## ✨ Key Features

### 🛒 Premium Customer Experience
- **Glassmorphism UI**: A stunning, modern design language that builds brand trust and increases conversion.
- **Dynamic Menu**: Real-time search, category filtering, and "Today's Special" highlights.
- **Smart Checkout**: Integrated offer code engine, delivery fee calculation, and automated tax processing.
- **Live Order Tracking**: Real-time status updates (Confirmed → Preparing → Out for Delivery) powered by **Server-Sent Events (SSE)**.

### 👨‍🍳 Pro Kitchen Operations (Admin)
- **Live Kitchen Queue**: A real-time management pane to track every active order without refreshing.
- **Chef Management System**: Monitor "Kitchen Floor" activity, track chef duty status, and manage workload.
- **Operations KPIs**: Instant visibility into today's revenue, active orders, and kitchen efficiency.
- **Support Ticket System**: Integrated threaded communication for handling customer queries effectively.

### 📊 Business Intelligence & Analytics
- **Revenue Analytics**: Deep-dive into financial performance with custom date-range scoping.
- **Product Insights**: Identify top-selling items and high-performing categories.
- **Customer Analytics**: Track repeat orders and customer lifetime value (LTV) through phone-based tracking.

## 🛠️ Technical Excellence
- **Dual-Mode Backend**: Unique architecture supporting both high-performance **PostgreSQL** for production and lightweight **JSON storage** for rapid prototyping.
- **Real-time Engine**: Built-in SSE implementation for instant push notifications from the kitchen to the customer.
- **Responsive Architecture**: Fully optimized for mobile-first ordering and desktop-first management.

## 💻 Tech Stack
- **Frontend**: React (SPA), Vanilla CSS (Custom Glassmorphism Framework)
- **Backend**: Node.js, Express
- **Database**: PostgreSQL / JSON-based Flat Files
- **Communication**: Server-Sent Events (SSE) for real-time reactivity

## 📸 Screenshots

### 🛍️ Customer Ordering Experience
A high-conversion, mobile-responsive storefront featuring a modern glassmorphism design.

````carousel
![Landing Page](file:///d:/Cloud%20Kitchen%20Startup%20Mode/Images/Customer_Site/landing_page.png)
<!-- slide -->
![Menu Discovery](file:///d:/Cloud%20Kitchen%20Startup%20Mode/Images/Customer_Site/menu_page.png)
<!-- slide -->
![Daily Specials](file:///d:/Cloud%20Kitchen%20Startup%20Mode/Images/Customer_Site/specials.png)
<!-- slide -->
![Smart Cart](file:///d:/Cloud%20Kitchen%20Startup%20Mode/Images/Customer_Site/cart_page.png)
<!-- slide -->
![Order Tracking](file:///d:/Cloud%20Kitchen%20Startup%20Mode/Images/Customer_Site/orders_page.png)
<!-- slide -->
![Payments](file:///d:/Cloud%20Kitchen%20Startup%20Mode/Images/Customer_Site/payments_page.png)
````

### 👨‍💼 Admin Management Portal
The command center for kitchen managers, providing deep insights into operations and performance.

````carousel
![Admin Overview](file:///d:/Cloud%20Kitchen%20Startup%20Mode/Images/Admin_Portal/admin_landing.png)
<!-- slide -->
![Deep Analytics](file:///d:/Cloud%20Kitchen%20Startup%20Mode/Images/Admin_Portal/admin_analytics.png)
<!-- slide -->
![Order History](file:///d:/Cloud%20Kitchen%20Startup%20Mode/Images/Admin_Portal/admin_pastOrders.png)
````

## 🛠️ Installation & Setup

1. **Clone & Install**:
   ```bash
   git clone https://github.com/milansinghal2004/CK-Project.git
   cd CK-Project
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file based on `.env.example`.
   ```env
   PORT=3000
   DATABASE_URL=your_postgres_url
   ADMIN_USERNAME=manager
   ADMIN_PASSWORD=manager123
   ```

3. **Start Development**:
   - For JSON Mode: `npm start`
   - For PostgreSQL Mode: `npm run start:db`

## 🔮 Future Roadmap
- [ ] **AI Demand Forecasting**: Predicting order surges using historical data.
- [ ] **Automated Marketing**: Integrated SMS/WhatsApp marketing for re-engaging past customers.
- [ ] **Inventory Management**: Automated stock alerts and ingredient level tracking.
- [ ] **Multi-Outlet Support**: Manage multiple kitchen locations from a single master dashboard.

## 👤 Author
**Milan Singhal** — [GitHub](https://github.com/milansinghal2004)

---

### Searchable Keywords (SEO)
`Cloud Kitchen Management System`, `Direct-to-Consumer Food Delivery`, `Restaurant Admin Dashboard`, `Real-time Order Tracking`, `React Food App`, `Kitchen Operations Software`, `Chef Management System`, `Online Food Ordering Flow`, `Glassmorphism UI Design`, `Food Tech Platform`, `Restaurant Analytics Software`, `Independent Kitchen Software`, `D2C Restaurant Tech`, `Ghost Kitchen Management`, `SaaS for Food Startups`.
