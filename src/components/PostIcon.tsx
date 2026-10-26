import React from 'react';
import { SvgXml } from 'react-native-svg';

const SVG_STRING = 
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">` +
  `<rect x="7" y="7" width="15" height="15" rx="4" fill="#F05A28" />` +
  `<rect x="0" y="0" width="18" height="18" rx="5" fill="#000000" />` +
  `<rect x="2" y="2" width="14" height="14" rx="3" fill="#F05A28" />` +
  `</svg>`;

interface PostIconProps {
  size?: number;
}

export function PostIcon({ size = 24 }: PostIconProps) {
  return (
    <SvgXml xml={SVG_STRING} width={size} height={size} />
  );
}
