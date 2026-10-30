/**
 * Every outside service the console talks to, as the Integrations screen
 * (`/admin/integrations`) lists them.
 *
 * Shared by the screen and the server (lib/server/integrations.ts): the server
 * reads the same list to know which settings exist, which of them are secret,
 * and which deployment setting each one falls back to.
 *
 * Only services the console really calls are here. A service is added to this
 * list in the same change that makes the console use it.
 */

export type IntegrationId =
  | 'email'
  | 'database'
  | 'gps'
  | 'maps'
  | 'geocode'
  | 'fuel'
  | 'ifsc'
  | 'reader'
  | 'whatsapp'
  | 'accounts'
  | 'bank';

export interface IntegrationField {
  key: string;
  label: string;
  /** Never sent back to the browser once saved; shown only as its last four characters. */
  secret?: boolean;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  /** The deployment setting (Vercel → Environment Variables) used when nothing is saved here. */
  env?: string[];
  /** A key the console makes up itself, with a button, rather than one from a provider's account. */
  generate?: boolean;
}

export interface IntegrationDef {
  id: IntegrationId;
  name: string;
  emoji: string;
  /** Whose service it is. */
  provider: string;
  /** What the console uses it for, in a sentence. */
  what: string;
  /** Where in the console it shows. */
  where: string;
  cost: string;
  /** Where to get an account or a key, when it needs one. */
  signUp?: { label: string; href: string };
  /** False for a service the console cannot work without. */
  canSwitchOff: boolean;
  /** What switching it off does, said before it is done. */
  offMeans?: string;
  /** Set up in the hosting dashboard only — this screen shows whether it is working. */
  hostOnly?: boolean;
  /** How to connect it, step by step. `{origin}` is this console's own address. */
  setup?: string[];
  fields: IntegrationField[];
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'email',
    name: 'Sign-in email',
    emoji: '✉️',
    provider: 'Brevo or Resend',
    what: 'Sends the 6-digit sign-in code to whoever signs in.',
    where: 'Sign-in page',
    cost: 'Free — Brevo 300 emails a day, Resend 100 a day',
    signUp: { label: 'Brevo → SMTP & API → API keys', href: 'https://app.brevo.com/settings/keys/api' },
    canSwitchOff: false,
    fields: [
      {
        key: 'provider',
        label: 'Mail service',
        options: [
          { value: 'brevo', label: 'Brevo' },
          { value: 'resend', label: 'Resend' },
        ],
      },
      {
        key: 'apiKey',
        label: 'API key',
        secret: true,
        placeholder: 'xkeysib-… (Brevo) or re_… (Resend)',
        env: ['BREVO_API_KEY', 'RESEND_API_KEY'],
      },
      {
        key: 'from',
        label: 'Send from',
        placeholder: 'Nexraah <no-reply@nexraah.com>',
        hint: 'Must be the sender verified with the mail service.',
        env: ['EMAIL_FROM'],
      },
      { key: 'replyTo', label: 'Replies go to (optional)', placeholder: 'support@nexraah.com', env: ['EMAIL_REPLY_TO'] },
    ],
  },
  {
    id: 'database',
    name: 'Shared database',
    emoji: '🗄️',
    provider: 'Upstash Redis (through Vercel Storage)',
    what: 'Keeps the list of people allowed to sign in, and the settings on this screen, the same for every administrator on every device.',
    where: 'Allowed emails, Integrations',
    cost: 'Free — 10,000 requests a day',
    canSwitchOff: false,
    hostOnly: true,
    fields: [],
  },
  {
    id: 'gps',
    name: 'GPS tracking',
    emoji: '📡',
    provider: 'Any GPS device or tracking app that can send a web request — e.g. the free Traccar Client app',
    what: 'Takes each truck’s live position as its GPS unit or the driver’s phone reports it, and puts it on the fleet board and the order’s truck map.',
    where: 'Fleet board, Order → Tracking',
    cost: 'Free. A driver’s phone with Traccar Client costs nothing; a fitted GPS unit is the transporter’s own. One report every 5 minutes per truck stays well inside the shared database’s free allowance.',
    signUp: { label: 'Traccar Client (Android / iPhone)', href: 'https://www.traccar.org/client/' },
    canSwitchOff: true,
    offMeans: 'Positions sent in are refused; the maps show only what Ops types in.',
    setup: [
      'Make a device key below, copy it, and save.',
      'Phone: install Traccar Client. Device identifier = the truck number (e.g. MH12QR8841). Server URL = {origin}/api/telematics/ping?key=YOUR-KEY. Frequency = 300 seconds. Switch tracking on.',
      'GPS unit or provider: send each position to {origin}/api/telematics/ping as JSON { vehicleNo, at, lat, lng, speedKmph, fuelPct }, with the key in the "Authorization: Bearer" header — or sign the body with HMAC-SHA256 in "X-Telematics-Signature".',
      'Positions show on the fleet board and the order’s Tracking tab while that truck is on an open trip.',
    ],
    fields: [
      {
        key: 'deviceKey',
        label: 'Device key',
        secret: true,
        generate: true,
        placeholder: 'Make one with the button below',
        hint: 'Every device and app sends this with each position. Changing it stops the old one working.',
        env: ['TELEMATICS_SECRET'],
      },
    ],
  },
  {
    id: 'maps',
    name: 'Maps',
    emoji: '🗺️',
    provider: 'Esri (truck map) · Google Maps (route)',
    what: 'Draws the truck map in Light, Dark and Satellite, and the driving route on an order.',
    where: 'Order → Tracking, and the tracking link sent to clients',
    cost: 'Free — no key needed. A Google key is optional and has its own free monthly allowance.',
    signUp: { label: 'Google Cloud → Maps Embed API', href: 'https://console.cloud.google.com/google/maps-apis/' },
    canSwitchOff: false,
    fields: [
      {
        key: 'googleMapsKey',
        label: 'Google Maps key (optional)',
        placeholder: 'AIza…',
        hint: 'Draws the route through the truck’s last position. Restrict the key to this website in Google Cloud: it is read by the browser.',
        env: ['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'],
      },
    ],
  },
  {
    id: 'geocode',
    name: 'Place finder',
    emoji: '📍',
    provider: 'OpenStreetMap Nominatim',
    what: 'Turns a city or an address into a point on the truck map when no coordinates were given.',
    where: 'Order → Tracking',
    cost: 'Free — no key',
    canSwitchOff: true,
    offMeans: 'A place typed as a name, not as coordinates, is not put on the map.',
    fields: [],
  },
  {
    id: 'fuel',
    name: 'Nearest fuel',
    emoji: '⛽',
    provider: 'OpenStreetMap data, through Photon and Overpass',
    what: 'Finds the fuel stations nearest the truck.',
    where: 'Order → Tracking → Nearest fuel',
    cost: 'Free — no key',
    canSwitchOff: true,
    offMeans: 'The Nearest fuel button is taken off the truck map.',
    fields: [],
  },
  {
    id: 'ifsc',
    name: 'Bank branch check',
    emoji: '🏦',
    provider: 'Razorpay IFSC',
    what: 'Shows the bank and branch for an IFSC code as it is typed, to check against what the transporter said.',
    where: 'New transporter → bank details',
    cost: 'Free — no key',
    canSwitchOff: true,
    offMeans: 'The IFSC is still taken; the bank and branch are not shown beside it.',
    fields: [],
  },
  {
    id: 'reader',
    name: 'Document reader',
    emoji: '📄',
    provider: 'pdf.js and Tesseract, loaded from jsDelivr',
    what: 'Reads the details off an uploaded PDF or photo to fill the form. The file never leaves the computer.',
    where: 'Fetch, beside document uploads',
    cost: 'Free — runs in the browser',
    canSwitchOff: true,
    offMeans: 'Fetch says the reader is off, and the details are typed by hand.',
    fields: [],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp sharing',
    emoji: '💬',
    provider: 'WhatsApp click-to-chat',
    what: 'Opens WhatsApp with the tracking link or a location already written, to send to a client or a driver.',
    where: 'Order → Tracking → Share',
    cost: 'Free — no key',
    canSwitchOff: true,
    offMeans: 'The WhatsApp button is taken off; SMS and Copy stay.',
    fields: [],
  },
  {
    id: 'accounts',
    name: 'Accounting export',
    emoji: '🧾',
    provider: 'Tally, Zoho Books, Busy — any system that imports a journal file',
    what: 'Gives the books every issued invoice, receipt and transporter payment as a double-entry journal. One way: the console is not the books of account.',
    where: 'P&L → Export to the accounts',
    cost: 'Free — a file, no connection',
    canSwitchOff: false,
    fields: [],
  },
  {
    id: 'bank',
    name: 'Bank statement check',
    emoji: '🏛️',
    provider: 'Your bank’s statement, downloaded as CSV',
    what: 'Looks for every released payment’s UTR in the bank’s own statement, to catch a UTR keyed wrong.',
    where: 'Payments → Bank statement check',
    cost: 'Free — the statement is read in the browser and not uploaded',
    canSwitchOff: false,
    fields: [],
  },
];

