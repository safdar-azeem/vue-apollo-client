import { isRef, unref, Ref, ComputedRef } from 'vue'

export const isComputed = (value: any): boolean => {
  return value && typeof value === 'object' && 'value' in value && 'effect' in value
}

export const unwrapVariables = (variables: any): any => {
  if (!variables) return variables

  if (isRef(variables) || isComputed(variables)) {
    return unwrapVariables(unref(variables))
  }

  if (typeof variables !== 'object' || variables === null) {
    return variables
  }

  if (Array.isArray(variables)) {
    return variables.map(unwrapVariables)
  }

  const result: Record<string, any> = {}
  Object.entries(variables).forEach(([key, value]) => {
    result[key] = unwrapVariables(value)
  })

  return result
}
