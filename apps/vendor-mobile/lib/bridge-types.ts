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

export interface CaptureDoneMessage {
  type: 'capture.done';
  kind: CaptureKind;
  attachmentId: string;
}

export type WebToNativeMessage = CaptureRequestMessage;
export type NativeToWebMessage = CaptureDoneMessage;
