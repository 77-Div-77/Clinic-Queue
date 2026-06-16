# ClinicQ — Thought Process Sheet

**Submission for:** Wooble Clinic Queue Challenge  
**Author:** Divya  
**Stack:** Express.js · Socket.IO · MongoDB · Vanilla HTML/CSS/JS

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
Clinics reset daily. Each "day" is one session. This keeps the data model simple, avoids stale tokens from previous days appearing, and makes the "total served today" stat meaningful. A more complex version would support multi-day history and analytics.

---

## 3. Wait Time Algorithm — Why It's Real, Not Hardcoded

```
estimatedWait(patient_i) =
  max(0, avgConsultTime − elapsedTimeForCurrentPatient)
  + (position_i × rollingAvgConsultTime)
```

**Rolling average logic:**
- Server records the actual duration of every completed consultation in ms
- Once ≥ 2 samples are collected, the rolling average of the last 10 replaces the manual setting
- The receptionist-set value is the *fallback only* — as soon as real data arrives, it takes over
- The UI explicitly shows the source: "Manual estimate" vs "📊 Real data active: X consultations sampled"

**Why this matters for the evaluators:** The wait time for a patient is *not* `position × 10 minutes`. It accounts for how far the current consultation has already progressed. A patient who is #3 in line when the current patient is 9 minutes into a 10-minute average gets a much lower estimate than #3 who just walked in after a fresh call.

---

## 4. Receptionist Speed — Under 10 Seconds

Measured from "patient walks to desk" to "token printed in their hand":

| Step | Action | Time |
|---|---|---|
| 1 | Input is already focused | 0s |
| 2 | Type patient name | 2–4s |
| 3 | Press Enter | <1s |
| 4 | Token assigned and displayed | <100ms (WebSocket round trip) |

**Total: 3–5 seconds in practice.**

Design choices that enable this:
- **Only one required field** (name). Phone is optional.
- **Auto-focus** on name input on page load and after every add
- **Enter key submits** — no mouse needed
- **"Add + Call Now" button** for even faster flow when the patient is next
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
`timeRemainingForCurrentPatient` is clamped to `Math.max(0, ...)`. Patients waiting behind are shown "Any moment now" rather than a negative wait. The overrun is displayed as a warning to the receptionist so they know to expect the queue to be running behind.

### Receptionist calls wrong token (fat-finger)
A 30-second **undo window** appears after every "Call Next". Within this window:
- The currently called patient reverts to "waiting"
- The previously done patient (if any) reverts to "in-consultation"
- All wait times recalculate
The undo button shows a live countdown. After 30 seconds it disappears permanently.

### Patient removes themselves
A receptionist can remove any waiting patient. Cannot remove someone in-consultation (would break the current session timer) or done.

---

## 6. The Demo Moment

> A clinic owner watches the receptionist type "Ravi Kumar" and hit Enter. Four seconds. Token #7 flashes on the big screen.  
> She clicks "Call Next."  
> Across the room, every phone silently updates. The giant number flips from 6 to 7. Ravi's self-lookup card turns green: *"You are currently being seen by the doctor!"*  
> Three patients behind him see their wait times drop by 12 minutes each.  
>  
> Nobody shouted. Nobody ran to the front desk. Nobody refreshed their browser.  
>  
> The clinic owner says: **"I want this."**

---

## 7. What I Would Add With More Time

| Feature | Why |
|---|---|
| Multi-doctor support | Larger clinics have 2–3 doctors; separate queues per room |
| SMS notification | Alert patient when 2 tokens away — no need to watch the screen |
| Doctor dashboard | Show current patient details, consultation history, avg time per doctor |
| Analytics | Daily/weekly charts of peak hours, avg wait, patient volume |
| QR code on token slip | Patient scans QR → opens patient view pre-filled with their token |
| Kiosk self-check-in | Patient touches a tablet at entry to add themselves to queue |

---

## 8. Answering the Three Evaluation Questions

**Q1 — Receptionist adds patient in under 10 seconds?**  
Yes. Single required field, auto-focus, Enter key submits. Tested at 3–5 seconds consistently.

**Q2 — Patient screen updates without refresh?**  
Yes. Socket.IO pushes `queue_update` to every connected client the instant any state change happens on the server. No polling. No manual refresh. The hero token number plays a 3D flip animation to make the change visually undeniable.

**Q3 — Wait time from real data?**  
Yes. After 2 consultations complete, the server computes a rolling average of actual durations (last 10) and uses that instead of the manual setting. The UI labels the source clearly. The algorithm also accounts for how much of the current consultation has already elapsed — so position 3 in line sees a lower wait when 9 of 10 minutes have passed for the current patient.
