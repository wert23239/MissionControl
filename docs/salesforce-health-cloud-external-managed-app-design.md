# Kouper x Salesforce — Code-Based Integration Plan

## Goal

Build the Salesforce Health Cloud integration as a **Kouper/Hiro backend code integration**, not as a Salesforce-native app first.

The runtime workflow should be:

```text
Patient call
  → Voice agent
  → Kouper backend
  → Epic / scheduling APIs
  → Kouper backend
  → Salesforce Health Cloud update
```

Epic remains the scheduling source of truth. Salesforce is the operational and care-management workflow layer where Kouper can create or update records such as:

- `Case`
- `Task`
- `Event`
- care-management workflow records
- call summaries / operational notes

The AI workflow, orchestration, auth handling, retries, field mapping, and audit logging live in Kouper code — not inside Salesforce.

---

## Current architecture decision

### Primary MVP shape

Use a **Salesforce External Client App / Connected App + Salesforce REST API integration**.

This means the first real build is code in Hiro/Kouper:

1. Hiro admin page: **Connect Salesforce Health Cloud**.
2. Backend OAuth start endpoint redirects customer admin to Salesforce.
3. Backend OAuth callback exchanges authorization code for tokens.
4. Backend stores customer org connection securely.
5. Voice-agent workflows call Hiro backend tools.
6. Hiro backend reads/writes Salesforce objects through Salesforce REST APIs.

### Do not start with

- a large managed package
- deep native Salesforce UI
- Apex-heavy logic
- complex AppExchange packaging

Those may matter later, but they are not required to prove the core integration.

---

## Salesforce concept map

### External Client App / Connected App

This is the most important Salesforce component for the MVP.

It is the OAuth/authentication layer that lets Kouper access a customer Salesforce org through Salesforce APIs.

Conceptually similar to:

- Sign in with Google
- Slack OAuth apps
- GitHub OAuth apps

Kouper owns:

- Salesforce app registration
- client ID
- client secret / key material
- OAuth callback configuration
- backend token exchange and refresh logic

The customer Salesforce admin authorizes Kouper to access their Salesforce org. After authorization, Kouper receives:

- access token
- refresh token
- org information
- customer-specific `instance_url`

Kouper can then call Salesforce REST APIs on behalf of that customer org.

Without this, there is no safe Salesforce API access and no ability to create/update Cases, Tasks, Events, or Health Cloud records.

### Customer Salesforce org

Each customer already maintains their own Salesforce environment containing:

- Health Cloud data
- patient / account records
- operational workflows
- Cases
- Tasks
- campaigns
- care-management processes

Kouper does **not** host or replace the customer Salesforce org. Kouper connects to the customer's existing org through OAuth-authorized REST APIs.

### AppExchange / Technology Listing

AppExchange is not the runtime API. It is the trust, review, discovery, and install/procurement wrapper.

For this architecture:

- **Technology / Solution** = the actual Kouper API integration / External Client App / possible future package that Salesforce reviews.
- **AppExchange Listing** = the public marketplace page that points to the reviewed technology.

AppExchange may help later with enterprise trust and procurement, especially in healthcare. But the actual runtime integration still happens through:

```text
Kouper Backend → Salesforce REST APIs
```

---

## Code-based MVP workstream

### 1. Salesforce OAuth flow

Implement backend-owned OAuth.

```ts
// routes
GET  /integrations/salesforce/oauth/start
GET  /integrations/salesforce/oauth/callback
POST /integrations/salesforce/disconnect
GET  /integrations/salesforce/status
```

OAuth requirements:

- Authorization Code + PKCE where applicable.
- Scopes: `api`, `refresh_token` / `offline_access`.
- Store one connection per customer org.
- Encrypt refresh tokens at rest.
- Never persist long-lived raw access tokens unnecessarily.
- Refresh access tokens server-side before Salesforce API calls.

Suggested connection model:

