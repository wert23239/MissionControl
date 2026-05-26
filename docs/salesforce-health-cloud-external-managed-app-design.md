# Salesforce Health Cloud External Managed App — Engineering Design

## TL;DR

We are building a Hiro-owned Salesforce Health Cloud connector that lets an existing voice agent and Epic integration safely update Salesforce after care workflows happen.

The customer-facing flow should be:

1. Hospital admin opens Hiro.
2. Admin clicks **Connect Salesforce Health Cloud**.
3. Salesforce OAuth approval screen opens from our Salesforce External Client App / Connected App.
4. Admin authorizes access for their Salesforce org.
5. Hiro stores the org connection securely.
6. Voice-agent workflows call Hiro backend tools.
7. Hiro reads/writes approved Salesforce Health Cloud objects through Salesforce REST APIs.
8. Our separate Epic/FHIR adapter remains the source for Epic-side scheduling/clinical operations.
9. After an appointment is booked in Epic, Hiro writes the relevant operational update back to Salesforce, usually as a `Case`, `Task`, `Event`, or care-management record linked to the patient/account.

In AppExchange terms:

- **Technology** = the actual connector/API/package Salesforce reviews.
- **Listing** = the public AppExchange storefront page that points to the reviewed technology.

Do **not** think of AppExchange as the API. AppExchange is distribution + trust + install flow. The real API calls are still normal Salesforce OAuth + REST API calls against each customer org.

---

## What the Salesforce Technology Listing actually does for us

The Technology Listing is basically Salesforce saying:

> Tell us what actual technical thing you’re connecting to customer Salesforce orgs, so we can review/approve it.

For us, it does three useful things.

### 1. Creates the reviewed integration artifact

Our API / middleware / External Client App / Connected App / managed package gets registered as the **Technology**.

This is the thing Salesforce security reviews.

For our use case, the first likely technology shape is:

- **Salesforce Platform API Solution** for Hiro backend + OAuth + REST integration.
- Optional later: **managed package** if we need Salesforce UI components, custom objects, flows, permission sets, buttons, or packaged setup screens inside the customer org.

### 2. Lets customers safely connect their Salesforce org

The customer installs or authorizes the technology.

Our voice-agent/backend can then read/write approved Health Cloud objects through OAuth/API access.

Without this, we are just a random external app asking for Salesforce credentials/API access. With it, we have a Salesforce-recognized integration path, security review artifacts, and a cleaner admin trust story.

### 3. Enables the public AppExchange listing

The storefront listing is mostly marketing/install/support.

But it has to point to a reviewed Technology underneath it.

So:

- **Technology** = the actual connector/API/package.
- **Listing** = the AppExchange page selling/distributing it.

---

## Proposed architecture

```text
Patient / caregiver call
        ↓
Voice agent runtime
        ↓ tool call
Hiro backend workflow layer
        ↓                         ↓
Salesforce adapter             Epic/FHIR adapter
        ↓                         ↓
Customer Salesforce             Customer Epic / EHR
Health Cloud org                scheduling + clinical APIs
```

Important split:

- The **voice agent should not talk directly to Salesforce**.
- The **voice agent calls Hiro tool endpoints**.
- Hiro owns auth, mapping, retries, validation, audit logs, and PHI controls.
- Epic booking happens through our existing Epic/FHIR integration path.
- Salesforce gets updated with care-management / CRM workflow state after the Epic action succeeds.

Example:

```text
1. Patient asks to schedule a follow-up appointment.
2. Voice agent gathers patient identity, preferred time, reason, and constraints.
3. Hiro calls Epic/FHIR scheduling API or Epic-backed middleware.
4. Epic appointment booking succeeds.
5. Hiro writes Salesforce update:
   - Case: appointment booked / escalation resolved
   - Task: follow-up action for care coordinator
   - Event: appointment metadata if the org uses Salesforce calendars
   - CaseComment / FeedItem / note object: call summary
6. Hiro logs the cross-system transaction ID for audit/debugging.
```

---

## Salesforce auth model

Use Salesforce OAuth 2.0 Authorization Code + PKCE through the External Client App / Connected App.

### Initial pilot/dev flow

- Salesforce app type: **External Client App** or Connected App.
- OAuth scopes:
  - `api` — call Salesforce REST APIs.
  - `refresh_token` / `offline_access` — refresh tokens for server-side background access.
  - Optional later: narrower scopes if Salesforce/customer policy requires.
