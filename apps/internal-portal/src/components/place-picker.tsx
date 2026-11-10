'use client';

import { KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Field } from '@/lib/ui';
import { PlaceHit, nameOfPoint, placeFinderOn, searchPlaces } from '@/lib/place-search';

interface Point {
  lat: number;
  lng: number;
}

const coords = (p: Point) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;

/**
 * "Where is the truck now?" — a place name in, coordinates out.
 *
 * Ops hears a town, a highway or a toll plaza from the driver, never a
 * latitude. They type it, pick the right match, and the point is saved. A
 * pin the driver shared can still be keyed in as coordinates, one click
 * away. With the place finder switched off (Control → Integrations), or
 * nothing reachable, the coordinate boxes are all there is.
 */
export function PlacePicker({ value, onChange }: { value: Point; onChange: (p: Point) => void }) {
  const inputId = useId();
  const listId = useId();
  const [finder, setFinder] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState('');
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<PlaceHit | null>(null);
  const [nowName, setNowName] = useState<string | null>(null);
  const [showCoords, setShowCoords] = useState(false);
  // The point the dialog opened with — named once, so the form says where the truck is now in words.
  const start = useRef(value);

  useEffect(() => {
    let live = true;
    void placeFinderOn().then((on) => live && setFinder(on));
    void nameOfPoint(start.current.lat, start.current.lng).then((n) => live && setNowName(n));
    return () => {
      live = false;
    };
  }, []);

  // Asked once typing pauses, and an older answer never overwrites a newer one.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2 || (picked && picked.label === text)) {
      setHits([]);
      setSearching(false);
      return;
    }
    const ctl = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      void searchPlaces(q, ctl.signal).then((found) => {
        if (ctl.signal.aborted) return;
        setHits(found);
        setActive(0);
        setSearched(q);
        setSearching(false);
      });
    }, 350);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [text, picked]);

  const pick = (hit: PlaceHit) => {
    setPicked(hit);
    setText(hit.label);
    setHits([]);
    onChange({ lat: hit.lat, lng: hit.lng });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === 'Escape') {
      // Closes the suggestions, not the whole dialog.
      e.stopPropagation();
      setHits([]);
    }
  };

  const moved = value.lat !== start.current.lat || value.lng !== start.current.lng;
  const finderOff = finder === false;

  const status = picked
    ? `Will be saved as ${picked.label} (${coords(picked)}).`
    : moved
      ? `Will be saved at ${coords(value)}.`
      : nowName
        ? `On the board now: near ${nowName}.`
        : `On the board now: ${coords(value)}.`;

  const noMatch = !searching && !hits.length && searched && searched === text.trim() && !picked;

  return (
    <>
      {!finderOff && (
        <div className="field">
          <label htmlFor={inputId}>Where is the truck now?</label>
          <input
            id={inputId}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (picked) setPicked(null);
            }}
            onKeyDown={onKey}
            placeholder="Type a town, highway or toll plaza — e.g. Nagpur bypass"
            autoComplete="off"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
          />
          {hits.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Matching places"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 4,
                border: '1px solid var(--color-divider-strong)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-surface-raised)',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              {hits.map((h, i) => (
                <li
                  key={h.label}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(h)}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    padding: '7px 9px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 'var(--text-md)',
                    background: i === active ? 'var(--color-surface-sunken)' : undefined,
                  }}
                >
                  📍 {h.label}
                </li>
              ))}
            </ul>
          )}
          <span className="muted" style={{ fontSize: 11 }} aria-live="polite">
            {searching
              ? 'Looking it up…'
              : noMatch
                ? 'No place by that name — try the nearest town or the highway number.'
                : hits.length && !picked
                  ? 'Pick one of these to move the truck there.'
                  : status}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: 'flex-start', paddingLeft: 0 }}
            onClick={() => setShowCoords((s) => !s)}
            aria-expanded={showCoords}
          >
            {showCoords ? 'Hide coordinates' : 'Driver shared a pin? Enter coordinates instead'}
          </button>
        </div>
      )}
      {(showCoords || finderOff) && (
        <>
          {finderOff && (
            <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
              The place finder is switched off under Control → Integrations, so the position is keyed in as coordinates.
            </p>
          )}
          <Field label="Latitude" hint="e.g. 19.997454, from the pin the driver shared.">
            <input
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              value={value.lat}
              onChange={(e) => {
                setPicked(null);
                onChange({ ...value, lat: Number(e.target.value) || 0 });
              }}
            />
          </Field>
          <Field label="Longitude" hint="e.g. 73.789803">
            <input
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              value={value.lng}
              onChange={(e) => {
                setPicked(null);
                onChange({ ...value, lng: Number(e.target.value) || 0 });
              }}
            />
          </Field>
        </>
      )}
    </>
  );
}
