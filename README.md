# D.I.C.E. — Decentralized Identity Credentials Exchange

D.I.C.E. is a hackathon MVP designed for issuing, holding, and verifying tamper-proof, signed student credentials (such as degrees, enrollment certificates, and academic honors).

---

## 🛠️ Baseline Tech Stack

- **Framework**: [React](https://react.dev/) + [Vite](https://vite.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Database / Backend-as-a-Service**: [Supabase JS Client](https://supabase.com/docs/reference/javascript)
- **Deployment**: Vercel-compatible static single-page application (SPA)

---

## 📁 Project Architecture & Folder Structure

```text
src/
├── components/          # Reusable shared UI components (e.g. Navbar)
├── features/            # Core feature modules
│   ├── issuer/          # Issuer Portal (Institution credential issuance & signing placeholder)
│   ├── wallet/          # Holder Wallet (Student vault & selective disclosure placeholder)
│   └── verifier/        # Verifier Portal (Third-party validation & verification placeholder)
├── layouts/             # Application shell & responsive layouts
├── lib/                 # Third-party integrations
│   └── supabase/        # Supabase client initialization & configuration
├── types/               # Shared domain & application TypeScript definitions
├── App.tsx              # Root component & view navigation router
├── main.tsx             # Application DOM mounting entry point
└── index.css            # Tailwind CSS directives & global resets
```

---

## 🔒 Security Principles

- **No Private Keys in Frontend**: No issuer private keys or Supabase service-role keys are stored or exposed in client bundles.
- **Client-Side Verification**: Cryptographic validation models use public keys and signed verifiable credential payloads.
- **Zero Heavy Backend**: Runs entirely as a high-performance frontend client interfacing directly with Supabase via public publishable keys.

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v20+ or v22+ recommended)
- npm (v10+)

### 2. Installation
```bash
git clone <repo-url>
cd D.I.C.E
npm install
```

### 3. Environment Variables
Copy the example environment configuration:
```bash
cp .env.example .env
```
Fill in your Supabase project credentials in `.env`:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

### 4. Running the Development Server
```bash
npm run dev
```
Open your browser at [http://localhost:5173](http://localhost:5173).

### 5. Build for Production
```bash
npm run build
```
This outputs production-optimized static assets to `dist/` ready for zero-configuration deployment to Vercel.