```ts
type SalesforceConnection = {
  id: string;
  customerId: string;
  salesforceOrgId: string;
  instanceUrl: string;
  refreshTokenCiphertext: string;
  scopes: string[];
  status: 'connected' | 'revoked' | 'error';
  connectedByUserId: string;
  lastTokenRefreshAt?: string;
  lastSuccessfulApiAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

### 2. Core Salesforce API client

Create a backend adapter that owns auth, token refresh, retries, limits, and request logging.

```ts
class SalesforceClient {
  constructor(private connection: SalesforceConnection) {}

  async query<T>(soql: string): Promise<T[]> {}
  async createObject<T>(objectApiName: string, body: Record<string, unknown>): Promise<T> {}
  async updateObject(objectApiName: string, id: string, body: Record<string, unknown>): Promise<void> {}
  async describeObject(objectApiName: string): Promise<SalesforceObjectDescribe> {}
  async composite(requests: SalesforceCompositeRequest[]): Promise<SalesforceCompositeResponse> {}
}
```

Base URL pattern:

```text
{instance_url}/services/data/vXX.X/...
```

Core endpoints:

| Need | Salesforce endpoint |
|---|---|
| OAuth authorize | `GET /services/oauth2/authorize` |
| Token exchange / refresh | `POST /services/oauth2/token` |
| Query | `GET /services/data/vXX.X/query/?q={SOQL}` |
| Create object | `POST /services/data/vXX.X/sobjects/{ObjectApiName}` |
| Update object | `PATCH /services/data/vXX.X/sobjects/{ObjectApiName}/{Id}` |
| Schema discovery | `GET /services/data/vXX.X/sobjects/{ObjectApiName}/describe` |
| Composite write | `POST /services/data/vXX.X/composite` |
| Limits | `GET /services/data/vXX.X/limits` |

### 3. Patient / Account search

Use Salesforce query APIs to identify the correct patient and retrieve workflow context before or after a call.

Primary object:

- `Account`

Health Cloud often represents patients as Person Accounts, so lookup usually starts with `Account`.

Example SOQL:

```sql
SELECT Id, Name, PersonEmail, PersonMobilePhone, PersonBirthdate
FROM Account
WHERE Name LIKE 'Jane%'
LIMIT 10
```

Possible lookup fields:

- name
- DOB
- phone number
- MRN
- external ID
- FHIR Patient ID
- custom customer mapping fields

Suggested Hiro service method:

```ts
async function searchSalesforcePatients(input: {
  customerId: string;
  name?: string;
  dateOfBirth?: string;
  phone?: string;
  externalId?: string;
}): Promise<SalesforcePatientMatch[]> {}
```

### 4. Case writeback

Use `Case` as the first operational writeback target. It maps naturally to care-management tickets, escalations, scheduling outcomes, and support workflows.

Create Case:

```http
POST /services/data/vXX.X/sobjects/Case
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

Update Case:

```http
PATCH /services/data/vXX.X/sobjects/Case/500...
Content-Type: application/json

{
  "Status": "Closed",
  "Description": "Epic booking completed. Appointment ID: abc123."
}
```

Suggested Hiro tool endpoint:

```ts
POST /tools/salesforce/cases
```

### 5. Follow-up Tasks

Create `Task` records when staff action is required.

```http
POST /services/data/vXX.X/sobjects/Task
Content-Type: application/json

{
  "Subject": "Call patient back about insurance verification",
  "Status": "Not Started",
  "Priority": "High",
  "WhatId": "500...",
  "WhoId": "003..."
}
```

Example uses:

- staff callback required
- insurance verification needed
- scheduling conflict needs review
- care coordinator follow-up required

### 6. Optional Events

Create `Event` records only if the customer wants Salesforce calendar visibility.

```http
POST /services/data/vXX.X/sobjects/Event
```

Important: Epic remains the source of truth for actual scheduling. Salesforce Event is only mirrored visibility/workflow metadata.

### 7. Call summaries / operational notes

Store summarized voice-agent workflow outcomes through one of:

- `CaseComment`
- `FeedItem`
- customer-specific notes object
- future custom object if needed

Example uses:

- voice-agent call summary
- scheduling outcome summary
- escalation explanation
- follow-up instructions
- audit trail references

### 8. Composite API

Use Composite API to bundle multi-write workflows.

```http
POST /services/data/vXX.X/composite
```

