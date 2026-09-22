// Source-measured mascot, orbit, star, and typography for the Float film.
import type { CSSProperties } from 'react'
import cubicBezier from 'bezier-easing'
import { interpolate } from 'remotion'

// Preserve the original curves without importing the Egaki runtime.
export const EASE = {
  smooth: cubicBezier(0.5, 0, 0, 1),
  decelerate: cubicBezier(0, 0, 0, 1),
}

export function value(frame: number, frames: number[], values: number[], easing = EASE.smooth) {
  return interpolate(frame, frames, values, { easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
}

export function SoftText({ frame, text, start, end = Infinity, size = 72, style }: {
  frame: number; text: string; start: number; end?: number; size?: number; style?: CSSProperties
}) {
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size, fontWeight: 300, whiteSpace: 'pre', ...style }}>
    {text.split('').map((character, index) => {
      const enter = value(frame, [start + index * 0.48, start + index * 0.48 + 10], [0, 1])
      const exit = Number.isFinite(end) ? value(frame, [end + index * 0.5, end + index * 0.5 + 10], [0, 1]) : 0
      return <span key={index} style={{ opacity: enter * (1 - exit), filter: `blur(${((1 - enter + exit) * 9).toFixed(2)}px)` }}>{character}</span>
    })}
  </div>
}

export function Face({ size, frame }: { size: number; frame: number }) {
  const turn = Math.sin((frame - 330) * 0.1)
  const blink = Math.pow(Math.max(0, Math.cos((frame - 418) * Math.PI / 57)), 38)
  return <svg width={size} height={size} viewBox="0 0 696 696" aria-hidden="true">
    <circle cx="348" cy="348" r="348" fill="#36e69a" />
    <g transform={`translate(${turn * 44},${Math.sin(frame * 0.07) * 18}) rotate(${turn * 13},348,348)`}>
      {[247, 467].map((x) => <rect key={x} x={x - 26} y={348 - (176 - blink * 155) / 2} width="52" height={176 - blink * 155} rx="26" fill="white" />)}
    </g>
  </svg>
}

const faceFrames = [330, 333, 336, 339, 345, 348, 351, 354, 357, 360, 362, 363, 369, 372, 379]

export function HeroFace({ frame }: { frame: number }) {
  const linear = (t: number) => t
  const x = value(frame, faceFrames, [960, 1004, 1044, 1048, 1050, 1028, 938, 912, 900, 900, 958, 974, 1000, 1004, 1076], linear)
  const y = value(frame, faceFrames, [540, 532, 500, 486, 478, 487, 493, 484, 479, 482, 514, 514, 508, 508, 508], linear)
  const eyeX = value(frame, faceFrames, [838, 906, 1001, 1020, 1024, 926, 787, 755, 745, 749, 885, 933, 1009, 1017, 1089], linear)
  const eyeY = value(frame, faceFrames, [563, 520, 401, 367, 356, 375, 388, 379, 375, 381, 456, 472, 495, 496, 496], linear)
  const gap = value(frame, faceFrames, [219, 216, 207, 205, 204, 213, 219, 219, 220, 220, 220, 220, 220, 220, 220], linear)
  const rise = value(frame, faceFrames, [0, -11, -36, -43, -44, -18, -1, 0, 0, 0, 0, 0, 0, 0, 0], linear)
  const height = value(frame, [330, 332, 337], [4, 12, 176])
  const angle = value(frame, [330, 338, 348, 351], [0, -18, -18, 0], linear)
  return <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
    <circle cx={x} cy={y} r="348" fill="#36e69a" />
    {[0, 1].map((index) => <rect key={index} x={eyeX + gap * index - 26} y={eyeY + rise * index - height / 2} width="52" height={height} rx="26" fill="#fff" transform={`rotate(${angle},${eyeX + gap * index},${eyeY + rise * index})`} />)}
  </svg>
}

