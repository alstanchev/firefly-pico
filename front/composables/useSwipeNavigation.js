import { useSwipe } from '@vueuse/core'
import { animate } from 'animejs'
import { useProfileStore } from '~/stores/profileStore.js'

// Horizontal swipe between sibling pages (previous / next transaction). While dragging, "contentRef" follows the finger,
// on release it slides out and the next page slides in from the opposite edge. Survives the page remount, so the newly
// mounted page knows from which side to enter.
let pendingEnterDirection = null

const NAVIGATE_MIN_DISTANCE = 80
const RESISTANCE = 0.3

export function useSwipeNavigation({ swipeRef, contentRef, isEnabled, hasPrevious, hasNext, onPrevious, onNext }) {
  const profileStore = useProfileStore()
  const hasAnimations = () => profileStore.showAnimations

  let axis = null // 'x' | 'y', decided on the first move of a gesture

  const setOffset = (x) => {
    if (!contentRef.value) return
    contentRef.value.style.transform = x === 0 ? '' : `translateX(${x}px)`
  }

  const canMove = (dx) => (dx < 0 ? hasNext.value : hasPrevious.value)

  const slideTo = (x, duration = 200) => {
    return animate(contentRef.value, { translateX: x, duration, ease: 'outQuad' }).then(() => {
      // Leaving a transform on the wrapper would turn it into a containing block for the fixed Edit button
      if (x === 0) contentRef.value?.style.removeProperty('transform')
    })
  }

  const navigate = async (dx) => {
    const isNext = dx < 0
    if (hasAnimations() && contentRef.value) {
      await slideTo(isNext ? -window.innerWidth : window.innerWidth)
    }
    pendingEnterDirection = isNext ? 'right' : 'left'
    isNext ? onNext() : onPrevious()
  }

  const { lengthX, lengthY } = useSwipe(swipeRef, {
    threshold: 10,
    onSwipeStart() {
      axis = null
    },
    onSwipe() {
      if (!isEnabled.value) return
      if (!axis) {
        axis = Math.abs(lengthY.value) > Math.abs(lengthX.value) ? 'y' : 'x'
      }
      if (axis !== 'x' || !hasAnimations()) return

      const dx = -lengthX.value
      setOffset(canMove(dx) ? dx : dx * RESISTANCE)
    },
    onSwipeEnd() {
      if (!isEnabled.value || axis !== 'x') return
      const dx = -lengthX.value

      if (Math.abs(dx) >= NAVIGATE_MIN_DISTANCE && canMove(dx)) {
        navigate(dx)
        return
      }
      if (hasAnimations() && contentRef.value) {
        slideTo(0)
      }
    },
  })

  // Returns true when it handled the entrance, so the caller can skip its default mount animation
  const animateEnter = async () => {
    const direction = pendingEnterDirection
    pendingEnterDirection = null
    if (!direction || !hasAnimations()) return false

    await nextTick()
    if (!contentRef.value) return false
    setOffset(direction === 'right' ? window.innerWidth : -window.innerWidth)
    await slideTo(0, 250)
    return true
  }

  return { animateEnter }
}
