import React from 'react';
import { SvgXml } from 'react-native-svg';

const SVG_STRING = 
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">` +
  `<rect x="2" y="2" width="20" height="20" rx="6" ry="6" stroke="#F05A28" stroke-width="2.5"/>` +
  `<path d="M12 7V17M7 12H17" stroke="#F05A28" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;

interface StoriesIconProps {
  size?: number;
}

export function StoriesIcon({ size = 24 }: StoriesIconProps) {
  return (
    <SvgXml xml={SVG_STRING} width={size} height={size} />
  );
}
