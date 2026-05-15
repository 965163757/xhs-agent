import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom'

export function navigateWithTransition(
  navigate: NavigateFunction,
  to: To,
  options?: NavigateOptions,
) {
  const startViewTransition = (document as any).startViewTransition
  if (typeof startViewTransition === 'function') {
    startViewTransition(() => navigate(to, options))
    return
  }
  document.documentElement.classList.add('route-soft-opening')
  window.setTimeout(() => {
    navigate(to, options)
    window.setTimeout(() => {
      document.documentElement.classList.remove('route-soft-opening')
    }, 260)
  }, 80)
}
