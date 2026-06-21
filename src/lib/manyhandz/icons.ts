import type { LucideIcon } from 'lucide-react-native'
import {
  Sparkles, Home, Utensils, Bath, Sofa, BedDouble, Trees, Shirt, Dog, Cat, Trash2, Brush,
  Car, Leaf, Droplet, ShoppingCart, Baby, Flower2, Wind, Wrench, Hammer, Recycle, WashingMachine,
  Sun, Bed, BookOpen, Gamepad2, GraduationCap, Heart, Star, Gift, Target, Award, Trophy,
} from 'lucide-react-native'

/**
 * Icon map — chore_category.icon and chore.icon are stored as stable string keys (lucide names in
 * kebab/lowercase). Screens resolve them to a component via iconFor(); the chore-create picker lists
 * CHORE_ICON_KEYS. Keeping this map central means the keys never drift between create + display.
 */
const ICONS: Record<string, LucideIcon> = {
  // categories
  home: Home,
  utensils: Utensils,
  bath: Bath,
  sofa: Sofa,
  'bed-double': BedDouble,
  trees: Trees,
  shirt: Shirt,
  dog: Dog,
  cat: Cat,
  // common chores
  sparkles: Sparkles,
  trash: Trash2,
  'trash-2': Trash2,
  brush: Brush,
  broom: Brush,
  car: Car,
  leaf: Leaf,
  droplet: Droplet,
  'shopping-cart': ShoppingCart,
  baby: Baby,
  flower: Flower2,
  wind: Wind,
  wrench: Wrench,
  hammer: Hammer,
  recycle: Recycle,
  'washing-machine': WashingMachine,
  sun: Sun,
  bed: Bed,
  book: BookOpen,
  game: Gamepad2,
  school: GraduationCap,
  heart: Heart,
  star: Star,
  gift: Gift,
  target: Target,
  award: Award,
  trophy: Trophy,
}

/** Keys offered in the chore-create / category icon pickers. */
export const CHORE_ICON_KEYS = Object.keys(ICONS)

/** Resolve a stored icon key to a Lucide component; unknown/empty falls back to Sparkles. */
export function iconFor(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Sparkles
}
