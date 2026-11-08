import { useRef } from 'react';
import type { PointerEvent } from 'react';
import type { Point, Signature } from '../../shared/fields';

const BOX = { width: 460, height: 140 } as const;

export function strokeToPoints(stroke: readonly Point[]): string {
  return stroke
    .map((point) => `${(point.x * BOX.width).toFixed(1)},${(point.y * BOX.height).toFixed(1)}`)
    .join(' ');
}

function Strokes({ strokes }: { strokes: readonly (readonly Point[])[] }) {
  return (
    <svg viewBox={`0 0 ${String(BOX.width)} ${String(BOX.height)}`} aria-hidden="true">
      {strokes.map((stroke, index) => (
        <polyline key={index} className="signature-stroke" points={strokeToPoints(stroke)} />
      ))}
    </svg>
  );
}

/** Shows a stored signature: the drawn lines, or the typed name in italics. */
export function SignatureView({ signature, name }: { signature: Signature; name: string }) {
  if (signature.kind === 'typed') {
    return (
      <p className="signature-typed" aria-label={`Typed signature of ${name}`}>
        {signature.text}
      </p>
    );
  }
  return (
    <div className="signature-view" role="img" aria-label={`Drawn signature of ${name}`}>
      <Strokes strokes={signature.strokes} />
    </div>
  );
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/** Ignore movements smaller than this share of the box, to keep strokes small. */
const MIN_STEP = 0.004;

/**
 * A drawing surface for mouse, pen and touch (pointer events cover all three).
 * Points are stored as fractions of the box, so a signature drawn on a phone
 * looks the same on a wide screen and in the PDF.
 *
 * Drawing cannot be done from the keyboard. The signing page always offers
 * "type your name" next to this pad as the keyboard-accessible way to sign.
 */
export function SignaturePad({
  strokes,
  onChange,
  describedBy,
}: {
  strokes: Point[][];
  onChange: (strokes: Point[][]) => void;
  describedBy?: string;
}) {
  const drawing = useRef(false);

  const pointOf = (event: PointerEvent<HTMLDivElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / (box.width || 1)),
      y: clamp((event.clientY - box.top) / (box.height || 1)),
    };
  };

  const start = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    onChange([...strokes, [pointOf(event)]]);
  };

  const move = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drawing.current) return;
    const current = strokes.at(-1);
    const last = current?.at(-1);
    if (!current || !last) return;
    const point = pointOf(event);
    if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_STEP) return;
    onChange([...strokes.slice(0, -1), [...current, point]]);
  };

  const stop = (): void => {
    drawing.current = false;
  };

  return (
    <div
      className="signature-pad"
      role="img"
      aria-label={strokes.length > 0 ? 'Your drawn signature' : 'Empty signature box'}
      aria-describedby={describedBy}
      data-testid="signature-pad"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <Strokes strokes={strokes} />
      {strokes.length === 0 ? <span className="signature-pad__hint">Sign here</span> : null}
    </div>
  );
}
