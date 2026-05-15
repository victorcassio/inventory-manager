import { useState } from 'react'

export function usePagination(initialPage = 1, initialLimit = 20) {
  const [page, setPage] = useState(initialPage)
  const [limit] = useState(initialLimit)
  const reset = () => setPage(1)
  return { page, limit, setPage, reset }
}
