# ClinicQ — Thought Process & Architecture Notes

**Submission for:** Wooble Clinic Queue Challenge  
**Author:** Divya  
**Stack:** Express.js · Socket.IO · MongoDB · Vanilla HTML/CSS/JS  
**Live Demo:** https://clinic-queue-production-90c9.up.railway.app

---

## 1. Problem Understanding

76% of India's 1.5 million clinics run on paper token slips. Patients wait 2–3 hours with zero visibility into how long they'll actually wait. Receptionists manage the entire queue from memory. Doctors have no dashboard.

**The core pain:** uncertainty. Patients don't know if they'll wait 10 minutes or 90. That uncertainty is what makes waiting feel unbearable.

**What I set out to fix:**
- Give every patient a number they can trust
- Make that number update *live* on their phone — no refresh
- Make wait time an honest estimate from real data, not a guess
- Make the receptionist's job so fast it's invisible

---

## 2. Architecture Decisions

### Why Socket.IO over polling?
HTTP polling (asking the server "any updates?" every N seconds) introduces latency proportional to the poll interval, wastes bandwidth even when nothing changed, and creates a jagged UX where the screen doesn't update until the next poll fires. Socket.IO keeps a persistent WebSocket connection — the server pushes changes the moment they happen. For a queue, where "call next" should register in milliseconds on every phone in the room, polling is simply the wrong tool.

### Why in-memory state + MongoDB rather than DB-only?
Every queue event (add, call, done) needs to broadcast instantly. Hitting MongoDB on every read would add ~5–50ms latency per broadcast, which compounds when many clients are connected. The solution: keep state in-memory for speed, write to MongoDB asynchronously for persistence. If the server restarts, it rehydrates from MongoDB. If MongoDB is unavailable, the clinic still runs — patients still get live updates, data just won't survive a restart.

### Why a single session model?
Clinics reset daily. Each "day" is one session. This keeps the data model simple, avoids stale tokens from previous days appearing, and makes the "total served today" stat meaningful. The History tab lets receptionists browse any past date's records.

---

## 3. Wait Time Algorithm — Why It's Real, Not Hardcoded

```
estimatedWait(patient_i) =
  max(0, avgConsultTime − elapsedTimeForCurrentPatient)
  + (position_i × rollingAvgConsultTime)
```

**Rolling average logic:**
- Server records the actual duration of every completed consultation in ms
- Once >= 2 samples are collected, the rolling average of the last 10 replaces the manual setting
- The receptionist-set value is the *fallback only* — as soon as real data arrives, it takes over
- The UI explicitly shows the source: "Manual estimate" vs "Real data active: X consultations sampled"

**Why this matters for the evaluators:** The wait time for a patient is *not* `position × 10 minutes`. It accounts for how far the current consultation has already progressed. A patient who is #3 in line when the current patient is 9 minutes into a 10-minute average gets a much lower estimate than #3 who just walked in after a fresh call.

---

## 4. Receptionist Speed — Under 10 Seconds

Measured from "patient walks to desk" to "token assigned":

| Step | Action | Time |
|---|---|---|
| 1 | Input is already focused | 0s |
| 2 | Type patient name | 2–4s |
| 3 | Press Enter | <1s |
| 4 | Token assigned and broadcast | <100ms (WebSocket round trip) |

**Total: 3–5 seconds in practice.**

Design choices that enable this:
- **Only one required field** (name). Phone is optional.
- **Auto-focus** on name input on page load and after every add
- **Enter key submits** — no mouse needed
- **Token confirmation banner** stays visible for 4 seconds so the receptionist can read it aloud

---

## 5. Concurrency & Edge Cases

### Two receptionists on the same screen
State lives on the server. Both clients receive identical `queue_update` broadcasts. There is no client-side source of truth — the server is always authoritative. If one receptionist adds a patient 10ms before another clicks "Call Next", the server processes them sequentially (Node.js event loop is single-threaded for JavaScript execution). No race conditions.

### Empty queue + "Call Next"
- Button is disabled client-side when `nextToken` is null
- Server validates again and emits `error_event` if somehow triggered anyway
- Defense in depth: client guard + server guard

### Server restart mid-day
MongoDB stores the full session state: current token, queue, all patient records, consultation durations. On restart, `connectDb()` queries for today's session and rehydrates `state` before the server begins accepting connections.

### Network loss on patient screen
Socket.IO has built-in reconnection with exponential backoff. On reconnect, the server's `connection` event fires and immediately emits the full current `queue_update` to the new socket. The patient sees correct state within milliseconds of reconnecting — no stale data, no blank screen.

### Consultation runs over the estimated time
`timeRemainingForCurrentPatient` is clamped to `Math.max(0, ...)`. Patients waiting behind are shown "Any moment now" rather than a negative wait. The overrun is displayed as a warning to the receptionist so they know the queue is running behind.

### Receptionist calls wrong token (fat-finger)
A 30-second **undo window** appears after every "Call Next". Within this window:
- The currently called patient reverts to "waiting"
- The previously done patient (if any) reverts to "in-consultation"
- All wait times recalculate instantly

