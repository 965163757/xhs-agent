import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom'

export function navigateWithTransition(
  navigate: NavigateFunction,
  to: To,
  options?: NavigateOptions,
) {
  const startViewTransition = (document as any).startViewTransition
  if (typeof startViewTransition === 'function') {
    try {
      ;(document as any).startViewTransition(() => navigate(to, options))
      return
    } catch {
      // Fall through to the CSS-based soft navigation when the browser exposes
      // startViewTransition but rejects detached/unsupported invocations.
    }
  }
  document.documentElement.classList.add('route-soft-opening')
  window.setTimeout(() => {
    navigate(to, options)
    window.setTimeout(() => {
      document.documentElement.classList.remove('route-soft-opening')
    }, 260)
  }, 80)
}
