# Master Implementation Plans

This document serves as our central reference for all planned features and future improvements that have not yet been implemented.

---

## 1. Cloud Deployment ✅ DONE
Deployed on Railway.app at: **https://clinic-queue-production-90c9.up.railway.app**

## 2. Cloud Database (MongoDB Atlas) ✅ DONE
Connected to Atlas cluster. Persistent multi-tenant data storage for all clinics.

## 3. Strict Phone Number Validation ✅ DONE
Integrated `intl-tel-input` library with country dropdown and regex validation across all patient entry forms.

## 4. Real SMS Notifications (Twilio) ✅ DONE (Mock Mode)
Twilio integration is fully implemented. Operates in mock-mode until API keys are provided in `.env`.

## 5. Real Email Reports (SendGrid) ✅ DONE (Mock Mode)
SendGrid integration fully implemented with rich HTML emails, Excel (`.xlsx`) and PDF (`.pdf`) attachments.

## 6. Custom Date Range Export ✅ DONE
Two export buttons in the History tab:
- **📤 Export Range** — Downloads Excel + PDF, emails them to clinic
- **📋 Append to Master Log** — Downloads full history as multi-tab Excel

## 7. Automated Periodic Reports ✅ DONE
`node-cron` jobs send automated reports to all registered clinics:
- Weekly: Every Sunday at 10:00 PM
- Monthly: Last day of the month at 10:00 PM
- Annual: December 31st at 10:00 PM

---

## 8. Patient Self-Service Kiosk Check-In (PLANNED)

**Goal:** Allow patients to add themselves to the queue by tapping on a tablet placed at the clinic entrance — eliminating the receptionist's manual data-entry work entirely.

**User Story:**
> A patient walks into the clinic, sees a tablet at the reception desk. They tap their own name and phone number on the screen. Token #12 appears instantly on the tablet and on the main queue display. They take a seat. No receptionist interaction needed.

**Implementation Plan:**
- Create a new page `kiosk.html` — fullscreen, touch-friendly, dark background
- Large font input for Name (required) and Phone (optional, with `intl-tel-input`)
- On submit, emit `add_patient` socket event (same as receptionist)
- Token confirmation screen displays for 5 seconds, then auto-resets for the next patient
- The receptionist can enable/disable kiosk mode from the dashboard settings
- Kiosk URL: `/kiosk.html?clinicId=<ID>` — accessible via a dedicated QR code separate from the patient view QR

**UI Sketch:**
```
┌─────────────────────────────────────┐
│           🏥 Sunrise Clinic         │
│        Self Check-In Kiosk          │
│                                     │
│   Your Name:  [________________]    │
│   Phone No.:  [+91 __________]      │
│                                     │
│         [ ✅ Join Queue ]           │
│                                     │
│    Current wait: ~14 minutes        │
│    Patients ahead: 3                │
└─────────────────────────────────────┘
```

**Dependencies:** No new packages needed — uses existing Socket.IO and intl-tel-input.

---

## 9. Audio Announcements via Clinic Sound System (PLANNED)

**Goal:** Announce the called token number through a speaker/sound system connected to the receptionist's computer — so patients in the waiting room hear it out loud, not just on their phones.

**Reasoning:** Making every patient's phone produce audio may be intrusive. A single general announcement from the clinic's speaker is more appropriate for a shared waiting room.

**Implementation Plan:**
- Use the browser's built-in **Web Speech API** (`window.speechSynthesis`) on the receptionist's browser
- When `call_next` is clicked and the server responds with `queue_update`, trigger:
  ```js
  const utterance = new SpeechSynthesisUtterance(`Token number ${currentToken}, please proceed to the doctor.`);
  utterance.lang = 'en-IN';
  window.speechSynthesis.speak(utterance);
  ```
- Add a toggle in the Dashboard settings: "🔊 Audio Announcements: ON / OFF"
- Announcement language can be expanded (Hindi: `hi-IN`) via a settings dropdown

**Dependencies:** Zero — Web Speech API is built into all modern browsers.

---

## 10. Multi-Doctor Support (PLANNED)

**Goal:** Allow clinics with multiple doctors to maintain separate queues per consultation room, with dynamic setup and intelligent routing.

**Implementation Plan:**
- **Dynamic Setup:** During clinic sign-up, ask the receptionist for the number of doctors and their names. Add a Settings UI to allow adding/removing doctors later as staff changes.
- **Per-Doctor Tokens:** Tokens will be alphanumeric per doctor (e.g., Dr. A gets A1, A2; Dr. B gets B1, B2) to keep queues strictly separated and prevent waiting room confusion.
- **AI Symptom Analysis:** Integrate an AI API on the kiosk or patient portal where patients describe their symptoms. The AI analyzes the text and automatically assigns them to the best-suited specialist doctor in the clinic.
- **Reporting Updates:** SMS alerts, email reports, and Excel exports must all be updated to include the Doctor Name and Room assignments.

---

## 11. Advanced ML Trend Analytics (PLANNED)

**Goal:** Add intelligent data-driven insights to the periodic and range email reports.

**Ideas:**
- **Busiest day prediction** — "Based on the last 4 weeks, Tuesday is your busiest day. Consider scheduling extra staff."
- **Anomaly detection** — "Today's average consultation was 40% longer than your monthly average."
- **Seasonal trends** — Monthly and annual reports highlight if the clinic is growing (more patients month-over-month)
- **Patient return rate** — Track repeat visits by phone number

**Technology:** Can be implemented with simple statistical analysis on the existing MongoDB data (no ML library needed for MVP). For deeper insights, integrate a lightweight ML library like `simple-statistics` or export data to a Python microservice.

---

ClinicQueue Cluster:
MongoDB username - javauser
MongoDB password - java123
