/**
 * India states and a curated set of major freight-hub cities.
 *
 * States are a closed, small set (28 states + 8 UTs) — safe as a hard
 * dropdown. Cities are not: there is no feasible fixed list covering every
 * town this business ships to or from, so `CITIES` is suggestions for a
 * `<datalist>`, never a closed `<select>` — the field always still accepts
 * free text for anything not listed.
 */

export interface IndianState {
  code: string;
  name: string;
}

/** RTO-style two-letter codes, matching the codes already used on vehicle registrations. */
export const INDIAN_STATES: IndianState[] = [
  { code: 'AN', name: 'Andaman and Nicobar Islands' },
  { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'AR', name: 'Arunachal Pradesh' },
  { code: 'AS', name: 'Assam' },
  { code: 'BR', name: 'Bihar' },
  { code: 'CH', name: 'Chandigarh' },
  { code: 'CG', name: 'Chhattisgarh' },
  { code: 'DD', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: 'DL', name: 'Delhi' },
  { code: 'GA', name: 'Goa' },
  { code: 'GJ', name: 'Gujarat' },
  { code: 'HR', name: 'Haryana' },
  { code: 'HP', name: 'Himachal Pradesh' },
  { code: 'JK', name: 'Jammu and Kashmir' },
  { code: 'JH', name: 'Jharkhand' },
  { code: 'KA', name: 'Karnataka' },
  { code: 'KL', name: 'Kerala' },
  { code: 'LA', name: 'Ladakh' },
  { code: 'LD', name: 'Lakshadweep' },
  { code: 'MP', name: 'Madhya Pradesh' },
  { code: 'MH', name: 'Maharashtra' },
  { code: 'MN', name: 'Manipur' },
  { code: 'ML', name: 'Meghalaya' },
  { code: 'MZ', name: 'Mizoram' },
  { code: 'NL', name: 'Nagaland' },
  { code: 'OD', name: 'Odisha' },
  { code: 'PY', name: 'Puducherry' },
  { code: 'PB', name: 'Punjab' },
  { code: 'RJ', name: 'Rajasthan' },
  { code: 'SK', name: 'Sikkim' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'TS', name: 'Telangana' },
  { code: 'TR', name: 'Tripura' },
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'UK', name: 'Uttarakhand' },
  { code: 'WB', name: 'West Bengal' },
];

/** Major cities and freight hubs, grouped for readability — flattened by `CITIES` below. */
const CITIES_BY_STATE: Record<string, string[]> = {
  AP: ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Tirupati', 'Kurnool', 'Kadapa', 'Rajahmundry'],
  AR: ['Itanagar'],
  AS: ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat'],
  BR: ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur'],
  CG: ['Raipur', 'Bhilai', 'Bilaspur', 'Durg'],
  GA: ['Panaji', 'Margao', 'Vasco da Gama'],
  GJ: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Gandhidham', 'Anand', 'Mundra', 'Kandla'],
  HR: ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Karnal', 'Hisar', 'Rohtak', 'Sonipat'],
  HP: ['Shimla', 'Solan', 'Baddi'],
  JH: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro'],
  KA: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi', 'Davangere'],
  KL: ['Kochi', 'Thiruvananthapuram', 'Kozhikode', 'Kollam', 'Thrissur'],
  MP: ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain', 'Pithampur'],
  MH: [
    'Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Chhatrapati Sambhajinagar', 'Bhiwandi', 'Solapur',
    'Kolhapur', 'Chakan', 'Thane', 'Navi Mumbai', 'Sangli', 'Satara',
  ],
  MN: ['Imphal'],
  ML: ['Shillong'],
  MZ: ['Aizawl'],
  NL: ['Kohima', 'Dimapur'],
  OD: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Paradeep'],
  PB: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Mohali', 'Bathinda'],
  RJ: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Bhilwara', 'Alwar', 'Bhiwadi'],
  SK: ['Gangtok'],
  TN: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruppur', 'Salem', 'Tiruchirappalli', 'Erode', 'Hosur'],
  TS: ['Hyderabad', 'Warangal', 'Nizamabad'],
  TR: ['Agartala'],
  UP: ['Lucknow', 'Kanpur', 'Noida', 'Ghaziabad', 'Agra', 'Varanasi', 'Meerut', 'Moradabad', 'Aligarh', 'Prayagraj'],
  UK: ['Dehradun', 'Haridwar', 'Rudrapur', 'Haldwani'],
  WB: ['Kolkata', 'Howrah', 'Durgapur', 'Siliguri', 'Asansol'],
  DL: ['Delhi'],
  PY: ['Puducherry'],
  CH: ['Chandigarh'],
  JK: ['Srinagar', 'Jammu'],
  LA: ['Leh'],
  AN: ['Port Blair'],
};

/**
 * Flat, alphabetised list of every city above — datalist suggestions for
 * `CityField` (`lib/ui.tsx`), never a closed set. India has far more towns
 * than any fixed list could cover, so the field these back always still
 * accepts free text for anything not listed.
 */
export const CITIES: string[] = Object.values(CITIES_BY_STATE).flat().sort((a, b) => a.localeCompare(b));