- Callback URL:
  - Dev: `http://localhost:.../oauth/salesforce/callback` or Postman callback for testing.
  - Prod: `https://api.hiro.../integrations/salesforce/oauth/callback`.

### Runtime connection fields

Store one row per connected customer org:

| Field | Purpose |
|---|---|
| `customer_id` | Hiro tenant/customer ID |
| `salesforce_org_id` | Salesforce org identifier returned by OAuth identity endpoint |
| `instance_url` | Customer-specific Salesforce base URL |
| `refresh_token_ciphertext` | Encrypted refresh token |
| `scopes` | Granted OAuth scopes |
| `status` | connected / revoked / error |
| `connected_by_user_id` | Customer admin who authorized |
| `last_token_refresh_at` | Operational health |
| `last_successful_api_at` | Integration health |

Never store raw access tokens long-term. Mint access tokens on demand from the refresh token, cache briefly if needed, and encrypt all secrets.

---

## Exact Salesforce APIs we need

Salesforce REST base pattern:

```text
https://{customer_instance_url}/services/data/vXX.X/...
```

Use a recent stable API version for the customer org, for example `v61.0` or newer after validation.

### Auth/token APIs

| Need | Endpoint |
|---|---|
| Browser authorization | `GET /services/oauth2/authorize` |
| Token exchange / refresh | `POST /services/oauth2/token` |
| Identity/org/user info | `GET /services/oauth2/userinfo` or OAuth identity URL returned by token response |

### Core REST APIs

| Need | Endpoint | Example |
|---|---|---|
| Query Salesforce data | `GET /services/data/vXX.X/query/?q={SOQL}` | Search patient/account/case context |
| Create object | `POST /services/data/vXX.X/sobjects/{ObjectApiName}/` | Create `Case`, `Task`, `Event` |
| Read object | `GET /services/data/vXX.X/sobjects/{ObjectApiName}/{Id}` | Fetch `Account`, `Case`, `Task` |
| Update object | `PATCH /services/data/vXX.X/sobjects/{ObjectApiName}/{Id}` | Update `Case.Status` after Epic booking |
| Composite transaction | `POST /services/data/vXX.X/composite` | Create Case + Task + note in one request |
| Describe object schema | `GET /services/data/vXX.X/sobjects/{ObjectApiName}/describe` | Discover fields in customer org |
| API limits | `GET /services/data/vXX.X/limits` | Monitor quota/rate limits |

---

## Salesforce data we likely need

### 1. Patient / household identity

Primary object:

- `Account`

Health Cloud often represents patients as **Person Accounts**, so patient lookup usually starts with `Account` records where the org's patient/person-account configuration is enabled.

Example SOQL:

```sql
SELECT Id, Name, PersonEmail, PersonMobilePhone, PersonBirthdate
FROM Account
WHERE Name LIKE 'Jane%'
LIMIT 10
```

Potential related objects depending on org config:

- `Contact`
- `Individual`
- Health Cloud patient/person account extensions
- External IDs mapping Salesforce patient/account to Epic MRN/FHIR Patient ID

Required mapping for Hiro:

| Hiro concept | Salesforce likely field/object | Epic/FHIR concept |
|---|---|---|
| Patient | `Account` / Person Account | `Patient` |
| Patient external ID | Custom field on `Account`, e.g. `Epic_MRN__c` or `FHIR_Patient_ID__c` | `Patient.id` / MRN |
| Caregiver / household member | `Contact` / relationship object | RelatedPerson |
| Phone/email | Person Account fields | Patient telecom |

### 2. Care-management workflow / service request

Primary object:

- `Case`

This is the first writeback target because we already proved we can create a Case, and it maps naturally to care-management tickets/escalations.

Example: after booking appointment in Epic, update or create a Salesforce Case.

Create Case:

```http
POST /services/data/vXX.X/sobjects/Case/
Content-Type: application/json

{
  "Subject": "Appointment booked by voice agent",
  "Description": "Patient requested cardiology follow-up. Epic appointment booked for 2026-06-02 10:30 ET.",
  "Status": "Closed",
  "Priority": "Medium",
  "Origin": "Voice Agent",
  "AccountId": "001..."
}
```

Update existing Case:

```http
PATCH /services/data/vXX.X/sobjects/Case/500...
Content-Type: application/json

{
  "Status": "Closed",
  "Description": "Epic appointment booked. Epic appointment ID: appt-123."
}
```

Fields may vary by customer org, so Hiro should use `Case.describe` during setup and support customer-specific field mapping.

### 3. Follow-up task for staff

Primary object:

- `Task`

