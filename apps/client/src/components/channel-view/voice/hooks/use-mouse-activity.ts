import { useCallback, useEffect, useState } from 'react';

export const useMouseActivity = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [element, setElement] = useState<HTMLElement | null>(null);

  // state instead of a ref so the listeners attach when the stage mounts after the first render
  const stageRef = useCallback((node: HTMLElement | null) => {
    setElement(node);
  }, []);

  const showControls = useCallback(() => setIsVisible(true), []);
  const hideControls = useCallback((event: PointerEvent) => {
    if (event.pointerType !== 'touch') setIsVisible(false);
  }, []);

  useEffect(() => {
    if (!element) return;

    const onOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) {
        setIsVisible(false);
      }
    };

    element.addEventListener('pointerenter', showControls);
    element.addEventListener('pointermove', showControls);
    element.addEventListener('pointerdown', showControls);
    element.addEventListener('touchstart', showControls);
    element.addEventListener('pointerleave', hideControls);
    document.addEventListener('pointerdown', onOutsidePointerDown);

    return () => {
      element.removeEventListener('pointerenter', showControls);
      element.removeEventListener('pointermove', showControls);
      element.removeEventListener('pointerdown', showControls);
      element.removeEventListener('touchstart', showControls);
      element.removeEventListener('pointerleave', hideControls);
      document.removeEventListener('pointerdown', onOutsidePointerDown);
    };
  }, [element, showControls, hideControls]);

  return { isVisible, stageRef };
};