export const integrationById = (id: string): IntegrationDef | undefined => INTEGRATIONS.find((i) => i.id === id);

/** What any visitor's browser is told: which services are on, and the one key a browser itself must use. */
export interface IntegrationSwitches {
  geocode: boolean;
  fuel: boolean;
  ifsc: boolean;
  reader: boolean;
  whatsapp: boolean;
  /** GPS tracking is on and has a device key — so there can be live positions worth asking for. */
  gps: boolean;
  /** Null: no key saved here — the deployment's own setting, if any, is used. */
  googleMapsKey: string | null;
}

export const ALL_ON: IntegrationSwitches = {
  geocode: true,
  fuel: true,
  ifsc: true,
  reader: true,
  whatsapp: true,
  // Off when the switches cannot be read: asking for positions nobody can send costs every map a round trip.
  gps: false,
  googleMapsKey: null,
};

/** One service as the Integrations screen is given it. Secrets come back as a hint, never the value. */
export interface IntegrationState {
  id: IntegrationId;
  enabled: boolean;
  values: Record<string, string>;
  secrets: Record<string, { set: boolean; hint: string | null; source: 'here' | 'host' | null }>;
  /** For each plain setting: saved here, from the hosting settings, or neither. */
  sources: Record<string, 'here' | 'host' | null>;
  /** Whether it can work as it stands. */
  ready: boolean;
  /** Why it cannot, when it cannot. */
  missing: string | null;
  lastTest: { at: string; ok: boolean; message: string } | null;
  updatedAt: string | null;
  updatedBy: string | null;
}
