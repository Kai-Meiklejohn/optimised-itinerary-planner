const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidCalendarDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) {
    return false
  }

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  )
}
