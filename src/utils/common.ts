import { isRef, unref, Ref, ComputedRef, toRaw } from 'vue'

export const isComputed = (value: any): boolean => {
  return value && typeof value === 'object' && 'value' in value && 'effect' in value
}

export const unwrapVariables = (variables: any): any => {
  if (variables === null || typeof variables !== 'object') {
    return variables
  }

  // Handle Ref/Computed/Reactive
  // unref() handles Refs and Computed.
  // toRaw() handles Reactive proxies.
  const raw = toRaw(isRef(variables) || isComputed(variables) ? unref(variables) : variables)

  // Double check if unref result is still a proxy (nested)
  const finalRaw = toRaw(raw)

  if (typeof finalRaw !== 'object' || finalRaw === null) {
    return finalRaw
  }

  // Handle Date
  if (finalRaw instanceof Date) {
    return new Date(finalRaw.getTime())
  }

  if (Array.isArray(finalRaw)) {
    return finalRaw.map(unwrapVariables)
  }

  // Deep clone object properties to strip any remaining reactivity or circular deps
  const result: any = {}
  Object.keys(finalRaw).forEach((key) => {
    result[key] = unwrapVariables(finalRaw[key]) as any
  })

  return result
}
