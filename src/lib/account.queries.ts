import { queryOptions } from '@tanstack/react-query'

import { getAccountFn } from './account.functions'

export const accountQuery = queryOptions({
  queryKey: ['personal-account'],
  queryFn: () => getAccountFn(),
})