Example:

```text
Create Case
  + Create Task
  + Attach call summary
```

This reduces round trips and helps avoid partial-failure scenarios.

### 9. Schema discovery and field mapping

Use object describe APIs to support customer-specific Salesforce configurations.

```http
GET /services/data/vXX.X/sobjects/{Object}/describe
```

Use for:

- detecting available fields
- validating customer mappings
- supporting custom Health Cloud variations
- hiding unsupported UI fields
- configuring integration per customer org

---

## Suggested product surface in Hiro

### Admin UI

Add a Salesforce integration page:

```text
Settings / Integrations / Salesforce Health Cloud
```

Minimum UI:

- connection status
- connected org name / org ID
- connected by
- last successful sync/API call
- **Connect Salesforce Health Cloud** button
- **Disconnect** button
- test query button
- field mapping configuration later

### Backend service methods

Initial service methods:

```ts
getSalesforceConnection(customerId)
startSalesforceOAuth(customerId, userId)
handleSalesforceOAuthCallback(code, state)
refreshSalesforceAccessToken(connection)
searchPatientAccounts(customerId, criteria)
getPatientWorkflowContext(customerId, patientId)
createSalesforceCase(customerId, payload)
updateSalesforceCase(customerId, caseId, payload)
createSalesforceTask(customerId, payload)
writeSalesforceCallSummary(customerId, payload)
runSalesforceComposite(customerId, requests)
```

### Voice-agent tool contract

The voice agent should call Kouper/Hiro tools, not Salesforce directly.

Example internal tools:

```ts
salesforce.searchPatientContext
salesforce.createSchedulingCase
salesforce.markSchedulingCaseResolved
salesforce.createFollowUpTask
salesforce.writeCallSummary
```

---

## End-to-end MVP workflow

```text
1. Customer Salesforce admin authorizes Kouper through OAuth.
2. Kouper stores the org connection securely.
3. Patient calls the voice agent.
4. Voice-agent workflow identifies patient intent.
5. Kouper searches Salesforce for patient/account context.
6. Kouper books/checks appointment through Epic integration.
7. Kouper writes operational result back to Salesforce.
8. Salesforce becomes the visibility/workflow layer for operations teams.
```

Example after successful Epic booking:

```text
Epic appointment booked
  → update/create Salesforce Case
  → optionally create Task for coordinator
  → optionally create Event for calendar visibility
  → write call summary
  → record audit log with Salesforce IDs + Epic appointment ID
```

---

## Security and compliance posture

Implementation rules:

- customer org authorization through OAuth only
- no customer Salesforce passwords
- encrypted refresh tokens
- least-privilege scopes where possible
- server-side API calls only
- audit logs for every external write
- structured error handling and retries
- no unnecessary PHI retention outside operational need
- token revocation / disconnect path
- rotate any development secret that was pasted into chat before real use

---

## AppExchange later

Once the code-based connector works, AppExchange work becomes packaging/trust work:

1. Register/connect the Technology/Solution in Salesforce Partner Console.
2. Likely choose **Salesforce Platform API Solution** first.
3. Add managed package only if customers need Salesforce-installed UI/components/permission sets/custom objects.
4. Prepare security-review docs: data flow, auth model, test credentials, scan reports, PHI/PII posture.
5. Create the public AppExchange Listing after the underlying technology exists.

The listing should say, effectively:

> Kouper is an officially reviewed Salesforce Health Cloud integration that connects your org to Kouper voice-agent workflows.

But the actual working product is still backend code + OAuth + REST APIs.

---

## Immediate next engineering tasks

1. Add Salesforce connection persistence model.
2. Add OAuth start/callback/disconnect/status endpoints.
3. Add encrypted refresh-token storage.
4. Add token refresh helper.
5. Add Salesforce REST client wrapper.
6. Add Account / Person Account search.
7. Add Case create/update.
8. Add Task create.
9. Add call-summary writeback.
10. Add Composite API helper.
11. Add admin integration page in Hiro.
12. Wire voice-agent workflows to Hiro Salesforce tool endpoints.
13. Add audit logging and customer-specific field mapping.
