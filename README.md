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

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React, Vanilla CSS (Glassmorphism), Vite |
| **Backend** | Node.js, Express.js |
| **Database** | PostgreSQL (Production), JSON Flat-file (Proto) |
| **Real-time** | Server-Sent Events (SSE) |
| **Deployment** | Netlify (Frontend), Render (Backend) |

## 📸 Screenshots

### 🛍️ Customer Ordering Experience

A high-conversion, mobile-responsive storefront featuring a modern glassmorphism design.

<table width="100%">
  <tr>
    <td width="33%"><img src="./Images/Customer_Site/landing_page.png" alt="Landing Page"/></td>
    <td width="33%"><img src="./Images/Customer_Site/menu_page.png" alt="Menu Discovery"/></td>
    <td width="33%"><img src="./Images/Customer_Site/specials.png" alt="Daily Specials"/></td>
  </tr>
  <tr>
    <td width="33%"><img src="./Images/Customer_Site/cart_page.png" alt="Smart Cart"/></td>
    <td width="33%"><img src="./Images/Customer_Site/orders_page.png" alt="Order Tracking"/></td>
    <td width="33%"><img src="./Images/Customer_Site/payments_page.png" alt="Payments"/></td>
  </tr>
</table>

### 👨‍💼 Admin Management Portal

The command center for kitchen managers, providing deep insights into operations and performance.

<table width="100%">
  <tr>
    <td width="33%"><img src="./Images/Admin_Portal/admin_landing.png" alt="Admin Overview"/></td>
    <td width="33%"><img src="./Images/Admin_Portal/admin_analytics.png" alt="Deep Analytics"/></td>
    <td width="33%"><img src="./Images/Admin_Portal/admin_pastOrders.png" alt="Order History"/></td>
  </tr>
</table>

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

## 🤝 Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

## 👤 Author

<p align="center">
  <img src="https://github.com/milansinghal2004.png" width="100" style="border-radius: 50%;" alt="Milan Singhal"/>
  <br/>
  <b>Milan Singhal</b><br/>
  <i>AI/ML Engineer, Designer & Automobile Enthusiast</i>
</p>

<p align="center">
  <a href="https://portfolio-milansinghal.netlify.app/">
    <img src="https://img.shields.io/badge/Portfolio-FF5733?style=for-the-badge&logo=googledomains&logoColor=white" alt="Portfolio"/>
  </a>
  <a href="https://github.com/milansinghal2004">
    <img src="https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"/>
  </a>
  <a href="https://linkedin.com/in/milansinghal">
    <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"/>
  </a>
  <a href="mailto:singhalmilan92@gmail.com">
    <img src="https://img.shields.io/badge/Email-D14836?style=for-the-badge&logo=gmail&logoColor=white" alt="Email"/>
  </a>
</p>

---

### 🏷️ Project Topics

`Cloud Kitchen` • `Food Delivery` • `Restaurant Admin` • `Real-time SSE` • `React.js` • `Node.js` • `PostgreSQL` • `Glassmorphism` • `D2C Tech` • `Ghost Kitchen`
