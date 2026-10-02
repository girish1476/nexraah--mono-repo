/**
 * The Nexraah symbol — globe, plane, ship and truck — drawn as a vector, so it
 * stays sharp at any size. The 180 px `logo.png` blurs when it is shown large;
 * this is the mark the sign-in screen sets big beside the form.
 *
 * `id` keeps the gradient ids apart when the mark is on the page twice (the
 * large one and the faint one behind the whole screen).
 */
export function NexraahMark({ id = 'nx', className, title }: { id?: string; className?: string; title?: string }) {
  const g = (name: string) => `${id}-${name}`;
  return (
    <svg
      className={className}
      viewBox="0 0 400 330"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id={g('globe')}>
          <circle cx="200" cy="140" r="122" />
        </clipPath>
        {/* Where the transport sits, the globe's lines are cut away. */}
        <mask id={g('cut')} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="330">
          <rect x="0" y="0" width="400" height="330" fill="#fff" />
          <path d="M40 330 L 40 236 C 96 218, 150 198, 240 192 C 292 188, 326 176, 350 156 L 400 156 L 400 330 Z" fill="#000" />
        </mask>
        <linearGradient id={g('sky')} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#1565c0" />
          <stop offset="1" stopColor="#4fb3ff" />
        </linearGradient>
        <linearGradient id={g('cab')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4fb3ff" />
          <stop offset="1" stopColor="#1565c0" />
        </linearGradient>
      </defs>

      {/* Globe: outline, meridians, parallels. */}
      <g fill="none" stroke="#fff" strokeLinecap="round" mask={`url(#${g('cut')})`}>
        <circle cx="200" cy="140" r="122" strokeWidth="9" />
        <g clipPath={`url(#${g('globe')})`} strokeWidth="6.5">
          <line x1="200" y1="10" x2="200" y2="270" />
          <ellipse cx="200" cy="140" rx="50" ry="122" />
          <ellipse cx="200" cy="140" rx="94" ry="122" />
          <line x1="70" y1="140" x2="330" y2="140" />
          <line x1="70" y1="80" x2="330" y2="80" />
          <line x1="70" y1="200" x2="330" y2="200" />
          <line x1="70" y1="34" x2="330" y2="34" />
        </g>
      </g>

      {/* Plane, climbing to the right. */}
      <g transform="translate(232 170) rotate(-14) scale(1.05)" fill="#fff">
        <path d="M-62 0 C-52 -7 38 -9 58 -4 C66 -2 66 2 58 4 C38 9 -52 7 -62 0 Z" />
        <path d="M2 -5 L-24 -40 L-11 -40 L26 -5 Z" />
        <path d="M2 5 L-18 30 L-7 30 L22 5 Z" opacity="0.92" />
        <path d="M-50 -2 L-64 -22 L-56 -22 L-40 -2 Z" />
      </g>

      {/* Ship's bow and the arrow out of it. */}
      <path d="M176 292 C 226 280 280 246 312 196 L 326 206 C 294 262 236 296 176 306 Z" fill={`url(#${g('sky')})`} />
      <path d="M206 286 C 246 272 284 246 306 214 L 314 220 C 292 256 252 282 206 294 Z" fill="#fff" opacity="0.9" />
      <path
        d="M196 270 C 248 258 300 226 338 178"
        fill="none"
        stroke="#fff"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path d="M352 158 L 346 196 L 322 176 Z" fill="#fff" />

      {/* Truck: container behind, cab in front. */}
      <g>
        <path d="M54 222 L 104 208 L 104 276 L 54 272 Z" fill="#fff" />
        <g stroke={`url(#${g('sky')})`} strokeWidth="2.4">
          <line x1="66" y1="220" x2="66" y2="272" />
          <line x1="78" y1="216" x2="78" y2="273" />
          <line x1="90" y1="212" x2="90" y2="274" />
        </g>
        <rect x="104" y="204" width="76" height="76" rx="12" fill={`url(#${g('cab')})`} stroke="#fff" strokeWidth="4" />
        <rect x="113" y="213" width="58" height="26" rx="5" fill="#060e32" stroke="#fff" strokeWidth="2.5" />
        <path d="M117 235 L 135 216" stroke="#4fb3ff" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
        <g fill="#fff">
          <rect x="122" y="248" width="40" height="3.5" rx="1.5" />
          <rect x="122" y="255" width="40" height="3.5" rx="1.5" />
          <rect x="122" y="262" width="40" height="3.5" rx="1.5" />
          <rect x="110" y="250" width="8" height="8" rx="2" />
          <rect x="166" y="250" width="8" height="8" rx="2" />
          <rect x="100" y="272" width="84" height="8" rx="3" />
        </g>
        <g fill="#0b1a4a" stroke="#fff" strokeWidth="2.5">
          <rect x="112" y="282" width="16" height="14" rx="3" />
          <rect x="156" y="282" width="16" height="14" rx="3" />
        </g>
      </g>

      {/* The water line under it all. */}
      <path d="M40 304 C 140 290 260 292 368 300" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
