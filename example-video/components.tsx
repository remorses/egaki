/**
 * Custom components for the video-example showcase and e2e HMR tests.
 * Only exports components (no data) so React Fast Refresh works.
 * Data constants live in data.ts.
 */

import type { FEATURES } from './data'

export function Dot() {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #818cf8, #6366f1)',
        boxShadow: '0 0 12px rgba(99, 102, 241, 0.6)',
        flexShrink: 0,
      }}
    />
  )
}

export function ListItem({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '20px 24px',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 14,
      }}
    >
      <div style={{ width: 20, display: 'flex', justifyContent: 'center' }}>
        {children}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: '#e4e4e7',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 16,
            color: '#71717a',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          }}
        >
          {description}
        </span>
      </div>
    </div>
  )
}

export function FeatureGrid({ features }: { features: typeof FEATURES }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, auto)',
        gap: 16,
        padding: '24px 80px 0',
      }}
    >
      {features.map((f) => (
        <div
          key={f.label}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            padding: '16px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          }}
        >
          <span style={{ fontSize: 24 }}>{f.icon}</span>
          <span
            style={{
              fontSize: 20,
              fontWeight: 500,
              color: '#e4e4e7',
              letterSpacing: '-0.01em',
            }}
          >
            {f.label}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Demo: MDX expression props can be functions because rendering happens
 * on the client (no RSC serialization boundary). Used by the e2e tests.
 */
export function FnPropDemo({ format }: { format?: (s: string) => string }) {
  return (
    <span style={{ color: '#fafafa', fontSize: 40 }}>
      {format ? format('fn-props-work') : 'no-fn-prop'}
    </span>
  )
}
