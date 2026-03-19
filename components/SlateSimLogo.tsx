import React from 'react';

interface Props {
  className?: string;
}

export const SlateSimLogo: React.FC<Props> = ({ className = '' }) => {
  return (
    <img
      src="/slatesim-logo-v3.png"
      alt="Slate Sim"
      className={`h-8 sm:h-10 w-auto object-contain ${className}`}
      onError={(event) => {
        const img = event.currentTarget;
        if (img.dataset.logoFallback === '1') return;
        img.dataset.logoFallback = '1';
        img.src = '/slatesim-logo-v2.png';
      }}
    />
  );
};
