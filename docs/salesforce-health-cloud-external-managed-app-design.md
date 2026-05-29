# Kouper x Salesforce — Prototype Scope

## Prototype goal

For this prototype, we only care about two things:

1. **Salesforce login button in Hiro**
2. **Patient match against Salesforce after login**

Everything else is explicitly out of scope for now:

- no Case writeback
- no Task writeback
- no Event creation
- no call-summary writeback
- no AppExchange packaging
- no managed package
- no native Salesforce UI
- no Epic scheduling writeback

The product proof is simply:

```text
Hiro admin clicks “Connect Salesforce”
  → Salesforce OAuth login/approval
  → Hiro stores Salesforce org connection
  → Hiro searches Salesforce Account / Person Account records
  → Hiro shows possible Salesforce patient matches for a Hiro patient
```

This should be built as **direct Hiro code in the existing Hiro repo**, not as a separate demo app.

Repo/folder:

```text
/Users/clawman/.openclaw/workspace/hiro
```

---

## Mental model

```text
Hiro frontend login button
        ↓
Hiro backend OAuth endpoints
        ↓
Salesforce External Client App / Connected App
        ↓
Customer Salesforce org
        ↓
Salesforce Account / Person Account query
        ↓
Hiro patient match result
```

The Salesforce integration belongs inside Hiro because Hiro already owns:

- user auth
- facility/practice context
- patient records
- backend API patterns
- frontend admin pages
- database migrations/entities

---

## Direct Hiro code locations

### Frontend

Add the prototype UI under the existing Hiro frontend:

```text
hiro/frontend/src/pages/AdminPanel/SalesforceIntegration.jsx
hiro/frontend/src/pages/AdminPanel/style.scss
hiro/frontend/src/App.jsx
hiro/frontend/src/pages/AdminPanel/AdminNav.jsx
hiro/frontend/src/HiroApi.js
```

Recommended UI location:

```text
/admin/salesforce
```

Add a simple admin page with:

- connection status
- **Connect Salesforce** button
- **Disconnect** button if already connected
- patient search/match form
- match results table

The login button should redirect to the Hiro backend, not directly hand-roll Salesforce auth in the browser:

```js
window.location.href = api.url(`/facility/${facilityId}/salesforce/oauth/start`);
```

### Backend

Add a dedicated Salesforce integration module under the existing Hiro backend:

```text
hiro/backend/src/salesforce/salesforce.module.ts
hiro/backend/src/salesforce/salesforce.controller.ts
hiro/backend/src/salesforce/salesforce.service.ts
hiro/backend/src/salesforce/salesforce.client.ts
hiro/backend/src/salesforce/dto/patient-match.dto.ts
hiro/backend/src/salesforce/entity/salesforce-connection.entity.ts
hiro/backend/src/salesforce/entity/salesforce-patient-match.entity.ts
```

Wire it into:

```text
hiro/backend/src/routes.ts
hiro/backend/src/app.module.ts or module registration file used by the repo
```

Existing relevant code to reuse/reference:

```text
hiro/backend/src/patient/entity/patient.entity.ts
hiro/backend/src/practice/entity/practice.entity.ts
hiro/backend/src/settings/*
hiro/backend/src/common/entity/base.entity.ts
hiro/backend/src/migrations/*
```

---

## Prototype backend endpoints

Only build the endpoints needed for login + patient match.

```http
GET  /facility/:facilityId/salesforce/oauth/start
GET  /facility/:facilityId/salesforce/oauth/callback
GET  /facility/:facilityId/salesforce/status
POST /facility/:facilityId/salesforce/disconnect
POST /facility/:facilityId/salesforce/patient-match
```

### Endpoint behavior

| Endpoint | Purpose |
|---|---|
| `GET /oauth/start` | Build Salesforce authorization URL and redirect admin to Salesforce |
| `GET /oauth/callback` | Exchange code for tokens, store connection, redirect back to Hiro admin page |
| `GET /status` | Return connected/disconnected + org info |
| `POST /disconnect` | Revoke/disable local connection |
| `POST /patient-match` | Search Salesforce for matching patient/account records |

---

## Database schema for prototype

### `salesforce_connection`

Store one Salesforce org connection per Hiro facility/practice/customer context.

```ts
@Entity({ name: 'salesforce_connection' })
@Unique('UQ_salesforce_connection_facility', ['facilityId'])
export class SalesforceConnection extends BaseEntity {
  @Column({ name: 'facility_id', length: 5 })
  facilityId: string;

  @Column({ name: 'salesforce_org_id' })
  salesforceOrgId: string;

  @Column({ name: 'instance_url' })
  instanceUrl: string;

  @Column({ name: 'refresh_token_ciphertext', type: 'text' })
  refreshTokenCiphertext: string;

  @Column({ type: 'text', array: true, default: '{}' })
  scopes: string[];

  @Column({ default: 'connected' })
  status: 'connected' | 'revoked' | 'error';

  @Column({ name: 'connected_by_user_id', nullable: true })
  connectedByUserId?: string;

  @Column({ name: 'last_token_refresh_at', type: 'timestamptz', nullable: true })
  lastTokenRefreshAt?: Date;

  @Column({ name: 'last_successful_api_at', type: 'timestamptz', nullable: true })
  lastSuccessfulApiAt?: Date;
}
```

