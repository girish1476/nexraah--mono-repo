/**
 * The web↔native contract, part 09 §2.3 of the mobile-shell spec. Mirrored
 * on the web side at apps/vendor-portal/src/lib/native-bridge.ts — keep
 * the two in sync by hand; there is no shared package yet (README's own
 * rule: no packages/* until a second *runtime* consumer needs one, and
 * this is types only).
 */
export type CaptureKind = 'KYC_PAN' | 'KYC_AADHAAR' | 'SELFIE';

export interface CaptureRequestMessage {
  type: 'capture.request';
  kind: CaptureKind;
  vendorId: string;
}

/**
 * Print a document the web side composed. The HTML travels rather than a
 * URL because `expo-print` renders a standalone string — it has no session,
 * no cookies and no access to the portal's stylesheet, so a link would print
 * a sign-in page at best.
 */
export interface PrintRequestMessage {
  type: 'print.request';
  html: string;
  /** Names the file if the transporter chooses "Save as PDF". */
  title: string;
}

export interface CaptureDoneMessage {
  type: 'capture.done';
  kind: CaptureKind;
  attachmentId: string;
}

/** Reports the outcome so the web side can stop saying "opening…". */
export interface PrintDoneMessage {
  type: 'print.done';
  ok: boolean;
  /** Present when `ok` is false — already fit to show a person. */
  message?: string;
}

export type WebToNativeMessage = CaptureRequestMessage | PrintRequestMessage;
export type NativeToWebMessage = CaptureDoneMessage | PrintDoneMessage;
