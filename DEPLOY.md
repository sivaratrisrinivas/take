# Deploy take to Google Cloud

Backend: **Cloud Run** (FastAPI + WebSocket).  
Frontend: **Firebase Hosting** (Vite SPA).  
Gemini: **Vertex AI** (service account).  
CI/CD: **GitHub Actions** (on push to `main`).

---

## Prerequisites

- Google Cloud project with billing enabled.
- `gcloud` CLI installed and logged in (`gcloud auth login`).
- Firebase CLI installed (`npm i -g firebase-tools`) and logged in (`firebase login`).
- GitHub repo with secrets configured (see below).

---

## 1. One-time GCP setup

### 1.1 Create project (or use existing)

```bash
export GCP_PROJECT_ID="take-prod-123"   # or your project ID
gcloud projects create $GCP_PROJECT_ID --name="take" || true
gcloud config set project $GCP_PROJECT_ID
```

Enable billing for the project in Cloud Console if not already.

### 1.2 Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  vertexai.googleapis.com \
  firebase.googleapis.com
```

### 1.3 Create Artifact Registry repo (for Docker images)

```bash
gcloud artifacts repositories create take --repository-format=docker --location=us-central1
```

### 1.4 (Optional) Grant Cloud Run SA access to Vertex AI

Cloud Run uses the default compute service account. Ensure it can call Vertex AI:

```bash
export REGION=us-central1
export PROJECT_NUMBER=$(gcloud projects describe $GCP_PROJECT_ID --format='value(projectNumber)')
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

---

## 2. One-time Firebase setup

### 2.1 Create Firebase project (linked to GCP project)

In [Firebase Console](https://console.firebase.google.com/), add project and select the same GCP project (`take-prod-123`). Note the **Firebase project ID** (often same as GCP project ID).

### 2.2 Create Hosting site

```bash
firebase use $GCP_PROJECT_ID
firebase hosting:sites:list   # note your default site ID, e.g. take-prod-123
```

Default frontend URL will be: `https://<firebase-site-id>.web.app`.

### 2.3 Initialize Firebase in repo (if not done)

```bash
cd /path/to/take
firebase init hosting
# Choose "Use an existing project" → select $GCP_PROJECT_ID
# Public directory: frontend/dist
# Single-page app: Yes
# Don't overwrite index.html if asked
```

This creates/updates `firebase.json` and `.firebaserc`.

---

## 3. Backend env (Cloud Run)

Set these in Cloud Run (or via GitHub Actions secrets → env):

| Variable | Description |
|----------|-------------|
| `GOOGLE_GENAI_USE_VERTEXAI` | `true` for production |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | e.g. `us-central1` |
| `CORS_ORIGINS` | Comma-separated allowed origins, e.g. `https://take-prod-123.web.app` |

No `GOOGLE_API_KEY` when using Vertex (auth via service account).

---

## 4. Deploy backend (Cloud Run) manually

From repo root:

```bash
export GCP_PROJECT_ID=take-prod-123
export REGION=us-central1
export IMAGE=$REGION-docker.pkg.dev/$GCP_PROJECT_ID/take/backend:latest

# Build and push
gcloud builds submit --tag $IMAGE --timeout=600 .

# Deploy (request timeout 3600s for WebSocket)
gcloud run deploy take-backend \
  --image $IMAGE \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$GCP_PROJECT_ID,GOOGLE_CLOUD_LOCATION=$REGION,CORS_ORIGINS=https://YOUR-FIREBASE-SITE-ID.web.app" \
  --timeout 3600 \
  --min-instances 0 \
  --max-instances 5
```

Note the service URL: `https://take-backend-<hash>-<region>.a.run.app`.

---

## 5. Deploy frontend (Firebase Hosting) manually

Build with production API/WS URLs, then deploy:

```bash
export BACKEND_URL=https://take-backend-XXXXX-uc.a.run.app   # from step 4

cd frontend
npm ci
npm run build -- --mode production

# Set env for build (if not in .env.production):
# VITE_API_URL=$BACKEND_URL VITE_WS_URL=wss://take-backend-XXXXX-uc.a.run.app npm run build

firebase deploy --only hosting
```

Frontend URL: `https://<firebase-site-id>.web.app`.

---

## 6. GitHub Actions (automated deploy)

### 6.1 Secrets and variables

In GitHub: **Settings → Secrets and variables → Actions**, add:

| Name | Secret? | Description |
|------|---------|-------------|
| `GCP_PROJECT_ID` | No (variable) | e.g. `take-prod-123` |
| `GCP_SA_KEY` | Yes | JSON key for a service account with Cloud Run Admin, Artifact Registry Writer, Vertex AI User |
| `FIREBASE_SITE_ID` | No (variable) | Hosting site ID (e.g. `take-prod-123`) |
| `FIREBASE_TOKEN` | Yes | `firebase login:ci` token for deploy |

Optional (if you want GHA to set backend URL for frontend build):

| Name | Description |
|------|-------------|
| `VITE_API_URL` | Full backend URL, e.g. `https://take-backend-xxx.a.run.app` |
| `VITE_WS_URL` | Full WebSocket URL, e.g. `wss://take-backend-xxx.a.run.app` |

If not set, the workflow can read Cloud Run service URL after deploy and pass it to the frontend build.

### 6.2 Service account for GHA

Create a key for deploy:

```bash
gcloud iam service-accounts create take-deploy \
  --display-name="take GitHub Actions deploy"

# Grant roles
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:take-deploy@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:take-deploy@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:take-deploy@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Download key (paste into GitHub secret GCP_SA_KEY)
gcloud iam service-accounts keys create key.json \
  --iam-account=take-deploy@$GCP_PROJECT_ID.iam.gserviceaccount.com
# Copy key.json contents to GitHub secret; then rm key.json
```

### 6.3 Firebase token

```bash
firebase login:ci
# Copy the token into GitHub secret FIREBASE_TOKEN
```

---

## 7. WebSocket timeout and reconnect

- Cloud Run request timeout is set to **3600 seconds** (60 min). After that, the connection is closed.
- The frontend **reconnects** on `onClose` when still in "directing" mode (see `api.js` / `App.jsx`). User can also tap "End session" to finish cleanly.

---

## 8. Checklist summary

- [ ] GCP project created, billing on, APIs enabled.
- [ ] Artifact Registry repo `take` in chosen region.
- [ ] Vertex AI role for Cloud Run default SA (or deploy SA).
- [ ] Firebase project linked, Hosting site created, `firebase.json` / `.firebaserc` in repo.
- [ ] Cloud Run deployed with timeout 3600 and `CORS_ORIGINS` set to Firebase URL.
- [ ] Frontend built with `VITE_API_URL` / `VITE_WS_URL` pointing at Cloud Run URL.
- [ ] GitHub secrets/variables set; workflow runs on push to `main`.

Source: [Cloud Run WebSockets](https://cloud.google.com/run/docs/triggering/websockets), [Vertex AI migration](https://cloud.google.com/vertex-ai/generative-ai/docs/migrate/migrate-google-ai).
