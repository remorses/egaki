// Frame-indexed SVG reconstruction; geometry is measured, gradients and grain are approximate.
import { useId } from 'react'
import motion from './ribbon-motion.json'

/** Absolute source-frame numbers at 24 fps; renders nothing outside frames 0-155. */
export function Ribbons({ frame }: { frame: number }) {
  const id = useId().replace(/:/g, '')
  const sample = Number.isFinite(frame) && frame >= 0 ? motion.frames[Math.floor(frame)] : undefined
  if (!sample) return null

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1920 1080"
      width={1920}
      height={1080}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <defs>
        <filter
          id={`${id}-grain`}
          x="-2%"
          y="-2%"
          width="104%"
          height="104%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation={frame < motion.cutFrame ? 4 : 0.5}
            result="ribbons"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.72"
            numOctaves={2}
            seed={17}
            result="noise"
          />
          <feColorMatrix in="noise" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope={0.1} />
          </feComponentTransfer>
          <feComposite in2="ribbons" operator="in" result="grain" />
          <feBlend in="ribbons" in2="grain" mode="soft-light" />
        </filter>
        <filter id={`${id}-soft-cap`} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation={4} />
        </filter>
        {sample.silhouettes.map((shape, index) => (
          <linearGradient
            key={index}
            id={`${id}-ribbon-${index}`}
            gradientUnits="userSpaceOnUse"
            x1={0}
            x2={0}
            y1={shape.top}
            y2={shape.bottom}
          >
            {shape.stops.map((stop) => (
              <stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={stop.opacity}
              />
            ))}
          </linearGradient>
        ))}
      </defs>
      <g filter={`url(#${id}-grain)`}>
        {sample.silhouettes.map((shape, index) => (
          <path key={index} d={shape.path} fill={`url(#${id}-ribbon-${index})`} />
        ))}
      </g>
      {sample.caps.map((points, index) => (
        <polygon
          key={index}
          points={points.map((point) => point.join(',')).join(' ')}
          fill="#000"
          filter={
            frame < motion.cutFrame && points[0][0] > 1300 ? `url(#${id}-soft-cap)` : undefined
          }
        />
      ))}
    </svg>
  )
}
