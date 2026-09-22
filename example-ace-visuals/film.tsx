// Full Float composition, local font loading, and source-frame scene boundaries.
import { useEffect, useState } from 'react'
import { Audio } from '@remotion/media'
import { cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion'
import { Ribbons } from './ribbon-motion.tsx'
import { Balls, HeroFace, SoftText, Star, value } from './components.tsx'
import { Chat } from './chat.tsx'
import { Dashboard } from './dashboard.tsx'

export function FloatFilm() {
  const currentFrame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const frame = currentFrame * 24 / fps
  const [fontHandle] = useState(() => delayRender('Load local Float fonts'))
  useEffect(() => {
    Promise.all([
      new FontFace('Float Sans', 'url(/inter-regular.ttf)', { weight: '400' }).load(),
      new FontFace('Float Sans', 'url(/inter-light.ttf)', { weight: '300' }).load(),
    ]).then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font))
      continueRender(fontHandle)
    }).catch(cancelRender)
  }, [fontHandle])

  return <div data-testid="float-film" style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, overflow: 'hidden', background: '#f8f8f8', color: '#000', fontFamily: '"Float Sans", sans-serif', fontWeight: 300 }}>
    <Audio src="/soundtrack.m4a" />
    {frame < 156 && <>
      <Ribbons frame={frame} />
      <SoftText frame={frame} text="You don’t think about" size={50} start={68} end={114} style={{ left: 100, right: 'auto', top: 510, bottom: 'auto', height: 70 }} />
      <SoftText frame={frame} text="finding your way home." size={50} start={79} end={125} style={{ left: 1296, right: 'auto', top: 506, bottom: 'auto', height: 70 }} />
    </>}
    {frame >= 156 && frame < 215 && <Star frame={frame} />}
    {frame >= 215 && frame < 263 && <SoftText frame={frame} text="Money should feel that natural." start={215} end={253} style={{ transform: `translateY(${value(frame, [253, 263], [0, -150])}px)` }} />}
    {frame >= 258 && frame < 339 && <Balls frame={frame} />}
    {frame >= 330 && frame < 380 && <div style={{ opacity: value(frame, [330, 339], [0, 1]) }}><HeroFace frame={frame} /></div>}
    {frame >= 380 && frame < 760 && <Chat frame={frame} />}
    {frame >= 760 && frame < 824 && <SoftText frame={frame} text="One less thing to remember." start={760} end={792} />}
    {frame >= 824 && frame < 936 && <Dashboard time={frame / 24} />}
    {frame >= 936 && frame < 1005 && <SoftText frame={frame} text="Then most things, taken care of." start={936} end={994} />}
    {frame >= 1005 && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 65, opacity: value(frame, [1005, 1015], [0, 1]) }}>
      <svg width="170" height="230" viewBox="0 0 170 230" aria-hidden="true">
        <circle cx="85" cy="140" r="69" fill="none" stroke="#31a981" strokeWidth="23" />
        <circle cx="85" cy="21" r="20" fill="#31a981" />
      </svg>
      <span style={{ fontSize: 124, fontWeight: 400, letterSpacing: -4 }}>float</span>
    </div>}
  </div>
}
