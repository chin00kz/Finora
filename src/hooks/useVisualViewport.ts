import { useState, useEffect } from 'react';

export function useVisualViewport() {
  const [viewport, setViewport] = useState({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    offsetTop: 0,
    isKeyboardOpen: false
  });

  useEffect(() => {
    if (!window.visualViewport) return;

    let ticking = false;

    const onResize = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const vv = window.visualViewport;
          if (vv) {
            setViewport(prev => {
              const isKeyboardOpen = vv.height < window.innerHeight * 0.8;
              if (
                Math.abs(prev.height - vv.height) < 1 &&
                Math.abs(prev.offsetTop - vv.offsetTop) < 1 &&
                prev.isKeyboardOpen === isKeyboardOpen
              ) {
                return prev;
              }
              return {
                height: vv.height,
                offsetTop: vv.offsetTop,
                isKeyboardOpen
              };
            });
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    onResize();
    window.visualViewport.addEventListener('resize', onResize);
    window.visualViewport.addEventListener('scroll', onResize);
    
    return () => {
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
    };
  }, []);

  return viewport;
}
