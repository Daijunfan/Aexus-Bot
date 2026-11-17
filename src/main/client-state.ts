import type {Store} from '../shared/types'

export function clientStore(store:Store):Store{
  const {employeeCreations,...visible}=store
  return visible
}
