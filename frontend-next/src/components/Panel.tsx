import { motion } from 'motion/react'
import type { ReactNode, CSSProperties } from 'react'

// A glass section that rises into place when it scrolls into view.
export function Panel({ title, hint, action, children, className, style, delay = 0 }: {
  title?: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties; delay?: number }) {
  return (
    <motion.section className={`panel glass ${className || ''}`} style={style}
      initial={{ opacity: 0, y: 28, filter: 'blur(10px)' }} whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}>
      {(title || action) && (
        <header className="panel-head">
          <div>{title && <h2>{title}</h2>}{hint && <p>{hint}</p>}</div>
          {action}
        </header>
      )}
      {children}
    </motion.section>
  )
}
