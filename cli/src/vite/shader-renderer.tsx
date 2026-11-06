'use client'

/**
 * WebGL2 shader component factory for egaki video.
 *
 * Egaki's equivalent of Framer's defineShader() API, adapted for Remotion's
 * frame-based rendering. Time is derived from useCurrentFrame()/fps so shaders
 * are deterministic and seekable. Property controls are exposed via useTweakpane
 * for live editing in the player.
 *
 * Port of Framer's WebGL2 shader infrastructure. Original sources (in unframer):
 *   - defineShader():           unframer/src/framer.js:50569-50588
 *   - generateShaderHead():     unframer/src/framer.js:50493-50546
 *   - WebGL2ShaderRenderer:     unframer/src/framer.js:49750-50346
 *   - ShaderCanvas:             unframer/src/framer.js:51376-51593
 *   - DEFAULT_VERTEX_SHADER:    unframer/src/framer.js:51184-51196
 *   - builtInUniforms:          unframer/src/framer.js:49718-49747
 *   - setUniform():             unframer/src/framer.js:50224-50246
 *   - colorToVec4():            unframer/src/framer.js:50923-50927
 *   - bindFullScreenQuadAttribs: unframer/src/framer.js:50354-50366
 *
 * Key differences from Framer:
 *   - u_time = frame / fps (not wall-clock performance.now())
 *   - No requestAnimationFrame loop; one GL draw per Remotion frame
 *   - useTweakpane replaces Framer's ControlType property controls UI
 *   - No mouse input, heightmaps, or multi-pass buffers (can add later)
 *   - preserveDrawingBuffer=true for @remotion/web-renderer HtmlInCanvas
 */

import { useCurrentFrame, useVideoConfig } from 'remotion'
import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { useTweakpane } from './tweakpane-hook.tsx'
import {
  compileGlShader,
  FULLSCREEN_VERTEX_SHADER,
  linkGlProgram,
  parseHexColor,
} from '@egaki/angled-screen/src'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NumberControl {
  type: 'number'
  defaultValue: number
  min: number
  max: number
  step: number
  /** Hidden controls are not shown in the tweakpane UI but still set as uniforms. */
  hidden?: boolean
}

export interface ColorArrayControl {
  type: 'array'
  control: { type: 'color' }
  /** Maximum number of colors. Determines the GLSL array size. */
  maxCount: number
  /** Max color slots shown in tweakpane UI. Defaults to maxCount. */
  maxVisible?: number
  defaultValue: string[]
}

export type PropertyControl = NumberControl | ColorArrayControl

export interface ShaderConfig {
  /** Display name shown in tweakpane and used as React displayName. */
  title: string
  /** Fragment shader body (everything after the auto-generated header). */
  fragment: string
  /** Property controls that become uniforms and tweakpane sliders. */
  propertyControls: Record<string, PropertyControl>
}

// ---------------------------------------------------------------------------
// GLSL constants
// ---------------------------------------------------------------------------

/**
 * Build the full fragment shader source by prepending uniform declarations
 * and built-in uniforms before the user-provided shader body.
 *
 * Mirrors Framer's generateShaderHead() (framer.js:50493-50546).
 * Property control keys are converted to uniform names with a `u_` prefix,
 * matching Framer's toUniformName() convention (framer.js:50458-50459).
 */
function generateFragmentSource(
  body: string,
  controls: Record<string, PropertyControl>,
): string {
  const lines: string[] = [
    '#version 300 es',
    'precision highp float;',
    '',
    'in vec2 v_uv;',
    'out vec4 fragColor;',
  ]

  // #define for array max counts (Framer's toArrayMaxLengthName, framer.js:50470-50473)
  for (const [key, ctrl] of Object.entries(controls)) {
    if (ctrl.type === 'array') {
      const constName = key.replace(/[a-z0-9](?=[A-Z])/g, '$&_').toUpperCase()
      lines.push('', `#define NUM_${constName} ${ctrl.maxCount}`)
    }
  }

  lines.push('')

  // Uniform declarations from property controls
  for (const [key, ctrl] of Object.entries(controls)) {
    const uName = `u_${key}`
    if (ctrl.type === 'array') {
      const constName = key.replace(/[a-z0-9](?=[A-Z])/g, '$&_').toUpperCase()
      lines.push(`uniform vec4 ${uName}[NUM_${constName}];`)
      lines.push(`uniform int ${uName}_length;`)
    } else {
      lines.push(`uniform float ${uName};`)
    }
  }

  lines.push('')

  // Built-in uniforms (Framer's builtInUniforms, framer.js:49718-49747)
  lines.push(
    'uniform float u_time;',
    'uniform vec2 u_resolution;',
    'uniform float u_deltaTime;',
    'uniform float u_pixelRatio;',
    'uniform vec4 u_mousePosition;',
    'uniform float u_mousePointerDown;',
    'uniform float u_mouseHover;',
    '',
  )

  lines.push(body)
  return lines.join('\n')
}

