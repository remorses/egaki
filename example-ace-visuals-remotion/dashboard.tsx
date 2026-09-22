// Editable Float dashboard with source-timed entrance, camera cut, and payout insertion.
import type { CSSProperties } from 'react'
import { EASE } from './components.tsx'
import { Img, interpolate, staticFile } from 'remotion'

export function Dashboard({ time }: { time: number }) {
  const progress = (start: number, end: number) => interpolate(time, [start, end], [0, 1], {
    easing: EASE.smooth,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const entrance = progress(34.33, 34.75)
  // The source cuts to the close view at frame 876, then settles vertically.
  const close = time >= 36.5
  const settle = progress(36.5, 36.92)
  const payout = progress(37.375, 37.875)
  const scale = close ? 2.65 : 1
  const appear = (start: number): CSSProperties => {
    const value = progress(start, start + 0.45)
    return { opacity: value, transform: `translateY(${((1 - value) * 12).toFixed(3)}px)` }
  }
  const label: CSSProperties = { position: 'absolute', fontSize: 14, color: '#828389', lineHeight: '20px' }
  const notificationY = [789, 870, 944]

  return (
    <div style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, overflow: 'hidden', background: '#f8f8f8', fontFamily: 'inherit', fontWeight: 300, color: '#1d2536' }}>
      <Img src={staticFile('meadow.png')} style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, objectFit: 'cover', opacity: entrance }} />
      <div style={{
        position: 'absolute', left: close ? 56 : 50, top: close ? -1694 + (1 - settle) * 38 : 40 - (1 - entrance) * 24,
        width: 1820, height: close ? 1027.5 : 1000, background: '#f8f8f8', overflow: 'hidden',
        opacity: entrance, transform: `scale(${scale})`, transformOrigin: '0 0', willChange: 'transform',
      }}>
        <div style={appear(34.4)}>
          <div style={{ position: 'absolute', left: 45, top: 44, width: 30, height: 31, border: '5px solid #32a781', borderRadius: '50%', boxSizing: 'border-box' }} />
          <div style={{ position: 'absolute', left: 56, top: 32, width: 8, height: 8, borderRadius: '50%', background: '#32a781' }} />
          <div style={{ position: 'absolute', left: 85, top: 46, color: '#080a09', fontSize: 21, fontWeight: 600 }}>float</div>
          <nav style={{ position: 'absolute', left: 680, top: 44, display: 'flex', alignItems: 'center', gap: 36, fontSize: 21, lineHeight: '28px' }}>
            {['Overview', 'Accounts', 'Activity', 'Cards'].map((item, index) => (
              <span key={item} style={{ color: index === 0 ? '#090909' : '#828389' }}>{item}</span>
            ))}
          </nav>
          <div style={{ position: 'absolute', left: 46, top: 100, width: 528, height: 1, background: '#f1f1f1' }} />
        </div>

        <div style={appear(34.46)}>
          <div style={{ ...label, left: 46, top: 120, fontSize: 16 }}>Good morning, Maya</div>
          <div style={{ ...label, left: 46, top: 167 }}>TOTAL BALANCE&nbsp;&nbsp; ALL ACCOUNTS</div>
          <div style={{ position: 'absolute', left: 39, top: 188, fontSize: 92, lineHeight: '105px', fontWeight: 500 }}>$47,911.45</div>
          <div style={{ position: 'absolute', left: 46, top: 297, color: '#36a98a', fontSize: 16, fontWeight: 500 }}>&#8593; 2.4%&nbsp;&nbsp;&nbsp; +$1,128.40 this month</div>
          {[
            { name: 'MONEY IN', amount: '$18,240.50', left: 1180 },
            { name: 'MONEY OUT', amount: '$11,918.30', left: 1405 },
            { name: 'NET FLOW', amount: '+$6,322.20', left: 1609 },
          ].map(({ name, amount, left }) => (
            <div key={name} style={{ position: 'absolute', left, top: 257 }}>
              <div style={{ fontSize: 14, color: '#828389', lineHeight: '21px' }}>{name}</div>
              <div style={{ fontSize: 29, lineHeight: '40px', fontWeight: 500, color: name === 'NET FLOW' ? '#36a98a' : '#202636' }}>{amount}</div>
            </div>
          ))}
        </div>

        <div style={appear(34.64)}>
          <div style={{ position: 'absolute', left: 51, top: 391, fontSize: 19 }}>Accounts</div>
          <div style={{ position: 'absolute', right: 63, top: 392, fontSize: 16, color: '#36a98a' }}>Manage</div>
        </div>
        {[
          ['N', 'Northbank', 'Everyday Checking', '$8,420.65'],
          ['N', 'Northbank', 'Savings', '$24,180.00'],
          ['S', 'Stripe', 'Payments balance', '$12,940.18'],
        ].map(([initial, name, description, amount], index) => (
          <div key={description} style={{ position: 'absolute', left: 46, top: 438 + index * 81, width: 1714, height: 48, ...appear(34.7 + index * 0.08) }}>
            <div style={{ position: 'absolute', width: 48, height: 46, borderRadius: 9, background: '#f3f5f6', display: 'grid', placeItems: 'center', fontSize: 14, color: '#090c0d' }}>{initial}</div>
            <div style={{ position: 'absolute', left: 70, top: 1, fontSize: 19, lineHeight: '25px' }}>{name}</div>
            <div style={{ position: 'absolute', left: 70, top: 24, fontSize: 14, color: '#858585' }}>{description}</div>
            <div style={{ position: 'absolute', right: 0, top: 10, fontSize: 19 }}>{amount}</div>
          </div>
        ))}

        <div style={appear(34.95)}>
          <div style={{ position: 'absolute', left: 47, top: 701, fontSize: 19, lineHeight: '26px' }}>From Float</div>
          <div style={{ ...label, right: 64, top: 703 }}>{payout > 0 ? '6 new' : '5 new'}</div>
        </div>
        {[
          "Your payout just landed. Still want that MacBook? You're good to go.",
          'Reminder from last week: you wanted to revisit the Adobe subscription.',
          "Netflix charged you twice this month, looks like the old plan didn't fully cancel.",
          'You spent $340 less on takeout this month than last. Nice.',
        ].map((text, index) => {
          const isNew = index === 0
          const y = isNew ? 789 - (1 - payout) * 20 : notificationY[index - 1] + payout * 78
          return (
            <div key={text} style={{ position: 'absolute', left: 46, top: y - 39, width: 1714, height: 80,
              opacity: isNew ? payout : progress(35.02 + index * 0.045, 35.4 + index * 0.045),
              filter: isNew ? `blur(${((1 - payout) * 3).toFixed(3)}px)` : undefined,
              transform: `translateY(${((1 - progress(35, 35.4)) * 8).toFixed(3)}px)`,
              borderBottom: '1px solid #f2f2f2', boxSizing: 'border-box',
            }}>
              <div style={{ position: 'absolute', left: 14, top: 34, width: 10, height: 10, borderRadius: '50%', background: '#59d8ac' }} />
              <div style={{ position: 'absolute', left: 55, top: 28, fontSize: 15, lineHeight: '22px', color: '#080909', whiteSpace: 'nowrap' }}>{text}</div>
              <div style={{ position: 'absolute', right: 6, top: 24, fontSize: 21, fontWeight: 300, color: '#d2d5d5' }}>&#8250;</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