Use this when the voice agent cannot fully resolve something, or when staff must verify an Epic result.

Create Task:

```http
POST /services/data/vXX.X/sobjects/Task/
Content-Type: application/json

{
  "Subject": "Review voice-agent appointment request",
  "Status": "Not Started",
  "Priority": "Normal",
  "WhatId": "500...",
  "Description": "Patient asked for earlier appointment if cancellation opens."
}
```

Common relationships:

- `WhoId` = person/contact/lead-style relationship when applicable.
- `WhatId` = related business object such as `Case`, `Account`, or custom care object.

### 4. Appointment/calendar representation

Possible objects:

- `Event` — standard Salesforce calendar event.
- Health Cloud scheduling/care-plan objects if customer has them configured.
- Custom object if the org already has an appointment model.

If Epic remains the appointment source of truth, Salesforce should usually receive a summarized appointment reference rather than become the scheduling system.

Create Event example:

```http
POST /services/data/vXX.X/sobjects/Event/
Content-Type: application/json

{
  "Subject": "Epic appointment: Cardiology follow-up",
  "StartDateTime": "2026-06-02T14:30:00Z",
  "EndDateTime": "2026-06-02T15:00:00Z",
  "WhatId": "001...",
  "Description": "Booked in Epic by Hiro voice agent. Epic appointment ID: appt-123."
}
```

### 5. Clinical/care context from Health Cloud

If the customer grants access and has Health Cloud objects enabled, the adapter can read context from objects such as:

- `ClinicalEncounter`
- `ClinicalEncounterProvider`
- `ClinicalEncounterDiagnosis`
- `HealthCondition`
- `MedicationRequest`
- `Medication`
- `PatientMedicationDosage`
- `MedicationStatement`
- `CareObservation`
- `DiagnosticSummary`
- `HealthcareProvider`
- `HealthcareFacility`

Use these carefully. For the MVP, avoid broad clinical writeback unless the customer explicitly wants it and field mappings are validated.

Recommended MVP stance:

- Read enough Salesforce context to identify patient + case/care workflow.
- Book or modify appointments in Epic through the existing Epic API path.
- Write operational status back to Salesforce: `Case`, `Task`, `Event`, and a call summary.
- Add clinical Health Cloud objects later after customer-specific validation.

---

## MVP API methods in Hiro

Expose internal Hiro tool endpoints to the voice agent. These are not public Salesforce APIs; these are our backend wrappers.

| Hiro endpoint | What it does | Salesforce/Epic calls |
|---|---|---|
| `POST /integrations/salesforce/oauth/start` | Begin Salesforce OAuth | Redirect to `/services/oauth2/authorize` |
| `GET /integrations/salesforce/oauth/callback` | Finish OAuth | `POST /services/oauth2/token` |
| `GET /salesforce/patient-search` | Search patient/account | SOQL on `Account` / related objects |
| `GET /salesforce/patient-context/{id}` | Fetch Salesforce care context | SOQL / object reads |
| `POST /epic/appointments/book` | Book appointment in Epic | Existing Epic API/FHIR scheduling path |
| `POST /salesforce/cases` | Create care-management case | `POST /sobjects/Case` |
| `PATCH /salesforce/cases/{id}` | Update case after Epic result | `PATCH /sobjects/Case/{Id}` |
| `POST /salesforce/tasks` | Create follow-up task | `POST /sobjects/Task` |
| `POST /salesforce/events` | Optional appointment calendar record | `POST /sobjects/Event` |
| `POST /salesforce/call-summary` | Write transcript/summary reference | Case comment/feed/note/custom mapping |

---

## Main workflow: Epic appointment booking + Salesforce Case update

```text
Voice agent hears: “Can you book my follow-up appointment?”

1. Hiro identifies patient.
   - Salesforce: search `Account` / Person Account.
   - Epic: resolve to FHIR `Patient` / MRN.

2. Hiro checks appointment options.
   - Epic API / FHIR scheduling / existing hospital scheduling middleware.

3. Hiro books appointment.
   - Epic remains source of truth for actual scheduling.

4. Hiro writes Salesforce update.
   - Create or update `Case` linked to patient `Account`.
   - Add `Task` if staff follow-up is needed.
   - Optional `Event` if customer wants Salesforce calendar visibility.
   - Store Epic appointment ID/reference in mapped custom field or description.

5. Hiro returns confirmation to voice agent.
```

Composite API option for step 4:

