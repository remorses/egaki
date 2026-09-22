// Standalone Remotion Studio entry with source-timed scenes and local assets.
import { useEffect, useState } from 'react'
import { Audio } from '@remotion/media'
import { Composition, Sequence, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
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
      new FontFace('Float Sans', `url(${staticFile('inter-regular.ttf')})`, { weight: '400' }).load(),
      new FontFace('Float Sans', `url(${staticFile('inter-light.ttf')})`, { weight: '300' }).load(),
    ]).then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font))
      continueRender(fontHandle)
    }).catch(cancelRender)
  }, [fontHandle])

  // Preserve typography previously inherited from Egaki's composition styles.
  return <div data-testid="float-film" style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, overflow: 'hidden', background: '#f8f8f8', color: '#000', fontFamily: '"Float Sans", sans-serif', fontWeight: 300, fontSize: 60, lineHeight: 1.5 }}>
    <Audio src={staticFile('soundtrack.m4a')} />
    <Sequence name="Ribbons" durationInFrames={156}>
      <Ribbons frame={frame} />
      <SoftText frame={frame} text="You don’t think about" size={50} start={68} end={114} style={{ left: 100, right: 'auto', top: 510, bottom: 'auto', height: 70 }} />
      <SoftText frame={frame} text="finding your way home." size={50} start={79} end={125} style={{ left: 1296, right: 'auto', top: 506, bottom: 'auto', height: 70 }} />
    </Sequence>
    <Sequence name="Star" from={156} durationInFrames={59}>
      <Star frame={frame} />
    </Sequence>
    <Sequence name="Money should feel natural" from={215} durationInFrames={48}>
      <SoftText frame={frame} text="Money should feel that natural." start={215} end={253} style={{ transform: `translateY(${value(frame, [253, 263], [0, -150])}px)` }} />
    </Sequence>
    <Sequence name="Spheres and orb" from={258} durationInFrames={81}>
      <Balls frame={frame} />
    </Sequence>
    <Sequence name="Mascot" from={330} durationInFrames={50}>
      <div style={{ opacity: value(frame, [330, 339], [0, 1]) }}><HeroFace frame={frame} /></div>
    </Sequence>
    <Sequence name="Chat" from={380} durationInFrames={380}>
      <Chat frame={frame} />
    </Sequence>
    <Sequence name="One less thing" from={760} durationInFrames={64}>
      <SoftText frame={frame} text="One less thing to remember." start={760} end={792} />
    </Sequence>
    <Sequence name="Dashboard" from={824} durationInFrames={112}>
      <Dashboard time={frame / 24} />
    </Sequence>
    <Sequence name="Taken care of" from={936} durationInFrames={69}>
      <SoftText frame={frame} text="Then most things, taken care of." start={936} end={994} />
    </Sequence>
    <Sequence name="Float logo" from={1005} durationInFrames={36}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 65, opacity: value(frame, [1005, 1015], [0, 1]) }}>
      <svg width="170" height="230" viewBox="0 0 170 230" aria-hidden="true">
        <circle cx="85" cy="140" r="69" fill="none" stroke="#31a981" strokeWidth="23" />
        <circle cx="85" cy="21" r="20" fill="#31a981" />
      </svg>
      <span style={{ fontSize: 124, fontWeight: 400, letterSpacing: -4 }}>float</span>
      </div>
    </Sequence>
  </div>
}

export function RemotionRoot() {
  return <Composition id="Float" component={FloatFilm} width={1920} height={1080} fps={24} durationInFrames={1041} />
}
