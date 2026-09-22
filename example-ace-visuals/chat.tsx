// Editable Float chat, timed to absolute source frames at 24 fps.
import { EASE } from 'egaki/video'
import { interpolate } from 'remotion'
import { Face } from './components.tsx'

export function Chat({ frame }: { frame: number }) {
  const tween = (frames: number[], values: number[], easing = EASE.smooth) => interpolate(frame, frames, values, {
    easing,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const query = 'I\u2019m thinking about buying a Macbook, should I do it?'
  const secondQuery = "Oh yes, that'd be great!"
  const firstReply = "You'd be at $4,821 after, still above your usual $3,000 buffer, but rent on the 1st brings you down to $3,021. Doable, just tighter than your usual month."
  const secondReply = "If you can wait 9 days, your payout lands and you'd buy it with room to spare. Want me to remind you on the 5th?"
  const close = frame >= 400
  const input = frame < 538 || (frame >= 646 && frame < 694)
  const second = frame >= 646
  const typed = second
    ? tween([648, 654, 660, 666, 672, 678], [0, 5, 6, 13, 20, secondQuery.length], (t) => t)
    : tween([411, 420, 426, 438, 450, 462, 474, 486], [0, 10, 12, 20, 29, 38, 46, query.length], (t) => t)
  const cameraScale = close ? tween([400, 410], [2.6, 2.7]) : 1
  const cameraX = tween([400, 410, 444, 450, 456, 462, 468, 480, 490], [130, 174, 174, -460, -1010, -1230, -1430, -1768, -2038])
  const replyY = tween([538, 552, 630, 645], [-36, 0, 0, -95])
  const replyShown = tween([546, 552, 558, 564, 570, 578], [0, 17, 75, 123, 145, firstReply.length + 35], (t) => t)
   const paragraphShown = tween([576, 582, 588, 594, 600, 606, 612, 618, 624], [0, 21, 40, 57, 72, 88, 101, secondReply.length, secondReply.length + 28], (t) => t)

  // Every character stays in flow; opacity and color alone advance the reveal.
  const reveal = (text: string, count: number, trail: number, caret = false) => (
    <>
      {text.split('').map((character, index) => {
        const green = Math.max(0, Math.min(1, 1 - (count - index - 1) / trail))
        return (
          <span key={index} style={{
            position: 'relative',
            opacity: index < Math.floor(count) ? 1 : 0,
            color: `rgb(${Math.round(45 * green)}, ${Math.round(223 * green)}, ${Math.round(158 * green)})`,
          }}>
            {character}
            {caret && index === Math.floor(count) - 1 && (
              <span style={{ position: 'absolute', right: -3, top: '4%', height: '105%', width: 1.5, background: '#000', opacity: frame % 12 < 7 ? 1 : 0 }} />
            )}
          </span>
        )
      })}
    </>
  )

  return (
    <div style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, overflow: 'hidden', background: '#f8f8f8', color: '#000', fontFamily: 'inherit', fontWeight: 300 }}>
      {input && (
        <div style={{
          position: 'absolute',
          left: second ? 170 : close ? cameraX : 191,
          top: second ? tween([646, 660, 684, 694], [405, 365, 365, 315]) : close ? 540 - 82 * cameraScale : 458,
          width: second ? 3300 : close ? 1360 : 1518,
          height: second ? 354 : 164,
          borderRadius: second ? 110 : 43,
          border: '1px solid #e7e7eb',
          boxSizing: 'border-box',
          background: '#fff',
          transform: `scale(${second ? 1 : cameraScale.toFixed(3)})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}>
          {second ? (
            <svg width="66" height="66" viewBox="0 0 66 66" style={{ position: 'absolute', left: 90, top: 140 }} aria-hidden="true">
              <path d="M3 33H63M33 3V63" stroke="currentColor" strokeWidth="5" />
            </svg>
          ) : (
            <div style={{ position: 'absolute', left: close ? 43 : 21, top: 43, opacity: frame < 447 ? 1 : 0 }}>
              <Face size={72} frame={frame} />
            </div>
          )}
          <div style={{ position: 'absolute', left: second ? 266 : 154, top: second ? 108 : 48, fontSize: second ? 96 : 40, lineHeight: second ? '120px' : '60px', whiteSpace: 'pre' }}>
            {!second && frame < 400 ? (
              <span style={{ color: '#a0a4af' }}>Ask Float anything...</span>
            ) : reveal(second ? secondQuery : query, typed + (frame > (second ? 678 : 486) ? (frame - (second ? 678 : 486)) * 2 : 0), second ? 0.001 : 5, !second)}
            {!second && close && typed === 0 && <span style={{ position: 'absolute', left: 0, top: 0, height: 51, width: 2.5, background: '#000' }} />}
          </div>
          {!second && (
            <div style={{ position: 'absolute', right: 37, top: 32, width: 93, height: 93, borderRadius: 25, background: frame >= 515 && frame < 520 ? '#000' : '#27ad7e', overflow: 'hidden', transform: `scale(${tween([508, 512, 516, 521], [1, 0.94, 1, 1])})` }}>
              <svg width="93" height="93" viewBox="0 0 93 93" style={{ transform: `translateY(${tween([509, 514, 519, 524], [0, -55, 55, 0])}px)` }} aria-hidden="true">
                <path d="M46.5 62V31M33.5 44L46.5 31L59.5 44" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
      )}

      {frame >= 470 && frame < 538 && (
        <div style={{ position: 'absolute',
          left: tween([470, 480, 486, 492, 498, 504, 510, 516, 522, 528, 537], [350, 510, 930, 1500, 1030, 877, 880, 880, 1470, 1498, 1410]),
          top: tween([470, 480, 486, 492, 498, 504, 510, 516, 522, 528, 537], [1090, 895, -40, 100, 895, 807, 807, 807, 130, 59, -150]),
          transform: `rotate(${tween([470, 480, 486, 492, 498, 510, 528, 537], [-40, -80, 20, -15, 25, -15, -20, 40])}deg) scale(${tween([470, 480, 486, 492, 498, 504], [1, 0.68, 0.55, 1, 1, 1])}, ${tween([470, 480, 486, 492, 498, 504], [1, 0.48, 0.55, 1, 1, 1])})`,
          willChange: 'transform',
        }}>
          <Face size={196} frame={frame} />
        </div>
      )}

      {!second && frame >= 538 && (
        <div style={{ position: 'absolute', inset: 0, transform: `translateY(${replyY.toFixed(3)}px)`, willChange: 'transform' }}>
          <div style={{ position: 'absolute', left: 384, top: 132, width: 1438, height: 193, borderRadius: 40, background: '#eaeaea', display: 'flex', alignItems: 'center', paddingLeft: 64, paddingBottom: 6, boxSizing: 'border-box', fontSize: 55.2, whiteSpace: 'nowrap' }}>
            {query}
          </div>
          <div style={{ position: 'absolute', left: tween([538, 546, 552], [170, 82, 90]), top: tween([538, 546, 552], [860, 425, 452]), transform: `rotate(${tween([538, 546, 552], [-30, -20, 0])}deg)`, willChange: 'transform' }}>
            <Face size={178} frame={frame} />
          </div>
          <div style={{ position: 'absolute', left: 348, top: 502, width: 1480, fontSize: 51.5, lineHeight: '60px', letterSpacing: '-0.3px' }}>
            <div>{reveal(firstReply, replyShown, 35)}</div>
            <div style={{ marginTop: 60 }}>{reveal(secondReply, paragraphShown, 28)}</div>
          </div>
        </div>
      )}

      {frame >= 694 && (
        <>
          <div style={{ position: 'absolute', left: 988, top: tween([694, 710], [195, 162]), width: 834, height: 184, borderRadius: 58, background: '#eaeaea', display: 'flex', alignItems: 'center', paddingLeft: 64, boxSizing: 'border-box', fontSize: 64, whiteSpace: 'nowrap' }}>
            {secondQuery}
          </div>
          <div style={{ position: 'absolute', left: tween([694, 708, 720], [82, 100, 104]), top: 458, transform: `rotate(${tween([694, 708, 720], [0, -7, 0])}deg)` }}>
            <Face size={166} frame={frame} />
          </div>
          <div style={{ position: 'absolute', left: 342, top: 490, fontSize: 64, lineHeight: '78px', whiteSpace: 'nowrap' }}>
            {reveal("Easy. I'll give you a nudge on the 5th.", tween([706, 714, 720, 732, 740, 748], [0, 10, 18, 32, 38, 54], (t) => t), 13)}
          </div>
        </>
      )}

      {((frame >= 383 && frame < 400) || (frame >= 493 && frame < 519)) && (
        <svg width={close ? 120 : 54} height={close ? 192 : 86} viewBox="0 0 120 192" style={{ position: 'absolute', left: close ? tween([493, 503], [1510, 1408]) : tween([383, 394], [560, 450]), top: close ? tween([493, 503], [745, 565]) : tween([383, 394], [760, 565]), transform: `scale(${tween([508, 512, 516], [1, 0.9, 1])})` }} aria-hidden="true">
          <path d="M5 5V145L37 113L64 180L91 170L64 106H105Z" fill="#000" stroke="#fff" strokeWidth="7" />
        </svg>
      )}
    </div>
  )
}
