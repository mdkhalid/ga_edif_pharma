# @medichain/mobile

The MediChain mobile application for **Android and iOS**, built with React Native and
Expo.

**Stack:** React Native 0.86.3 · Expo SDK 57 · React 19.2 · TypeScript · React
Navigation 7 · TanStack Query v5 · Zustand · `expo-secure-store` · EAS Build.
MMKV, FlashList, push and camera modules are **not installed** — those rows below
are target design, not current behaviour.

---

## Why React Native + Expo

| Reason | Detail |
|---|---|
| **One codebase, two stores** | The brief requires both Android and iOS; a small team cannot maintain two native codebases. |
| **TypeScript end to end** | Validation schemas, DTOs and the salt normaliser are shared with the backend and website via `packages/`. |
| **Expo removes native build pain** | Signing, provisioning profiles and native module linking are handled. EAS Build in CI, EAS Submit to the stores. |
| **OTA updates** | JS-only fixes ship without store review — critical when a store review takes days. |
| **Escape hatch** | `expo prebuild` ejects to bare React Native without losing the codebase, if a native module ever requires it. |

**Why not Flutter:** the entire backend and web stack is TypeScript. Sharing types,
validation and business logic across all four applications is worth more than
Flutter's marginally better rendering performance.

---

## Getting started

```bash
cp .env.example .env
npm install
npm run start --workspace=@medichain/mobile        # Expo dev server
npm run android --workspace=@medichain/mobile
npm run ios --workspace=@medichain/mobile
```

For a native build (required for push notifications and some native modules):

```bash
eas build --profile development --platform android
eas build --profile development --platform ios
```

---

## Navigation

The tree below is the **target** navigator. Today the app has the auth flow,
home, profile and the Orders tab (list + one-tap reorder); the catalogue, cart,
checkout, scan and remaining account screens are still P12 scope.

```
RootNavigator
├── AuthNavigator        (unauthenticated)
│   ├── Login
│   ├── OTP
│   └── Register
└── AppTabs              (authenticated)
    ├── Home
    ├── CatalogStack
    │   ├── Catalog → ProductDetail → Category
    │   └── Search → SaltSearch
    ├── ScanStack
    │   └── BarcodeScan
    ├── OrdersStack
    │   ├── OrderList → OrderDetail → TrackOrder
    │   └── Cart → Checkout
    └── AccountStack
        ├── Profile → Addresses → Security → Settings
        ├── Prescriptions
        ├── Invoices
        ├── Credit
        └── Returns
```

Deep links are declared in `navigation/linking.ts` so a push notification tap opens
the right screen rather than the home screen.

---

## Storage — the rules that matter

| Data | Storage | Never |
|---|---|---|
| Access token | **In memory only** | — |
| Refresh token | `expo-secure-store` (Keychain / Keystore) | ❌ AsyncStorage |
| Cart | In-memory today; MMKV sync is planned (not installed) | — |
| Cached catalogue | No local cache today; MMKV + Query persister planned | — |
| User preferences | Not persisted today; MMKV planned | — |
| Prescription images | Uploaded to S3, only the reference cached | ❌ Local copies |

**Tokens go in the Keychain / Keystore, never AsyncStorage.** AsyncStorage is
unencrypted plaintext on disk. On a rooted or jailbroken device — or through a
device backup — an AsyncStorage token is a full account compromise.

---

## Offline behaviour

**Target behaviour — not implemented.** No offline cache, persister or queued
orders exist today; the rules below are the design intent for P12.

| Feature | Offline behaviour |
|---|---|
| Browse catalogue | Cached results shown, marked "last updated" |
| Search | Cached results; a clear "offline" indicator |
| Add to cart | Fully functional; synced when connectivity returns |
| Place order | Queued, with an explicit "will submit when online" notice |
| Orders, invoices | Last-known data shown, marked stale |
| Payments | **Blocked** — never queue a payment offline |

**Payments are never queued offline.** A queued payment can execute at an
unpredictable later time, against a price or stock level that has changed. The user
must be online to pay.

---

## Performance

| Technique | Purpose |
|---|---|
| FlashList for long lists | Planned — not installed; uses flat lists today |
| MMKV cache | Planned — not installed |
| TanStack Query persistence | Planned — no persister installed |
| Hermes engine | Faster startup, lower memory |
| Image caching + server-side resizing | Less bandwidth, no jank |
| `InteractionManager` for heavy work | Keeps the JS thread responsive |
| Dynamic imports | Smaller initial bundle |
| Hermes bytecode precompilation | Faster, smaller bundles |

Budget: cold start < 2 s, 60 fps scrolling, < 30 MB baseline memory.

---

## Push notifications

**Planned — `expo-notifications` is not installed.** No push token registry or
delivery exists in the app today.

| Event | Notification |
|---|---|
| Order confirmed | "Order SO-2026-000412 confirmed" |
| Order dispatched | With tracking link |
| Order delivered | Delivery confirmation |
| Payment reminder | Overdue invoice |
| Near-expiry stock | For the buyer's own stock |
| Licence expiry | 90/60/30/7 days before |

Push payloads contain **no sensitive data** — an id and a type. The app fetches the
details after the user authenticates. A notification is displayed on a locked screen.

---

## Release process

| Step | Command |
|---|---|
| Version bump | Update `app.json` + `package.json` |
| Build | `eas build --profile production --platform all` |
| Submit | `eas submit --profile production --platform all` |
| OTA update (JS only) | `eas update --branch production` |

### Version gating

Every request sends `X-App-Version` and `X-App-Platform`. If the version is below the
server's configured minimum, the API returns `426 Upgrade Required` and the app shows
a blocking upgrade screen.

**This is the only reliable way to retire an old mobile client.** A deprecated API
version must be supported for at least 6 months, because users on old app versions
cannot be force-updated — some devices never update.

---

## Monorepo configuration

Metro does not resolve workspace packages by default. `metro.config.js` must set:

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

Without this, imports from `@medichain/shared-types` fail to resolve — and the error
is unhelpful.

---

## Testing

The only suite today is the headless auth flow:
`npm run test:integration --workspace=@medichain/mobile` (7 cases against a live
API). There is no component-test script, React Native Testing Library or Detox,
and no screen has been rendered on a device or simulator here.

Critical flows still to automate: salt search, add to cart, place order, barcode
scan to reorder, view invoice, upload prescription, receive and open a push
notification.
