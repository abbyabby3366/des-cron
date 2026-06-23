# CronWA — Express Scheduled WhatsApp Notification Server

A lightweight scheduled WhatsApp notification server built with Node.js, Express, MongoDB Atlas (Mongoose), and a premium vanilla HTML/CSS frontend. It replicates the core behaviors of the `CronWa` app (managing schedules, logs, and users) but is designed to send notifications through your custom WhatsApp Server API and can be easily deployed to Render using Docker.

## Features

- **Multi-tenant Scheduler**: Each user can manage their own notification tasks (One-time, Interval, and Cron schedules).
- **MongoDB Atlas Backend**: Fully powered by MongoDB for scalable, cloud-hosted persistence.
- **Premium Calendar View**: Monthly glassmorphic calendar view displaying scheduled/firing tasks and historical activity logs by day.
- **External WhatsApp API**: Integrates directly with `https://deswa.io7.my/api/external/send-message` using native `fetch`.
- **Flexible Verification Options**:
  - **Webhook-based Verification**: Incoming messages to your WhatsApp server matching a user's 8-character verification code bind their chat ID automatically.
  - **Manual Profile Override**: Users can directly input/override their phone number in their Settings tab.
  - **Admin Override**: Admins can override any user's phone number or role.
- **Premium Frontend**: Responsive dashboard, dark-mode styling, glassmorphism, native modals with light-dismiss, and visual micro-animations.

---

## Local Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file in the root directory:
```env
PORT=3000
WHATSAPP_API_URL=https://deswa.io7.my/api/external/send-message
SESSION_EXPIRY_DAYS=30
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority
```

### 3. Run the Server
```bash
npm start
```
The server will connect to MongoDB Atlas, spawn the scheduling tick daemon, and host the web dashboard at `http://localhost:3000`.

*Default admin login: `admin / admin123`*

---

## Render Deployment (Docker)

To deploy this application to Render:

### 1. Deploy as a Web Service
Create a new **Web Service** on Render and connect your repository:
- **Runtime**: `Docker`
- **Build Command**: (Handled by the Dockerfile)
- **Start Command**: (Handled by the Dockerfile)

### 2. Configure Environment Variables
In your Render settings, add the following under **Environment Variables**:
- `MONGODB_URI`: Your MongoDB Atlas connection string.
- `WHATSAPP_API_URL`: `https://deswa.io7.my/api/external/send-message`
- `PORT`: `3000`

---

## Webhook Verification Setup

To allow users to verify their WhatsApp accounts by sending their verification codes directly to your WhatsApp number:
1. In your custom WhatsApp server dashboard, find the Webhook settings.
2. Set the incoming message webhook URL to:
   `https://your-render-app-url.onrender.com/api/webhook/whatsapp`
3. When a user sends their 8-character verification code (e.g. `ABCD-EFGH` or `ABCDEFGH`), the webhook will bind their WhatsApp number automatically and reply to confirm.

---

## Technical Architecture

- **`server.js`**: Express server routes, session handling, static folder serving, calendar calculations, and webhook hooks.
- **`scheduler.js`**: Chronological loop running every 5 seconds. It fetches active firing tasks, invokes the WhatsApp API, logs the attempts, and calculates the next run times.
- **`database.js`**: Connects to MongoDB Atlas and compiles Mongoose schemas. Handles hashing and code generations.
- **`public/`**: Static frontend folder containing:
  - `index.html`: Multi-pane layouts, calendar containers, form templates, and native `<dialog>` wrappers.
  - `css/style.css`: Sleek responsive stylesheet featuring outfit/inter layout styles.
  - `js/app.js`: Session states, navigation handlers, fetches, calendar grids, and dialog hooks.