### `salesforce_patient_match`

Optional but useful for debugging/demo: store match attempts and selected matches.

```ts
@Entity({ name: 'salesforce_patient_match' })
export class SalesforcePatientMatch extends BaseEntity {
  @Column({ name: 'facility_id', length: 5 })
  facilityId: string;

  @Column({ name: 'hiro_patient_id', nullable: true })
  hiroPatientId?: string;

  @Column({ name: 'salesforce_account_id' })
  salesforceAccountId: string;

  @Column({ name: 'salesforce_contact_id', nullable: true })
  salesforceContactId?: string;

  @Column({ type: 'float', default: 0 })
  score: number;

  @Column({ type: 'jsonb', default: {} })
  criteria: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  rawSalesforceRecord: Record<string, unknown>;
}
```

Migration file location:

```text
hiro/backend/src/migrations/<timestamp>-salesforce-login-and-patient-match.ts
```

---

## Patient match API contract

### Request

```http
POST /facility/:facilityId/salesforce/patient-match
Content-Type: application/json
```

```json
{
  "hiroPatientId": "optional-existing-hiro-patient-id",
  "firstName": "Jane",
  "lastName": "Smith",
  "dob": "1980-04-12",
  "phone": "+15555550123",
  "email": "jane@example.com",
  "externalId": "optional-mrn-or-fhir-id"
}
```

### Response

```json
{
  "matches": [
    {
      "score": 0.94,
      "salesforceAccountId": "001...",
      "salesforceContactId": "003...",
      "name": "Jane Smith",
      "dob": "1980-04-12",
      "phone": "+15555550123",
      "email": "jane@example.com",
      "matchedOn": ["name", "dob", "phone"]
    }
  ]
}
```

---

## Salesforce query for prototype

Start with `Account` / Person Account because Health Cloud commonly represents patients as Person Accounts.

```sql
SELECT Id, Name, FirstName, LastName, PersonBirthdate, PersonMobilePhone, PersonEmail
FROM Account
WHERE LastName LIKE 'Smith%'
LIMIT 10
```

If the org does not expose Person Account fields, fallback to basic `Account` fields:

```sql
SELECT Id, Name, Phone
FROM Account
WHERE Name LIKE 'Jane Smith%'
LIMIT 10
```

Matching rules for prototype:

1. exact/near last name
2. exact/near first name
3. exact DOB if available
4. normalized phone match if available
5. email match if available
6. external ID/MRN if customer field exists later

No need to solve every Health Cloud schema variation in the prototype. The demo only needs to show that Hiro can log in to Salesforce and find likely patient matches.

---

## Salesforce client methods

```ts
class SalesforceClient {
  async refreshAccessToken(connection: SalesforceConnection): Promise<string> {}

  async query<T>(connection: SalesforceConnection, soql: string): Promise<T[]> {}

  async searchPatientAccounts(
    connection: SalesforceConnection,
    input: SalesforcePatientMatchRequest,
  ): Promise<SalesforcePatientCandidate[]> {}
}
```

Salesforce REST endpoints used:

```text
GET  /services/oauth2/authorize
POST /services/oauth2/token
GET  /services/data/vXX.X/query/?q={SOQL}
```

That is enough for the prototype.

---

## Frontend prototype behavior

Page:

```text
/admin/salesforce
```

States:

### Disconnected

Show:

```text
Salesforce Health Cloud is not connected.
[Connect Salesforce]
```

Clicking the button redirects to:

```text
/facility/:facilityId/salesforce/oauth/start
```

### Connected

Show:

```text
Connected to Salesforce org: <org id / instance url>
[Disconnect]
```

Then show patient match form:

- first name
- last name
- DOB
- phone
- email
- optional Hiro patient selector / ID

Submit calls:

```text
POST /facility/:facilityId/salesforce/patient-match
```

Render candidate matches with score and matched fields.

---

## What success looks like

A successful prototype demo is:

1. Open Hiro.
2. Go to `/admin/salesforce`.
3. Click **Connect Salesforce**.
4. Approve Salesforce OAuth.
5. Return to Hiro and see connected state.
6. Enter patient search fields.
7. Hiro queries Salesforce and shows possible Account / Person Account matches.

That is it. Patient match is the product proof.

---

## Explicitly later / not now

After the prototype works, later phases can add:

- Case writeback
- Task creation
- Event mirroring
- call-summary writeback
- schema discovery UI
- customer-specific field mapping
- AppExchange Technology / Listing
- managed package only if required

But none of those should distract from the prototype.