```http
POST /services/data/vXX.X/composite
Content-Type: application/json

{
  "allOrNone": true,
  "compositeRequest": [
    {
      "method": "POST",
      "url": "/services/data/vXX.X/sobjects/Case",
      "referenceId": "newCase",
      "body": {
        "Subject": "Appointment booked by voice agent",
        "Status": "Closed",
        "Origin": "Voice Agent",
        "AccountId": "001...",
        "Description": "Booked in Epic. Appointment ID appt-123."
      }
    },
    {
      "method": "POST",
      "url": "/services/data/vXX.X/sobjects/Task",
      "referenceId": "newTask",
      "body": {
        "Subject": "Confirm appointment prep instructions",
        "Status": "Not Started",
        "Priority": "Normal",
        "WhatId": "@{newCase.id}"
      }
    }
  ]
}
```

---

## External managed app vs managed package

### API-only External Client App / Connected App

Best for MVP and pilots.

Use when:

- Hiro backend is the product.
- Customers authorize access with OAuth.
- We do not need Salesforce UI components installed.
- We can map existing objects like `Account`, `Case`, `Task`, `Event`.

Pros:

- Faster to build.
- Closer to normal SaaS integration pattern.
- Less package complexity.

Cons:

- Customer-specific field mapping may be needed.
- No packaged Salesforce UI/setup screens unless we build them separately.

### Managed package + API solution

Use later if needed.

Use when:

- We need custom Salesforce objects/fields.
- We need packaged permission sets.
- We need Lightning components or buttons inside Salesforce.
- We need a native setup wizard or admin panel inside Salesforce.

Likely package contents later:

- Permission set: `Hiro_Integration_Admin`.
- Custom fields on `Case`/`Account`, e.g. Epic appointment ID, voice-agent call ID.
- Optional custom object: `Hiro_Call__c` or `Voice_Agent_Interaction__c`.
- Optional Lightning page/component for call summaries.

Recommendation:

Start API-only. Add managed package only when a pilot customer requires native Salesforce UI/custom metadata.

---

## AppExchange path

1. Build working Hiro Salesforce connector.
2. Validate in Health Cloud trial/dev org.
3. Validate with one real or partner sandbox customer org.
4. Decide API-only vs managed package + API.
5. In Salesforce Partner Console, create/connect the **Technology**.
6. Register as Salesforce Platform API Solution first if API-only.
7. Add managed package technology only if required.
8. Prepare security review submission:
   - Data-flow diagram.
   - OAuth/auth docs.
   - PHI/PII handling posture.
   - Test credentials/environment.
   - Scan reports.
   - Least-privilege access story.
   - Support/remediation process.
9. Submit security review.
10. After technology approval, create AppExchange **Listing**.
11. Listing points to the reviewed technology and gives customers the trust/discovery/install flow.

---

## Security and compliance notes

- Rotate the current Salesforce Consumer Secret before anything real because it was pasted during testing.
- Use Authorization Code + PKCE.
- Encrypt refresh tokens.
- Do not store raw PHI in logs.
- Log object IDs, transaction IDs, and status codes; redact transcripts unless explicitly approved.
- Add per-customer field mapping and allowlist objects/fields.
- Use least-privilege permission sets where possible.
- Support token revocation and disconnect flow.
- Add audit log for every Salesforce and Epic write.
- Use idempotency keys when updating Salesforce after Epic booking to avoid duplicate Cases/Tasks.

---

## Open questions before production

1. Is Salesforce the care-management workflow source of truth, or only a CRM mirror of Epic actions?
2. Which object should represent the main voice-agent workflow: `Case`, `Task`, custom object, or Health Cloud care-plan object?
3. Does the customer already map Salesforce `Account` to Epic MRN/FHIR Patient ID?
4. Should appointment visibility be represented as `Event`, Case fields, or not in Salesforce at all?
5. Do we need native Salesforce UI components, or is Hiro-hosted setup enough?
6. What exact permission set will the customer admin grant?
7. Which transcripts/summaries can be stored in Salesforce vs Hiro vs not stored?

---

## Recommended next implementation slice

Build the smallest useful end-to-end demo:

1. Hiro OAuth connect page for Salesforce.
2. Store `instance_url` + encrypted refresh token.
3. Search `Account` by name.
4. Create `Case` linked to Account.
5. Simulate Epic booking response with appointment ID.
6. Update Case with Epic appointment ID/status.
7. Add Task if follow-up needed.
8. Add audit log row for every external write.

This proves the core product story:

> Existing voice agent books or manages care through Epic, then Hiro updates Salesforce Health Cloud care-management state through a reviewed, customer-authorized integration.
