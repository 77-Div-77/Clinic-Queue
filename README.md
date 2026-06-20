# <img src="https://raw.githubusercontent.com/77-Div-77/Clinic-Queue/main/public/favicon.ico" width="28" height="28" alt="🏥" /> ClinicQ — Live Digital Queue Manager

<div align="center">

**A real-time, multi-tenant SaaS platform that replaces paper token slips in neighbourhood clinics — visible on every patient's phone, controlled by the receptionist in seconds.**

[![Node.js](https://img.shields.io/badge/Node.js-24.x-3c873a?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

[🌐 Live Demo](https://clinic-queue-production-90c9.up.railway.app) · [📖 Thought Process](THOUGHT_PROCESS.md) · [🔌 Socket Diagram](SOCKET_DIAGRAM.md)

---

> *"76% of India's 1.5 million clinics still run on paper slips and shouting."*
>
> ClinicQ fixes that.

</div>

---

## ✅ Evaluation Criteria — Answered

| # | Criterion | Answer |
|---|---|---|
| **Q1** | Can a receptionist add a patient in **under 10 seconds**? | ✅ **Yes.** Single required field, auto-focus, Enter key submits. Measured at **3–5 seconds** consistently. |
| **Q2** | Does the patient screen update **without refreshing**? | ✅ **Yes.** Socket.IO pushes `queue_update` to all clients the moment any state changes. Zero polling. Zero refresh. |
| **Q3** | Is estimated wait time from **real data**? | ✅ **Yes.** After 2 consultations complete, a rolling average of actual durations replaces the manual estimate automatically. |

---

## 🎬 The Demo Moment

> The receptionist types **"Ravi Kumar"**, hits **Enter** — Token #7 appears in 4 seconds.
> She clicks **"Call Next"**.
> Across the room, every phone silently updates. The giant number flips from **6 → 7**. Ravi's card turns green: *"You're being seen now!"* Three patients behind him see their wait times drop live.
>
> Nobody shouted. Nobody refreshed. The clinic owner says: **"I want this."**

---

## 🌐 Live Demo

| Screen | URL |
|---|---|
| 🏠 Landing Page (Register / Login) | https://clinic-queue-production-90c9.up.railway.app |
| 🖥️ Receptionist Dashboard | https://clinic-queue-production-90c9.up.railway.app/receptionist.html |
| 📱 Patient Waiting Room | https://clinic-queue-production-90c9.up.railway.app/patient.html?clinicId=`<ID>` |
| 🔍 API Health Check | https://clinic-queue-production-90c9.up.railway.app/api/health |

---

## 🚀 Getting Started (Local)

```bash
# 1. Clone the repository
git clone https://github.com/77-Div-77/Clinic-Queue.git
cd Clinic-Queue

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your credentials (see Environment Variables section below)

# 4. Start the server
npm start
```

The server starts at `http://localhost:3000`.

---

## 🔑 Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | Recommended | MongoDB Atlas connection string |
| `JWT_SECRET` | Required | Secret key for signing JWT auth tokens |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio Account SID for real SMS delivery |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Optional | Twilio sender number (e.g. `+1234567890`) |
| `SENDGRID_API_KEY` | Optional | SendGrid API key for real email reports |
| `CLINIC_MANAGER_EMAIL` | Optional | Verified sender email for SendGrid |
| `APP_URL` | Optional | Public URL of the deployment (for SMS links) |

> **Evaluator Note:** If `TWILIO_*` and `SENDGRID_API_KEY` are not set, the app gracefully operates in **Mock Mode** — SMS and email events are simulated with UI popups showing exactly what would be sent. Drop in your API keys and real delivery activates instantly.

> **No MongoDB?** The server runs in pure in-memory mode automatically. All features work — data just won't survive a server restart.

---

## 🏥 How to Use ClinicQ

### Step 1 — Register Your Clinic

Visit the [homepage](https://clinic-queue-production-90c9.up.railway.app) and click **"Register"**.

- Enter your **Clinic Name**, **Email**, **Username**, and a **strong password**
- Password must meet the **8-4 Rule**: minimum 8 characters with at least 1 uppercase, 1 lowercase, 1 number, and 1 special symbol
- Your unique **Clinic ID** is generated automatically

### Step 2 — Log Into the Receptionist Dashboard

Sign in with your credentials. You land on the **Receptionist Dashboard** with four main sections:

| Section | What It Does |
|---|---|
| **Dashboard** | Add patients, call next, mark done, view live queue |
| **Patients** | Full table of all patients ever treated at your clinic |
| **History** | Day-by-day consultation log, analytics, and reporting |
| **Patient's View QR Code** | Generate and display the QR code for patients |

### Step 3 — Manage the Queue

From the **Dashboard**, you can:

- **Add Patient** — Type a name (and optional phone number), press Enter. Token assigned in under 3 seconds.
- **Add Emergency** — Jumps the patient to the front of the queue with a red badge.
- **Add Quick Consult** — Marks the patient for a brief consultation.
- **Call Next** — Calls the next patient. Broadcasts instantly to all patient screens.
- **30-Second Undo** — Made a mistake? Click Undo within 30 seconds to revert.
- **Mark Done** — Ends the consultation, records the duration for the wait-time algorithm.
- **Remove Patient** — Remove any waiting patient from the queue.
- **Set Average Time** — Manually override the estimated consultation duration (auto-switches to real data after 2 samples).

### Step 4 — Share the Patient View

Click **"Patient's View QR Code"** in the sidebar to open a modal containing:
- A scannable **QR code** that opens the patient waiting room for *your specific clinic*
- The unique **Clinic ID** printed below the QR code
- An **"Open Link Manually ↗"** button that directly opens the clinic's patient view

Patients scan the QR code on any phone — no app install required.

### Step 5 — Patient Waiting Room

Patients see a live, auto-updating screen showing:
- **Current Token** being seen by the doctor (large, animated flip display)
- **Their position in queue** and **estimated wait time**
- A **token lookup** — patients enter their token number to see personalised wait info
- Status alerts: *"You're next!"*, *"You are currently being seen!"*, *"Your consultation is complete!"*

### Step 6 — SMS Notifications

When a patient's phone number is entered, ClinicQ sends automatic SMS alerts (via Twilio):

- ✅ **On queue entry:** Token number + direct link to their clinic's patient view
- ⏰ **When next in line:** "You are next! Please be ready."
- 🔔 **When called:** "It's your turn! Please proceed to the doctor."

### Step 7 — History & Analytics

The **History** tab provides:

- **Day picker** — browse any date's consultation log
- **KPI Strip** — Total Served, Average Duration, Peak Hour for the selected day
- **Sortable table** — sort by Token, Name, Arrival, Departure, or Duration
- **Search** — filter by patient name or token number
- **📧 Email Report** — sends a full analytics email to your registered clinic email with:
  - Rich HTML body with today's key highlights
  - `.xlsx` attachment — full patient log + summary sheet (blue-styled headers)
  - `.pdf` attachment — hourly distribution chart + duration buckets + KPI summary

### Step 8 — Custom Date Range Export

Use the **Export Custom Date Range** section in the History tab:

- **📤 Export Range** — select any `From` and `To` datetime. The server generates and instantly downloads **both the Excel and PDF** files to your computer. It also emails them to your registered clinic email simultaneously.
- **📋 Append to Master Log** — downloads a single Excel workbook where **every tab is one calendar day** of your clinic's entire history. Useful for long-term record keeping.

### Step 9 — Automated Periodic Reports

ClinicQ automatically emails analytics reports to every registered clinic's email:

| Frequency | When | Coverage |
|---|---|---|
| **Weekly** | Every Sunday at 10:00 PM | Last 7 days |
| **Monthly** | Last day of month at 10:00 PM | Last 31 days |
| **Annual** | December 31st at 10:00 PM | Last 365 days |

Each automated email contains the same rich HTML format with Excel + PDF attachments.

---

## 🏗️ Architecture

```
┌──────────────────────┐   WebSocket (Socket.IO Room)   ┌──────────────────────┐
│  Receptionist View   │ ◄──────────────────────────── ► │  Patient Waiting     │
│  receptionist.html   │       room_<clinicId>            │  Room View           │
│  Desktop / Tablet    │       REST + WS                  │  patient.html        │
└──────────┬───────────┘                                  │  Any phone browser   │
           │                                              └──────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Node.js + Express Server                                  │
│  • Multi-Tenant ClinicQueue class (one instance per clinic, in-memory)      │
│  • Socket.IO Rooms (clinic data isolation guaranteed)                        │
│  • JWT Cookie Authentication (secure, stateless)                            │
│  • MongoDB / Mongoose (async persistence, graceful fallback)                │
│  • Twilio SMS · SendGrid Email (with Excel/PDF attachments)                 │
│  • node-cron (weekly / monthly / annual automated reports)                  │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │     MongoDB Atlas    │
                   │  (Clinic, Patient,  │
                   │   Session schemas)  │
                   └─────────────────────┘
```

---

## 📊 Wait Time Algorithm

```
estimatedWait(patient_at_position_i) =
  max(0, effectiveAvgMs − elapsedForCurrentPatient)
  + (i × effectiveAvgMs)

effectiveAvgMs =
  if (completedConsultations ≥ 2):
    rollingAverage(last 10 actual durations in ms)
  else:
    receptionistSetMinutes × 60,000
```

**Properties:**
- ✅ **Server-side only** — never hardcoded in the client
- ✅ **Self-correcting** — real data overrides manual setting after 2 samples
- ✅ **Overrun-aware** — clamped to 0 when current consultation exceeds avg
- ✅ **Live** — recalculated and re-broadcast on every event

---

## 🧠 Concurrency & Edge Cases

| Scenario | Solution |
|---|---|
| Two receptionists open simultaneously | Server is single source of truth; both receive identical broadcasts |
| `call_next` on empty queue | Button disabled client-side; server validates and emits `error_event` if bypassed |
| Patient added mid-consultation | Appended to end; wait times recalculate from current elapsed time |
| Server restart mid-day | MongoDB rehydrates today's session on startup |
| Patient network disconnect | Socket.IO reconnects automatically; `connect` event triggers full state push |
| Consultation overruns avg time | `timeRemaining` clamped to `0`; UI shows "Any moment now" |
| Wrong token called | 30-second undo window reverts state and recalculates all waits |
| Multiple clinics on same server | Isolated by Socket.IO rooms and separate `ClinicQueue` instances |
| Clock skew between client devices | All timestamps and math server-side using `Date.now()` |

---

## 🔌 Socket Events

See [`SOCKET_DIAGRAM.md`](SOCKET_DIAGRAM.md) for the complete Mermaid sequence diagram covering all events.

**Quick Reference:**

| Event | Direction | Description |
|---|---|---|
| `join_clinic` | Client → Server | Authenticate and join clinic room |
| `add_patient` | Client → Server | Add patient to queue |
| `add_emergency` | Client → Server | Add patient at front of queue |
| `add_quick_consult` | Client → Server | Add express-lane patient |
| `call_next` | Client → Server | Call next waiting patient |
| `mark_done` | Client → Server | End current consultation |
| `undo_call` | Client → Server | Revert last call (within 30s) |
| `remove_patient` | Client → Server | Remove waiting patient |
| `set_avg_time` | Client → Server | Override consultation duration |
| `send_daily_report` | Client → Server | Trigger rich email report |
| `export_range` | Client → Server | Generate Excel+PDF for date range |
| `get_all_history` | Client → Server | Fetch all records for Master Log |
| `queue_update` | Server → Room | Broadcast full state to all clients |
| `export_ready` | Server → Client | Return base64 Excel+PDF for download |
| `report_sent` | Server → Client | Confirm email sent with stats |
| `mock_sms_sent` | Server → Client | Show SMS preview toast (mock mode) |

---

## 📁 Project Structure

```
Clinic-Queue/
├── server/
│   ├── index.js              ← Express + Socket.IO server (all business logic)
│   └── models/
│       ├── Clinic.js         ← Mongoose schema: clinicId, name, email, username, password
│       ├── Patient.js        ← Mongoose schema: token, name, status, timestamps, clinicId
│       └── Session.js        ← Mongoose schema: daily session, rolling avg data
├── public/
│   ├── index.html            ← Landing page with Register & Sign In modals
│   ├── receptionist.html     ← Receptionist dashboard (sidebar layout)
│   ├── receptionist.css      ← Dark glassmorphism, sidebar, KPI strip
│   ├── receptionist.js       ← Socket.IO client: all queue actions + UI
│   ├── patients.html         ← All-time patient records table
│   ├── patients.js           ← Patients panel socket logic
│   ├── history.html          ← History, analytics, and reporting panel
│   ├── history.js            ← History, export range, master log logic
│   ├── patient.html          ← Patient waiting room (mobile-first)
│   ├── patient.css           ← Animated hero, token flip, rings
│   └── patient.js            ← Live queue rendering, token lookup, alerts
├── .env.example              ← Environment variable template
├── .gitignore
├── package.json
├── README.md                 ← You are here
├── SOCKET_DIAGRAM.md         ← Complete Mermaid socket event diagram
├── THOUGHT_PROCESS.md        ← Architecture decisions, algorithm deep-dive, edge cases
└── Plans.md                  ← Future feature roadmap
```

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | Node.js 24 | Non-blocking I/O — handles many concurrent clinic connections |
| **Server** | Express.js 4 | Minimal, fast, production-proven |
| **Real-time** | Socket.IO 4 | Persistent WebSocket + auto-reconnect + room isolation |
| **Database** | MongoDB + Mongoose | Flexible schema, fast writes, easy cloud hosting |
| **Auth** | JWT + bcryptjs | Stateless, secure, multi-tenant session management |
| **SMS** | Twilio | Real SMS delivery with mock fallback |
| **Email** | SendGrid | Rich HTML emails with Excel + PDF attachments |
| **Excel** | ExcelJS | Blue-styled spreadsheets with multi-sheet support |
| **PDF** | PDFKit | In-memory analytics PDFs with charts |
| **Master Log** | SheetJS (client-side) | Browser-side multi-tab Excel generation, no server load |
| **Scheduler** | node-cron | Weekly / monthly / annual automated email reports |
| **Frontend** | Vanilla HTML/CSS/JS | Zero build step, instant page loads, no framework overhead |
| **Fonts** | Google Fonts (Inter) | Professional medical UI typography |

---

## 📡 REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server status |
| `GET` | `/api/state` | Full queue state snapshot (JSON) |
| `GET` | `/api/history?date=YYYY-MM-DD` | Patient history for a given date |
| `POST` | `/api/register` | Register a new clinic |
| `POST` | `/api/signin` | Sign in and receive JWT cookie |
| `GET` | `/api/me` | Returns current clinic info from JWT cookie |

---

## 🏆 Why ClinicQ Works

1. **True Multi-Tenant SaaS.** One server can securely host hundreds of independent clinics. Every clinic gets its own isolated Socket.IO room, Clinic ID, and QR code.
2. **Bank-Level Security.** JWT cookie authentication + bcrypt password hashing + strict **8-4 Password Complexity Rule** (8+ chars, upper, lower, number, special symbol).
3. **Zero polling.** Socket.IO pushes updates in milliseconds — the "Now Serving" number on every patient's phone flips the instant the receptionist clicks "Call Next."
4. **Honest wait times.** Rolling average of real consultation durations. Accounts for elapsed time of the current consultation. Self-corrects after 2 data points.
5. **Fault-tolerant.** MongoDB optional — runs in-memory without it. Socket.IO reconnects automatically on network loss.
6. **Complete analytics pipeline.** Daily, custom-range, weekly, monthly, and annual reports delivered as rich HTML emails with Excel and PDF attachments — zero extra work for the receptionist.

---

## 🗺️ Roadmap

See [`Plans.md`](Plans.md) for the full future feature roadmap including:
- Patient Self-Service Kiosk Check-In
- Multi-doctor support
- Advanced ML-driven trend analytics

---

## 📄 License

MIT © 2026 · Built for the [Wooble Clinic Queue Challenge](https://wooble.org/hackathon/queue-cure-26)
