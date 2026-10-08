import { LoaderCircle, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import type {
  AmazonLocationRequestError,
  PlaceSearchOptions,
  PlacesGateway,
  PlaceSuggestion,
  ResolvedPlace,
} from './amazon-location'

type PlaceSearchComboboxProps = {
  gateway: PlacesGateway
  value: string
  onValueChange: (value: string) => void
  onPlaceSelect: (place: ResolvedPlace | null) => void
  biasPosition?: PlaceSearchOptions['biasPosition']
  onResolvingChange?: (resolving: boolean) => void
  inputClassName?: string
  inputDescribedBy?: string
  inputInvalid?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === 'AmazonLocationRequestError') {
    return (error as AmazonLocationRequestError).message
  }
  return 'Place search is temporarily unavailable.'
}

export function PlaceSearchCombobox({
  gateway,
  value,
  onValueChange,
  onPlaceSelect,
  biasPosition,
  onResolvingChange,
  inputClassName,
  inputDescribedBy,
  inputInvalid,
  inputRef,
}: PlaceSearchComboboxProps) {
  const id = useId()
  const listboxId = `${id}-listbox`
  const statusId = `${id}-status`
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [isLoading, setIsLoading] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const [selectedValue, setSelectedValue] = useState('')
  const [retrySequence, setRetrySequence] = useState(0)
  const requestSequence = useRef(0)
  const searchController = useRef<AbortController | null>(null)
  const resolutionController = useRef<AbortController | null>(null)
  const trimmedValue = value.trim()
  const isOpen = isFocused && trimmedValue.length >= 3 && (isLoading || hasSearched || Boolean(error))

  useEffect(() => {
    if (trimmedValue.length < 3 || isComposing || trimmedValue === selectedValue) {
      setSuggestions([])
      setActiveIndex(-1)
      setError('')
      setHasSearched(false)
      setIsLoading(false)
      return
    }

    const controller = new AbortController()
    searchController.current = controller
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setIsLoading(true)
    setHasSearched(false)
    setError('')

    const timeout = window.setTimeout(async () => {
      try {
        const nextSuggestions = await gateway.suggest(trimmedValue, {
          biasPosition,
          signal: controller.signal,
        })
        if (requestSequence.current !== sequence) return
        setSuggestions(nextSuggestions)
        setActiveIndex(-1)
        setHasSearched(true)
      } catch (requestError) {
        if (isAbortError(requestError) || requestSequence.current !== sequence) return
        setSuggestions([])
        setHasSearched(true)
        setError(getErrorMessage(requestError))
      } finally {
        if (searchController.current === controller) searchController.current = null
        if (requestSequence.current === sequence) setIsLoading(false)
      }
    }, 300)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
      if (searchController.current === controller) searchController.current = null
    }
  }, [biasPosition, gateway, isComposing, retrySequence, selectedValue, trimmedValue])

  useEffect(() => () => {
    requestSequence.current += 1
    searchController.current?.abort()
    resolutionController.current?.abort()
  }, [])

  const selectSuggestion = async (suggestion: PlaceSuggestion) => {
    resolutionController.current?.abort()
    const controller = new AbortController()
    resolutionController.current = controller
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setIsResolving(true)
    onResolvingChange?.(true)
    setError('')
    try {
      const place = await gateway.resolve(suggestion, {
        biasPosition,
        signal: controller.signal,
      })
      if (requestSequence.current !== sequence) return
      setSelectedValue(place.name.trim())
      onValueChange(place.name)
      onPlaceSelect(place)
      setSuggestions([])
      setHasSearched(false)
      setActiveIndex(-1)
    } catch (requestError) {
      if (isAbortError(requestError) || requestSequence.current !== sequence) return
      setError(getErrorMessage(requestError))
      setSuggestions([])
      setHasSearched(true)
    } finally {
      if (resolutionController.current === controller) resolutionController.current = null
      if (requestSequence.current === sequence) { setIsResolving(false); onResolvingChange?.(false) }
    }
  }

  const activeOptionId = activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined

  return (
    <div className="relative">
      <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor={`${id}-input`}>
        Place name
      </label>
      <div className="relative">
        <Search className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
        <input
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-busy={isLoading || isResolving}
          aria-controls={listboxId}
          aria-describedby={[statusId, inputDescribedBy].filter(Boolean).join(' ')}
          aria-expanded={isOpen}
          aria-invalid={inputInvalid || undefined}
          autoComplete="off"
          autoFocus
          className={inputClassName}
          id={`${id}-input`}
          onBlur={() => window.setTimeout(() => setIsFocused(false), 100)}
          onChange={(event) => {
            resolutionController.current?.abort()
            requestSequence.current += 1
            setIsResolving(false)
            onResolvingChange?.(false)
            setSelectedValue('')
            onValueChange(event.target.value)
            onPlaceSelect(null)
            setIsFocused(true)
          }}
          onCompositionEnd={() => setIsComposing(false)}
          onCompositionStart={() => setIsComposing(true)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              requestSequence.current += 1
              searchController.current?.abort()
              resolutionController.current?.abort()
              setSuggestions([])
              setHasSearched(false)
              setActiveIndex(-1)
              setError('')
              setIsLoading(false)
              setIsResolving(false)
              onResolvingChange?.(false)
              return
            }
            if (!isOpen || suggestions.length === 0) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((current) => (current + 1) % suggestions.length)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1))
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault()
              void selectSuggestion(suggestions[activeIndex])
            }
          }}
          placeholder="Search or enter a place"
          ref={inputRef}
          role="combobox"
          value={value}
        />
        {(isLoading || isResolving) && (
          <LoaderCircle className="absolute top-3.5 right-3.5 size-4 animate-spin text-emerald-700" aria-hidden="true" />
        )}
      </div>

      <div aria-live="polite" className="sr-only" id={statusId} role="status">
        {isLoading
          ? 'Searching places'
          : isResolving
            ? 'Loading selected place'
            : error || (hasSearched ? `${suggestions.length} place suggestions available` : '')}
      </div>

      {isOpen && (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-emerald-950/12">
          {suggestions.length > 0 && (
            <ul aria-label="Place suggestions" id={listboxId} role="listbox">
              {suggestions.map((suggestion, index) => (
                <li
                  aria-selected={index === activeIndex}
                  className="cursor-pointer border-b border-slate-100 px-3.5 py-3 text-sm text-slate-700 last:border-0 hover:bg-emerald-50 aria-selected:bg-emerald-50 aria-selected:text-emerald-950"
                  id={`${id}-option-${index}`}
                  key={suggestion.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void selectSuggestion(suggestion)}
                  role="option"
                >
                  <span className="block font-medium">{suggestion.text.split(',')[0]}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{suggestion.text}</span>
                </li>
              ))}
            </ul>
          )}

          {!isLoading && hasSearched && suggestions.length === 0 && !error && (
            <p className="px-3.5 py-3 text-xs leading-5 text-slate-500">
              No matching places. You can still enter it manually.
            </p>
          )}

          {error && (
            <div className="px-3.5 py-3 text-xs leading-5 text-red-700" role="alert">
              <p>{error}</p>
              <button
                className="mt-2 font-semibold text-emerald-800 underline underline-offset-2"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setRetrySequence((current) => current + 1)}
                type="button"
              >
                Retry place search
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
