# 09 · Mobile shell — wave `P8`

> ## 🔴 Blocked — do not build
>
> FSD `B1` reads: *"A driver-facing mobile application. **The transporter portal is web only in version one.**"*
> FSD `A10` phase 5 budgets the **whole** transporter portal at four weeks.
>
> `P8` needs a **change request against FSD `B1`** before any work starts. This part is the design if it is approved, not a wave to pick up.

**Depends on:** 08 (wraps finished screens) — and on that change request.

---

## 1 · Why it is deferred, not cancelled

Parts 03–08 are responsive web and work in a desktop browser and a phone browser with no shell present (`NFR-06`). Nothing in them depends on native code. Dropping the POD scanner (`D-33`) is what made that true: it took native capture from three screens to two.

The shell adds three things, none of which is required for a transporter to quote, carry a load, attach a POD or raise a bill:

| Addition | Value | Substitute today |
|---|---|---|
| Native camera on two KYC screens | Better capture quality | `<input capture="environment">` (part 08 §2) |
| Push notifications | Faster award response | SMS via the DLT gateway (part 10) |
| Native bottom tabs | Perceptibly faster nav | Web tabs |

Judge it against `A10` phase 5's four weeks for *everything*. An Expo build, two app-store listings and a release process is not a rounding error inside that budget.

---

## 2 · Design, if approved

### 2.1 Native screens — two only

| Screen | Uses |
|---|---|
| KYC card capture | `expo-camera` — PAN and Aadhaar cards |
| Geo-stamped selfie | `expo-camera` + `expo-location` |

**The POD no longer needs the camera** (`D-33`). POD attachment is an ordinary file input, identical in the WebView and in a desktop browser (part 06).

### 2.2 Architecture

```
Expo shell (iOS + Android)
 ├── Native auth screen        Supabase session → expo-secure-store
 ├── WebView                   vendor-portal, session injected
 ├── Native camera screens     KYC card photos · geo-stamped selfie
 └── Native bottom tabs        Loads · Quotes · Trips · Fleet
```

Expo SDK 52, `react-native-webview`, `expo-camera`, `expo-location`, `expo-secure-store`.

### 2.3 The bridge

```ts
// web → native
window.NexraahNative?.capture({ kind: 'KYC_PAN' | 'KYC_AADHAAR' | 'SELFIE', vendorId })

// native → web
webview.postMessage({ type: 'capture.done', attachmentId, kind })
```

**The web must degrade.** When `NexraahNative` is undefined — desktop browser, or any build before this wave — fall back to a file input. **Never a dead button.**

The optional chaining is not defensive style; it is the contract. `P8` shipping or not shipping must be invisible to parts 03–08.

### 2.4 Other shell responsibilities

- Session in `expo-secure-store`, injected on WebView load. **Never a token in a URL.**
- Push notifications via Expo, deep-linking to the relevant screen (part 10).
- **Offline: read-only** cache of the last loaded lists with an offline banner. **No queued writes** — a queued quote submitted three hours late against a filled load is worse than an error.
- Bottom tabs rendered natively for speed.

The offline rule is the one to hold under pressure. A transporter in a dead zone wants to bid, and a queue feels helpful; but a quote that arrives after the award is a placement the desk already made, and the transporter believes they bid and lost. An honest error at the moment of failure is kinder.

---

## 3 · If the change request is declined

Nothing is lost. Part 08 already ships web capture, part 10 already ships SMS, and the tabs are already web. Close `P8` and delete this part rather than leaving a wave that never starts.
