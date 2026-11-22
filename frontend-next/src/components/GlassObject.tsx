// The 3D object on the sign-in page: a slowly turning knot of liquid glass with glowing orbs
// in the theme's tones behind it, so the glass bends their colour.
//
// Smoothness (it used to stutter):
//  • the page mounts this only after its entrance animation, then fades it in, so compiling
//    the glass shader never lands on top of the text animating in;
//  • one transmission pass (no backside pass), fewer samples, a smaller buffer, fewer polygons;
//  • PerformanceMonitor lowers the pixel ratio and quality on devices that can't keep up;
//  • the shaders compile in the background (compileAsync, parallel where the GPU allows) and
//    the scene only starts drawing, and fades in, once that's done: no freeze on the first frame;
//  • nothing renders while the tab is hidden.
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Float, Lightformer, MeshTransmissionMaterial, PerformanceMonitor } from '@react-three/drei'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import type * as THREE from 'three'
import type { Theme } from '../lib/themes'

function Stage({ theme, still, q }: { theme: Theme; still: boolean; q: number }) {
  const { viewport } = useThree()
  const x = viewport.width > 7 ? viewport.width * 0.22 : 0
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[-0.35, 0.3, -1.6]}><sphereGeometry args={[0.42, 24, 24]} /><meshBasicMaterial color={theme.a} toneMapped={false} /></mesh>
      <mesh position={[0.45, -0.3, -1.8]}><sphereGeometry args={[0.36, 24, 24]} /><meshBasicMaterial color={theme.b} toneMapped={false} /></mesh>
      {theme.c && <mesh position={[0.1, 0.55, -2]}><sphereGeometry args={[0.24, 20, 20]} /><meshBasicMaterial color={theme.c} toneMapped={false} /></mesh>}
      <Float speed={still ? 0 : 1.2} rotationIntensity={0.4} floatIntensity={0.8}><Knot theme={theme} still={still} q={q} /></Float>
    </group>
  )
}

function Knot({ theme, still, q }: { theme: Theme; still: boolean; q: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((s, dt) => {
    if (!ref.current || still) return
    const d = Math.min(dt, 1 / 30)   // a long frame never makes it jump
    ref.current.rotation.x += d * 0.12; ref.current.rotation.y += d * 0.18
    ref.current.position.x += ((Math.sin(s.clock.elapsedTime * 0.3) * 0.12 + s.pointer.x * 0.2) - ref.current.position.x) * Math.min(1, d * 4)
    ref.current.position.y += (s.pointer.y * 0.18 - ref.current.position.y) * Math.min(1, d * 4)
  })
  return (
    <mesh ref={ref} scale={0.95}>
      <torusKnotGeometry args={[1, 0.36, 160, 24]} />
      <MeshTransmissionMaterial samples={q > 0.6 ? 4 : 2} resolution={q > 0.6 ? 384 : 192} thickness={1.1} roughness={0.08} transmission={1} ior={1.35}
        chromaticAberration={0.12} anisotropy={0.1} distortion={0.2} distortionScale={0.4} temporalDistortion={0}
        color={theme.scheme === 'light' ? '#ffffff' : '#d9dcff'} />
    </mesh>
  )
}

// Compiles every shader in the scene off the critical path, then says it's ready.
function Warmup({ onReady }: { onReady: () => void }) {
  const { gl, scene, camera, invalidate } = useThree()
  useEffect(() => {
    let alive = true
    // After compiling, draw one frame while still invisible (sets up the glass and lighting
    // buffers), then let the page fade the object in.
    const done = () => { if (!alive) return; invalidate(); requestAnimationFrame(() => requestAnimationFrame(() => { if (alive) onReady() })) }
    const r = gl as unknown as { compileAsync?: (s: unknown, c: unknown) => Promise<void> }
    if (r.compileAsync) r.compileAsync(scene, camera).then(done, done)
    else { gl.compile(scene, camera); done() }
    return () => { alive = false }
  }, [gl, scene, camera, invalidate, onReady])
  return null
}

export default function GlassObject({ theme, onReady }: { theme: Theme; onReady?: () => void }) {
  const still = !!useReducedMotion() || theme.prefs.reduce_motion
  const small = typeof window !== 'undefined' && window.innerWidth < 700
  const [dpr, setDpr] = useState(small ? 1 : 1.5)
  const [q, setQ] = useState(small ? 0.5 : 1)
  const [visible, setVisible] = useState(!document.hidden)
  const [ready, setReady] = useState(false)
  const markReady = useCallback(() => { setReady(true); onReady?.() }, [onReady])
  useEffect(() => {
    const on = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return (
    <Canvas dpr={dpr} camera={{ position: [0, 0, 6], fov: 40 }} frameloop={!ready || still || !visible ? 'demand' : 'always'}
      gl={{ alpha: true, antialias: false, powerPreference: 'high-performance' }}>
      <Warmup onReady={markReady} />
      <PerformanceMonitor onDecline={() => { setDpr(1); setQ(0.5) }} onIncline={() => { if (!small) { setDpr(1.5); setQ(1) } }} flipflops={3} />
      <ambientLight intensity={0.4} />
      <Stage theme={theme} still={still} q={q} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 4, 2]} scale={[8, 2, 1]} />
        <Lightformer form="rect" intensity={2} position={[-4, 0, 2]} scale={[2, 6, 1]} color={theme.a} />
        <Lightformer form="rect" intensity={2} position={[4, 0, 2]} scale={[2, 6, 1]} color={theme.b} />
        <Lightformer form="ring" intensity={1.5} position={[0, -3, 3]} scale={3} />
      </Environment>
    </Canvas>
  )
}
