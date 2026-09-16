import { FILTERS, type SessionFilter } from './session-filters'

interface Props {
  value: SessionFilter
  counts: Record<SessionFilter, number>
  onChange: (value: SessionFilter) => void
}

export function SessionFilters({ value, counts, onChange }: Props) {
  return (
    <div className="filters" role="group" aria-label="Filtrar sesiones">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          className="filter-chip"
          aria-pressed={value === f.key}
          aria-label={`${f.label} (${counts[f.key]})`}
          onClick={() => onChange(f.key)}
        >
          {f.label}
          <span className="filter-count" aria-hidden="true">
            {counts[f.key]}
          </span>
        </button>
      ))}
    </div>
  )
}