export function Star({ frame }: { frame: number }) {
  const scale = value(frame, [156, 166], [0.05, 1], EASE.decelerate)
  const exit = value(frame, [200, 212], [0, 1])
  const rotation = value(frame, [156, 165, 180, 198, 213], [-24, 0, 40, 116, 185], (t) => t)
  return <>
    <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0, opacity: 1 - exit, filter: `blur(${exit * 8}px)` }} aria-hidden="true">
      <circle cx="960" cy="540" r={value(frame, [156, 159, 162, 166], [38, 322, 420, 460])} stroke="#151515" fill="none" strokeWidth="1.5" opacity={value(frame, [156, 166], [1, 0])} />
      <path d="M0 -160 L9 -9 L160 0 L9 9 L0 160 L-9 9 L-160 0 L-9 -9 Z" fill="#050505" transform={`translate(960 540) rotate(${rotation}) scale(${scale})`} />
    </svg>
    <SoftText text="You just go." frame={frame} start={167} end={201} style={{ top: 165, bottom: 'auto', height: 100 }} />
  </>
}

export function Balls({ frame }: { frame: number }) {
  const spin = cubicBezier(0.12, 0.68, 0.18, 1)
  const rowX = [559, 768, 969, 1155, 1342]
  const ringAngle = [-160, -88, -16, 56, 128]
  const shades = [ ['#379875', '#a5edc4'], ['#008a62', '#2bd9a2'], ['#173e30', '#668b77'], ['#9eaaa3', '#edf6ed'], ['#00492f', '#1aa474'] ]
  const orbit = value(frame, [281, 298], [0, 1], spin)
  const contraction = value(frame, [312, 319], [1, 0])
  return <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
    <defs>
      {shades.map(([dark, light], index) => <linearGradient key={index} id={`ball-${index}`} x1="0" x2="0.6" y1="0" y2="1"><stop stopColor={dark} /><stop offset="1" stopColor={light} /></linearGradient>)}
      <radialGradient id="orb-base" cx="30%" cy="26%" r="90%"><stop stopColor="#18edbd" /><stop offset="0.45" stopColor="#4dfccc" /><stop offset="0.65" stopColor="#c3ffe7" /><stop offset="1" stopColor="#31eeb2" /></radialGradient>
      <filter id="orb-blur"><feGaussianBlur stdDeviation="24" /></filter>
      <clipPath id="orb-clip"><circle cx="960" cy="540" r={value(frame, [319, 320, 324, 327, 330], [152, 196, 320, 344, 348])} /></clipPath>
    </defs>
    {frame < 319 && shades.map((_, index) => {
      const angle = (ringAngle[index] + value(frame, [281, 297, 312], [330, 12, -17], spin)) * Math.PI / 180
      const x = (rowX[index] * (1 - orbit) + (960 + Math.cos(angle) * 300) * orbit - 960) * contraction + 960
      const initialY = value(frame, [258 + index, 275 + index], [520, 356], EASE.decelerate)
      const y = (initialY * (1 - orbit) + (540 + Math.sin(angle) * 300) * orbit - 540) * contraction + 540
      return <circle key={index} cx={x} cy={y} r="72" fill={`url(#ball-${index})`} opacity={frame >= 258 + index ? 1 : 0} style={{ filter: `blur(${value(frame, [278, 287, 296, 310, 318], [0, 16, 0, 0, 10])}px)` }} />
    })}
    {frame >= 319 && <g clipPath="url(#orb-clip)">
      <circle cx="960" cy="540" r="360" fill="url(#orb-base)" />
      <g filter="url(#orb-blur)" transform={`rotate(${value(frame, [319, 333], [-48, 80])},960,540)`} opacity={value(frame, [329, 338], [1, 0])}>
        <ellipse cx="892" cy="420" rx="225" ry="270" fill="none" stroke="#f8fff3" strokeWidth="95" />
      </g>
    </g>}
  </svg>
}