// Pre-computed metadata for hot-path uniform updates during draw
interface NumberMeta {
  key: string
  uniformName: string
  defaultValue: number
  hidden: boolean
}
interface ArrayMeta {
  key: string
  uniformName: string
  lengthName: string
  maxCount: number
}

const BUILTIN_UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_deltaTime',
  'u_pixelRatio',
  'u_mousePosition',
  'u_mousePointerDown',
  'u_mouseHover',
] as const

interface GlState {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  posBuf: WebGLBuffer
  texBuf: WebGLBuffer
  locs: Record<string, WebGLUniformLocation | null>
}

// ---------------------------------------------------------------------------
// defineShader
// ---------------------------------------------------------------------------

/**
 * Create a React component that renders a WebGL2 fragment shader full-screen.
 *
 * The returned component accepts all property control keys as optional props
 * plus a `style` prop. Number controls are exposed in tweakpane as sliders
 * (unless `hidden: true`). Color array items are exposed as individual
 * tweakpane color pickers with swatch UI.
 *
 * Time and resolution are derived from Remotion's hooks, making the shader
 * fully deterministic and seekable.
 */
export function defineShader(config: ShaderConfig) {
  const fragmentSource = generateFragmentSource(
    config.fragment,
    config.propertyControls,
  )

  // Pre-compute per-control metadata so the draw path avoids Object.entries()
  const numberMetas: NumberMeta[] = []
  const arrayMetas: ArrayMeta[] = []
  const tweakpaneDefaults: Record<
    string,
    { value: number; min: number; max: number; step: number }
  > = {}
  const arrayDefaults: Record<string, string[]> = {}

  for (const [key, ctrl] of Object.entries(config.propertyControls)) {
    if (ctrl.type === 'number') {
      numberMetas.push({
        key,
        uniformName: `u_${key}`,
        defaultValue: ctrl.defaultValue,
        hidden: !!ctrl.hidden,
      })
      if (!ctrl.hidden) {
        tweakpaneDefaults[key] = {
          value: ctrl.defaultValue,
          min: ctrl.min,
          max: ctrl.max,
          step: ctrl.step,
        }
      }
    } else if (ctrl.type === 'array') {
      arrayMetas.push({
        key,
        uniformName: `u_${key}`,
        lengthName: `u_${key}_length`,
        maxCount: ctrl.maxCount,
      })
      arrayDefaults[key] = ctrl.defaultValue
    }
  }

  // Build tweakpane keys for color array items. Each color slot up to maxCount
  // becomes an individual tweakpane color picker (e.g. "colors 1", "colors 2").
  // A "{key} count" slider controls how many are active (sent as u_{key}_length).
  // Tweakpane auto-detects #hex strings as color inputs with a swatch.
  const arrayTweakpaneKeys: {
    arrayKey: string
    countKey: string
    tpKeys: string[]
    defaults: string[]
    maxCount: number
  }[] = []
  for (const m of arrayMetas) {
    const ctrl = config.propertyControls[m.key] as ColorArrayControl
    const visible = ctrl.maxVisible ?? ctrl.maxCount
    const tpKeys: string[] = []
    for (let i = 0; i < visible; i++) {
      tpKeys.push(`${m.key} ${i + 1}`)
    }
    arrayTweakpaneKeys.push({
      arrayKey: m.key,
      countKey: `${m.key} count`,
      tpKeys,
      defaults: ctrl.defaultValue,
      maxCount: ctrl.maxCount,
    })
  }

  function ShaderComponent(
    props: Record<string, any> & { style?: CSSProperties },
  ) {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()
    const time = frame / fps

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const glStateRef = useRef<GlState | null>(null)

    // Build tweakpane schema with props overriding defaults.
    // Number controls become sliders; color array items become individual
    // color pickers (tweakpane auto-detects #hex strings as color inputs).
    const tpSchema: Record<string, any> = {}
    for (const [key, base] of Object.entries(tweakpaneDefaults)) {
      tpSchema[key] = { ...base, value: props[key] ?? base.value }
    }
    for (const { arrayKey, countKey, tpKeys, defaults } of arrayTweakpaneKeys) {
      const propColors: string[] | undefined = props[arrayKey]
      const activeCount = Math.min(propColors?.length ?? defaults.length, tpKeys.length)
      tpSchema[countKey] = { value: activeCount, min: 1, max: tpKeys.length, step: 1 }
      for (let i = 0; i < tpKeys.length; i++) {
        tpSchema[tpKeys[i]!] = propColors?.[i] ?? defaults[i] ?? '#000000'
      }
    }
    const tp = useTweakpane(config.title, tpSchema)

    // Initialize WebGL2 on mount (useLayoutEffect so the first frame draws)
    useLayoutEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: false,
        // Must be true for @remotion/web-renderer HtmlInCanvas screenshots
        preserveDrawingBuffer: true,
      })
      if (!gl) {
        console.error(`[${config.title}] WebGL2 not supported`)
        return
      }

      let vs: WebGLShader | null = null
      let fs: WebGLShader | null = null
      try {
        vs = compileGlShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX_SHADER)
        fs = compileGlShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
        const program = linkGlProgram(gl, vs, fs)
        // Shaders can be deleted after successful link
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        vs = null
        fs = null

        // Fullscreen quad VAO (2 triangles, 6 vertices)
        // Position/texCoord data matches Framer's createStaticArrayBuffer (framer.js:50347-50352)
        const vao = gl.createVertexArray()!
        gl.bindVertexArray(vao)

        const posBuf = gl.createBuffer()!
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
        // prettier-ignore
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          -1, -1,  1, -1,  -1, 1,
          -1,  1,  1, -1,   1, 1,
        ]), gl.STATIC_DRAW)
        const posLoc = gl.getAttribLocation(program, 'a_position')
        if (posLoc >= 0) {
          gl.enableVertexAttribArray(posLoc)
          gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
        }

        const texBuf = gl.createBuffer()!
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuf)
        // prettier-ignore
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          0, 0,  1, 0,  0, 1,
          0, 1,  1, 0,  1, 1,
        ]), gl.STATIC_DRAW)
        const texLoc = gl.getAttribLocation(program, 'a_texCoord')
        if (texLoc >= 0) {
          gl.enableVertexAttribArray(texLoc)
          gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0)
        }

        gl.bindVertexArray(null)

        // Look up all uniform locations once
        const locs: Record<string, WebGLUniformLocation | null> = {}
        for (const name of BUILTIN_UNIFORM_NAMES) {
          locs[name] = gl.getUniformLocation(program, name)
        }
        for (const m of numberMetas) {
          locs[m.uniformName] = gl.getUniformLocation(program, m.uniformName)
        }
        for (const m of arrayMetas) {
          locs[m.uniformName] = gl.getUniformLocation(program, m.uniformName)
          locs[m.lengthName] = gl.getUniformLocation(program, m.lengthName)
        }

        // Bind program + VAO for all subsequent draws (single-pass hot path,
        // mirrors Framer's constructor binding in framer.js:49795-49797)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.clearColor(0, 0, 0, 0)

        glStateRef.current = { gl, program, vao, posBuf, texBuf, locs }
      } catch (e) {
        console.error(`[${config.title}] Shader init failed:`, e)
        if (vs) gl.deleteShader(vs)
        if (fs) gl.deleteShader(fs)
      }

      return () => {
        const state = glStateRef.current
        if (state) {
          const { gl: g, program, vao, posBuf, texBuf } = state
          g.deleteProgram(program)
          g.deleteVertexArray(vao)
          g.deleteBuffer(posBuf)
          g.deleteBuffer(texBuf)
          glStateRef.current = null
        }
      }
    }, [])

    // Draw every Remotion frame. No deps = runs on every render, which is
    // triggered by useCurrentFrame() changing each frame.
    useLayoutEffect(() => {
      const state = glStateRef.current
      const canvas = canvasRef.current
      if (!state || !canvas) return

      const { gl, locs } = state
      const dpr =
        typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)

      // Resize backing buffer to match CSS size × DPR
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }

      // Built-in uniforms (mirrors updatePassBuiltIns, framer.js:50318-50344)
      const loc = locs
      if (loc.u_time !== null) gl.uniform1f(loc.u_time!, time)
      if (loc.u_resolution !== null) gl.uniform2f(loc.u_resolution!, w, h)
      if (loc.u_deltaTime !== null) gl.uniform1f(loc.u_deltaTime!, 1 / fps)
      if (loc.u_pixelRatio !== null) gl.uniform1f(loc.u_pixelRatio!, dpr)
      if (loc.u_mousePosition !== null)
        gl.uniform4fv(loc.u_mousePosition!, [0, 0, 0, 0])
      if (loc.u_mousePointerDown !== null)
        gl.uniform1f(loc.u_mousePointerDown!, 0)
      if (loc.u_mouseHover !== null) gl.uniform1f(loc.u_mouseHover!, 0)

      // Number control uniforms (from tweakpane for visible, props for hidden)
      for (const m of numberMetas) {
        const l = loc[m.uniformName]
        if (l == null) continue
        const value = m.hidden
          ? (props[m.key] ?? m.defaultValue)
          : ((tp as any)[m.key] ?? m.defaultValue)
        gl.uniform1f(l, value)
      }

      // Color array uniforms — read count + individual colors from tweakpane
      for (const { arrayKey, countKey, tpKeys } of arrayTweakpaneKeys) {
        const m = arrayMetas.find((am) => am.key === arrayKey)!
        const count = (tp as any)[countKey] as number
        const flat: number[] = []
        for (let i = 0; i < m.maxCount; i++) {
          if (i < tpKeys.length) {
            flat.push(...parseHexColor((tp as any)[tpKeys[i]!] ?? '#000000'))
          } else {
            flat.push(0, 0, 0, 0)
          }
        }
        const uLoc = loc[m.uniformName]
        if (uLoc != null) gl.uniform4fv(uLoc, flat)
        const lLoc = loc[m.lengthName]
        if (lLoc != null) gl.uniform1i(lLoc, count)
      }

      // Draw the fullscreen quad
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    })

    return (
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          ...props.style,
        }}
      />
    )
  }

  ShaderComponent.displayName = config.title
  return ShaderComponent
}
