import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignaturePad, strokeToPoints } from '../../src/web/components/signature';
import type { Point } from '../../src/shared/fields';

const onChange = vi.fn<(strokes: Point[][]) => void>();

/** Holds the strokes like the signing page does, so moves build on earlier points. */
function Harness() {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  return (
    <SignaturePad
      strokes={strokes}
      onChange={(next) => {
        onChange(next);
        setStrokes(next);
      }}
    />
  );
}

function mountPad(): HTMLElement {
  render(<Harness />);
  const pad = screen.getByTestId('signature-pad');
  pad.getBoundingClientRect = () =>
    ({ left: 100, top: 50, width: 400, height: 100, right: 500, bottom: 150 }) as DOMRect;
  return pad;
}

const lastStrokes = (): Point[][] => onChange.mock.lastCall?.[0] ?? [];

describe('SignaturePad', () => {
  beforeEach(() => {
    onChange.mockClear();
  });

  it('starts empty and says so', () => {
    mountPad();
    expect(screen.getByRole('img', { name: 'Empty signature box' })).toBeInTheDocument();
    expect(screen.getByText('Sign here')).toBeInTheDocument();
  });

  it('records a stroke as fractions of the box', () => {
    const pad = mountPad();
    fireEvent.pointerDown(pad, { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 300, clientY: 75 });
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 500, clientY: 150 });
    fireEvent.pointerUp(pad, { pointerId: 1 });

    expect(lastStrokes()).toEqual([
      [
        { x: 0.25, y: 0.5 },
        { x: 0.5, y: 0.25 },
        { x: 1, y: 1 },
      ],
    ]);
    expect(screen.getByRole('img', { name: 'Your drawn signature' })).toBeInTheDocument();
    expect(screen.queryByText('Sign here')).not.toBeInTheDocument();
  });

  it('starts a new stroke on each press and ignores moves between strokes', () => {
    const pad = mountPad();
    fireEvent.pointerDown(pad, { button: 0, pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 400, clientY: 120 });
    fireEvent.pointerDown(pad, { button: 0, pointerId: 1, clientX: 500, clientY: 150 });
    fireEvent.pointerCancel(pad, { pointerId: 1 });
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 120, clientY: 60 });

    expect(lastStrokes().map((stroke) => stroke.length)).toEqual([2, 1]);
  });

  it('keeps points inside the box and drops tiny movements', () => {
    const pad = mountPad();
    fireEvent.pointerDown(pad, { button: 0, pointerId: 1, clientX: 50, clientY: 0 });
    expect(lastStrokes()).toEqual([[{ x: 0, y: 0 }]]);

    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 100.5, clientY: 50.1 });
    expect(lastStrokes()[0]).toHaveLength(1);

    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 9999, clientY: 9999 });
    expect(lastStrokes()[0]?.at(-1)).toEqual({ x: 1, y: 1 });
  });

  it('ignores presses with other mouse buttons', () => {
    const pad = mountPad();
    fireEvent.pointerDown(pad, { button: 2, pointerId: 1, clientX: 200, clientY: 100 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('strokeToPoints', () => {
  it('scales fractions to the drawing box', () => {
    expect(
      strokeToPoints([
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ]),
    ).toBe('0.0,0.0 230.0,70.0 460.0,140.0');
  });
});
