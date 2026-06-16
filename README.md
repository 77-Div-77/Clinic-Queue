# 🏥 ClinicQ — Live Digital Queue Manager

> Replace paper token slips with a real-time digital queue visible on every phone in the waiting room.

![ClinicQ Banner](https://img.shields.io/badge/ClinicQ-Live%20Queue%20Manager-3b82f6?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-24.x-green?style=flat-square&logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-black?style=flat-square&logo=express)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-white?style=flat-square&logo=socket.io)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-green?style=flat-square&logo=mongodb)

---

## ✅ The Three Questions — Answered

| Question | Answer |
|---|---|
| Can a receptionist add a patient in **under 10 seconds**? | ✅ Yes — single required field (name), Enter key submits, auto-focus resets instantly |
| Does the patient screen update **without refreshing**? | ✅ Yes — Socket.IO pushes every state change to all connected clients immediately |
| Is estimated wait computed from **real data**? | ✅ Yes — rolling average of actual consultation durations; falls back to manual setting only if < 2 samples |

---

## 🎬 The Demo Moment

> *The receptionist types "Ravi Kumar", hits Enter — token #7 appears on screen. She clicks "Call Next" — and across the room, every patient's phone silently flips: the big number changes from 6 to 7, wait times update, and Ravi's card glows green: "You're next." The clinic owner turns and says: "I want this."*

---

## 🏗️ Architecture

```
┌─────────────────────┐      WebSocket (Socket.IO)      ┌──────────────────────┐
│  Receptionist View  │ ◄──────────────────────────────► │  Patient Waiting     │
│  /receptionist.html │                                  │  Room View           │
│  (Tab 1 / Desktop)  │        REST + Socket.IO           │  /patient.html       │
└─────────┬───────────┘                                  │  (Phone / TV screen) │
          │                                              └──────────────────────┘
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Node.js + Express Server                               │
│                    + Socket.IO (real-time broadcast to all clients)           │
│                    + In-memory queue state (fast) + MongoDB (persistent)      │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                      ┌────────▼────────┐
                      │   MongoDB        │
                      │  (optional,      │
                      │  graceful        │
                      │  fallback)       │
                      └─────────────────┘
```

---

## 🔌 Socket Event Diagram

```
RECEPTIONIST CLIENT                 SERVER                    PATIENT CLIENT
       │                               │                            │
       │── add_patient ───────────────►│                            │
       │   { name, phone }             │── broadcast queue_update ─►│
       │◄── patient_added ─────────────│   { queue[], currentToken, │
       │   { token, name }             │     nextToken, avgWait,    │
       │◄── queue_update ──────────────│     effectiveAvgMinutes,   │
       │   (full state)                │     sampleCount, ... }     │
       │                               │                            │
       │── call_next ─────────────────►│                            │
       │   {}                          │── broadcast queue_update ─►│
       │◄── queue_update ──────────────│   (updated state)          │
       │                               │                            │
       │── set_avg_time ──────────────►│                            │
       │   { minutes: 8 }              │── broadcast queue_update ─►│
       │◄── queue_update ──────────────│                            │
       │                               │                            │
       │── mark_done ─────────────────►│                            │
       │   { token: 4 }                │── broadcast queue_update ─►│
       │◄── queue_update ──────────────│                            │
       │                               │                            │
       │── undo_call ─────────────────►│  (within 30-second window) │
       │◄── queue_update ──────────────│                            │
       │                               │                            │
       │── remove_patient ────────────►│                            │
       │   { token: 3 }                │── broadcast queue_update ─►│
       │                               │                            │
       │                               │◄── lookup_token ───────────│
       │                               │    { token: 7 }            │
       │                               │── token_status ───────────►│
       │                               │   { found, tokensAhead,    │
       │                               │     estimatedWaitMin }     │
       │                               │                            │
  (on connect)                         │                   (on connect)
       │◄── queue_update ──────────────│────────────────────────────│
       │   (full state snapshot)       │   (full state snapshot)    │
```

---

## 📊 Wait Time Algorithm

```
estimatedWait(patient_at_position_i) =
  timeRemainingForCurrentConsultation
  + (i × effectiveAvgConsultTime)

Where:
  effectiveAvgConsultTime = rolling average of last 10 actual durations
                            (or receptionist's manual setting if < 2 samples)

  timeRemainingForCurrentConsultation =
    max(0, effectiveAvgConsultTime − (now − consultStartTime))
```

**Key properties:**
- ✅ Computed server-side and sent in every broadcast — never hardcoded client-side
- ✅ Self-correcting: as actual consultations complete, real data overrides manual estimates
- ✅ Handles overruns: clamped to 0, shown as "any moment" in UI
- ✅ Receptionist can adjust manual setting live — instantly recalculates all waits

---

## 🧠 Thought Process: Concurrency & Edge Cases

| Scenario | Solution |
|---|---|
| Two receptionists open simultaneously | Server is single source of truth; both clients receive identical broadcasts |
| "Call Next" clicked on empty queue | Button disabled client-side + server validates and emits `error_event` |
| Patient added while doctor is mid-consultation | Appended to end of queue; wait times auto-recalculate from real elapsed time |
| Server restart | MongoDB persists full state; server rehydrates on startup |
| Patient screen loses network | Socket.IO auto-reconnect; `connect` event triggers immediate full state push |
| Consultation runs over time | `timeRemaining` clamped to 0; UI shows "Any moment now" instead of negative wait |
| Receptionist calls wrong token | 30-second undo window reverts state and recalculates all waits |
| Multiple patients look up same token | All lookups resolved from server-broadcast state — no race condition |
| Clock skew between clients | All time math done server-side using `Date.now()` on the server |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- MongoDB (optional — runs in memory mode without it)

### Install & Run

```bash
# Clone / navigate to project
cd clinic-queue

# Install dependencies
npm install

# Configure (optional — edit .env for MongoDB URI)
cp .env.example .env

# Start server
npm start
# or for development with auto-reload:
npm run dev
```

Open in browser:
- **Receptionist:** http://localhost:3000/receptionist.html
- **Patient View:** http://localhost:3000/patient.html

### Without MongoDB
The server runs perfectly without MongoDB — it falls back to in-memory state automatically.
State will be lost on server restart (acceptable for a demo/prototype).

---

## 📁 Project Structure

```
clinic-queue/
├── server/
│   ├── index.js              ← Express + Socket.IO server (all logic)
│   └── models/
│       ├── Patient.js        ← Mongoose patient schema
│       └── Session.js        ← Mongoose daily session schema
├── public/
│   ├── receptionist.html     ← Receptionist dashboard
│   ├── receptionist.css      ← Dark glassmorphism styles
│   ├── receptionist.js       ← Client Socket.IO + UI logic
│   ├── patient.html          ← Patient waiting room
│   ├── patient.css           ← Animated patient UI styles
│   └── patient.js            ← Patient client Socket.IO logic
├── .env                      ← MONGODB_URI, PORT
├── package.json
└── README.md
```

---

## 🎨 UI Highlights

**Receptionist Screen:**
- Dark glassmorphism dashboard with glowing accent cards
- Token add form with single required field + auto-focus
- Large animated "Now Serving" token display
- Live consultation timer (countdown + overrun warning)
- Per-patient wait time with color coding (green/amber/red)
- 30-second undo button with live countdown
- Real data indicator showing rolling average vs manual setting

**Patient Screen:**
- Giant animated token number (3D flip animation on change)
- Floating particle background
- Self-service token lookup — type your number, see your position + wait live
- "Your turn is soon" full-screen alert when 1 token ahead
- Mobile-first layout — works on any phone screen

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Server status + DB connection |
| GET | `/api/state` | Full queue state snapshot |
| GET | `/receptionist.html` | Receptionist dashboard |
| GET | `/patient.html` | Patient waiting room |

---

## 🏆 Why This Solution Works

1. **Zero polling.** Socket.IO maintains a persistent connection — updates arrive in milliseconds, not after a timer fires.
2. **Real wait times.** The server measures actual consultation durations and builds a rolling average. After 2 consultations, manual estimates are replaced with real data automatically.
3. **Fault-tolerant.** MongoDB is optional. If it's down, the clinic still runs. If the patient's phone disconnects, Socket.IO reconnects and receives the latest state immediately.
4. **Speed for receptionists.** One required field, Enter key support, auto-focus — verified under 10 seconds per patient.
5. **Privacy-first.** Patient names are never shown on the public patient screen — only token numbers.
