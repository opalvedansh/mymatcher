import React from 'react';
import { SvgXml } from 'react-native-svg';

const CROWN_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M4.5 16L3.5 9L8 11.5L12 4L16 11.5L20.5 9L19.5 16H4.5Z" stroke="#F05A28" stroke-width="2" stroke-linejoin="round"/>
<circle cx="3.5" cy="8" r="1.5" fill="#F05A28"/>
<circle cx="12" cy="3" r="1.5" fill="#F05A28"/>
<circle cx="20.5" cy="8" r="1.5" fill="#F05A28"/>
<path d="M5.5 19.5H18.5" stroke="#F05A28" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const MINIMAL_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="12" cy="12" r="7" stroke="#F05A28" stroke-width="3.5"/>
</svg>`;

const BOLD_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M13 3L4 14H12L11 21L20 10H12L13 3Z" fill="#F05A28" stroke="#F05A28" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const AUTHENTIC_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 21.5C12 21.5 20 18 20 11.5V5L12 2.5L4 5V11.5C4 18 12 21.5 12 21.5Z" fill="#F05A28"/>
<path d="M9 11.5L11 13.5L15 9.5" stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const GENZ_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M10 3L11.5 7.5L16 9L11.5 10.5L10 15L8.5 10.5L4 9L8.5 7.5L10 3Z" fill="#F05A28" stroke="#F05A28" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M17 14L17.75 16.25L20 17L17.75 17.75L17 20L16.25 17.75L14 17L16.25 16.25L17 14Z" fill="#F05A28" stroke="#F05A28" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

export function PremiumIcon({ size = 24 }: { size?: number }) {
  return <SvgXml xml={CROWN_SVG} width={size} height={size} />;
}

export function MinimalIcon({ size = 24 }: { size?: number }) {
  return <SvgXml xml={MINIMAL_SVG} width={size} height={size} />;
}

export function BoldIcon({ size = 24 }: { size?: number }) {
  return <SvgXml xml={BOLD_SVG} width={size} height={size} />;
}

export function AuthenticIcon({ size = 24 }: { size?: number }) {
  return <SvgXml xml={AUTHENTIC_SVG} width={size} height={size} />;
}

export function GenzIcon({ size = 24 }: { size?: number }) {
  return <SvgXml xml={GENZ_SVG} width={size} height={size} />;
}
