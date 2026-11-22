// Chart colours come from the theme (src/themes/catalog.ts): every theme's pair was checked
// with the dataviz palette validator. Colour-blind-safe mode swaps in Okabe–Ito based steps.
import type { Theme } from '../../lib/themes'

export const seriesColours = (t: Theme) => t.chart.series
export const priorityColours = (t: Theme) => t.chart.priority
export const PRIORITY_NAME: Record<string, string> = { P1: 'Urgent', P2: 'High', P3: 'Normal', P4: 'Low' }
