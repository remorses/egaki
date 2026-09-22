/**
 * AngledScreen demos for flat product screenshots (Strada, Spiceflow).
 * Each section is a static 1s shot so agents can screenshot mid-frame.
 */

import { AbsoluteFill } from 'remotion'
import { AngledScreen } from 'egaki/video'

function Shot(props: {
  src: string
  bg: string
  perspective: number
  rotateX: number
  rotateY: number
  rotateZ?: number
  translateZ: number
  translateX?: number
  fog?: number
  grain?: number
  aperture?: number
  maxBlur?: number
  focus?: number
  chromaticAberration?: number
  width?: string
}) {
  return (
    <AbsoluteFill style={{ backgroundColor: props.bg }}>
      <AngledScreen
        perspective={props.perspective}
        rotateX={props.rotateX}
        rotateY={props.rotateY}
        rotateZ={props.rotateZ ?? 0}
        translateZ={props.translateZ}
        translateX={props.translateX ?? 0}
        fog={props.fog ?? 0.35}
        grainIntensity={props.grain ?? 0.02}
        aperture={props.aperture ?? 0.5}
        maxBlur={props.maxBlur ?? 0.12}
        focus={props.focus ?? 0}
        chromaticAberration={props.chromaticAberration ?? 0.45}
        backgroundColor={props.bg}
        width={props.width ?? '86%'}
        height='auto'
      >
        <img
          src={props.src}
          style={{
            width: '100%',
            display: 'block',
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.12)',
            boxSizing: 'border-box',
          }}
        />
      </AngledScreen>
    </AbsoluteFill>
  )
}

/** Strada landing — white page, so white stage bg (no black letterbox). */
export function StradaShot() {
  return (
    <Shot
      src='/inputs/strada.png'
      bg='#ffffff'
      perspective={720}
      rotateX={11}
      rotateY={-24}
      translateZ={90}
      fog={0.2}
      grain={0.04}
      aperture={0.5}
      maxBlur={0.12}
      chromaticAberration={0.55}
      width='88%'
    />
  )
}

/** OpenSession — dark landing page, cinematic dark bg. */
export function OpenSessionShot() {
  return (
    <Shot
      src='/inputs/opensession.png'
      bg='#060a0c'
      perspective={780}
      rotateX={9}
      rotateY={-19}
      translateZ={180}
      aperture={0.35}
      maxBlur={0.1}
      focus={0.6}
      grain={0.03}
      chromaticAberration={0.5}
      fog={0.3}
      width='88%'
    />
  )
}

/** Spiceflow — props dialed in via tweakpane (frame 40). */
export function SpiceflowShot() {
  return (
    <Shot
      src='/inputs/spiceflow.png'
      bg='#040406'
      perspective={800}
      rotateX={10}
      rotateY={22}
      translateZ={217}
      aperture={0.07}
      maxBlur={0.07}
      focus={0.74}
      grain={0.198}
      chromaticAberration={0.7}
      fog={0.35}
      width='88%'
    />
  )
}
