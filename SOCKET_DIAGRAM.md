# ClinicQ — Socket Event Diagram

This document illustrates the complete real-time communication architecture of ClinicQ using Socket.IO WebSockets. All state changes are server-authoritative and broadcast instantly to every connected client within the same clinic room.

---

## Multi-Tenant Room Architecture

Every clinic operates in its own isolated Socket.IO **room** (`room_<clinicId>`). Events are never leaked between clinics.

```mermaid
graph TD
    A[Receptionist Browser] -- join_clinic{clinicId} --> S[Server]
    B[Patient Browser] -- join_clinic{clinicId} --> S
    S -- queue_update broadcast --> R1[room_clinicId_A]
    S -- queue_update broadcast --> R2[room_clinicId_B]
    R1 --> A
    R1 --> B
```

---

## Main Queue Flow

```mermaid
sequenceDiagram
    participant R as Receptionist Client
    participant S as Server
    participant P as Patient Client

    Note over R,P: ── Session Start ──
    R->>S: join_clinic { clinicId }
    P->>S: join_clinic { clinicId }
    S-->>R: queue_update (full state snapshot)
    S-->>P: queue_update (full state snapshot)

    Note over R,P: ── Adding a Patient ──
    R->>S: add_patient { name, phone }
    S-->>R: patient_added { token, name }
    S-->>R: queue_update { queue[], waitTimes, ... }
    S-->>P: queue_update { queue[], waitTimes, ... }
    Note over S: sendSMS(phone, "Token #N assigned...")

    Note over R,P: ── Emergency / Quick Consult ──
    R->>S: add_emergency { name, phone }
    S-->>R: queue_update (patient inserted at front)
    S-->>P: queue_update (patient inserted at front)

    R->>S: add_quick_consult { name, phone }
    S-->>R: queue_update (express lane)
    S-->>P: queue_update (express lane)

    Note over R,P: ── Calling Next Patient ──
    R->>S: call_next
    S-->>R: queue_update { currentToken, inConsultation[], ... }
    S-->>P: queue_update { currentToken, inConsultation[], ... }
    Note over S: sendSMS(nextPatient.phone, "It's your turn!")
    Note over S: sendSMS(patientBehind.phone, "You're next!")

    Note over R,P: ── 30-Second Undo Window ──
    R->>S: undo_call
    S-->>R: queue_update (state reverted)
    S-->>P: queue_update (state reverted)

    Note over R,P: ── Marking Consultation Done ──
    R->>S: mark_done { token }
    S-->>R: queue_update (patient moved to done[])
    S-->>P: queue_update (patient moved to done[])
    Note over S: elapsedMs recorded → rolling avg updated

    Note over R,P: ── Adjusting Average Time ──
    R->>S: set_avg_time { minutes }
    S-->>R: queue_update (new effectiveAvgMin)
    S-->>P: queue_update (new effectiveAvgMin)

    Note over R,P: ── Removing a Patient ──
    R->>S: remove_patient { token }
    S-->>R: queue_update (patient removed)
    S-->>P: queue_update (patient removed)
```

---

## Patient Token Lookup Flow

```mermaid
sequenceDiagram
    participant P as Patient Client
    participant S as Server

    P->>S: lookup_token { token, clinicId }
    S-->>P: token_status { status, tokensAhead, estimatedWaitMin, name }
    Note over P: "You are being seen now!" / "X tokens ahead, ~Y min"
```

---

## Reporting & Export Flow

```mermaid
sequenceDiagram
    participant R as Receptionist Client
    participant S as Server
    participant SG as SendGrid API

    Note over R,SG: ── Daily Email Report ──
    R->>S: send_daily_report { date }
    S->>S: Query Patient records for date
    S->>S: Compute analytics (peak hour, avg, fastest, slowest)
    S->>S: Generate .xlsx (exceljs) in-memory
    S->>S: Generate .pdf (pdfkit) in-memory
    S->>SG: sgMail.send({ html, attachments: [xlsx, pdf] })
    SG-->>S: 202 Accepted
    S-->>R: report_sent { message: "Report emailed via SendGrid!" }

    Note over R,SG: ── Custom Range Export ──
    R->>S: export_range { from, to }
    S->>S: Query Patient records for range
    S->>S: Generate .xlsx + .pdf in-memory
    S-->>R: export_ready { xlsx: base64, pdf: base64, filename }
    Note over R: Browser auto-downloads both files
    S->>SG: sgMail.send({ html, attachments: [xlsx, pdf] })

    Note over R,SG: ── Master Log Download ──
    R->>S: get_all_history
    S-->>R: all_history { records[] }
    Note over R: SheetJS builds multi-sheet workbook client-side
    Note over R: Browser downloads ClinicQ_MasterLog.xlsx
```

---

## Automated Periodic Reports (Server-Side Cron)

```mermaid
sequenceDiagram
    participant CRON as node-cron Scheduler
    participant S as Server
    participant SG as SendGrid API

    Note over CRON,SG: ── Every Sunday 10:00 PM ──
    CRON->>S: Weekly report trigger
    S->>S: Query last 7 days for all clinics
    S->>SG: Send weekly report email (xlsx + pdf)

    Note over CRON,SG: ── Last Day of Month 10:00 PM ──
    CRON->>S: Monthly report trigger
    S->>S: Query last 30 days for all clinics
    S->>SG: Send monthly report email (xlsx + pdf)

    Note over CRON,SG: ── Dec 31st 10:00 PM ──
    CRON->>S: Annual report trigger
    S->>S: Query last 365 days for all clinics
    S->>SG: Send annual report email (xlsx + pdf)
```

---

## State Broadcast Payload Reference

Every `queue_update` event carries the following full state object:

```json
{
  "currentToken": 7,
  "nextToken": 8,
  "queue": [
    { "token": 8, "name": "Meera Singh", "phone": "+919876543210", "status": "waiting" },
    { "token": 9, "name": "Rohan Das",   "phone": "+919123456789", "status": "waiting" }
  ],
  "inConsultation": [
    { "token": 7, "name": "Ravi Kumar", "consultStartTime": "2026-06-20T14:23:00Z" }
  ],
  "done": [],
  "waitTimes": { "8": 3, "9": 11 },
  "effectiveAvgMin": 8,
  "avgSource": "real",
  "completedCount": 6,
  "totalServedToday": 6,
  "undoAvailable": false
}
```

---

*Generated by ClinicQ · [GitHub](https://github.com/77-Div-77/Clinic-Queue) · [Live Demo](https://clinic-queue-production-90c9.up.railway.app)*