The undo button shows a live countdown. After 30 seconds it disappears permanently.

---

## 6. Multi-Tenant SaaS Architecture & Security

The system was designed as a **fully multi-tenant SaaS platform** from the ground up.

- **Clinic Data Isolation:** Each clinic registers a unique account. Socket.IO Rooms (`<clinicId>`) ensure events are never leaked between clinics.
- **JWT Authentication:** Stateless JSON Web Tokens authorize API routes and socket joins. Cookies expire in 7 days.
- **Strict 8-4 Password Rule:** Registration enforces: minimum 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special symbol.
- **Dynamic Patient Routing:** Patients scan a QR code containing `?clinicId=<ID>` — dynamically routed to their clinic's live queue.
- **Legacy Migration:** On first boot, any existing single-tenant data is automatically migrated to a `Default Clinic` account for backwards compatibility.

---

## 7. API Integrations & Mock Mode

For hackathon evaluation, external API integrations (Twilio SMS, SendGrid Email) operate in **Mock Mode** by default when API keys are absent.

- **Mock SMS:** UI toast pops up showing exactly what the SMS would say and to whom
- **Mock Email:** Server logs and a UI confirmation show the full email subject + recipient
- **Activation:** Drop API keys into `.env` and real delivery activates instantly — no code changes

This ensures evaluators can verify the complete logic flow without needing paid API accounts.

---

## 8. Full-Stack Mobile Responsiveness

A dedicated mobile responsiveness audit was conducted and resolved issues identified through DevTools at a 472px mobile viewport.

**Root Cause — Document scrollWidth = 683px on a 472px viewport:**

| Problem | Source |
|---|---|
| Body expanding to 683px | `.main-wrap` had no width constraint |
| Table overflowing viewport | `.queue-table-wrap` lacked `overflow-x: auto` |
| Queue search forcing layout | Hardcoded `width: 180px` on `.queue-search` |
| Flex children escaping parent | Missing `min-width: 0` on flex/grid children |

**Fixes Applied:**

| Component | Fix |
|---|---|
| `.main-wrap` | `width: 100%; max-width: 100vw; overflow-x: hidden` |
| `.queue-table-wrap` | `overflow-x: auto; width: 100%; -webkit-overflow-scrolling: touch` |
| `.queue-table` | `min-width: 560px` — scrolls inside its container, not the whole page |
| `.queue-search` | Changed to `max-width: 210px` (was `width: 180px`) |
| Flex/grid children | Added `min-width: 0` to `.left-col`, `.right-col`, `.content-grid`, `.main-content` |
| Landing page nav | Full slide-in drawer with hamburger JS, animated X icon, Escape key support |
| Patient page | Removed `maximum-scale=1.0` (accessibility — blocked pinch-to-zoom) |
| Form buttons | Stack to `width: 100%` at 480px breakpoint |
| KPI strip | 4-col → 2-col → 1-col at 1024px / 768px / 480px |
| Wait time grid | Stacks to column at 768px |
| Toasts | Full viewport width at 480px |
| Export rows | Date inputs stack to full width at 480px |
| **JS bug** | Removed duplicate sidebar toggle handler conflicting with the mobile drawer |

---

## 9. The Demo Moment

> A clinic owner watches the receptionist type "Ravi Kumar" and hit Enter. Four seconds. Token #7 flashes on the big screen.
> She clicks "Call Next."
> Across the room, every phone silently updates. The giant number flips from 6 to 7. Ravi's self-lookup card turns green: *"You are currently being seen by the doctor!"*
> Three patients behind him see their wait times drop by 12 minutes each.
>
> Nobody shouted. Nobody ran to the front desk. Nobody refreshed their browser.
>
> The clinic owner says: **"I want this."**

---

## 10. Answering the Three Evaluation Questions

**Q1 — Receptionist adds patient in under 10 seconds?**
Yes. Single required field, auto-focus, Enter key submits. Tested at 3–5 seconds consistently.

**Q2 — Patient screen updates without refresh?**
Yes. Socket.IO pushes `queue_update` to every connected client the instant any state change happens on the server. No polling. No manual refresh. The hero token number plays a 3D flip animation to make the change visually undeniable.

**Q3 — Wait time from real data?**
Yes. After 2 consultations complete, the server computes a rolling average of actual durations (last 10) and uses that instead of the manual setting. The UI labels the source clearly. The algorithm also accounts for how much of the current consultation has already elapsed — so position 3 in line sees a lower wait when 9 of 10 minutes have passed for the current patient.

---

## 11. What Would Come Next

| Feature | Rationale |
|---|---|
| **Multi-doctor support** | Larger clinics have 2–3 doctors; separate queues per room with alphanumeric tokens (A1, B1) |
| **Patient self-service kiosk** | Fullscreen touch-friendly tablet page where patients add themselves — zero receptionist involvement |
| **Doctor dashboard** | Real-time view of current patient, today's stats, and average consultation time per doctor |
| **ML trend analytics** | Busiest day prediction, anomaly detection, patient return rate from existing MongoDB data |
| **Progressive Web App (PWA)** | Offline-capable, installable on Android home screen — no app store needed |
