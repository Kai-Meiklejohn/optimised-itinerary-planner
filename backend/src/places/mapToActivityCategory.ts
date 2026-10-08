export type ActivityCategory = 'Attraction' | 'Food' | 'Stay' | 'Transport' | 'Other'

export const ACTIVITY_CATEGORIES: ActivityCategory[] = ['Attraction', 'Food', 'Stay', 'Transport', 'Other']

const FOOD_KEYWORDS = ['restaurant', 'cafe', 'food', 'bar', 'bakery']
const STAY_KEYWORDS = ['hotel', 'lodging', 'hostel']
const TRANSPORT_KEYWORDS = ['airport', 'station', 'transit', 'train']

export function mapToActivityCategory(categories: string[]): ActivityCategory {
  const lower = categories.map((category) => category.toLowerCase())

  if (lower.some((category) => FOOD_KEYWORDS.some((keyword) => category.includes(keyword)))) {
    return 'Food'
  }
  if (lower.some((category) => STAY_KEYWORDS.some((keyword) => category.includes(keyword)))) {
    return 'Stay'
  }
  if (lower.some((category) => TRANSPORT_KEYWORDS.some((keyword) => category.includes(keyword)))) {
    return 'Transport'
  }
  if (categories.length > 0) {
    return 'Attraction'
  }
  return 'Other'
}
