import { useState, useEffect } from 'react';

export function useVisualViewport() {
  const [viewport, setViewport] = useState({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    offsetTop: 0,
    isKeyboardOpen: false
  });

  useEffect(() => {
    if (!window.visualViewport) return;

    const onResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      
      const isKeyboardOpen = vv.height < window.innerHeight * 0.8;
      
      setViewport({
        height: vv.height,
        offsetTop: vv.offsetTop,
        isKeyboardOpen
      });
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
